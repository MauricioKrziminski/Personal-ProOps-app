"""Protect the service SQL boundary; live SQL fixtures prove database effects."""
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from app.graph.schemas import FinanceAction, ResourceAction, ResourceField
from app.jobs import importer, scheduler
from app.tools import finance, resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error


@pytest.mark.asyncio
async def test_import_suggestion_inherits_detail_only_from_user_rule(monkeypatch):
    child = uuid4()
    writes = []

    async def one(sql, *args):
        if "from public.accounts" in sql:
            return {"id": uuid4(), "type": "checking"}
        if "insert into public.import_batches" in sql:
            return {"id": uuid4()}
        if "match_rule" in sql:
            return {"category": "alimentação", "subcategory_id": child}
        return None

    async def fetch(sql, *args):
        return []

    async def execute(sql, *args):
        writes.append((sql, args))

    async def classify(*args, **kwargs):
        return [("restaurante", "compra")]

    monkeypatch.setattr(importer.db, "fetch_one", one)
    monkeypatch.setattr(importer.db, "fetch", fetch)
    monkeypatch.setattr(importer.db, "execute", execute)
    monkeypatch.setattr(importer, "classify_statement_lines", classify)
    await importer.run(user_id=uuid4(), workspace_id=uuid4(), account_id=uuid4(),
                       content="Data,Descrição,Valor\n03/10/2026,Mercado,-12.50\n", source="csv")
    inserted = [(sql, args) for sql, args in writes if "insert into public.import_items" in sql]
    assert len(inserted) == 1
    sql, args = inserted[0]
    assert "suggested_subcategory_id" in sql
    assert child in args


@pytest.mark.asyncio
async def test_scheduler_uses_temporal_parent_with_temporal_child(monkeypatch):
    start = datetime(2026, 10, 4, 12, tzinfo=UTC)
    row = {"id": uuid4(), "user_id": uuid4(), "workspace_id": uuid4(), "kind": "expense",
               "amount_cents": 1000, "currency": "BRL", "category": "current", "description": "Conta",
               "merchant": None, "account_id": None, "rrule": "FREQ=MONTHLY;BYMONTHDAY=4",
               "next_run_at": start, "dtstart": start, "end_date": None, "auto_confirm": False,
               "materialized_until": None, "timezone": "America/Sao_Paulo", "edit_revision": 1}
    inserts = []

    async def fetch(sql, *args):
        return [row] if "from public.recurring_transactions" in sql else []

    async def one(sql, *args):
        if "insert into public.transactions" in sql:
            inserts.append((" ".join(sql.split()), args))
            return {"intent_current": True, "created": True}

    async def execute(sql, *args):
        return 1

    monkeypatch.setattr(scheduler.db, "fetch", fetch)
    monkeypatch.setattr(scheduler.db, "execute", execute)
    monkeypatch.setattr(scheduler.db, "fetch_one", one)
    await scheduler.materialize_horizon(datetime(2026, 10, 2, 12, tzinfo=UTC))
    assert inserts
    for sql, args in inserts:
        assert "then v.category else r.category end" in sql
        assert "private.recurring_subcategory_at(r.id,i.day)" in sql
        assert "subcategory_snapshot_set" in sql
        assert args[:4] == (row["id"], row["edit_revision"], row["rrule"], row["dtstart"])
        assert args[4] >= "2026-10-04"


def test_resource_child_is_optional_but_explicit_null_is_preserved():
    base = {"type": "resource_update", "resource": "rules", "name": "mercado"}
    assert resources.validate_fields(ResourceAction(**base)) == {}
    assert resources.validate_fields(ResourceAction(**base, fields=[
        ResourceField(name="subcategory_id", value=None)])) == {"subcategory_id": None}


def test_resource_rejects_guessed_child_name_or_invalid_id():
    for value in ("mercado", "111", ""):
        with pytest.raises(Level1Error):
            resources.validate_fields(ResourceAction(type="resource_update", resource="rules", name="mercado",
                fields=[ResourceField(name="subcategory_id", value=value)]))


@pytest.mark.asyncio
async def test_rule_child_lookup_is_closed_to_workspace_and_final_parent(monkeypatch):
    workspace, child = uuid4(), uuid4()
    calls = []

    async def one(sql, *args):
        calls.append((sql, args))
        return {"subcategory_id": child}

    monkeypatch.setattr(finance.db, "fetch_one", one)
    action = FinanceAction(type="create_expense", amount_cents=100, description="mercado", category="alimentação")
    assert await finance._subcategory_from_rule(workspace, action, "alimentação") == child
    assert calls[0][1] == (workspace, "mercado alimentação", "alimentação")
    assert "private.fold(category)=private.fold(%s)" in calls[0][0]
    calls.clear()
    assert await finance._subcategory_from_rule(workspace, action, None) is None
    assert calls == [], "missing parent must never borrow a child"


@pytest.mark.asyncio
async def test_created_transaction_writes_proven_rule_child_in_same_insert(monkeypatch):
    workspace, child = uuid4(), uuid4()
    inserts = []

    async def one(sql, *args):
        if "match_rule_subcategory" in sql:
            return {"subcategory_id": child}
        if "insert into public.transactions" in sql:
            inserts.append((sql, args))
        return {"id": uuid4()}

    monkeypatch.setattr(finance.db, "fetch_one", one)
    ctx = ExecContext(uuid4(), workspace, None, "America/Sao_Paulo", "gasto", "app:1")
    await finance.create_transaction(ctx, FinanceAction(type="create_expense", amount_cents=100,
        description="mercado", category="alimentação", account="sem conta", occurred_at="2026-10-03"))
    assert len(inserts) == 1
    sql, args = inserts[0]
    assert "subcategory_id, subcategory_snapshot_set" in sql
    assert args[-1] == child


@pytest.mark.asyncio
async def test_resource_child_refuses_different_parent_before_proposal(monkeypatch):
    child = uuid4()

    async def fetch(sql, *args):
        if "from public.categorization_rules" in sql:
            return [{"id": uuid4(), "pattern": "mercado", "category": "saúde", "row_version": "1"}]
        return []

    monkeypatch.setattr(resources.db, "fetch", fetch)
    ctx = ExecContext(uuid4(), uuid4(), None, "America/Sao_Paulo", "gasto", "app:1")
    with pytest.raises(Level1Error, match="categoria e ao espaço"):
        await resources.prepare(ctx, ResourceAction(type="resource_update", resource="rules", name="mercado",
            fields=[ResourceField(name="subcategory_id", value=str(child))]))
