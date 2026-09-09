from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from app.graph.policy import describe_for_confirmation
from app.graph.schemas import FinanceAction
from app.tools import finance, resolve
from app.tools.base import ExecContext

from app import db

WS = UUID("22222222-2222-2222-2222-222222222222")
PLAN = "33333333-3333-3333-3333-333333333333"
ROWS = [
    {
        "kind": "expense",
        "description": "carro",
        "category": None,
        "id": str(UUID(int=i)),
        "installment_no": i,
        "amount_cents": 147000,
        "occurred_at": f"2026-{i:02d}-08",
        "status": "pending",
        "paid_at": None,
    }
    for i in range(1, 9)
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text",
    [
        "Todas as 8 anteriores do carro, marque como pagas",
        "As 8 parcelas anteriores criadas do carro, marque como paga",
    ],
)
async def test_exact_eight_car_confirmation(monkeypatch, text):
    async def fetch(q, *args):
        if "join public.installment_plans" in q:
            return [
                {
                    "tx_id": r["id"],
                    "plan_id": PLAN,
                    "description": "carro",
                    "installments": 48,
                    "total_cents": 7056000,
                    "first_occurred_at": "2026-01-08",
                }
                for r in ROWS
            ]
        if "from public.installment_plans" in q:
            return [
                {
                    "id": PLAN,
                    "description": "carro",
                    "installments": 48,
                    "total_cents": 7056000,
                    "first_occurred_at": "2026-01-08",
                }
            ]
        return ROWS

    monkeypatch.setattr(db, "fetch", fetch)
    action = FinanceAction(type="mark_paid", description="carro")
    target = (await resolve.for_actions(WS, [action], text))[0]
    summary = describe_for_confirmation(action, target)
    assert "11.760" in summary
    assert "1–8" in summary
    assert "70.560" not in summary
    assert len(target["candidates"][0]["installment_snapshot"]["rows"]) == 8


@pytest.mark.asyncio
async def test_legacy_checkpoint_cannot_shift_entire_plan(monkeypatch):
    write = AsyncMock()
    monkeypatch.setattr(db, "execute", write)
    monkeypatch.setattr(
        db, "fetch_one", AsyncMock(return_value={"id": PLAN, "installments": 48})
    )
    ctx = ExecContext(
        user_id=WS,
        workspace_id=WS,
        phone="",
        timezone="America/Sao_Paulo",
        texto="",
        source_message_id="x",
        target={
            "table": "installment_plans",
            "status": "found",
            "candidates": [{"id": PLAN}],
        },
    )
    result = await finance.mark_paid(
        ctx, FinanceAction(type="mark_paid", current_installment=8)
    )
    assert result.read_only
    write.assert_not_awaited()


@pytest.mark.parametrize(
    "changes", [{"current_installment": 9}, {"occurred_at": "2026-01-08"}]
)
def test_old_creation_asks_explicit_payment_history(changes):
    from app.domain.required import faltando

    action = FinanceAction(
        type="create_installment_purchase",
        description="carro",
        amount_cents=7056000,
        installments=48,
        account="Nubank",
        **changes,
    )
    assert faltando(action)[0] == "already_paid_count"


def test_explicit_zero_payment_history_is_complete():
    from app.domain.required import faltando

    action = FinanceAction(
        type="create_installment_purchase",
        description="carro",
        amount_cents=7056000,
        installments=48,
        account="Nubank",
        current_installment=9,
        already_paid_count=0,
    )
    assert faltando(action) is None


@pytest.mark.asyncio
async def test_payment_history_reply_preserves_current_position(monkeypatch):
    from app.domain import draft
    from app.graph.schemas import DraftDecision

    monkeypatch.setattr(
        draft,
        "_classificar",
        AsyncMock(return_value=DraftDecision(decision="answer", already_paid_count=5)),
    )
    original = {
        "type": "create_installment_purchase",
        "installments": 48,
        "current_installment": 9,
        "amount_cents": 7056000,
        "description": "carro",
    }
    answer = await draft.interpretar(
        "paguei só cinco", {"slot": "already_paid_count", "action": original}
    )
    merged = draft.mesclar(original, answer)
    assert merged["already_paid_count"] == 5
    assert merged["current_installment"] == 9
    assert merged["amount_cents"] == 7056000


@pytest.mark.parametrize(
    "text,parsed,expected",
    [
        ("Todas as 8 anteriores do carro", {"mode": "all"}, [1, 2, 3, 4, 5, 6, 7, 8]),
        ("Marque da 3ª até a 8ª", {"mode": "all"}, [3, 4, 5, 6, 7, 8]),
        ("as últimas 2", None, [47, 48]),
        ("paguei a terceira", {"mode": "range", "start": 3, "end": 3}, [3]),
        (
            "até agosto de 2026",
            {"mode": "dates", "through_date": "2026-08-31"},
            list(range(1, 9)),
        ),
    ],
)
def test_scope_selection(text, parsed, expected):
    from app.domain.dates import add_months
    from app.domain.installment_scope import scope_from_text, select_rows
    from app.graph.schemas import InstallmentScope

    rows = [
        {"installment_no": i, "occurred_at": add_months("2026-01-08", i - 1)}
        for i in range(1, 49)
    ]
    selected = select_rows(
        rows,
        scope_from_text(text, InstallmentScope(**parsed) if parsed else None),
        total_installments=48,
    )
    assert [r["installment_no"] for r in selected] == expected


