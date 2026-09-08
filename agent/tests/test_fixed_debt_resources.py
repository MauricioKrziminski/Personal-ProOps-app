from unittest.mock import AsyncMock

import pytest

from app.graph.schemas import ResourceAction, ResourceField
from app.tools import resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error


@pytest.fixture
def fixed_debt(monkeypatch):
    async def fetch(sql, *args):
        if "public.debts" in sql:
            return [{
                "id": "debt", "row_version": "3", "name": "Carro",
                "account_id": "bank", "principal_cents": 7056000,
                "remaining_cents": 5880000, "archived": False,
                "installments": 48, "installments_paid": 8,
                "installment_cents": 147000, "interest_rate_monthly": 0,
                "calculation_mode": "fixed_installments",
            }]
        return [{"id": "bank", "name": "Conta corrente", "type": "checking"}]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    return ExecContext("user", "workspace", None, "America/Sao_Paulo", "carro", "app:1")


def action(operation, **values):
    return ResourceAction(
        type=operation, resource="debts", name="Carro",
        fields=[ResourceField(name=k, value=str(v)) for k, v in values.items()],
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("values", [
    {"interest_rate_monthly": "0"}, {"principal_cents": 6000000},
    {"remaining_cents": 5000000}, {"installment_cents": 140000},
    {"installments": 36}, {"installments_paid": 9, "remaining_cents": 5733000},
])
async def test_fixed_debt_financial_edits_require_app_review(fixed_debt, values):
    with pytest.raises(Level1Error, match="parcelas fixas"):
        await resources.prepare(fixed_debt, action("resource_update", **values))


@pytest.mark.asyncio
async def test_fixed_debt_metadata_edit_preserves_unknown_interest(fixed_debt):
    proposal = await resources.prepare(fixed_debt, action("resource_update", due_day=10))
    assert proposal["values"] == {"due_day": 10}
    assert "taxa não informada" in proposal["summary"]
    assert "0%" not in proposal["summary"]


@pytest.mark.asyncio
async def test_fixed_debt_payment_reports_nominal_remaining_installments(fixed_debt, monkeypatch):
    payment = action("resource_pay", amount_cents=147000, paid_at="2026-09-08")
    proposal = await resources.prepare(fixed_debt, payment)
    assert "taxa não informada" in proposal["summary"]
    fixed_debt.target = {"prepared": proposal}
    monkeypatch.setattr(resources.db, "fetch_one", AsyncMock(return_value={"remaining_cents": 5733000}))
    result = await resources.execute(fixed_debt, payment)
    assert "Total das parcelas restantes" in result.message
    assert "57.330" in result.message
    assert "Saldo devedor" not in result.message
