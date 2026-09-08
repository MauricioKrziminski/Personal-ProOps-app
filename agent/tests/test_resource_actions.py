import pytest
from app.graph.schemas import ResourceAction, ResourceActionType, ResourceField
from app.tools import resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error
from app.graph.policy import needs_confirmation


def action(resource="cards", kind="resource_create", **values):
    return ResourceAction(
        type=kind,
        resource=resource,
        name="Nubank",
        fields=[
            ResourceField(name=k, value=str(v) if v is not None else None)
            for k, v in values.items()
        ],
    )


def ctx():
    return ExecContext(
        "user", "workspace", None, "America/Sao_Paulo", "cria cartão", "app:1"
    )


@pytest.mark.asyncio
async def test_card_requires_cycle_before_confirmation(monkeypatch):
    async def empty(*a):
        return []

    monkeypatch.setattr(resources.db, "fetch", empty)
    with pytest.raises(Level1Error, match="fechamento"):
        await resources.prepare(ctx(), action())


@pytest.mark.asyncio
async def test_card_validates_explicit_cycle_and_scopes(monkeypatch):
    async def empty(*a):
        return []

    monkeypatch.setattr(resources.db, "fetch", empty)
    prepared = await resources.prepare(
        ctx(), action(closing_day=5, due_day=12, credit_limit_cents=2000000)
    )
    assert prepared["values"]["type"] == "credit_card"
    assert prepared["values"]["closing_day"] == 5
    assert "20.000" in prepared["summary"]
    assert needs_confirmation(action(), 1.0)


@pytest.mark.asyncio
async def test_arbitrary_columns_never_reach_database(monkeypatch):
    with pytest.raises(Level1Error):
        await resources.prepare(ctx(), action(workspace_id="foreign"))


@pytest.mark.asyncio
async def test_card_cycle_out_of_range_rejected():
    with pytest.raises(Level1Error):
        await resources.prepare(ctx(), action(closing_day=32, due_day=12))


@pytest.mark.asyncio
async def test_resource_enum_all_dispatches():
    from app.tools.registry import _tool

    for kind in ResourceActionType:
        assert _tool(action(kind=kind)) is not None


@pytest.mark.asyncio
async def test_payer_from_other_workspace_is_not_resolved(monkeypatch):
    queries = []

    async def fetch(sql, *args):
        queries.append((sql, args))
        return []

    monkeypatch.setattr(resources.db, "fetch", fetch)
    with pytest.raises(Level1Error):
        await resources.prepare(
            ctx(), action(closing_day=5, due_day=12, payment_account_id="foreign-id")
        )
    assert any("workspace_id" in sql and "workspace" in args for sql, args in queries)


@pytest.mark.asyncio
async def test_create_card_graph_waits_for_final_confirmation(monkeypatch):
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.types import Command
    from app.graph import build as graph_module
    from app.graph.schemas import ResourcePlan
    from app.graph import nodes
    import importlib

    async def route(_):
        return {"domains": ["cadastros"], "confidence": 1.0}

    async def fetch(*a):
        return []

    writes = []

    async def one(sql, *args):
        writes.append((sql, args))
        return {"id": "new-id"}

    async def reserve(*a):
        return True

    async def confirmed(*a):
        pass

    class Model:
        async def ainvoke(self, _):
            return ResourcePlan(actions=[action(closing_day=5, due_day=12)])

    monkeypatch.setattr(nodes, "route", route)
    monkeypatch.setattr(nodes.gemini, "structured", lambda *a: Model())
    monkeypatch.setattr(resources.db, "fetch", fetch)
    monkeypatch.setattr(resources.db, "fetch_one", one)
    monkeypatch.setattr(resources.db, "reserve_execution", reserve)
    monkeypatch.setattr(resources.db, "confirm_execution", confirmed)
    importlib.reload(graph_module)
    graph = graph_module.build(InMemorySaver())
    config = {"configurable": {"thread_id": "resource"}}
    first = await graph.ainvoke(
        {
            "workspace_id": "workspace",
            "user_id": "user",
            "phone": None,
            "timezone": "America/Sao_Paulo",
            "text": "cria cartão Nubank fecha 5 vence 12",
            "source_message_id": "app:1",
            "results": [],
        },
        config,
    )
    assert not writes
    assert "fechamento: 5" in first["__interrupt__"][0].value["summary"]
    result = await graph.ainvoke(Command(resume=True), config)
    assert len(writes) == 1
    assert "workspace" in writes[0][1] and "credit_card" in writes[0][1]
    assert "Concluído" in result["reply"]


