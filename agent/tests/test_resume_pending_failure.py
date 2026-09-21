"""A aprovação só é consumida quando o resume TERMINA.

Antes, `resolve_pending` rodava ANTES do `ainvoke(Command(resume=...))`: o resume
caía no meio (modelo em 402, banco fora, container reciclado), a pendência já
estava `approved`, o retry não a achava mais, o "sim" virava mensagem nova e a
ação aprovada sumia sem aviso.
"""

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app import conversation
from app.graph import build

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


@pytest.mark.asyncio
async def test_resume_repetido_no_grafo_real_executa_uma_vez(monkeypatch, grafo):  # noqa: F811
    """O segundo `Command(resume=...)` num thread cujo resume morreu no meio
    retoma e executa — com o MESMO `source_message_id`, que é a chave de
    `executed_actions` (a escrita parcial da 1ª tentativa é pulada lá)."""
    from app.graph import nodes

    chaves: list[str] = []
    falhas = {"n": 1}

    async def executar(state, indexadas):
        chaves.append(state["source_message_id"])
        if falhas["n"]:
            falhas["n"] -= 1
            raise RuntimeError("banco caiu no meio da escrita")
        return ["EXECUTOU" for _ in indexadas]

    monkeypatch.setattr(nodes, "_executar", executar)
    config = {"configurable": {"thread_id": "resume-falho"}}
    estado = await grafo.ainvoke(
        _estado([{"type": "create_expense", "amount_cents": 4500, "category": "mercado"}]),
        config=config,
    )
    assert _pausa(estado)["kind"] == "confirmation"

    with pytest.raises(RuntimeError):
        await grafo.ainvoke(Command(resume=True), config=config)
    retomado = await grafo.ainvoke(Command(resume=True), config=config)
    assert "EXECUTOU" in retomado["reply"]
    assert chaves == ["wamid.1", "wamid.1"]
