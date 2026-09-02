"""Testes da Etapa 3.3: Progressive Disclosure, Agrupamento Dinâmico e Paginação."""

from datetime import date
from uuid import UUID
import pytest

from app import db
from app.graph.schemas import FinanceQuery, FinanceQueryType
from app.services.gemini import _fallback_format_query
from app.tools import queries
from app.tools.base import ExecContext

WS = UUID("22222222-2222-2222-2222-222222222222")
USER_ID = UUID("11111111-1111-1111-1111-111111111111")
CARD_ID = UUID("33333333-3333-3333-3333-333333333333")


def _ctx(texto: str = "todos os lançamentos no cartão") -> ExecContext:
    return ExecContext(
        user_id=USER_ID,
        workspace_id=WS,
        phone="5551999999999",
        timezone="America/Sao_Paulo",
        texto=texto,
        wa_message_id="w1",
    )


class TestProgressiveDisclosure:
    @pytest.mark.asyncio
    async def test_consulta_com_muitos_itens_aplica_revelacao_progressiva_e_botoes(self, monkeypatch):
        """Com 8 lançamentos, exibe os 3 mais recentes, resumo de 5 ocultos e botões interativos."""
        async def accounts(workspace_id, only_cards=False):
            return [{"id": CARD_ID, "name": "Nubank Cartão", "type": "credit_card", "closing_day": 25}]

        fake_rows = [
            {
                "id": UUID(f"00000000-0000-0000-0000-00000000000{i}"),
                "description": f"Compra {i}",
                "amount_cents": 10000 * i,
                "category_name": "geral",
                "kind": "expense",
                "occurred_at": date(2026, 8, 20 + i),
                "status": "cleared",
                "current_installment": 1 if i % 2 == 0 else None,
                "total_installments": 10 if i % 2 == 0 else None,
                "account_name": "Nubank Cartão",
                "account_type": "credit_card",
            }
            for i in range(1, 9)
        ]

        async def fetch(query, *args):
            return fake_rows

        monkeypatch.setattr(db, "accounts", accounts)
        monkeypatch.setattr(db, "fetch", fetch)

        action = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS, account="nubank")
        ctx = _ctx("todos os lançamentos do nubank")

        res = await queries.query_transactions(ctx, action)

        assert res.read_only is True
        assert res.interactive_spec is not None
        assert res.interactive_spec["ui"] == "buttons"
        assert len(res.interactive_spec["buttons"]) >= 2
        # Primeiro botão é Ver mais
        assert res.interactive_spec["buttons"][0][1] == "Ver mais"
        # Deve haver botão de Ver Parcelas porque há parcelamento
        titulos_botoes = [b[1] for b in res.interactive_spec["buttons"]]
        assert "Ver Parcelas" in titulos_botoes

    @pytest.mark.asyncio
    async def test_consulta_com_poucos_itens_exibe_todos_diretamente(self, monkeypatch):
        """Com 3 lançamentos (<= 5), exibe todos diretamente sem botões de paginação."""
        async def accounts(workspace_id, only_cards=False):
            return [{"id": CARD_ID, "name": "Nubank Cartão", "type": "credit_card"}]

        fake_rows = [
            {
                "id": UUID(f"00000000-0000-0000-0000-00000000000{i}"),
                "description": f"Compra {i}",
                "amount_cents": 5000,
                "category_name": "geral",
                "kind": "expense",
                "occurred_at": date(2026, 9, 1),
                "status": "cleared",
                "current_installment": None,
                "total_installments": None,
                "account_name": "Nubank Cartão",
                "account_type": "credit_card",
            }
            for i in range(1, 4)
        ]

        async def fetch(query, *args):
            return fake_rows

        monkeypatch.setattr(db, "accounts", accounts)
        monkeypatch.setattr(db, "fetch", fetch)

        action = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS, account="nubank")
        ctx = _ctx("gastos de hoje no nubank")

        res = await queries.query_transactions(ctx, action)

        assert res.read_only is True
        # <= 5 itens: sem necessidade de spec interativo de paginação
        assert res.interactive_spec is None


class TestFallbackFormatProgressive:
    def test_fallback_com_resumo_oculto(self):
        data = {
            "periodo": {"de_br": "01/08/2026", "ate_br": "31/08/2026"},
            "filtro_conta": "Nubank",
            "total_gastos_centavos": 150000,
            "lancamentos": [
                {
                    "description": f"Item {i}",
                    "amount_cents": 10000,
                    "amount_brl": "R$ 100,00",
                    "kind": "expense",
                    "occurred_at": "15/08/2026",
                    "installment_label": None,
                }
                for i in range(1, 4)
            ],
            "resumo_ocultos": {
                "quantidade_oculta": 12,
                "total_gastos_ocultos_centavos": 120000,
            },
        }
        texto = _fallback_format_query(data)
        assert "Item 1" in texto
        assert "Item 3" in texto
        assert "outras 12 compras" in texto
        assert "R$ 1.200,00" in texto
