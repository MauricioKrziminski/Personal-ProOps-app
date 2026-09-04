"""Testes da Etapa 3.8: UX de Paginação Unificada e Preservação de Projeção Futura."""

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


class TestUnifiedCumulativePagination:
    @pytest.mark.asyncio
    async def test_paginacao_acumulativa_unificada_retorna_todos_itens_revelados(self, monkeypatch):
        """Ao clicar em 'Ver mais' (offset 3), a resposta traz TODOS os 8 itens acumulados (1 a 8) em lista única."""
        async def fetch(query, *args):
            return [
                {
                    "id": UUID(f"00000000-0000-0000-0000-{i:012d}"),
                    "description": f"Compra {i}",
                    "amount_cents": 10000 * i,
                    "category_name": "outros",
                    "kind": "expense",
                    "occurred_at": date(2026, 9, i),
                    "status": "cleared",
                    "current_installment": None,
                    "total_installments": None,
                    "account_name": "Nubank Cartão",
                    "account_type": "credit_card",
                }
                for i in range(1, 9)  # 8 itens no total
            ]

        monkeypatch.setattr(db, "fetch", fetch)

        # Contexto de paginação: offset 3
        ctx = ExecContext(
            user_id=USER_ID,
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="ver mais",
            source_message_id="w2",
            clicked_id="qpage:33333333-3333-3333-3333-333333333333:3",
            last_query_data={
                "blueprint": {
                    "account_id": str(CARD_ID),
                    "account_name": "Nubank Cartão",
                    "account_type": "credit_card",
                    "start_date": "2026-08-26",
                    "end_date": "2026-09-25",
                    "offset": 3,
                }
            },
        )

        action = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS)
        res = await queries.query_transactions(ctx, action)

        assert res.data["is_expanded_view"] is True
        assert res.data["total_exibidos"] == 8
        assert len(res.data["lancamentos"]) == 8  # Todos os 8 itens acumulados!
        assert res.data["lancamentos"][0]["description"] == "Compra 1"
        assert res.data["lancamentos"][7]["description"] == "Compra 8"
        assert res.data["resumo_ocultos"] is None

        # Button Sentry: Não há mais itens ocultos, [Ver mais] deve sumir
        if res.interactive_spec:
            botoes = res.interactive_spec.get("buttons", [])
            assert not any("qpage:" in b[0] for b in botoes)
        else:
            assert res.interactive_spec is None

    @pytest.mark.asyncio
    async def test_projecao_futura_bias_preservada_na_paginacao(self, monkeypatch):
        """Ao pedir projeção de 90 dias, a janela até 30/11 é mantida e preservada na paginação."""
        queries_feitas = []

        async def accounts(workspace_id, only_cards=False):
            return [{"id": CARD_ID, "name": "Nubank Cartão", "type": "credit_card", "closing_day": 25}]

        async def fetch(query, *args):
            queries_feitas.append((query, args))
            return [
                {
                    "id": UUID(f"00000000-0000-0000-0000-{i:012d}"),
                    "description": f"Parcela Futura {i}",
                    "amount_cents": 25000,
                    "category_name": "eletronicos",
                    "kind": "expense",
                    "occurred_at": date(2026, 10, i),
                    "status": "pending",
                    "current_installment": i,
                    "total_installments": 10,
                    "account_name": "Nubank Cartão",
                    "account_type": "credit_card",
                }
                for i in range(1, 11)  # 10 parcelas futuras
            ]

        monkeypatch.setattr(db, "accounts", accounts)
        monkeypatch.setattr(db, "fetch", fetch)

        # 1. Turno 1: Usuário pede projeção dos próximos 90 dias
        ctx1 = ExecContext(
            user_id=USER_ID,
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="projeção dos próximos 90 dias do nubank",
            source_message_id="w1",
        )
        action1 = FinanceQuery(
            type=FinanceQueryType.QUERY_TRANSACTIONS,
            account="nubank",
        )
        res1 = await queries.query_transactions(ctx1, action1)

        assert res1.data["blueprint"]["include_projection"] is True
        assert res1.data["blueprint"]["end_date"] > "2026-09-01"
        assert res1.data["total_exibidos"] == 3
        assert len(res1.data["lancamentos"]) == 3

        # 2. Turno 2: Usuário clica em 'Ver mais'
        ctx2 = ExecContext(
            user_id=USER_ID,
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="ver mais",
            source_message_id="w2",
            clicked_id="qpage:33333333-3333-3333-3333-333333333333:3",
            last_query_data=res1.data,
        )
        action2 = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS)
        res2 = await queries.query_transactions(ctx2, action2)

        # Verifica que a busca manteve a data futura original e não resetou para hoje
        assert len(queries_feitas) == 2
        _, params2 = queries_feitas[1]
        assert params2[6] == res1.data["blueprint"]["end_date"]
        # Resposta cumulativa unificada: 8 itens revelados juntos!
        assert res2.data["total_exibidos"] == 8
        assert len(res2.data["lancamentos"]) == 8
