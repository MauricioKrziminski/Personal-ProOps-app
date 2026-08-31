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

    async def _executar_falso(state, indexadas):
        """Dublê no ponto onde as DUAS fases passam (segura e pós-SIM).

        Dublar só `execute_node` deixava a fase segura chamando o banco de
        verdade — que é justamente o caminho novo que precisa de cobertura.
        """
        return ["EXECUTOU" for _ in indexadas]

    monkeypatch.setattr(nodes, "_executar", _executar_falso)

    async def alvos_falso(workspace_id, acoes, texto_cru):
        """Dublê da Fase Cognitiva: alvo único e resolvido, salvo se o teste
        tiver pré-carregado `targets` no estado inicial."""
        from app.tools import resolve as _r

        return [
            {"table": "transactions", "status": "found",
             "candidates": [{"id": "tx-1", "label": "gasto de R$ 45,00 em *mercado*"}]}
            if getattr(a, "type", None) in _r.TARGETS else {}
            for a in acoes
        ]

    monkeypatch.setattr(nodes.resolve, "for_actions", alvos_falso)
    monkeypatch.setattr(nodes, "route", router_falso)
    monkeypatch.setattr(nodes, "finance_node", financas_falso)
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
        _estado([{"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500,
             "category": "mercado"}]),
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
        _estado([{"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 480_000,
                  "category": "reforma"}]),
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
        _estado([{"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500,
             "category": "mercado"}]),
        config=config,
    )
    # o dublê de router devolve o fast-path (sem llm_calls); nada a cobrar
    assert estado.get("llm_calls", 0) == 0


def test_chamadas_de_modelo_somam_no_fan_out():
    """Router + dois domínios em paralelo = 3. Reducer errado aqui perderia
    contagem (o `_replace` das outras chaves manteria só a última).

    Assere COMPORTAMENTO, não identidade da função: a versão anterior exigia
    `is operator.add`, e por isso quebrou quando o reducer passou a também zerar
    entre turnos — uma correção de bug, não uma regressão. Teste que prende a
    implementação transforma conserto em falha vermelha.
    """
    import typing

    from app.graph.state import AgentState

    # `from __future__ import annotations` deixa a anotação como string:
    # get_type_hints resolve, include_extras preserva o Annotated
    hints = typing.get_type_hints(AgentState, include_extras=True)
    soma = hints["llm_calls"].__metadata__[0]

    # router (1) e depois os dois domínios do fan-out (1 + 1) = 3
    assert soma(soma(0, 1), 1) == 2
    assert soma(soma(soma(0, 1), 1), 1) == 3


# ---------------------------------------------------------------------------
# Freeze Frame: o alvo é resolvido ANTES da pergunta e congelado no checkpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pergunta_cita_a_linha_real_e_nao_o_eco_do_modelo(grafo):
    """O bug que originou tudo: o usuário lia "apagar a nota sobre última
    mensagem" — o texto que o MODELO escreveu — em vez do registro de verdade."""
    estado = await grafo.ainvoke(
        _estado(
            [{"type": "delete_transaction", "description": "última mensagem"}]
        ),
        config={"configurable": {"thread_id": "freeze-1"}},
    )
    pausa = estado["__interrupt__"][0]
    valor = pausa.value if hasattr(pausa, "value") else pausa

    assert "R$ 45,00" in valor["summary"], valor["summary"]
    assert "última mensagem" not in valor["summary"]


