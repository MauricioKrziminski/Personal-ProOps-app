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


# --- cadastro no modo simples (o que o agente não conseguia criar) -----------


@pytest.fixture
def workspace(monkeypatch):
    async def fetch(sql, *args):
        return []

    monkeypatch.setattr(resources.db, "fetch", fetch)
    return ExecContext("user", "workspace", None, "America/Sao_Paulo", "carro em 48x", "app:1")


@pytest.mark.asyncio
async def test_financiamento_simples_deriva_principal_saldo_e_taxa(workspace):
    """O contrato inteiro sai da parcela — é o que o check da migration exige.

    Sem isto o agente só sabia criar dívida no modo detalhado e pedia principal
    original, saldo devedor e taxa mensal para sempre, porque não havia resposta
    que completasse o cadastro.
    """
    proposal = await resources.prepare(workspace, action(
        "resource_create", kind="financing", calculation_mode="fixed_installments",
        installments=48, installment_cents=147000, installments_paid=8, due_day=10,
    ))
    valores = proposal["values"]
    assert valores["principal_cents"] == 147000 * 48
    assert valores["remaining_cents"] == 147000 * 40
    assert valores["interest_rate_monthly"] == "0"
    assert valores["calculation_mode"] == "fixed_installments"
    assert "taxa não informada" in proposal["summary"]
    # O zero é aritmética interna: apresentá-lo seria dizer "sem juros" num
    # contrato cujos juros existem e não foram informados. Principal e saldo
    # também saem — são eco da parcela, não dado novo.
    assert "0%" not in proposal["summary"] and "juros" not in proposal["summary"].split("—")[1].split(";")[0]
    assert "principal" not in proposal["summary"] and "fixed_installments" not in proposal["summary"]
    assert "R$ 1.470,00" in proposal["summary"]


@pytest.mark.asyncio
async def test_financiamento_sem_modo_declarado_cai_no_simples(workspace):
    proposal = await resources.prepare(workspace, action(
        "resource_create", kind="financing",
        installments=48, installment_cents=147000, installments_paid=0, due_day=10,
    ))
    assert proposal["values"]["calculation_mode"] == "fixed_installments"
    assert proposal["values"]["remaining_cents"] == 147000 * 48


@pytest.mark.asyncio
async def test_principal_e_taxa_informados_continuam_no_modo_detalhado(workspace):
    proposal = await resources.prepare(workspace, action(
        "resource_create", kind="financing", principal_cents=5000000,
        remaining_cents=4000000, interest_rate_monthly="0.0199",
    ))
    assert proposal["values"]["calculation_mode"] == "amortized"
    assert proposal["values"]["remaining_cents"] == 4000000


@pytest.mark.asyncio
async def test_simples_sem_parcela_pergunta_a_parcela_e_nao_o_principal(workspace):
    with pytest.raises(Level1Error) as erro:
        await resources.prepare(workspace, action(
            "resource_create", kind="financing", installments=48, installments_paid=0,
            due_day=10,
        ))
    assert "valor da parcela" in erro.value.mensagem_usuario
    assert "principal" not in erro.value.mensagem_usuario


@pytest.mark.asyncio
async def test_modo_de_calculo_nao_muda_depois_de_criado(fixed_debt):
    with pytest.raises(Level1Error, match="não muda"):
        await resources.prepare(fixed_debt, action("resource_update", calculation_mode="amortized"))


@pytest.mark.asyncio
async def test_no_de_cadastros_usa_a_acao_pronta_sem_chamar_o_modelo(workspace, monkeypatch):
    """A conversão da compra em financiamento monta a ação FORA do grafo.

    Reextrair aqui gastaria uma chamada para chegar a um resultado pior — o
    texto do turno é "É financiamento", que não descreve contrato nenhum. Este
    teste é também o que prende o FORMATO do dict escrito em `conversation.py`:
    os outros passam por um dublê do grafo e nunca chegam ao `model_validate`.
    """
    from app.graph import nodes

    def nunca(*a, **kw):
        raise AssertionError("ação pronta não pode gastar chamada de modelo")

    monkeypatch.setattr(nodes.gemini, "structured", nunca)
    saida = await nodes.resource_node({
        "user_id": "user", "workspace_id": "workspace", "phone": None,
        "timezone": "America/Sao_Paulo", "text": "É financiamento",
        "source_message_id": "app:1", "messages": [], "preset": True,
        "resource_actions": [{
            "type": "resource_create", "resource": "debts", "name": "carro",
            "fields": [
                {"name": "kind", "value": "financing"},
                {"name": "calculation_mode", "value": "fixed_installments"},
                {"name": "installments", "value": "48"},
                {"name": "installment_cents", "value": "147000"},
                {"name": "installments_paid", "value": "8"},
                {"name": "due_day", "value": "10"},
            ],
        }],
    })
    assert saida["llm_calls"] == 0
    assert saida["resource_draft"] == [] and saida["results"] == []
    assert saida["resource_prepared"][0]["values"]["remaining_cents"] == 147000 * 40


@pytest.mark.asyncio
async def test_no_de_cadastros_sem_acao_pronta_ainda_extrai(workspace, monkeypatch):
    """`preset` do cadastro incompleto fixa só o DOMÍNIO — a mensagem seguinte
    ("nenhuma parcela paga") ainda precisa do modelo."""
    from app.graph import nodes

    chamado = []

    class Modelo:
        async def ainvoke(self, mensagens):
            chamado.append(mensagens)
            from app.graph.schemas import ResourcePlan
            return ResourcePlan(actions=[])

    monkeypatch.setattr(nodes.gemini, "structured", lambda *a, **kw: Modelo())
    saida = await nodes.resource_node({
        "user_id": "user", "workspace_id": "workspace", "phone": None,
        "timezone": "America/Sao_Paulo", "text": "nenhuma parcela paga ainda",
        "source_message_id": "app:2", "messages": [], "preset": True,
        "resource_actions": [],
    })
    assert chamado and saida["llm_calls"] == 1


@pytest.mark.asyncio
async def test_contrato_com_parcelas_pergunta_o_dia_de_vencimento(workspace):
    """Sem o dia, `debt_schedule_for` ancorava no dia de HOJE: a data da próxima
    parcela andava sozinha, e com ela a projeção de caixa e as contas a pagar."""
    with pytest.raises(Level1Error) as erro:
        await resources.prepare(workspace, action(
            "resource_create", kind="financing", installments=48,
            installment_cents=147000, installments_paid=8,
        ))
    assert "que dia do mês vence" in erro.value.mensagem_usuario
    assert "já pagou" not in erro.value.mensagem_usuario  # essa já foi respondida


@pytest.mark.asyncio
async def test_divida_sem_parcelas_nao_pergunta_vencimento(workspace):
    """"Devo 500 pro João" não tem parcela nem cadência — exigir um dia aqui
    seria travar a conversa por um dado que não existe no contrato."""
    proposal = await resources.prepare(workspace, action(
        "resource_create", kind="loan", remaining_cents=50000,
        principal_cents=50000, interest_rate_monthly="0.01",
    ))
    assert proposal["values"].get("due_day") is None