@pytest.mark.parametrize(
    "scope",
    [
        {"mode": "first", "count": 0},
        {"mode": "first", "count": 49},
        {"mode": "range", "start": 8, "end": 3},
        {"mode": "dates"},
        {"mode": "unclear"},
    ],
)
def test_invalid_scope_never_defaults_to_whole_plan(scope):
    from app.domain.installment_scope import select_rows
    from app.graph.schemas import InstallmentScope

    with pytest.raises(ValueError):
        select_rows(ROWS, InstallmentScope(**scope))


@pytest.mark.asyncio
async def test_graph_confirmation_freezes_eight_on_resume(monkeypatch):
    from app.graph import build as graph_module
    from app.graph import nodes
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.types import Command

    async def noop(state):
        return {}

    calls = []

    async def fetch(q, *args):
        calls.append(q)
        if "from public.installment_plans" in q:
            return [
                {
                    "id": PLAN,
                    "description": "carro",
                    "installments": 48,
                    "total_cents": 7056000,
                    "first_occurred_at": "2026-01-08",
                }
            ]
        return ROWS

    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(graph_module, "route", noop)
    monkeypatch.setattr(graph_module, "finance_node", noop)
    executions = []

    async def execute(state, actions):
        executions.append(state["targets"])
        return ["executed"], None, None

    monkeypatch.setattr(nodes, "_executar", execute)
    graph = graph_module.build(InMemorySaver())
    config = {"configurable": {"thread_id": "bounded"}}
    state = {
        "preset": True,
        "domains": ["financas"],
        "workspace_id": str(WS),
        "user_id": str(WS),
        "timezone": "America/Sao_Paulo",
        "phone": "",
        "text": "Todas as 8 anteriores do carro, marque como pagas",
        "finance_actions": [{"type": "mark_paid", "description": "carro"}],
        "confidence": 1.0,
        "results": [],
        "source_message_id": "test",
    }
    first = await graph.ainvoke(state, config)
    prompt = first["__interrupt__"][0].value
    assert prompt["kind"] == "confirmation"
    assert "11.760" in prompt["summary"] and "1–8" in prompt["summary"]
    assert not executions
    read_count = len(calls)
    await graph.ainvoke(Command(resume=True), config)
    assert len(calls) == read_count
    assert len(executions) == 1
    frozen = executions[0][0]["candidates"][0]["installment_snapshot"]
    assert len(frozen["rows"]) == 8 and frozen["total_cents"] == 1176000


@pytest.mark.asyncio
async def test_creation_model_omissions_do_not_shrink_total_or_lose_history(
    monkeypatch,
):
    from app.graph import nodes
    from app.graph.schemas import FinancePlan

    parsed = FinancePlan(
        actions=[
            FinanceAction(
                type="create_installment_purchase",
                description="carro",
                account="Nubank",
                installments=48,
                already_paid_count=8,
            )
        ]
    )
    monkeypatch.setattr(
        nodes.gemini,
        "structured",
        lambda *a: type("Model", (), {"ainvoke": AsyncMock(return_value=parsed)})(),
    )
    result = await nodes.finance_node(
        {
            "text": "Cadastre meu carro no Nubank em 48x de 1470, já paguei as primeiras oito",
            "timezone": "America/Sao_Paulo",
        }
    )
    action = result["finance_actions"][0]
    assert action["amount_cents"] == 7056000
    assert action["current_installment"] == 9
    assert action["already_paid_count"] == 8


def test_financing_with_installments_requires_explicit_paid_history():
    from app.graph.schemas import ResourceAction
    from app.tools.guards import Level1Error
    from app.tools.resources import validate_fields

    values = {
        "kind": "financing",
        "principal_cents": "7056000",
        "remaining_cents": "5880000",
        "interest_rate_monthly": "0",
        "installments": "48",
        "started_at": "2026-01-08",
    }
    action = ResourceAction(
        type="resource_create",
        resource="debts",
        name="carro",
        fields=[{"name": k, "value": v} for k, v in values.items()],
    )
    with pytest.raises(Level1Error, match="já pagou"):
        validate_fields(action)


