"""The delivery job advances fixed monthly reminders through short months."""

from datetime import datetime, timezone

import pytest
from app.jobs import reminders


def instant(year: int, month: int, day: int) -> datetime:
    # 09:00 in America/Sao_Paulo, away from midnight UTC boundaries.
    return datetime(year, month, day, 12, tzinfo=timezone.utc)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("rule", "start", "expected"),
    [
        ("FREQ=MONTHLY;BYMONTHDAY=29", instant(2027, 1, 29), [
            instant(2027, 2, 28), instant(2027, 3, 29),
        ]),
        ("FREQ=MONTHLY;BYMONTHDAY=30", instant(2027, 1, 30), [
            instant(2027, 2, 28), instant(2027, 3, 30),
        ]),
        ("FREQ=MONTHLY;BYMONTHDAY=31", instant(2027, 1, 31), [
            instant(2027, 2, 28), instant(2027, 3, 31), instant(2027, 4, 30),
        ]),
        ("FREQ=MONTHLY", instant(2027, 1, 31), [
            instant(2027, 2, 28), instant(2027, 3, 31), instant(2027, 4, 30),
        ]),
        ("FREQ=MONTHLY;BYMONTHDAY=30", instant(2028, 1, 30), [
            instant(2028, 2, 29), instant(2028, 3, 30),
        ]),
        ("FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=30", instant(2026, 12, 30), [
            instant(2027, 2, 28), instant(2027, 4, 30),
        ]),
        ("FREQ=MONTHLY;INTERVAL=2", instant(2026, 12, 30), [
            instant(2027, 2, 28), instant(2027, 4, 30),
        ]),
        ("FREQ=MONTHLY;BYMONTHDAY=-1", instant(2027, 1, 31), [
            instant(2027, 2, 28), instant(2027, 3, 31),
        ]),
        ("FREQ=MONTHLY;BYMONTHDAY=5,31", instant(2027, 1, 31), [
            instant(2027, 2, 5), instant(2027, 3, 5),
        ]),
    ],
)
async def test_job_keeps_the_reminder_calendar(monkeypatch, rule, start, expected):
    row = {
        "id": "reminder", "user_id": "user", "title": "Pay bill",
        "recurrence": rule, "channel": "push", "next_run_at": start,
        "skip_run_at": None, "parent_reminder_id": None,
        "timezone": "America/Sao_Paulo", "send_attempts": 0,
        "phone": None, "expo_push_token": "token",
        "alerts_whatsapp_enabled": False,
    }
    sent = []
    updates = []

    async def fetch(sql, *args):
        return [row.copy()]

    async def execute(sql, *args):
        updates.append(args)
        row["recurrence"] = args[4]
        return 1

    async def deliver(due):
        sent.append(due["next_run_at"])

    monkeypatch.setattr(reminders.db, "fetch", fetch)
    monkeypatch.setattr(reminders.db, "execute", execute)
    monkeypatch.setattr(reminders, "_entregar", deliver)

    for next_date in expected:
        monkeypatch.setattr(reminders, "now_utc", lambda: row["next_run_at"])
        result = await reminders.run()
        assert result == {"due": 1, "sent": 1, "given_up": 0}
        assert updates[-1][3] == next_date
        row["next_run_at"] = next_date

    assert sent == [start, *expected[:-1]]
    fixed_day = start.day if "BYMONTHDAY" not in rule and start.day >= 29 else None
    assert row["recurrence"] == (f"{rule};BYMONTHDAY={fixed_day}" if fixed_day else rule)


def test_implicit_day_uses_the_reminders_timezone():
    # 31/01 02:00 UTC is still 30/01 23:00 in Sao Paulo.
    at = datetime(2027, 1, 31, 2, tzinfo=timezone.utc)
    assert reminders._fixed_day_for_implicit_monthly(
        "FREQ=MONTHLY", at, "America/Sao_Paulo"
    ) == "FREQ=MONTHLY;BYMONTHDAY=30"
    assert reminders._fixed_day_for_implicit_monthly(
        "FREQ=MONTHLY;BYMONTHDAY=-1", at, "America/Sao_Paulo"
    ) == "FREQ=MONTHLY;BYMONTHDAY=-1"
    assert reminders._fixed_day_for_implicit_monthly(
        "RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=4", at, "America/Sao_Paulo"
    ) == "RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=30;COUNT=4"


@pytest.mark.asyncio
async def test_job_persists_implicit_day_after_last_failed_delivery(monkeypatch):
    at = instant(2027, 1, 31)
    row = {
        "id": "reminder", "user_id": "user", "title": "Pay bill",
        "recurrence": "FREQ=MONTHLY", "channel": "push", "next_run_at": at,
        "skip_run_at": None, "parent_reminder_id": None,
        "timezone": "America/Sao_Paulo", "send_attempts": reminders.MAX_SEND_ATTEMPTS - 1,
        "phone": None, "expo_push_token": "token",
        "alerts_whatsapp_enabled": False,
    }
    updates = []

    async def fetch(sql, *args):
        return [row]

    async def execute(sql, *args):
        updates.append(args)
        return 1

    async def fail(row):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(reminders.db, "fetch", fetch)
    monkeypatch.setattr(reminders.db, "execute", execute)
    monkeypatch.setattr(reminders, "_entregar", fail)
    monkeypatch.setattr(reminders, "now_utc", lambda: at)

    assert await reminders.run() == {"due": 1, "sent": 0, "given_up": 1}
    assert updates[0][3] == instant(2027, 2, 28)
    assert updates[0][4] == "FREQ=MONTHLY;BYMONTHDAY=31"
