"""The scheduler supplies the historical payment version to each real INSERT.

SQL integration tests prove the history lookup; this test protects the Python-to-SQL
boundary from silently returning to the default/unknown column value.
"""
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.jobs import scheduler


@pytest.mark.asyncio
async def test_materialization_asks_database_for_method_of_occurrence_date(monkeypatch):
    start = datetime(2026, 10, 4, 12, tzinfo=UTC)
    row = {
        "id": uuid4(), "user_id": uuid4(), "workspace_id": uuid4(), "kind": "expense",
        "amount_cents": 1000, "currency": "BRL", "category": "contas", "description": "Conta",
        "merchant": None, "account_id": uuid4(), "rrule": "FREQ=MONTHLY;BYMONTHDAY=4",
        "next_run_at": start, "dtstart": start, "end_date": None, "auto_confirm": False,
        "materialized_until": None, "timezone": "America/Sao_Paulo",
    }
    inserts = []

    async def fetch(sql, *args):
        return [row] if "from public.recurring_transactions" in sql else []

    async def execute(sql, *args):
        if "insert into public.transactions" in sql:
            inserts.append((" ".join(sql.split()), args))

    monkeypatch.setattr(scheduler.db, "fetch", fetch)
    monkeypatch.setattr(scheduler.db, "execute", execute)
    await scheduler.materialize_horizon(datetime(2026, 10, 2, 12, tzinfo=UTC))

    assert inserts, "must exercise real materialization rather than an empty scheduler"
    for sql, args in inserts:
        assert "payment_method" in sql, "scheduler discarded payment metadata"
        assert "private.payment_method_at(%s,%s::date)" in sql
        assert args[-2] == row["id"]
        assert args[-1] == args[9], "method must use the same civil date as the transaction"
