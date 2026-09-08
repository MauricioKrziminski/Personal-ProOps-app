"""Slot continuations keep their session and all previously collected fields."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, create_autospec

import pytest

from app import conversation
from app.graph import build
from app.graph.schemas import DraftDecision


@pytest.mark.asyncio
@pytest.mark.parametrize("historical", [False, True])
async def test_installment_slots_preserve_session_and_purchase(monkeypatch, historical):
    session = {
        "id": "44444444-4444-4444-4444-444444444444",
        "channel": "app", "phone": None,
        "user_id": "11111111-1111-1111-1111-111111111111",
        "workspace_id": "22222222-2222-2222-2222-222222222222",
        "timezone": "America/Sao_Paulo", "thread_id": "chat", "session_epoch": 1,
    }
    other_session = "55555555-5555-5555-5555-555555555555"
    other_draft = {"id": "other-draft", "action": {"description": "notebook"}}
    drafts = {other_session: deepcopy(other_draft)}
    initial_text = "Comprei um carro em 48x"
    purchase = {
        "type": "create_installment_purchase", "description": "carro",
        "installments": 48, "amount_cents": None, "account": None,
        "current_installment": 9 if historical else 1,
    }

    async def save(**kwargs):
        key = kwargs["session_id"]
        drafts[key] = {**deepcopy(kwargs), "id": "car-draft"}
        return "car-draft"

    # Unlike permissive **kwargs mocks, autospec enforces db.save_draft's
    # required keyword-only session_id before the in-memory persistence runs.
    monkeypatch.setattr(conversation.db, "save_draft", create_autospec(
        conversation.db.save_draft, side_effect=save,
    ))
    monkeypatch.setattr(conversation.db, "open_draft", AsyncMock(
        side_effect=lambda session_id: deepcopy(drafts.get(session_id)),
    ))
    monkeypatch.setattr(conversation.db, "delete_draft", AsyncMock(
        side_effect=lambda session_id: drafts.pop(session_id, None),
    ))
    for name in ("expire_drafts", "expire_pending"):
        monkeypatch.setattr(conversation.db, name, AsyncMock())
    monkeypatch.setattr(conversation.db, "open_pending", AsyncMock(return_value=None))
    monkeypatch.setattr(conversation.db, "accounts", AsyncMock(return_value=[
        {"id": "card-id", "name": "Nubank"},
    ]))
    monkeypatch.setattr(conversation, "_audit", AsyncMock())
    monkeypatch.setattr(conversation.telemetry, "callbacks", list)
    decisions = [DraftDecision(decision="answer", amount_type="per_installment")]
    if historical:
        decisions.append(DraftDecision(decision="answer", already_paid_count=8))
    monkeypatch.setattr(conversation.draft, "_classificar", AsyncMock(side_effect=decisions))
    graph_inputs = []

    class Graph:
        async def aget_state(self, config):
            return SimpleNamespace(values={})

        async def ainvoke(self, state, config):
            graph_inputs.append(deepcopy(state))
            if state.get("preset"):
                return {"finance_actions": state["finance_actions"], "reply": "ready for validation"}
            return {"reply": "Quanto é cada parcela?", "draft": {
                "action": purchase, "raw_text": initial_text,
                "slot": "amount", "missing": "Quanto é cada parcela?",
            }}

    monkeypatch.setattr(build, "graph", lambda: Graph())

    async def turn(text, clicked_id="", history=None):
        return await conversation.run_turn(
            session, source_message_id=f"app:{text}",
            conteudo={"text": text, "clicked_id": clicked_id}, prompt_history=history,
        )

    first = await turn(initial_text)
    assert "parcela" in first
    assert drafts[session["id"]]["slot"] == "amount"
    reply = await turn("48x de 1470")
    saved = drafts[session["id"]]
    assert saved["slot"] == "account"
    assert saved["action"]["amount_cents"] == 7056000
    assert saved["action"]["installments"] == 48
    assert saved["raw_text"] == initial_text
    assert "ds:car-draft:c:card-id" in [button[0] for button in reply["buttons"]]
    assert len(graph_inputs) == 1  # No incomplete purchase reaches execution.

    history = [{"role": "user", "content": initial_text},
               {"role": "assistant", "content": first},
               {"role": "user", "content": "48x de 1470"}]
    reply = await turn("Nubank", "ds:car-draft:c:card-id", history)
    if historical:
        assert "pagas" in reply
        saved = drafts[session["id"]]
        assert saved["slot"] == "already_paid_count"
        assert saved["action"]["account"] == "Nubank"
        assert saved["action"]["amount_cents"] == 7056000
        assert len(graph_inputs) == 1
        reply = await turn("8", history=history)
    assert reply == "ready for validation"
    assert session["id"] not in drafts
    assert drafts[other_session] == other_draft
    final_state = graph_inputs[-1]
    action = final_state["finance_actions"][0]
    assert action["description"] == "carro"
    assert action["amount_cents"] == 7056000
    assert action["installments"] == 48
    assert action["account"] == "Nubank"
    assert action["current_installment"] == (9 if historical else 1)
    if historical:
        assert action["already_paid_count"] == 8
    assert final_state["session_id"] == session["id"]
    assert final_state["messages"][:-1] == history
