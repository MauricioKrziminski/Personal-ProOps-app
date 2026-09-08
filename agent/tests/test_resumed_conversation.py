"""A resumed graph must persist its next question/draft at the conversation boundary."""

import pytest
from app import conversation
from app.graph import build

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
@pytest.mark.parametrize("next_step", ["draft", "confirmation"])
async def test_resume_persists_next_step_instead_of_returning_stale_reply(
    monkeypatch, next_step
):
    async def noop(*a, **k):
        pass

    async def no_draft(*a, **k):
        return None

    pending = {
        "id": "pending",
        "thread_id": "chat:1",
        "action": {
            "kind": "soft_warning",
            "action_type": "create_installment_purchase",
            "candidates": [],
        },
    }

    async def open_pending(*a):
        return pending

    async def decide(*a):
        return {"approved": True, "candidate_id": "change_card"}

    for method in [
        "expire_drafts",
        "expire_pending",
        "resolve_pending",
        "delete_draft",
    ]:
        monkeypatch.setattr(conversation.db, method, noop)
    monkeypatch.setattr(conversation.db, "open_draft", no_draft)
    monkeypatch.setattr(conversation.db, "open_pending", open_pending)
    monkeypatch.setattr(conversation.confirm, "decide", decide)
    monkeypatch.setattr(conversation, "_audit", noop)
    monkeypatch.setattr(conversation.telemetry, "callbacks", lambda: [])
    state = {"reply": "old checkpoint reply"}
    saved = []
    if next_step == "draft":
        state["draft"] = {
            "action": {
                "type": "create_installment_purchase",
                "account": None,
                "amount_cents": 7056000,
                "installments": 48,
                "current_installment": 9,
            },
            "raw_text": "carro 48x1470 na nona",
            "slot": "account",
            "missing": "Qual outro cartão?",
        }

        async def save_draft(**kwargs):
            saved.append(kwargs)
            return "new-draft"

        async def accounts(*a, **k):
            return []

        monkeypatch.setattr(conversation.db, "save_draft", save_draft)
        monkeypatch.setattr(conversation.db, "accounts", accounts)
    else:
        state["__interrupt__"] = [
            {
                "kind": "confirmation",
                "action_type": "update_transaction",
                "summary": "corrigir mercado para R$ 54,00 na conta Reserva",
            }
        ]

        async def create_pending(**kwargs):
            saved.append(kwargs)
            return {"id": "next-pending"}

        monkeypatch.setattr(conversation.db, "create_pending", create_pending)

    class Graph:
        async def ainvoke(self, *a, **k):
            return state

    monkeypatch.setattr(build, "graph", lambda: Graph())
    reply = await conversation.run_turn(
        SESSION,
        source_message_id="app:click",
        conteudo={"text": "Trocar de Cartão", "clicked_id": "pa:pending:c:change_card"},
    )
    assert len(saved) == 1, (
        "next step must be persisted, not only present in graph memory"
    )
    assert isinstance(reply, dict) and reply["ui"] == "buttons"
    if next_step == "draft":
        assert saved[0]["action"]["account"] is None
        assert saved[0]["action"]["current_installment"] == 9
    else:
        assert reply["buttons"][0][0] == "pa:next-pending:ok"
