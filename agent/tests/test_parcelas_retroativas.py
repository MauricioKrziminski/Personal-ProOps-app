"""Compra parcelada que começou no passado.

"Estou na 4ª parcela de 10" era gravado como uma compra de HOJE em 10x: as dez
parcelas iam para o futuro, o histórico de três meses sumia, e a projeção de
caixa ganhava três meses de dívida que já tinha sido paga (encontrado no teste
ponta a ponta de 31/08/2026).

A correção não é regra nova: a `0013` já gera cada parcela em
`add_months(occurred_at, i-1)` e marca `cleared` toda data que não é futura
(`0013:269,278`). Faltava só recuar a data da PRIMEIRA parcela. Este arquivo
prende a data que sai daqui — é ela que decide tudo o que a RPC faz depois.
"""

from uuid import UUID

import pytest

from app import db
from app.domain.dates import add_months
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance
from app.tools.base import ExecContext

CTX = ExecContext(
    user_id=UUID("11111111-1111-1111-1111-111111111111"),
    workspace_id=UUID("22222222-2222-2222-2222-222222222222"),
    phone="5551999999999",
    timezone="America/Sao_Paulo",
    texto="",
    source_message_id="w1",
)


@pytest.fixture
def rpc(monkeypatch):
    """Captura os argumentos que chegam em `create_installment_plan`."""
    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append(args)
        return {"id": "plano-1"}

    async def conta(workspace_id, name, *, only_cards=False):
        # o parcelado exige CARTÃO: pedir outra coisa aqui é regressão
        assert only_cards is True
        return UUID("33333333-3333-3333-3333-333333333333")

    async def owned(*a, **k):
        return None

    monkeypatch.setattr(db, "fetch_one", fetch_one)
    monkeypatch.setattr(finance, "resolve_account", conta)
    monkeypatch.setattr(finance, "ensure_owned", owned)
    return chamadas


def _acao(**extra):
    return FinanceAction(
        type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
        amount_cents=840000,
        installments=10,
        description="mac",
        account="Nubank",
        occurred_at="2026-08-31",
        **extra,
    )


class TestRetroacao:
    @pytest.mark.asyncio
    async def test_quarta_de_dez_comeca_tres_meses_atras(self, rpc):
        await finance.create_installment_purchase(CTX, _acao(current_installment=4))
        # args: (conta, total, parcelas, quando, descricao, categoria)
        assert rpc[0][3] == "2026-05-31"

    @pytest.mark.asyncio
    async def test_a_parcela_atual_cai_no_mes_corrente(self, rpc):
        """É o efeito que o usuário percebe: a 4ª é a deste mês."""
        await finance.create_installment_purchase(CTX, _acao(current_installment=4))
        primeira = rpc[0][3]
        # a RPC gera a i-ésima em add_months(primeira, i-1)
        assert add_months(primeira, 3)[:7] == "2026-08"

    @pytest.mark.asyncio
    async def test_compra_de_agora_nao_retroage(self, rpc):
        await finance.create_installment_purchase(CTX, _acao())
        assert rpc[0][3] == "2026-08-31"

    @pytest.mark.asyncio
    async def test_primeira_parcela_nao_retroage(self, rpc):
        await finance.create_installment_purchase(CTX, _acao(current_installment=1))
        assert rpc[0][3] == "2026-08-31"

    @pytest.mark.asyncio
    async def test_parcela_impossivel_nao_inventa_passado(self, rpc):
        """"tô na 12ª de 10" é o modelo errando. Retroagir 11 meses criaria um
        histórico que nunca existiu."""
        await finance.create_installment_purchase(CTX, _acao(current_installment=12))
        assert rpc[0][3] == "2026-08-31"

    @pytest.mark.asyncio
    async def test_o_total_nao_muda_com_a_retroacao(self, rpc):
        """Retroagir mexe em QUANDO, nunca em QUANTO."""
        await finance.create_installment_purchase(CTX, _acao(current_installment=4))
        assert rpc[0][1] == 840000
        assert rpc[0][2] == 10

    @pytest.mark.asyncio
    async def test_a_resposta_conta_o_que_foi_feito(self, rpc):
        r = await finance.create_installment_purchase(CTX, _acao(current_installment=4))
        assert "3 anteriores entraram como pagas" in r.message
        assert "4ª" in r.message

    @pytest.mark.asyncio
    async def test_ja_paguei_duas_parcelas_cai_na_terceira_e_retroage_dois_meses(self, rpc):
        """Ao dizer 'já paguei 2 parcelas', current_installment=3 e retroage 2 meses."""
        # Se ocorreu em 2026-09-01 e já pagou 2 (current=3): começa em 2026-07-01
        ctx_setembro = ExecContext(
            user_id=CTX.user_id,
            workspace_id=CTX.workspace_id,
            phone=CTX.phone,
            timezone=CTX.timezone,
            texto="",
            source_message_id="w1",
        )
        acao_set = FinanceAction(
            type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
            amount_cents=1200000,
            installments=12,
            description="macbook",
            account="Nubank",
            occurred_at="2026-09-01",
            current_installment=3,
        )
        r = await finance.create_installment_purchase(ctx_setembro, acao_set)
        # Começa 2 meses atrás (Julho/2026)
        assert rpc[0][3] == "2026-07-01"
        assert "2 anteriores entraram como pagas" in r.message
        assert "3ª" in r.message
