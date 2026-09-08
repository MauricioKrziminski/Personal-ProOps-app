"""Regression for the actual photo: choosing another card must never write."""

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from app.graph import build as graph_module, nodes
from app.domain.confirm import parse_click


@pytest.fixture
def graph(monkeypatch):
    async def noop(state):
        return {}

    async def account(*a, **kw):
        return "card-id"

    async def limit(*a, **kw):
        return {
            "excedeu": True,
            "card_name": "Nubank",
            "limite_centavos": 2000000,
            "disponivel_centavos": 2000000,
        }

    from app.tools import finance

    monkeypatch.setattr(finance, "resolve_account", account)
    monkeypatch.setattr(finance, "verificar_limite_disponivel", limit)
    monkeypatch.setattr(graph_module, "route", noop)
    monkeypatch.setattr(graph_module, "finance_node", noop)

    async def writes(state, actions):
        return ["WROTE" for _ in actions], None, None

    monkeypatch.setattr(nodes, "_executar", writes)
    return graph_module.build(InMemorySaver())


def state():
    return {
        "preset": True,
        "domains": ["financas"],
        "workspace_id": "w",
        "user_id": "u",
        "phone": None,
        "timezone": "America/Sao_Paulo",
        "text": "carro 48x de 1470 na nona",
        "finance_actions": [
            {
                "type": "create_installment_purchase",
                "amount_cents": 7056000,
                "installments": 48,
                "current_installment": 9,
                "account": "Nubank",
                "description": "carro",
            }
        ],
        "results": [],
        "source_message_id": "app:test",
        "confidence": 1.0,
    }


@pytest.mark.asyncio
async def test_change_card_preserves_draft_and_never_executes(graph):
    config = {"configurable": {"thread_id": "change"}}
    first = await graph.ainvoke(state(), config)
    assert first["__interrupt__"][0].value["kind"] == "soft_warning"
    last = await graph.ainvoke(
        Command(resume=parse_click("pa:p:c:change_card", "p")), config
    )
    assert "WROTE" not in last["results"]
    assert not last["approved"]
    assert last["draft"]["slot"] == "account"
    assert last["draft"]["action"]["account"] is None
    assert last["draft"]["action"]["amount_cents"] == 7056000
    assert last["draft"]["action"]["current_installment"] == 9


@pytest.mark.asyncio
async def test_plain_yes_confirms_warning(graph):
    config = {"configurable": {"thread_id": "yes"}}
    await graph.ainvoke(state(), config)
    last = await graph.ainvoke(Command(resume=True), config)
    assert "WROTE" in last["results"]


@pytest.mark.asyncio
async def test_warning_approval_does_not_approve_unshown_sibling(graph):
    config = {"configurable": {"thread_id": "sibling"}}
    initial = state()
    initial["resource_actions"] = [
        {
            "type": "resource_create",
            "resource": "accounts",
            "name": "Reserva",
            "fields": [{"name": "type", "value": "savings"}],
        }
    ]
    initial["resource_prepared"] = [{"summary": "criar conta Reserva"}]
    await graph.ainvoke(initial, config)
    second = await graph.ainvoke(Command(resume=True), config)
    assert "WROTE" not in second["results"]
    assert second["__interrupt__"][0].value["summary"] == "criar conta Reserva"
    final = await graph.ainvoke(Command(resume=False), config)
    assert "WROTE" not in final["results"]
