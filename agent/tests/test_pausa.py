from datetime import UTC, date, datetime

import pytest

from app import db
from app.domain.recurrence import em_pausa
from app.jobs import reminders, scheduler


def test_em_pausa_fim_exclusivo():
    de, ate = date(2026, 11, 5), date(2027, 1, 5)
    assert em_pausa("2026-11-05", de, ate)
    assert em_pausa(date(2026, 12, 5), de, ate)
    assert not em_pausa("2027-01-05", de, ate)
    assert not em_pausa("2026-11-04", de, ate)


def test_sem_pausa():
    assert not em_pausa("2026-11-05", None, None)


@pytest.mark.asyncio
async def test_agendador_pula_a_data_pausada_e_avanca_o_cursor(monkeypatch):
    agora = datetime(2026, 10, 7, 12, tzinfo=UTC)
    rec = {
        "id": "s", "user_id": "u", "workspace_id": "w", "rrule": "FREQ=MONTHLY;BYMONTHDAY=5",
        "next_run_at": datetime(2026, 11, 5, 12, tzinfo=UTC), "dtstart": datetime(2026, 11, 5, 12, tzinfo=UTC),
        "end_date": None, "materialized_until": None, "edit_revision": 1, "timezone": "UTC",
        "paused_from": date(2026, 11, 5), "paused_until": date(2026, 12, 5),
    }
    chamadas, updates = [], []

    async def fetch(sql, *args):
        return [rec] if "from public.recurring_transactions r" in sql else []

    async def materialize(r, dia, ja):
        chamadas.append(dia)
        return {"intent_current": True, "created": True}

    async def execute(sql, *args):
        updates.append(args)
        return 1

    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "execute", execute)
    monkeypatch.setattr(scheduler, "_materialize_occurrence", materialize)
    await scheduler.materialize_horizon(agora)
    assert "2026-11-05" not in chamadas
    assert "2026-12-05" in chamadas
    assert updates and updates[0][1] is not None  # cursor avançou (materialized_until)


@pytest.mark.asyncio
async def test_lembrete_na_pausa_nao_entrega_e_avanca(monkeypatch):
    at = datetime(2026, 11, 10, 12, tzinfo=UTC)
    row = {
        "id": "r", "user_id": "u", "title": "t", "recurrence": "FREQ=DAILY", "channel": "push",
        "next_run_at": at, "timezone": "UTC", "send_attempts": 0, "phone": None,
        "expo_push_token": "t", "alerts_whatsapp_enabled": False, "skip_run_at": None,
        "parent_reminder_id": None, "paused_from": date(2026, 11, 5), "paused_until": date(2026, 12, 5),
    }
    entregues, updates = [], []

    async def fetch(sql, *args):
        return [row]

    async def execute(sql, *args):
        updates.append(sql)
        return 1

    async def entregar(r):
        entregues.append(r)

    monkeypatch.setattr(reminders.db, "fetch", fetch)
    monkeypatch.setattr(reminders.db, "execute", execute)
    monkeypatch.setattr(reminders, "_entregar", entregar)
    monkeypatch.setattr(reminders, "now_utc", lambda: at)
    await reminders.run()
    assert entregues == []
    assert len(updates) == 1 and "finish_reminder_occurrence" in updates[0]
