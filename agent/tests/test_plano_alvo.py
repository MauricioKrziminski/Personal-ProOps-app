"""Compra parcelada como ALVO — apagar inteira e dar baixa retroativa.

Dois pedidos do teste ponta a ponta de 31/08/2026 não tinham como funcionar:

- "exclua a TV por completo": `delete_transaction` apaga UMA linha por id. Com 10
  parcelas o resolver devolvia empate, e cada "sim" matava uma parcela — deixando
  o plano órfão dizendo `installments = 10` com nove parcelas vivas.
- "já paguei a terceira parcela": `mark_paid` marcava uma transação E reescrevia
  `occurred_at = hoje`, o que dispara `set_invoice` (0013:211) e arranca a parcela
  da fatura em que ela nasceu.

A correção não somou tipo nenhum ao enum (`FinanceAction` está em 14×14 = 196 e o
teto provado é 198): o ALVO é que passou a poder ser uma linha de
`installment_plans`.
"""

from uuid import UUID

import pytest

from app import db
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance
from app.tools.base import ExecContext

WS = UUID("22222222-2222-2222-2222-222222222222")

PLANO = {
    "id": "plano-1",
    "description": "TV",
    "installments": 10,
    "total_cents": 840000,
    "parcelas": 10,
    "first_occurred_at": "2026-05-15",
}


def _ctx(tabela: str, alvo_id: str = "plano-1") -> ExecContext:
    return ExecContext(
        user_id=UUID("11111111-1111-1111-1111-111111111111"),
        workspace_id=WS,
        phone="5551999999999",
        timezone="America/Sao_Paulo",
        texto="",
        wa_message_id="w1",
        target={"table": tabela, "status": "found",
                "candidates": [{"id": alvo_id, "label": "TV — tudo (10x)", "table": tabela}]},
    )


@pytest.fixture
def sql(monkeypatch):
    """Captura o SQL emitido, que é o que decide o efeito no banco."""
    executados = []

    async def fetch_one(query, *args):
        if "installment_plans" in query:
            return dict(PLANO)
        if "from public.transactions" in query and "count" in query:
            return {"count": 0}
        return None

    async def execute(query, *args):
        executados.append((" ".join(query.split()), args))
        return 3  # linhas afetadas

    monkeypatch.setattr(db, "fetch_one", fetch_one)
    monkeypatch.setattr(db, "execute", execute)
    return executados


class TestApagarCompraInteira:
    @pytest.mark.asyncio
    async def test_apaga_o_PLANO_e_deixa_o_cascade_trabalhar(self, sql):
        r = await finance.delete_transaction(
            _ctx("installment_plans"),
            FinanceAction(type=FinanceActionType.DELETE_TRANSACTION),
        )
        query, args = sql[0]
        assert query.startswith("delete from public.installment_plans")
        # escopo de workspace no where, como toda mutação do projeto
        assert "workspace_id = %s" in query
        assert args == ("plano-1", WS)
        assert "10 parcelas" in r.message

    @pytest.mark.asyncio
    async def test_alvo_de_transacao_continua_apagando_UMA(self, monkeypatch):
        """A regressão que este arquivo não pode causar: quem pede uma parcela
        continua apagando uma parcela."""
        executados = []

        async def fetch_one(query, *args):
            return {"id": "tx-1", "kind": "expense", "amount_cents": 8400,
                    "category": None, "description": "TV (3/10)"}

        async def execute(query, *args):
            executados.append(" ".join(query.split()))
            return 1

        monkeypatch.setattr(db, "fetch_one", fetch_one)
        monkeypatch.setattr(db, "execute", execute)

        await finance.delete_transaction(
            _ctx("transactions", "tx-1"),
            FinanceAction(type=FinanceActionType.DELETE_TRANSACTION),
        )
        assert executados[0].startswith("delete from public.transactions")


