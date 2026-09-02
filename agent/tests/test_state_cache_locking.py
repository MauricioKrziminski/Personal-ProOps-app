"""Testes da Etapa 3.5: State Cache Locking, Herança Estrita e Expansão de Paginação."""

from datetime import date
from uuid import UUID
import pytest

from app import db
from app.graph.schemas import FinanceQuery, FinanceQueryType
from app.tools import queries
from app.tools.base import ExecContext

WS = UUID("22222222-2222-2222-2222-222222222222")
USER_ID = UUID("11111111-1111-1111-1111-111111111111")
CARD_ID = UUID("33333333-3333-3333-3333-333333333333")
CHECKING_ID = UUID("44444444-4444-4444-4444-444444444444")
ITAU_ID = UUID("55555555-5555-5555-5555-555555555555")


class TestStateCacheLocking:
    @pytest.mark.asyncio
    async def test_heranca_estrita_trava_cartao_e_impede_troca_para_conta_corrente(self, monkeypatch):
        """Ao mandar 'me mostre todos', herda o CARD_ID do last_query_data sem trocar para CHECKING_ID."""
        contas_db = [
            {"id": CHECKING_ID, "name": "Nubank Conta", "type": "checking"},
            {"id": CARD_ID, "name": "Nubank Cartão", "type": "credit_card", "closing_day": 25, "due_day": 5},
        ]

        queries_feitas = []

        async def accounts(workspace_id, only_cards=False):
            if only_cards:
                return [c for c in contas_db if c["type"] == "credit_card"]
            return contas_db

        async def fetch(query, *args):
            queries_feitas.append((query, args))
            return [
                {
                    "id": UUID("00000000-0000-0000-0000-000000000001"),
                    "description": "Macbook",
                    "amount_cents": 78000,
                    "category_name": "eletronicos",
                    "kind": "expense",
                    "occurred_at": date(2026, 9, 1),
                    "status": "cleared",
                    "current_installment": 1,
                    "total_installments": 12,
                    "account_name": "Nubank Cartão",
                    "account_type": "credit_card",
                }
            ]

        monkeypatch.setattr(db, "accounts", accounts)
        monkeypatch.setattr(db, "fetch", fetch)

        # Contexto contendo last_query_data da consulta anterior ao Cartão Nubank
        ctx = ExecContext(
            user_id=USER_ID,
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="me mostre todos",
            wa_message_id="w2",
            last_query_data={
                "account_id": str(CARD_ID),
                "account_name": "Nubank Cartão",
                "account_type": "credit_card",
                "periodo": {"de": "2026-08-26", "ate": "2026-09-25"},
            },
        )

        action = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS, account="nubank")
        res = await queries.query_transactions(ctx, action)

        # Verifica que a query no Postgres usou CARD_ID exato e o período da fatura
        assert len(queries_feitas) == 1
        sql, params = queries_feitas[0]
        # params: (workspace_id, account_id, account_id, category, category, de, ate)
        assert params[1] == CARD_ID
        assert params[5] == "2026-08-26"
        assert params[6] == "2026-09-25"
        assert res.data["account_id"] == str(CARD_ID)
        assert res.data["account_type"] == "credit_card"

    @pytest.mark.asyncio
    async def test_troca_de_conta_quando_usuario_cita_explicitamente_outro_banco(self, monkeypatch):
        """Se o usuário citar 'e no Itaú?', o sistema troca de conta mesmo havendo last_query_data."""
        contas_db = [
            {"id": CARD_ID, "name": "Nubank Cartão", "type": "credit_card"},
            {"id": ITAU_ID, "name": "Itaú Corrente", "type": "checking"},
        ]
        queries_feitas = []

        async def accounts(workspace_id, only_cards=False):
            if only_cards:
                return [c for c in contas_db if c["type"] == "credit_card"]
            return contas_db

        async def fetch(query, *args):
            queries_feitas.append((query, args))
            return []

        monkeypatch.setattr(db, "accounts", accounts)
        monkeypatch.setattr(db, "fetch", fetch)

        ctx = ExecContext(
            user_id=USER_ID,
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="e no Itaú?",
            wa_message_id="w3",
            last_query_data={
                "account_id": str(CARD_ID),
                "account_name": "Nubank Cartão",
                "account_type": "credit_card",
            },
        )

        action = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS, account="itau")
        res = await queries.query_transactions(ctx, action)

        assert len(queries_feitas) == 1
        _, params = queries_feitas[0]
        assert params[1] == ITAU_ID
        assert res.data["account_id"] == str(ITAU_ID)
