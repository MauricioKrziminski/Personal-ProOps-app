"""Testes da Etapa 3.2: Cognitive Reading, Janela de Fatura e Filtro Estrito de Conta."""

from datetime import date
from uuid import UUID
import pytest

from app import db
from app.domain.dates import invoice_cycle_window
from app.graph.schemas import FinanceQuery, FinanceQueryType
from app.services.gemini import _fallback_format_query
from app.tools import queries
from app.tools.base import ExecContext

WS = UUID("22222222-2222-2222-2222-222222222222")
USER_ID = UUID("11111111-1111-1111-1111-111111111111")
CARD_ID = UUID("33333333-3333-3333-3333-333333333333")
CHECKING_ID = UUID("44444444-4444-4444-4444-444444444444")


def _ctx(texto: str = "quanto gastei no nubank esse mês?") -> ExecContext:
    return ExecContext(
        user_id=USER_ID,
        workspace_id=WS,
        phone="5551999999999",
        timezone="America/Sao_Paulo",
        texto=texto,
        wa_message_id="w1",
    )


class TestInvoiceCycleWindow:
    def test_dia_primeiro_do_mes_captura_fim_do_mes_anterior(self):
        """No dia 01/09, com fechamento no dia 25, a fatura ativa começou em 26/08 e fecha em 25/09."""
        de, ate = invoice_cycle_window(closing_day=25, occurred_date="2026-09-01")
        assert de == "2026-08-26"
        assert ate == "2026-09-25"

    def test_dia_trinta_do_mes_anterior_cai_na_fatura_de_setembro(self):
        """Em 30/08 (após o fechamento do dia 25/08), a fatura ativa também fecha em 25/09."""
        de, ate = invoice_cycle_window(closing_day=25, occurred_date="2026-08-30")
        assert de == "2026-08-26"
        assert ate == "2026-09-25"

    def test_dia_apos_fechamento_abre_fatura_do_mes_seguinte(self):
        """Em 28/09 (após 25/09), a fatura ativa abre em 26/09 e fecha em 25/10."""
        de, ate = invoice_cycle_window(closing_day=25, occurred_date="2026-09-28")
        assert de == "2026-09-26"
        assert ate == "2026-10-25"


class TestQueryTransactionsFiltroConta:
    @pytest.mark.asyncio
    async def test_filtro_estrito_de_conta_e_janela_fatura(self, monkeypatch):
        """Consulta sobre 'nubank' busca apenas account_id do cartão Nubank e aplica janela da fatura."""
        queries_feitas = []

        async def accounts(workspace_id, only_cards=False):
            return [
                {
                    "id": CARD_ID,
                    "name": "Nubank Cartão",
                    "type": "credit_card",
                    "closing_day": 25,
                    "due_day": 5,
                },
                {
                    "id": CHECKING_ID,
                    "name": "Itaú Corrente",
                    "type": "checking",
                },
            ]

        async def fetch(query, *args):
            queries_feitas.append((query, args))
            return [
                {
                    "id": UUID("55555555-5555-5555-5555-555555555555"),
                    "description": "Macbook Pro",
                    "amount_cents": 780000,
                    "category_name": "eletrônicos",
                    "kind": "expense",
                    "occurred_at": date(2026, 8, 30),
                    "status": "cleared",
                    "current_installment": 1,
                    "total_installments": 12,
                    "account_name": "Nubank Cartão",
                    "account_type": "credit_card",
                }
            ]

        monkeypatch.setattr(db, "accounts", accounts)
        monkeypatch.setattr(db, "fetch", fetch)

        action = FinanceQuery(
            type=FinanceQueryType.QUERY_TRANSACTIONS,
            account="nubank",
        )
        ctx = _ctx("quanto gastei no nubank esse mês?")

        res = await queries.query_transactions(ctx, action)

        assert len(queries_feitas) == 1
        q, args = queries_feitas[0]
        # workspace_id, account_id, account_id, category, category, de, ate
        assert args[0] == WS
        assert args[1] == CARD_ID
        assert args[2] == CARD_ID
        # Janela de fatura capturou o início em 26/08 e fim em 25/09 (ou no mês corrente)
        assert args[5] <= "2026-08-30"  # de
        assert args[6] >= "2026-08-30"  # ate
        assert res.read_only is True


class TestFormatadorQuery:
    def test_fallback_format_query_exibe_parcelas_corretamente(self):
        data = {
            "periodo": {"de": "2026-08-26", "ate": "2026-09-25", "de_br": "26/08/2026", "ate_br": "25/09/2026"},
            "filtro_conta": "Nubank",
            "total_gastos_centavos": 780000,
            "total_receitas_centavos": 0,
            "lancamentos": [
                {
                    "id": "1",
                    "description": "Macbook Pro",
                    "amount_cents": 780000,
                    "amount_brl": "R$ 7.800,00",
                    "category_name": "eletrônicos",
                    "kind": "expense",
                    "occurred_at": "30/08/2026",
                    "account_name": "Nubank",
                    "installment_label": "1/12",
                }
            ],
        }
        res = _fallback_format_query(data)
        assert "Macbook Pro" in res
        assert "R$ 7.800,00" in res
        assert "(1/12)" in res
        assert "Nubank" in res
