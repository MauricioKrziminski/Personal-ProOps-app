"""Testes da Correção Sistêmica: Smart Windows e Separação Estrita de Contas."""

from datetime import date
from uuid import UUID
import pytest

from app import db
from app.domain.dates import add_months, local_iso_date
from app.domain.matching import infer_account_type, match_accounts
from app.graph.schemas import FinanceQuery, FinanceQueryType
from app.tools import queries
from app.tools.base import ExecContext

WS = UUID("22222222-2222-2222-2222-222222222222")
USER_ID = UUID("11111111-1111-1111-1111-111111111111")
CARD_ID = UUID("33333333-3333-3333-3333-333333333333")
CHECKING_ID = UUID("44444444-4444-4444-4444-444444444444")


def _ctx(texto: str = "") -> ExecContext:
    return ExecContext(
        user_id=USER_ID,
        workspace_id=WS,
        phone="5551999999999",
        timezone="America/Sao_Paulo",
        texto=texto,
        wa_message_id="w1",
    )


class TestInferAccountType:
    def test_modificadores_de_cartao(self):
        assert infer_account_type("qual o limite do meu cartão nubank?") == "credit_card"
        assert infer_account_type("quanto tá a fatura do nubank?") == "credit_card"
        assert infer_account_type("compras no crédito este mês") == "credit_card"
        assert infer_account_type("ver parcelas do cartão itaú") == "credit_card"

    def test_modificadores_de_conta_corrente(self):
        assert infer_account_type("qual o saldo da conta nubank?") == "checking"
        assert infer_account_type("quanto recebi de salário na conta?") == "checking"
        assert infer_account_type("extrato de débito do itaú") == "checking"
        assert infer_account_type("qual o saldo do pix?") == "checking"

    def test_sem_modificadores_retorna_none(self):
        assert infer_account_type("quanto gastei no nubank?") is None
        assert infer_account_type("resumo geral") is None


class TestMatchAccountsPorTipo:
    def test_desempate_por_subtipo(self):
        linhas = [
            {"id": CHECKING_ID, "name": "Nubank", "type": "checking"},
            {"id": CARD_ID, "name": "Nubank", "type": "credit_card"},
        ]
        # Quando o usuário fala em cartão, seleciona o cartão
        achados_cartao = match_accounts("nubank", linhas, account_type="credit_card")
        assert len(achados_cartao) == 1
        assert achados_cartao[0]["id"] == CARD_ID

        # Quando o usuário fala em conta corrente, seleciona a conta corrente
        achados_conta = match_accounts("nubank", linhas, account_type="checking")
        assert len(achados_conta) == 1
        assert achados_conta[0]["id"] == CHECKING_ID


class TestSmartWindows:
    @pytest.mark.asyncio
    async def test_comando_todos_define_janela_ampla(self, monkeypatch):
        queries_feitas = []
        hoje = local_iso_date("America/Sao_Paulo")

        async def accounts(workspace_id, only_cards=False):
            return [{"id": CHECKING_ID, "name": "Itaú", "type": "checking"}]

        async def fetch(query, *args):
            queries_feitas.append((query, args))
            return []

        monkeypatch.setattr(db, "accounts", accounts)
        monkeypatch.setattr(db, "fetch", fetch)

        action = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS)
        ctx = _ctx("mostre todos os meus lançamentos")

        await queries.query_transactions(ctx, action)

        assert len(queries_feitas) == 1
        _, args = queries_feitas[0]
        de, ate = args[5], args[6]
        assert de == add_months(hoje, -12)
        assert ate == hoje

    @pytest.mark.asyncio
    async def test_comando_hoje_define_apenas_hoje(self, monkeypatch):
        queries_feitas = []
        hoje = local_iso_date("America/Sao_Paulo")

        async def accounts(workspace_id, only_cards=False):
            return [{"id": CHECKING_ID, "name": "Itaú", "type": "checking"}]

        async def fetch(query, *args):
            queries_feitas.append((query, args))
            return []

        monkeypatch.setattr(db, "accounts", accounts)
        monkeypatch.setattr(db, "fetch", fetch)

        action = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS)
        ctx = _ctx("gastos de hoje")

        await queries.query_transactions(ctx, action)

        assert len(queries_feitas) == 1
        _, args = queries_feitas[0]
        de, ate = args[5], args[6]
        assert de == hoje
        assert ate == hoje

    @pytest.mark.asyncio
    async def test_sem_data_em_conta_corrente_busca_ultimos_30_dias(self, monkeypatch):
        queries_feitas = []
        hoje = local_iso_date("America/Sao_Paulo")

        async def accounts(workspace_id, only_cards=False):
            return [{"id": CHECKING_ID, "name": "Itaú Corrente", "type": "checking"}]

        async def fetch(query, *args):
            queries_feitas.append((query, args))
            return []

        monkeypatch.setattr(db, "accounts", accounts)
        monkeypatch.setattr(db, "fetch", fetch)

        action = FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS, account="itaú")
        ctx = _ctx("extrato da conta itaú")

        await queries.query_transactions(ctx, action)

        assert len(queries_feitas) == 1
        _, args = queries_feitas[0]
        de, ate = args[5], args[6]
        assert de == add_months(hoje, -1)
        assert ate == hoje
