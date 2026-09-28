"""A one-off edit replaces one due occurrence without sending the original."""

from datetime import datetime, timezone

import pytest
from app.jobs import reminders

AT = datetime(2026, 9, 28, 12, tzinfo=timezone.utc)


def due(**changes):
    return {
        "id": "series", "user_id": "user", "title": "Original",
        "recurrence": "FREQ=DAILY", "channel": "push", "next_run_at": AT,
        "timezone": "UTC", "send_attempts": 0, "phone": None,
        "expo_push_token": "token", "alerts_whatsapp_enabled": False,
        "skip_run_at": AT, "parent_reminder_id": None,
        **changes,
    }


@pytest.mark.asyncio
async def test_replaced_occurrence_advances_series_without_delivery(monkeypatch):
    delivered = []
    updates = []

    async def fetch(sql, *args):
        return [due()]

    async def execute(sql, *args):
        updates.append((sql, args))
        return 1

    async def deliver(row):
        delivered.append(row["id"])

    monkeypatch.setattr(reminders.db, "fetch", fetch)
    monkeypatch.setattr(reminders.db, "execute", execute)
    monkeypatch.setattr(reminders, "_entregar", deliver)
    monkeypatch.setattr(reminders, "now_utc", lambda: AT)

    result = await reminders.run()

    assert delivered == []
    assert result["sent"] == 0
    assert len(updates) == 1
    assert updates[0][1][3] == datetime(2026, 9, 29, 12, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_completed_parent_uses_atomic_history_advance(monkeypatch):
    updates = []

    async def fetch(sql, *args):
        return [due(skip_run_at=None)]

    async def execute(sql, *args):
        updates.append((sql, args))
        return 1

    async def deliver(row):
        return None

    monkeypatch.setattr(reminders.db, "fetch", fetch)
    monkeypatch.setattr(reminders.db, "execute", execute)
    monkeypatch.setattr(reminders, "_entregar", deliver)
    monkeypatch.setattr(reminders, "now_utc", lambda: AT)

    await reminders.run()

    assert len(updates) == 1
    assert "finish_reminder_occurrence" in updates[0][0]
    assert "'sent'" in updates[0][0]
    assert AT in updates[0][1]


@pytest.mark.asyncio
async def test_replacement_sends_once_then_deactivates(monkeypatch):
    delivered = []
    updates = []

    async def fetch(sql, *args):
        return [due(id="replacement", recurrence=None, skip_run_at=None, parent_reminder_id="series")]

    async def execute(sql, *args):
        updates.append((sql, args))
        return 1

    async def deliver(row):
        delivered.append(row["id"])

    monkeypatch.setattr(reminders.db, "fetch", fetch)
    monkeypatch.setattr(reminders.db, "execute", execute)
    monkeypatch.setattr(reminders, "_entregar", deliver)
    monkeypatch.setattr(reminders, "now_utc", lambda: AT)

    await reminders.run()

    assert delivered == ["replacement"]
    assert updates[0][1][3] is None


@pytest.mark.asyncio
async def test_failed_replacement_keeps_retrying(monkeypatch):
    updates = []

    async def fetch(sql, *args):
        return [due(id="replacement", recurrence=None, skip_run_at=None, parent_reminder_id="series")]

    async def execute(sql, *args):
        updates.append((sql, args))
        return 1

    async def deliver(row):
        raise RuntimeError("channel unavailable")

    monkeypatch.setattr(reminders.db, "fetch", fetch)
    monkeypatch.setattr(reminders.db, "execute", execute)
    monkeypatch.setattr(reminders, "_entregar", deliver)
    monkeypatch.setattr(reminders, "now_utc", lambda: AT)

    await reminders.run()

    assert updates[0][1][0] == 1


@pytest.mark.asyncio
async def test_replacement_retry_succeeds_once_without_reactivating_parent(monkeypatch):
    child = due(id="replacement", recurrence=None, skip_run_at=None,
                parent_reminder_id="series")
    parent = due()
    child["active"] = parent["active"] = True
    attempts = []

    async def fetch(sql, *args):
        return [row.copy() for row in (parent, child)
                if row["active"] and row["next_run_at"] <= AT]

    async def execute(sql, *args):
        if "finish_reminder_occurrence" in sql:
            row = parent if args[0] == "series" else child
            row["active"] = args[3] is not None
            row["next_run_at"] = args[3] or row["next_run_at"]
            row["skip_run_at"] = None
        else:
            child["send_attempts"] = args[0]
        return 1

    async def deliver(row):
        attempts.append(row["id"])
        if len(attempts) == 1:
            raise RuntimeError("temporary provider failure")

    monkeypatch.setattr(reminders.db, "fetch", fetch)
    monkeypatch.setattr(reminders.db, "execute", execute)
    monkeypatch.setattr(reminders, "_entregar", deliver)
    monkeypatch.setattr(reminders, "now_utc", lambda: AT)

    await reminders.run()
    assert attempts == ["replacement"]
    assert child["send_attempts"] == 1
    assert parent["next_run_at"] == datetime(2026, 9, 29, 12, tzinfo=timezone.utc)

    await reminders.run()
    assert attempts == ["replacement", "replacement"]
    assert child["active"] is False