@pytest.mark.asyncio
async def test_existing_debt_history_does_not_create_new_payment(monkeypatch):
    from app.graph.schemas import ResourceAction
    from app.tools import resources
    from app.tools.guards import Level1Error

    # Quem denuncia a baixa em lote é a ARITMÉTICA do contrato, não uma palavra.
    # O regex antigo barrava qualquer pagamento cuja frase tivesse "parcelas" e
    # deixava passar "quitei as anteriores" — as duas metades erradas.
    contrato = {
        "id": "debt", "row_version": "1", "name": "carro", "archived": False,
        "account_id": "bank", "installment_cents": 147000, "installments": 48,
        "installments_paid": 8, "principal_cents": 7056000,
        "remaining_cents": 5880000, "interest_rate_monthly": 0,
        "calculation_mode": "amortized",
    }

    async def leitura(sql, *args):
        return [contrato] if "public.debts" in sql else [
            {"id": "bank", "name": "Conta", "type": "checking"}
        ]

    monkeypatch.setattr(db, "fetch", leitura)
    escrita = AsyncMock()
    monkeypatch.setattr(db, "fetch_one", escrita)

    def ctx_de(texto):
        return ExecContext(user_id=WS, workspace_id=WS, phone="",
                           timezone="America/Sao_Paulo", texto=texto, source_message_id="x")

    def pagamento(cents):
        return ResourceAction(type="resource_pay", resource="debts", name="carro",
                              fields=[{"name": "amount_cents", "value": str(cents)}])

    # 8 × 1470: em QUALQUER redação, inclusive a que o regex não pegava.
    for texto in ("As 8 parcelas anteriores do financiamento do carro, marque como pagas",
                  "quitei as anteriores do carro",
                  "ja tinha pago isso tudo do carro"):
        with pytest.raises(Level1Error, match="prestações"):
            await resources.prepare(ctx_de(texto), pagamento(1176000))

    # Uma prestação e uma amortização avulsa continuam passando: o veto por
    # palavra barrava as duas quando a frase tinha "parcelas".
    for cents in (147000, 200000):
        proposta = await resources.prepare(
            ctx_de("paguei as parcelas do carro esse mes"), pagamento(cents)
        )
        assert proposta["values"]["amount_cents"] == cents
    escrita.assert_not_awaited()


def test_existing_debt_paid_count_requires_explicit_remaining_baseline():
    from app.graph.schemas import ResourceAction
    from app.tools.guards import Level1Error
    from app.tools.resources import validate_fields

    action = ResourceAction(
        type="resource_update",
        resource="debts",
        name="carro",
        fields=[{"name": "installments_paid", "value": "8"}],
    )
    with pytest.raises(Level1Error, match="saldo devedor"):
        validate_fields(action)


def test_numeric_bound_precedes_model_date_scope():
    from app.domain.installment_scope import scope_from_text
    from app.graph.schemas import InstallmentScope

    scope = scope_from_text(
        "as primeiras 8 do carro",
        InstallmentScope(mode="dates", through_date="2099-01-01"),
    )
    assert scope.mode == "first" and scope.count == 8


@pytest.mark.asyncio
async def test_multiple_plan_bounds_do_not_reuse_global_first_count(monkeypatch):
    from app.graph.schemas import InstallmentScope

    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(db, "fetch", fetch)
    actions = [
        FinanceAction(
            type="mark_paid",
            description="carro",
            installment_scope=InstallmentScope(mode="first", count=8),
        ),
        FinanceAction(
            type="mark_paid",
            description="moto",
            installment_scope=InstallmentScope(mode="last", count=2),
        ),
    ]
    targets = await resolve.for_actions(
        WS, actions, "marque primeiras 8 do carro e últimas 2 da moto como pagas"
    )
    assert all(
        "uma compra por mensagem" in t.get("correction_error", "") for t in targets
    )
    fetch.assert_not_awaited()


def test_last_installments_cannot_shift_when_tail_was_deleted():
    from app.domain.installment_scope import select_rows
    from app.graph.schemas import InstallmentScope

    with pytest.raises(ValueError, match="Faltam"):
        select_rows(
            [{"installment_no": i} for i in range(1, 48)],
            InstallmentScope(mode="last", count=2),
            total_installments=48,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("has_payments", [False, True])
async def test_debt_baseline_correction_only_before_payment_ledger(
    monkeypatch, has_payments
):
    from app.graph.schemas import ResourceAction
    from app.tools import resources
    from app.tools.guards import Level1Error

    old = {
        "id": PLAN,
        "name": "carro",
        "row_version": "7",
        "principal_cents": 7056000,
        "installments": 48,
        "installments_paid": 0,
        "remaining_cents": 7056000,
    }

    async def fetch(query, *args):
        return (
            [{"id": str(WS)}]
            if "public.transactions" in query and has_payments
            else ([] if "public.transactions" in query else [old])
        )

    monkeypatch.setattr(db, "fetch", fetch)
    ctx = ExecContext(
        user_id=WS,
        workspace_id=WS,
        phone="",
        timezone="America/Sao_Paulo",
        texto="corrija o histórico do carro, 8 pagas e saldo atual 50000",
        source_message_id="x",
    )
    action = ResourceAction(
        type="resource_update",
        resource="debts",
        name="carro",
        fields=[
            {"name": "installments_paid", "value": "8"},
            {"name": "remaining_cents", "value": "5000000"},
        ],
    )
    if has_payments:
        with pytest.raises(Level1Error, match="pagamentos registrados"):
            await resources.prepare(ctx, action)
    else:
        proposal = await resources.prepare(ctx, action)
        assert proposal["values"]["installments_paid"] == 8
        assert proposal["values"]["remaining_cents"] == 5000000
