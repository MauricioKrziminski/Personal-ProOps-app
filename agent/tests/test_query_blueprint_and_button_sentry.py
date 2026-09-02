"""Testes da Etapa 3.7: Query Blueprint e Button Sentry (Condição de Parada)."""

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


class TestQueryBlueprintAndButtonSentry:
    @pytest.mark.asyncio
    async def test_paginacao_preserva_datas_customizadas_e_projecao_futura(self, monkeypatch):
        """Ao clicar em 'Ver mais' (qpage:...), preserva a janela com projeção futura até 30/11."""
        queries_feitas = []

        async def fetch(query, *args):
            queries_feitas.append((query, args))
            return [
                {
                    "id": UUID(f"00000000-0000-0000-0000-{i:012d}"),
                    "description": f"Compra {i}",
                    "amount_cents": 10000,
                    "category_name": "outros",
                    "kind": "expense",
                    "occurred_at": date(2026, 10, i),
                    "status": "cleared",
                    "current_installment": i,
                    "total_installments": 10,
                    "account_name": "Nubank Cartão",
                    "account_type": "credit_card",
                }
                for i in range(1, 11)
            ]

        monkeypatch.setattr(db, "fetch", fetch)

        # Contexto contendo last_query_data com blueprint de projeção futura (03/06 a 30/11)
        ctx = ExecContext(
            user_id=USER_ID,
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="ver mais lançamentos anteriores",
            wa_message_id="w2",
            clicked_id="qpage:all:3",
            last_query_data={
                "blueprint": {
                    "account_id": str(CARD_ID),
                    "account_name": "Nubank Cartão",
                    "account_type": "credit_card",
                    "start_date": "2026-06-03",
                    "end_date": "2026-11-30",
                    "include_projection": True,
                    "limit": 5,
                    "offset": 3,
                },
                "periodo": {"de": "2026-06-03", "ate": "2026-11-30"},
            },
        )

        action = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS)
        res = await queries.query_transactions(ctx, action)

        assert len(queries_feitas) == 1
        _, params = queries_feitas[0]
        # params: (workspace_id, account_id, account_id, category, category, de, ate)
        assert params[5] == "2026-06-03"
        assert params[6] == "2026-11-30"
        assert res.data["blueprint"]["start_date"] == "2026-06-03"
        assert res.data["blueprint"]["end_date"] == "2026-11-30"
        assert res.data["total_exibidos"] == 8
        assert res.interactive_spec is not None
        # Verifica que o próximo botão aponta para o offset 8
        botoes = res.interactive_spec["buttons"]
        assert any("qpage:33333333-3333-3333-3333-333333333333:8" in b[0] for b in botoes)

    @pytest.mark.asyncio
    async def test_button_sentry_remove_botao_ver_mais_quando_todos_itens_foram_exibidos(self, monkeypatch):
        """Quando o último item for exibido, o botão 'Ver mais' desaparece da resposta."""
        async def fetch(query, *args):
            return [
                {
                    "id": UUID(f"00000000-0000-0000-0000-{i:012d}"),
                    "description": f"Compra {i}",
                    "amount_cents": 10000,
                    "category_name": "outros",
                    "kind": "expense",
                    "occurred_at": date(2026, 9, i),
                    "status": "cleared",
                    "current_installment": None,
                    "total_installments": None,
                    "account_name": "Nubank Cartão",
                    "account_type": "credit_card",
                }
                for i in range(1, 7)  # 6 itens no total
            ]

        monkeypatch.setattr(db, "fetch", fetch)

        # Página 2: offset = 3, trazendo os 3 itens finais (total_exibidos = 6 de 6)
        ctx = ExecContext(
            user_id=USER_ID,
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="ver mais",
            wa_message_id="w3",
            clicked_id="qpage:all:3",
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

        assert res.data["total_exibidos"] == 6
        assert res.data["total_geral_itens"] == 6
        assert res.data["resumo_ocultos"] is None

        # Button Sentry: Como não há parcelas nem múltiplos meses e todos os 6 itens foram exibidos,
        # nenhum botão 'Ver mais' é gerado.
        if res.interactive_spec:
            botoes = res.interactive_spec.get("buttons", [])
            assert not any("qpage:" in b[0] for b in botoes)
        else:
            assert res.interactive_spec is None
