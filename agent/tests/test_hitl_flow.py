"""O ciclo completo do HITL: o grafo PARA, guarda o estado, e retoma no
`Command(resume=...)` — que é o que faz uma confirmação sobreviver ao container
morrer entre a pergunta e o "sim". Num canal assíncrono como WhatsApp esse
intervalo é o caso normal, não a exceção.

Sem rede e sem banco: os nós que falam com o mundo são substituídos.
"""

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.config import get_settings
from app.graph import build as build_mod
from app.graph.schemas import FinanceActionType


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("HITL_AMOUNT_THRESHOLD_CENTS", "100000")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def grafo(monkeypatch):
    """Grafo real, com router/domínio/execução substituídos por dublês.

    Só estes três falam com o mundo (Gemini e Postgres). Gate, arestas,
    checkpointer e interrupt são os DE VERDADE — é isso que o teste verifica.
    """
    from app.graph import nodes

    async def router_falso(state):
        return {"domains": ["financas"], "confidence": state.get("confidence", 1.0)}

    async def financas_falso(state):
        # o plano já vem pronto no estado inicial: o dublê só não chama o modelo
        return {}

    async def executar_falso(state):
        return {"results": [*state.get("results", []), "EXECUTOU"]}

    monkeypatch.setattr(nodes, "route", router_falso)
    monkeypatch.setattr(nodes, "finance_node", financas_falso)
    monkeypatch.setattr(nodes, "execute_node", executar_falso)
    # o build resolve os nós no momento da montagem
    import importlib

    importlib.reload(build_mod)
    return build_mod.build(InMemorySaver())


def _estado(acoes):
    return {
        "thread_id": "t1", "phone": "5551999999999", "user_id": "u1",
        "workspace_id": "w1", "timezone": "America/Sao_Paulo",
        "wa_message_id": "wamid.1", "text": "teste", "media": None,
        "results": [], "domains": [], "finance_actions": [], "finance_queries": [],
        "notes_actions": [],
        "confidence": 1.0, "approved": False, "halted": False,
    } | {"finance_actions": acoes}


@pytest.mark.asyncio
async def test_gasto_comum_executa_sem_perguntar(grafo):
    config = {"configurable": {"thread_id": "sem-pergunta"}}
    estado = await grafo.ainvoke(
        _estado([{"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500}]),
        config=config,
    )
    assert "__interrupt__" not in estado
    assert "EXECUTOU" in estado["reply"]


@pytest.mark.asyncio
async def test_destrutiva_para_e_so_executa_depois_do_sim(grafo):
    config = {"configurable": {"thread_id": "com-pergunta"}}
    acao = [{"type": FinanceActionType.UNDO_LAST.value}]

    estado = await grafo.ainvoke(_estado(acao), config=config)
    # parou ANTES de executar
    pausa = estado["__interrupt__"][0]
    valor = getattr(pausa, "value", pausa)
    assert valor["reason"] == "destrutiva"
    assert "apagar" in valor["summary"]

    # o "sim" retoma na MESMA thread e aí sim executa
    retomado = await grafo.ainvoke(Command(resume=True), config=config)
    assert "EXECUTOU" in retomado["reply"]


@pytest.mark.asyncio
async def test_nao_cancela_sem_executar(grafo):
    config = {"configurable": {"thread_id": "recusa"}}
    await grafo.ainvoke(_estado([{"type": FinanceActionType.UNDO_LAST.value}]), config=config)

    recusado = await grafo.ainvoke(Command(resume=False), config=config)
    assert "EXECUTOU" not in recusado["reply"]
    assert "não fiz nada" in recusado["reply"]


@pytest.mark.asyncio
async def test_valor_alto_tambem_para(grafo):
    config = {"configurable": {"thread_id": "valor-alto"}}
    estado = await grafo.ainvoke(
        _estado([{"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 480_000}]),
        config=config,
    )
    valor = getattr(estado["__interrupt__"][0], "value", estado["__interrupt__"][0])
    assert valor["reason"] == "valor alto"


@pytest.mark.asyncio
async def test_fast_path_nao_consome_mensagem_da_cota(grafo):
    """`llm_calls` é o que vira linha em `ai_events`, e `ai_events` é o que a cota
    do plano CONTA. Um caminho que não chamou modelo cobrando mensagem do usuário
    é bug de cobrança, não de código."""
    from app.graph import nodes

    config = {"configurable": {"thread_id": "fast-path"}}
    estado = await grafo.ainvoke(
        _estado([{"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500}]),
        config=config,
    )
    # o dublê de router devolve o fast-path (sem llm_calls); nada a cobrar
    assert estado.get("llm_calls", 0) == 0


@pytest.mark.asyncio
async def test_chamadas_de_modelo_somam_no_fan_out():
    """Router + dois domínios em paralelo = 3. Reducer errado aqui perderia
    contagem (o `_replace` das outras chaves manteria só a última)."""
    import operator
    import typing

    from app.graph.state import AgentState

    # `from __future__ import annotations` deixa a anotação como string:
    # get_type_hints resolve, include_extras preserva o Annotated
    hints = typing.get_type_hints(AgentState, include_extras=True)
    assert hints["llm_calls"].__metadata__[0] is operator.add
