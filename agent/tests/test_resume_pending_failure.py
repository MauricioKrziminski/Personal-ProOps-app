"""A aprovação só é consumida quando o resume TERMINA.

Antes, `resolve_pending` rodava ANTES do `ainvoke(Command(resume=...))`: o resume
caía no meio (modelo em 402, banco fora, container reciclado), a pendência já
estava `approved`, o retry não a achava mais, o "sim" virava mensagem nova e a
ação aprovada sumia sem aviso.
"""

import pytest
from langgraph.types import Command

from app import conversation
from app.graph import build

from app.graph.nodes import _executar as _EXECUTAR_REAL
from tests.test_hitl_flow import _config, _estado, _pausa, grafo  # noqa: F401

SESSION = {
    "id": "44444444-4444-4444-4444-444444444444",
    "channel": "app",
    "phone": None,
    "user_id": "11111111-1111-1111-1111-111111111111",
    "workspace_id": "22222222-2222-2222-2222-222222222222",
    "timezone": "America/Sao_Paulo",
    "thread_id": "chat",
    "session_epoch": 1,
}


@pytest.mark.asyncio
async def test_resume_que_falha_mantem_a_pendencia_e_o_retry_executa(monkeypatch):
    eventos: list = []
    pendente = {"id": "p1", "thread_id": "chat:1", "action": {"action_type": "create_expense"}}
    aberta = {"v": True}

    async def noop(*a, **k):
        pass

    async def nenhum(*a, **k):
        return None

    async def open_pending(*a):
        return pendente if aberta["v"] else None

    async def resolve_pending(pid, status):
        eventos.append(("resolve", status))
        aberta["v"] = False

    async def decide(*a):
        return {"approved": True}

    for m in ["expire_drafts", "expire_pending", "delete_draft"]:
        monkeypatch.setattr(conversation.db, m, noop)
    monkeypatch.setattr(conversation.db, "open_draft", nenhum)
    monkeypatch.setattr(conversation.db, "open_pending", open_pending)
    monkeypatch.setattr(conversation.db, "resolve_pending", resolve_pending)
    monkeypatch.setattr(conversation.confirm, "decide", decide)
    monkeypatch.setattr(conversation, "_audit", noop)
    monkeypatch.setattr(conversation.telemetry, "callbacks", list)

    falhas = {"n": 1}

    class Graph:
        async def ainvoke(self, entrada, config):
            eventos.append(("resume", config["configurable"]["thread_id"]))
            if falhas["n"]:
                falhas["n"] -= 1
                raise RuntimeError("402 do modelo no meio do resume")
            return {"reply": "✅ Registrado"}

    monkeypatch.setattr(build, "graph", lambda: Graph())
    turno = dict(
        source_message_id="app:click",
        conteudo={"text": "Confirmar", "clicked_id": "pa:p1:ok"},
    )

    with pytest.raises(RuntimeError):
        await conversation.run_turn(SESSION, **turno)
    assert aberta["v"], "resume que falhou NÃO pode consumir a aprovação"
    assert ("resolve", "approved") not in eventos

    assert await conversation.run_turn(SESSION, **turno) == "✅ Registrado"
    assert eventos == [
        ("resume", "chat:1"), ("resume", "chat:1"), ("resolve", "approved"),
    ]


def _escrita_idempotente(monkeypatch, falha_na_acao: int | None):
    """`_executar` REAL com o banco em memória: a reserva de `executed_actions`
    é um dict chaveado por (source_message_id, action_index), como a tabela.
    `falha_na_acao` levanta FORA da tool (entre ações), uma vez."""
    from app.graph import nodes
    from app.tools import registry
    from app.tools.base import ToolResult

    monkeypatch.setattr(nodes, "_executar", _EXECUTAR_REAL)
    reservas: dict = {}
    rodou: list = []

    async def reserve(smid, idx, *a, **k):
        if (smid, idx) in reservas:
            return False
        reservas[(smid, idx)] = None
        return True

    async def confirm(smid, idx, rid):
        reservas[(smid, idx)] = rid

    async def resultado(smid, idx):
        return reservas.get((smid, idx))

    async def noop(*a, **k):
        pass

    for nome, f in [("reserve_execution", reserve), ("confirm_execution", confirm),
                    ("execution_result_id", resultado), ("release_execution", noop)]:
        monkeypatch.setattr(registry.db, nome, f)

    async def tool(ctx, acao):
        rodou.append((ctx.source_message_id, ctx.action_index))
        return ToolResult(f"✅ gasto {ctx.action_index}", result_id=f"tx-{ctx.action_index}")

    monkeypatch.setattr(registry, "_tool", lambda acao: tool)
    falhas = {"n": 1}

    async def regras(workspace_id, acao):
        if falha_na_acao is not None and acao.amount_cents == falha_na_acao and falhas["n"]:
            falhas["n"] -= 1
            raise RuntimeError("banco caiu entre uma ação e outra")
        return acao

    monkeypatch.setattr(nodes, "apply_rules", regras)
    return rodou