@pytest.mark.asyncio
async def test_snapshot_change_blocks_update(monkeypatch):
    async def fetch(*a):
        return [{"id": "x", "row_version": "12", "name": "Nubank", "type": "checking"}]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    a = action("accounts", "resource_update", initial_balance_cents=500)
    context = ctx()
    context.target = {"prepared": await resources.prepare(context, a)}
    queries = []

    async def one(sql, *args):
        queries.append(sql)
        return None

    monkeypatch.setattr(resources.db, "fetch_one", one)
    with pytest.raises(Level1Error, match="mudou"):
        await resources.execute(context, a)
    assert "xmin::text = %s" in queries[0] and "workspace_id = %s" in queries[0]


@pytest.mark.asyncio
async def test_invalid_schedule_is_not_replaced_by_now():
    a = action("reminders", title="teste", next_run_at="not-a-date")
    with pytest.raises(Level1Error):
        await resources.prepare(ctx(), a)


def test_resource_schema_budget_and_draft_lifecycle():
    from app.graph.state import _resource_draft

    assert len(ResourceAction.model_fields) * len(ResourceActionType) <= 198
    assert _resource_draft([{"inert": True}], None) == [{"inert": True}]
    assert _resource_draft([{"inert": True}], []) == []


def test_nested_schema_preserves_server_bound_without_gemini_maxitems_product():
    from pydantic import ValidationError
    from app.graph.schemas import ResourcePlan

    schema = ResourcePlan.model_json_schema()
    assert "maxItems" not in schema["$defs"]["ResourceAction"]["properties"]["fields"]
    with pytest.raises(ValidationError, match="20 campos"):
        ResourceAction(
            type="resource_create",
            resource="cards",
            fields=[ResourceField(name="name", value="Nubank")] * 21,
        )
    with pytest.raises(ValidationError):
        ResourcePlan(actions=[action()] * 11)


@pytest.mark.asyncio
async def test_debt_payment_freezes_contract_and_uses_amortization_rpc(monkeypatch):
    async def fetch(sql, *args):
        if "public.debts" in sql:
            return [
                {
                    "id": "debt",
                    "row_version": "3",
                    "name": "Carro",
                    "account_id": "bank",
                    "principal_cents": 6000000,
                    "remaining_cents": 5000000,
                    "archived": False,
                }
            ]
        return [{"id": "bank", "name": "Conta corrente", "type": "checking"}]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    a = action("debts", "resource_pay", amount_cents=147000, paid_at="2026-09-08")
    context = ctx()
    proposal = await resources.prepare(context, a)
    assert "Conta corrente" in proposal["summary"] and "1.470" in proposal["summary"]
    assert needs_confirmation(a, 1.0)
    context.target = {"prepared": proposal}
    queries = []

    async def one(sql, *args):
        queries.append((sql, args))
        return {"remaining_cents": 4903000}

    monkeypatch.setattr(resources.db, "fetch_one", one)
    result = await resources.execute(context, a)
    assert "49.030" in result.message
    sql, args = queries[0]
    assert (
        "materialized" in sql and "for update" in sql and "pay_debt_installment" in sql
    )
    assert "workspace" in args and "3" in args
    assert "linked.type" in sql and "not linked.archived" in sql


@pytest.mark.asyncio
async def test_debt_payment_requires_amount_and_account(monkeypatch):
    async def fetch(*args):
        return [{"id": "debt", "row_version": "3", "name": "Carro", "account_id": None}]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    with pytest.raises(Level1Error, match="valor da prestação"):
        await resources.prepare(ctx(), action("debts", "resource_pay"))
    with pytest.raises(Level1Error, match="Qual conta"):
        await resources.prepare(
            ctx(), action("debts", "resource_pay", amount_cents=147000)
        )