class TestBaixaRetroativa:
    @pytest.mark.asyncio
    async def test_marca_da_primeira_ate_a_informada_com_shifting(self, sql):
        r = await finance.mark_paid(
            _ctx("installment_plans"),
            FinanceAction(type=FinanceActionType.MARK_PAID, current_installment=3),
        )
        # Primeiro sql: update em installment_plans ajustando first_occurred_at
        q_plan, args_plan = sql[0]
        assert "update public.installment_plans set first_occurred_at = %s" in q_plan
        assert args_plan[1] == "plano-1"
        assert args_plan[2] == WS
        # Atualizou as 10 parcelas
        assert len(sql) == 1 + 10
        assert "3 parcelas constam como pagas" in r.message

    @pytest.mark.asyncio
    async def test_parcela_fora_da_faixa_nao_vira_update_maluco(self, sql):
        """"já paguei a 30ª de 10" é o modelo errando; o guard clampa para 1."""
        r = await finance.mark_paid(
            _ctx("installment_plans"),
            FinanceAction(type=FinanceActionType.MARK_PAID, current_installment=30),
        )
        assert "1 parcelas constam como pagas" in r.message or "1ª é a parcela" in r.message


class TestBaixaEmLancamentoUnico:
    """"Paguei a luz" também não pode mover a data.

    O app parou de reescrever `occurred_at` na 0046; o agente continuava. Ficava
    a divergência: a mesma ação, pelo WhatsApp, migrava o lançamento de mês — e
    numa parcela de cartão o trigger `set_invoice` ainda a arrancava da fatura em
    que nasceu, que é exatamente a armadilha que o ramo de plano já evitava.
    """

    @pytest.fixture
    def sql(self, monkeypatch):
        executados = []

        async def fetch_one(query, *args):
            return {"id": "tx-1", "description": "luz", "category": "casa",
                    "amount_cents": 12000}

        async def execute(query, *args):
            executados.append((" ".join(query.split()), args))
            return 1

        monkeypatch.setattr(db, "fetch_one", fetch_one)
        monkeypatch.setattr(db, "execute", execute)
        return executados

    @pytest.mark.asyncio
    async def test_grava_paid_at_e_NAO_occurred_at(self, sql):
        r = await finance.mark_paid(
            _ctx("transactions", "tx-1"),
            FinanceAction(type=FinanceActionType.MARK_PAID),
        )
        query, _ = sql[0]
        assert "paid_at = %s" in query
        assert "occurred_at" not in query
        assert "Baixa dada" in r.message

    @pytest.mark.asyncio
    async def test_escopo_de_workspace_no_where(self, sql):
        await finance.mark_paid(
            _ctx("transactions", "tx-1"),
            FinanceAction(type=FinanceActionType.MARK_PAID),
        )
        assert "workspace_id = %s" in sql[0][0]


class TestEdicaoPlano:
    @pytest.mark.asyncio
    async def test_update_em_plano_com_current_installment_atualiza_parcelas_pagas(self, sql):
        r = await finance.update_transaction(
            _ctx("installment_plans"),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, current_installment=3),
        )
        assert len(sql) == 1 + 10
        assert "3 parcelas constam como pagas" in r.message

    @pytest.mark.asyncio
    async def test_update_em_plano_sem_parcelas_informa_opcoes(self, monkeypatch):
        r = await finance.update_transaction(
            _ctx("installment_plans"),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=5000),
        )
        assert "mudar as parcelas pagas ou excluir" in r.message


class TestAlvoDefensivo:
    @pytest.mark.asyncio
    async def test_candidatos_vazios_nao_causam_index_error(self):
        ctx_vazio = ExecContext(
            user_id=UUID("11111111-1111-1111-1111-111111111111"),
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="",
            wa_message_id="w1",
            target={"table": "installment_plans", "status": "none", "candidates": []},
        )
        r_del = await finance.delete_transaction(
            ctx_vazio, FinanceAction(type=FinanceActionType.DELETE_TRANSACTION)
        )
        assert "não está mais aqui" in r_del.message

        r_mark = await finance.mark_paid(
            ctx_vazio, FinanceAction(type=FinanceActionType.MARK_PAID)
        )
        assert "não está mais aqui" in r_mark.message or "Não achei" in r_mark.message

        r_up = await finance.update_transaction(
            ctx_vazio, FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=100)
        )
        assert "não está mais aqui" in r_up.message
