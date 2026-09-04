from uuid import UUID

import pytest

from app import db


@pytest.mark.asyncio
async def test_record_ai_event_congela_workspace_e_canal(monkeypatch):
    chamada = {}

    async def execute(query, *params):
        chamada["query"] = query
        chamada["params"] = params

    monkeypatch.setattr(db, "execute", execute)

    user_id = UUID("11111111-1111-1111-1111-111111111111")
    workspace_id = UUID("22222222-2222-2222-2222-222222222222")
    await db.record_ai_event(
        user_id=user_id,
        workspace_id=workspace_id,
        channel="whatsapp",
        model="gemini-teste",
        confidence=0.9,
        result={"llm_calls": 1},
    )

    assert "workspace_id, channel" in chamada["query"]
    assert chamada["params"][:4] == (user_id, workspace_id, "whatsapp", "gemini-teste")