def _dois_gastos():
    return _estado([
        {"type": "create_expense", "amount_cents": 4500, "category": "mercado"},
        {"type": "create_expense", "amount_cents": 3000, "category": "uber"},
    ])


@pytest.mark.asyncio
async def test_resume_repetido_depois_de_escrita_parcial_escreve_cada_acao_uma_vez(
    monkeypatch, grafo,  # noqa: F811
):
    """1ª tentativa: o mercado ESCREVE e o processo cai antes do uber. O 2º
    `Command(resume=...)` retoma com a MESMA chave; a reserva pula o mercado e
    só o uber roda."""
    rodou = _escrita_idempotente(monkeypatch, falha_na_acao=3000)
    config = {"configurable": {"thread_id": "resume-parcial"}}
    assert _pausa(await grafo.ainvoke(_dois_gastos(), config=config))["kind"] == "confirmation"

    with pytest.raises(RuntimeError):
        await grafo.ainvoke(Command(resume=True), config=config)
    assert rodou == [("wamid.1", 0)]

    retomado = await grafo.ainvoke(Command(resume=True), config=config)
    assert rodou == [("wamid.1", 0), ("wamid.1", 1)], "cada ação UMA vez"
    assert "gasto 1" in retomado["reply"]


@pytest.mark.asyncio
async def test_resume_repetido_num_thread_ja_terminado_nao_duplica_nem_cala(
    monkeypatch, grafo,  # noqa: F811
):
    """Resume OK e `resolve_pending` falhando depois: a pendência fica aberta e
    o retry manda `Command(resume=...)` num thread que já terminou. O LangGraph
    não roda nó nenhum e devolve o estado final — a mesma resposta, sem
    escrever de novo."""
    rodou = _escrita_idempotente(monkeypatch, falha_na_acao=None)
    config = {"configurable": {"thread_id": "resume-terminado"}}
    await grafo.ainvoke(_dois_gastos(), config=config)
    primeiro = await grafo.ainvoke(Command(resume=True), config=config)
    segundo = await grafo.ainvoke(Command(resume=True), config=config)
    assert rodou == [("wamid.1", 0), ("wamid.1", 1)]
    assert segundo["reply"] and segundo["reply"] == primeiro["reply"]
    assert not segundo.get("__interrupt__")


@pytest.mark.asyncio
async def test_resume_que_faz_nova_pergunta_resolve_a_velha_antes_de_criar_a_nova(
    monkeypatch,
):
    """O índice parcial da 0055 aceita UMA pendência aberta por sessão: criada
    antes de resolver a velha, `create_pending` devolveria a VELHA."""
    eventos: list = []
    pendente = {"id": "p1", "thread_id": "chat:1", "action": {"action_type": "update_transaction"}}

    async def noop(*a, **k):
        pass

    async def nenhum(*a, **k):
        return None

    async def open_pending(*a):
        return pendente

    async def resolve_pending(pid, status):
        eventos.append(("resolve", pid))

    async def create_pending(**k):
        eventos.append(("create", None))
        return {"id": "p2"}

    async def decide(*a):
        return {"approved": True, "candidate_id": "tx-1"}

    for m in ["expire_drafts", "expire_pending", "delete_draft"]:
        monkeypatch.setattr(conversation.db, m, noop)
    monkeypatch.setattr(conversation.db, "open_draft", nenhum)
    monkeypatch.setattr(conversation.db, "open_pending", open_pending)
    monkeypatch.setattr(conversation.db, "resolve_pending", resolve_pending)
    monkeypatch.setattr(conversation.db, "create_pending", create_pending)
    monkeypatch.setattr(conversation.confirm, "decide", decide)
    monkeypatch.setattr(conversation, "_audit", noop)
    monkeypatch.setattr(conversation.telemetry, "callbacks", list)

    class Graph:
        async def ainvoke(self, *a, **k):
            return {"__interrupt__": [{
                "kind": "confirmation", "action_type": "update_transaction",
                "summary": "corrigir mercado para R$ 54,00",
            }]}

    monkeypatch.setattr(build, "graph", lambda: Graph())
    resposta = await conversation.run_turn(
        SESSION, source_message_id="app:click",
        conteudo={"text": "1", "clicked_id": "pa:p1:c:tx-1"},
    )
    assert eventos == [("resolve", "p1"), ("create", None)]
    assert resposta["buttons"][0][0] == "pa:p2:ok"
