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

    @pytest.mark.asyncio
    async def test_slicing_sete_itens_primeira_mensagem_exibe_tres_e_renderiza_botao_ver_mais(self, monkeypatch):
        """Com 7 itens no banco, a 1ª consulta exibe 3 itens, acusa 4 ocultas e renderiza botão 'Ver mais'."""
        async def accounts(workspace_id, only_cards=False):
            return [{"id": CARD_ID, "name": "Nubank Cartão", "type": "credit_card", "closing_day": 25}]

        fake_rows = [
            {
                "id": UUID(f"00000000-0000-0000-0000-{i:012d}"),
                "description": f"Compra {i}",
                "amount_cents": 5000 * i,
                "category_name": "outros",
                "kind": "expense",
                "occurred_at": date(2026, 9, i),
                "status": "cleared",
                "current_installment": None,
                "total_installments": None,
                "account_name": "Nubank Cartão",
                "account_type": "credit_card",
            }
            for i in range(1, 8)  # 7 itens no total
        ]

        async def fetch(query, *args):
            return fake_rows

        monkeypatch.setattr(db, "accounts", accounts)
        monkeypatch.setattr(db, "fetch", fetch)

        # Turno 1: Primeira consulta
        ctx1 = ExecContext(
            user_id=USER_ID,
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="gastos no cartão nubank",
            wa_message_id="w1",
        )
        action1 = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS, account="nubank")
        res1 = await queries.query_transactions(ctx1, action1)

        assert res1.data["total_geral_itens"] == 7
        assert res1.data["total_exibidos"] == 3
        assert len(res1.data["lancamentos"]) == 3
        assert res1.data["resumo_ocultos"] is not None
        assert res1.data["resumo_ocultos"]["quantidade_oculta"] == 4
        assert res1.interactive_spec is not None
        assert res1.interactive_spec["ui"] == "buttons"
        botoes1 = res1.interactive_spec["buttons"]
        assert any(b[1] == "Ver mais" and "qpage:" in b[0] for b in botoes1)
        assert any(f"qpage:{CARD_ID}:3" in b[0] for b in botoes1)

        # Turno 2: Clique em 'Ver mais' (offset = 3)
        ctx2 = ExecContext(
            user_id=USER_ID,
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="ver mais",
            wa_message_id="w2",
            clicked_id=f"qpage:{CARD_ID}:3",
            last_query_data=res1.data,
        )
        action2 = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS)
        res2 = await queries.query_transactions(ctx2, action2)

        assert res2.data["total_geral_itens"] == 7
        assert res2.data["total_exibidos"] == 7
        assert len(res2.data["lancamentos"]) == 7  # Todos os 7 itens consolidados!
        assert res2.data["resumo_ocultos"] is None
        assert res2.data["is_expanded_view"] is True
        if res2.interactive_spec:
            botoes2 = res2.interactive_spec.get("buttons", [])
            assert not any("qpage:" in b[0] for b in botoes2)
        else:
            assert res2.interactive_spec is None

    @pytest.mark.asyncio
    async def test_execute_node_preserva_spec_de_botoes_e_last_query_data(self, monkeypatch):
        """O execute_node do grafo preserva reply interativo (spec) e last_query_data sem descartar."""
        from app.graph.nodes import execute_node

        fake_rows = [
            {
                "id": UUID(f"00000000-0000-0000-0000-{i:012d}"),
                "description": f"Compra {i}",
                "amount_cents": 5000,
                "category_name": "outros",
                "kind": "expense",
                "occurred_at": date(2026, 9, i),
                "status": "cleared",
                "current_installment": None,
                "total_installments": None,
                "account_name": "Nubank Cartão",
                "account_type": "credit_card",
            }
            for i in range(1, 8)
        ]

        async def fetch(query, *args):
            return fake_rows

        monkeypatch.setattr(db, "fetch", fetch)

        state = {
            "user_id": str(USER_ID),
            "workspace_id": str(WS),
            "phone": "5551999999999",
            "timezone": "America/Sao_Paulo",
            "wa_message_id": "w1",
            "text": "gastos no nubank",
            "finance_queries": [{"type": "query_transactions", "account": "nubank"}],
            "finance_actions": [],
            "notes_actions": [],
            "targets": [{}],
            "results": [],
            "last_query_data": {},
        }

        ret = await execute_node(state)
        assert "reply" in ret
        assert isinstance(ret["reply"], dict)
        assert ret["reply"]["ui"] == "buttons"
        assert "last_query_data" in ret
        assert ret["last_query_data"]["total_geral_itens"] == 7
        assert ret["last_query_data"]["total_exibidos"] == 3

    @pytest.mark.asyncio
    async def test_projecao_com_query_to_truncada_pelo_llm_expande_para_futuro(self, monkeypatch):
        """Mesmo que o LLM extraia query_to como hoje, pedidos de projeção expandem até o futuro."""
        queries_feitas = []

        async def accounts(workspace_id, only_cards=False):
            return [{"id": CARD_ID, "name": "Nubank Cartão", "type": "credit_card", "closing_day": 25}]

        async def fetch(query, *args):
            queries_feitas.append((query, args))
            return []

        monkeypatch.setattr(db, "accounts", accounts)
        monkeypatch.setattr(db, "fetch", fetch)

        # LLM extraiu query_from = 2026-06-03 e query_to = 2026-09-01 (hoje), mas texto pede projeção futura dos próximos 90 dias
        ctx = ExecContext(
            user_id=USER_ID,
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="me mostre dos ultimos 90 dias com projecao dos proximos 90 dias",
            wa_message_id="w1",
        )
        action = FinanceQuery(
            type=FinanceQueryType.QUERY_TRANSACTIONS,
            query_from="2026-06-03",
            query_to="2026-09-01",
        )
        res = await queries.query_transactions(ctx, action)

        assert len(queries_feitas) == 1
        _, params = queries_feitas[0]
        # params: (workspace_id, account_id, account_id, category, category, de, ate)
        assert params[5] == "2026-06-03"
        assert params[6] > "2026-09-01"  # Data futura expandida (ex: 2026-11-30 ou 2026-12-01)
        assert res.data["blueprint"]["include_projection"] is True
        assert res.data["blueprint"]["end_date"] > "2026-09-01"


