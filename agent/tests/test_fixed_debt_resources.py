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
    {"interest_rate_monthly": "0"}, {"principal_cents": 6000000}, {"remaining_cents": 5000000},
])
async def test_fixed_debt_derived_numbers_are_never_edited_directly(fixed_debt, values):
    """Principal, saldo e taxa SAEM da parcela no modo simples — editar um deles direto
    gravaria um contrato que o `check` recusa (ou, pior, um que ele aceita por acaso)."""
    with pytest.raises(Level1Error, match="parcelas fixas"):
        await resources.prepare(fixed_debt, action("resource_update", **values))


# --- financiamento maleável (23/09/2026): o contrato fixo se edita pelo agente -------------


@pytest.mark.asyncio
@pytest.mark.parametrize("values,esperado", [
    ({"installments_paid": 10}, {"installments_paid": 10, "principal_cents": 147000 * 48, "remaining_cents": 147000 * 38}),
    ({"installment_cents": 150000}, {"installment_cents": 150000, "principal_cents": 150000 * 48, "remaining_cents": 150000 * 40}),
    ({"installments": 36}, {"installments": 36, "principal_cents": 147000 * 36, "remaining_cents": 147000 * 28}),
])
async def test_fixed_debt_contract_edit_rederives_the_contract(fixed_debt, values, esperado):
    proposal = await resources.prepare(fixed_debt, action("resource_update", **values))
    for chave, valor in esperado.items():
        assert proposal["values"][chave] == valor, chave


@pytest.fixture
def fixed_debt_with_payment(monkeypatch):
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
        if "public.transactions" in sql:
            return [{"id": "payment", "n": 2, "total": 294000}]
        return [{"id": "bank", "name": "Conta corrente", "type": "checking"}]

    monkeypatch.setattr(resources.db, "fetch", fetch)
    return ExecContext("user", "workspace", None, "America/Sao_Paulo", "carro", "app:1")


@pytest.mark.asyncio
async def test_paid_count_edits_even_with_registered_payments(fixed_debt_with_payment):
    """Decisão do dono do produto: com "Paguei" lançado o contrato continua editável."""
    proposal = await resources.prepare(fixed_debt_with_payment, action("resource_update", installments_paid=10))
    assert proposal["values"]["installments_paid"] == 10


def test_first_due_date_sets_the_due_day_when_missing():
    valores = resources.validate_fields(action(
        "resource_create", kind="financing", calculation_mode="fixed_installments",
        installments=12, installment_cents=10000, installments_paid=0, first_due_date="2026-12-05",
    ))
    assert valores["first_due_date"] == "2026-12-05"
    assert valores["due_day"] == 5


@pytest.mark.asyncio
async def test_delete_de_vez_apaga_pagamentos_e_divida(fixed_debt_with_payment, monkeypatch):
    apagar = action("resource_delete", trashed="true")
    proposal = await resources.prepare(fixed_debt_with_payment, apagar)
    assert proposal["purge"] is True
    assert "DE VEZ" in proposal["summary"] and "2 pagamentos" in proposal["summary"]

    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append((sql, args))
        return {"n": 2}

    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    fixed_debt_with_payment.target = {"prepared": proposal}
    result = await resources.execute(fixed_debt_with_payment, apagar)
    assert any("public.delete_debt" in sql and args[0] == "debt" for sql, args in chamadas)
    assert "2 pagamentos" in result.message


@pytest.mark.asyncio
async def test_delete_sem_de_vez_continua_arquivando(fixed_debt):
    proposal = await resources.prepare(fixed_debt, action("resource_delete"))
    assert proposal["values"] == {"archived": True}
    assert not proposal.get("purge")


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


# --- revisão final (23/09/2026) -----------------------------------------------------------


@pytest.mark.asyncio
async def test_fixed_debt_paid_with_remaining_as_the_prompt_asks_is_derived_not_refused(fixed_debt):
    """O prompt manda "installments_paid e remaining_cents" para dívida existente; no modo fixo o
    saldo SAI da parcela, então o que o modelo mandou é descartado — recusar deixava a correção
    inalcançável por conversa."""
    proposal = await resources.prepare(
        fixed_debt, action("resource_update", installments_paid=12, remaining_cents=1)
    )
    assert proposal["values"]["installments_paid"] == 12
    assert proposal["values"]["remaining_cents"] == 147000 * 36


@pytest.mark.asyncio
async def test_next_due_date_becomes_the_contract_anchor(fixed_debt):
    """"A próxima vence 05/10" numa dívida com 8 pagas: a âncora é a 1ª (05/02), nunca 05/10 —
    gravar a próxima como primeira tiraria 8 meses da projeção."""
    proposal = await resources.prepare(fixed_debt, action("resource_update", next_due_date="2026-10-05"))
    assert proposal["values"]["first_due_date"] == "2026-02-05"
    assert proposal["values"]["due_day"] == 5
    assert "next_due_date" not in proposal["values"]
    assert "próxima parcela: 05/10/2026" in proposal["summary"]
    assert "primeira parcela" not in proposal["summary"]


@pytest.mark.asyncio
async def test_paid_count_never_below_registered_payments(fixed_debt_with_payment):
    """Com 2 pagamentos lançados, dizer "1 paga" faria o próximo "Paguei" repetir o número 2."""
    with pytest.raises(Level1Error, match="lançado"):
        await resources.prepare(fixed_debt_with_payment, action("resource_update", installments_paid=1))


@pytest.mark.asyncio
async def test_purge_rechecks_workspace_and_version(fixed_debt_with_payment, monkeypatch):
    apagar = action("resource_delete", trashed="true")
    proposal = await resources.prepare(fixed_debt_with_payment, apagar)
    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append((sql, args))
        return {"n": 2}

    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    fixed_debt_with_payment.target = {"prepared": proposal}
    await resources.execute(fixed_debt_with_payment, apagar)
    sql, args = chamadas[0]
    assert "workspace_id" in sql and "xmin" in sql, "a exclusão reconfere dono e versão"
    assert args == ("debt", "workspace", "3")


@pytest.mark.asyncio
async def test_paid_floor_counts_the_highest_paid_installment(fixed_debt_with_payment, monkeypatch):
    """O piso é a MAIOR parcela já paga, não só a contagem: um "Paguei" lançado como a 5ª com
    4 pagas deixaria a 5ª paga aparecendo como futura (o mesmo piso do app)."""
    consultas = []
    anterior = resources.db.fetch

    async def fetch(sql, *args):
        consultas.append(sql)
        return await anterior(sql, *args)

    monkeypatch.setattr(resources.db, "fetch", fetch)
    await resources.prepare(fixed_debt_with_payment, action("resource_update", installments_paid=10))
    piso = [q for q in consultas if "public.transactions" in q]
    assert piso and "max(debt_payment_no)" in piso[0]