@pytest.mark.asyncio
async def test_alvo_ambiguo_vira_escolha_e_so_id_da_lista_aprova(monkeypatch, grafo):
    from app.graph import nodes

    async def dois_candidatos(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [{"id": "a", "label": "gasto de R$ 45"},
                                {"id": "b", "label": "gasto de R$ 80"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois_candidatos)
    cfg = {"configurable": {"thread_id": "freeze-2"}}

    estado = await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)
    pausa = estado["__interrupt__"][0]
    valor = pausa.value if hasattr(pausa, "value") else pausa
    assert valor["kind"] == "choice"
    assert [o["id"] for o in valor["options"]] == ["a", "b"]

    # um "sim" NÃO escolhe nada: aprovar sem escolher é voltar a adivinhar
    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    assert "EXECUTOU" not in final.get("results", [])


@pytest.mark.asyncio
async def test_escolha_valida_congela_o_id_e_executa(monkeypatch, grafo):
    from app.graph import nodes

    async def dois_candidatos(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [{"id": "a", "label": "gasto de R$ 45"},
                                {"id": "b", "label": "gasto de R$ 80"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois_candidatos)
    cfg = {"configurable": {"thread_id": "freeze-3"}}

    await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)
    final = await grafo.ainvoke(Command(resume="b"), config=cfg)

    assert "EXECUTOU" in final.get("results", [])
    assert final.get("chosen_id") == "b"
    # o alvo ficou CONGELADO no id escolhido, não em "o mais recente"
    assert final["targets"][0]["candidates"] == [{"id": "b", "label": "gasto de R$ 80"}]


@pytest.mark.asyncio
async def test_id_inventado_no_resume_nao_executa(monkeypatch, grafo):
    from app.graph import nodes

    async def dois_candidatos(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [{"id": "a", "label": "x"}, {"id": "b", "label": "y"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois_candidatos)
    cfg = {"configurable": {"thread_id": "freeze-4"}}

    await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)
    final = await grafo.ainvoke(Command(resume="id-que-nao-existe"), config=cfg)

    assert "EXECUTOU" not in final.get("results", [])


# ---------------------------------------------------------------------------
# Execução dividida: o que é seguro grava NA HORA, o sensível espera confirmação
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lote_misto_grava_o_seguro_e_pergunta_o_sensivel(monkeypatch, grafo):
    """"gastei 45 no mercado e apaga o último" não pode segurar o gasto de 45
    esperando uma decisão sobre OUTRA coisa — e um NÃO não pode desfazê-lo."""
    from app.graph import nodes

    async def alvos(workspace_id, acoes, texto_cru):
        from app.tools import resolve as _r

        return [
            {"table": "transactions", "status": "found",
             "candidates": [{"id": "tx-1", "label": "gasto de R$ 80,00"}]}
            if a.type in _r.TARGETS else {}
            for a in acoes
        ]

    monkeypatch.setattr(nodes.resolve, "for_actions", alvos)
    cfg = {"configurable": {"thread_id": "split-1"}}

    estado = await grafo.ainvoke(
        _estado([
            {"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500,
             "category": "mercado"},
            {"type": "delete_transaction"},
        ]),
        config=cfg,
    )

    # a criação JÁ rodou — está no estado ANTES de qualquer pergunta
    assert "EXECUTOU" in estado.get("results", []), estado.get("results")
    # e a deleção está esperando
    assert "__interrupt__" in estado


@pytest.mark.asyncio
async def test_nao_no_lote_misto_preserva_o_que_ja_foi_gravado(monkeypatch, grafo):
    from app.graph import nodes

    async def alvos(workspace_id, acoes, texto_cru):
        from app.tools import resolve as _r

        return [
            {"table": "transactions", "status": "found",
             "candidates": [{"id": "tx-1", "label": "gasto de R$ 80,00"}]}
            if a.type in _r.TARGETS else {}
            for a in acoes
        ]

    monkeypatch.setattr(nodes.resolve, "for_actions", alvos)
    cfg = {"configurable": {"thread_id": "split-2"}}

    await grafo.ainvoke(
        _estado([
            {"type": FinanceActionType.CREATE_EXPENSE.value, "amount_cents": 4500,
             "category": "mercado"},
            {"type": "delete_transaction"},
        ]),
        config=cfg,
    )
    final = await grafo.ainvoke(Command(resume=False), config=cfg)

    # cancelar a deleção não pode apagar o gasto que já foi gravado
    assert "EXECUTOU" in final.get("results", []), final.get("results")
    assert "não fiz nada" in " ".join(final.get("results", []))


@pytest.mark.asyncio
async def test_o_que_o_WORKER_manda_no_resume_o_gate_entende(monkeypatch, grafo):
    """A costura entre worker e gate, que quase passou batido.

    Os outros testes chamam `Command(resume="b")` na mão. O worker NUNCA manda
    isso: ele manda o dict que sai de `_congelado(decide(...))`. O gate aceitava
    só a string, então todo clique e todo "2" digitado caíam no cancelamento —
    o caminho feliz estava morto ponta a ponta e a suíte inteira passava.
    """
    from app.domain import confirm
    from app.graph import nodes
    from app.worker import _congelado

    async def dois(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [{"id": "a", "label": "R$ 45"}, {"id": "b", "label": "R$ 80"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois)
    cfg = {"configurable": {"thread_id": "costura-1"}}
    await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)

    pendente = {"id": "11111111-2222-3333-4444-555555555555",
                "action": {"candidates": [{"id": "a"}, {"id": "b"}]}}

    # 1) clique no botão do segundo candidato
    decisao = confirm.decide({"clicked_id": f"pa:{pendente['id']}:c:b"}, pendente)
    final = await grafo.ainvoke(Command(resume=_congelado(decisao, pendente)), config=cfg)
    assert "EXECUTOU" in final.get("results", []), final.get("results")
    assert final["targets"][0]["candidates"] == [{"id": "b", "label": "R$ 80"}]


@pytest.mark.asyncio
async def test_numero_digitado_tambem_chega_inteiro_no_gate(monkeypatch, grafo):
    from app.domain import confirm
    from app.graph import nodes
    from app.worker import _congelado

    async def dois(workspace_id, acoes, texto_cru):
        return [{"table": "transactions", "status": "ambiguous",
                 "candidates": [{"id": "a", "label": "R$ 45"}, {"id": "b", "label": "R$ 80"}]}
                for _ in acoes]

    monkeypatch.setattr(nodes.resolve, "for_actions", dois)
    cfg = {"configurable": {"thread_id": "costura-2"}}
    await grafo.ainvoke(_estado([{"type": "delete_transaction"}]), config=cfg)

    pendente = {"id": "11111111-2222-3333-4444-555555555555",
                "action": {"candidates": [{"id": "a"}, {"id": "b"}]}}
    decisao = confirm.decide({"text": "1"}, pendente)   # quem não clica, digita
    final = await grafo.ainvoke(Command(resume=_congelado(decisao, pendente)), config=cfg)

    assert "EXECUTOU" in final.get("results", [])
    assert final["chosen_id"] == "a"


@pytest.mark.asyncio
async def test_acao_sem_valor_pede_o_dado_e_NAO_vira_pergunta(grafo):
    """O bug do "Confirma registrar None em 12x?", no grafo inteiro.

    Duas coisas têm que valer ao mesmo tempo: nenhum `interrupt` (não dá para
    confirmar uma ação sem valor) e uma resposta que PEDE o valor — recusar em
    silêncio seria só outra forma de falhar.
    """
    estado = await grafo.ainvoke(
        _estado([{"type": FinanceActionType.CREATE_INSTALLMENT_PURCHASE.value,
                  "installments": 12}]),
        config={"configurable": {"thread_id": "sem-valor"}},
    )

    assert "__interrupt__" not in estado
    assert "None" not in estado["reply"]
    assert "valor" in estado["reply"].lower()
    assert "12x" in estado["reply"]
    assert "EXECUTOU" not in estado.get("results", [])
