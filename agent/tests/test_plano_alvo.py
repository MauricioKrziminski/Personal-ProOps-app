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
from app.tools.guards import Level1Error

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
        source_message_id="w1",
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
    async def test_confirmacao_antiga_sem_snapshot_nao_altera_plano(self, sql):
        r = await finance.mark_paid(
            _ctx("installment_plans"),
            FinanceAction(type=FinanceActionType.MARK_PAID, current_installment=3),
        )
        assert sql == []
        assert r.read_only
        assert "confirmação antiga" in r.message

    @pytest.mark.asyncio
    async def test_parcela_fora_da_faixa_nao_vira_update_maluco(self, sql):
        """Invalid legacy counts never clamp into another payment."""
        r = await finance.mark_paid(
            _ctx("installment_plans"),
            FinanceAction(type=FinanceActionType.MARK_PAID, current_installment=30),
        )
        assert sql == []
        assert r.read_only


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


def _ctx_plano(**alvo) -> ExecContext:
    ctx = _ctx("installment_plans")
    ctx.target = {**ctx.target, **alvo}
    return ctx


def _ctx_snapshot(*linhas) -> ExecContext:
    ctx = _ctx("installment_plans")
    cand = {**ctx.target["candidates"][0],
            "installment_snapshot": {"version": 2, "rows": list(linhas), "total_cents": 0}}
    ctx.target = {**ctx.target, "candidates": [cand]}
    return ctx


PLANO_COMPLETO = {
    "id": "plano-1", "total_cents": 300000, "installments": 10,
    "first_occurred_at": "2026-05-15", "description": "TV", "category": "eletrônicos",
    "merchant": "Magalu", "account_id": "acc-1",
}


class TestEdicaoPlano:
    @pytest.mark.asyncio
    async def test_update_sem_correcao_nunca_da_baixa(self, sql):
        """`current_installment` numa correção era desviado para `_baixa_em_parcelas`:
        um update que marcava parcela como paga."""
        with pytest.raises(Level1Error):
            await finance.update_transaction(
                _ctx("installment_plans"),
                FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, current_installment=3),
            )
        assert not any("cleared" in q for q, _ in sql)

    @staticmethod
    def _duble(monkeypatch, *, editaveis=8, travado=60000):
        chamadas = []

        async def fetch_one(sql, *args):
            chamadas.append((" ".join(sql.split()), args))
            if "from public.installment_plans" in sql:
                return {**PLANO_COMPLETO, "editaveis": editaveis, "travado_cents": travado}
            return {"mexidas": 10}

        monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
        return chamadas

    @pytest.mark.asyncio
    async def test_valor_por_parcela_com_fatura_paga_em_parte_passa_o_total_pela_rpc(self, monkeypatch):
        """`update_transaction_scoped` mexia em parcela pendente de fatura paga em PARTE.
        Agora o total é travado_agora + X × editáveis_agora, e a RPC redistribui."""
        chamadas = self._duble(monkeypatch, editaveis=7, travado=90000)
        r = await finance.update_transaction(
            _ctx_plano(amount_unit="parcela"),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=30000),
        )
        leitura = chamadas[0]
        assert "parcela_travada" in leitura[0] and "workspace_id = %s" in leitura[0]
        rpc = [a for q, a in chamadas if "update_installment_plan" in q]
        assert rpc == [("plano-1", 90000 + 30000 * 7, 10, "2026-05-15", "TV",
                        "eletrônicos", "Magalu", "acc-1")]
        assert not any("update_transaction_scoped" in q for q, _ in chamadas)
        assert not r.read_only

    @pytest.mark.asyncio
    async def test_valor_por_parcela_sem_parcela_editavel_nao_mexe(self, monkeypatch):
        chamadas = self._duble(monkeypatch, editaveis=0, travado=300000)
        r = await finance.update_transaction(
            _ctx_plano(amount_unit="parcela"),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=5000),
        )
        assert r.read_only and "nenhuma parcela dessa compra pode mudar mais" in r.message.lower()
        assert not any("update_installment_plan" in q for q, _ in chamadas)

    @pytest.mark.asyncio
    async def test_renomear_plano_nao_passa_pela_rpc_nem_toca_dinheiro_data_ou_conta(self, monkeypatch):
        """Sem parcela travada a RPC reescreve o contrato inteiro: uma parcela editada à
        mão voltaria à divisão igual só porque a pessoa trocou o nome."""
        chamadas = []

        async def fetch_one(sql, *args):
            chamadas.append((" ".join(sql.split()), args))
            return {"id": "plano-1", "linhas": 10}

        monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
        r = await finance.update_transaction(
            _ctx_plano(candidates=[{"id": "plano-1", "label": "TV — tudo (10x)",
                                    "table": "installment_plans", "editaveis": 8}]),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_description="TV sala",
                          new_category="casa"),
        )
        assert not any("update_installment_plan" in q for q, _ in chamadas)
        assert len(chamadas) == 1
        sql, args = chamadas[0]
        import re

        sets = " ".join(parte.split(" where ")[0] for parte in sql.split(" set ")[1:])
        atribuidas = set(re.findall(r"(?:^|,)\s*(\w+) =", sets))
        assert atribuidas == {"description", "category", "merchant", "updated_at"}
        assert "update public.installment_plans" in sql and "update public.transactions" in sql
        assert "p.workspace_id = %s" in sql and "t.workspace_id = p.workspace_id" in sql
        assert WS in args
        assert "TV sala" in args and "casa" in args
        assert "já pagas ficaram" not in r.message and "todas as parcelas" in r.message

    @pytest.mark.asyncio
    async def test_renomear_de_pendencia_antiga_nao_escreve(self, monkeypatch):
        """M2: a frase de antes do deploy dizia "(só as parcelas em aberto…)" e o SIM
        renomearia TODAS. Sem o marcador que só o gate novo congela (`editaveis`), pede de novo."""
        chamadas = []

        async def fetch_one(sql, *args):
            chamadas.append(sql)
            return {"id": "plano-1", "linhas": 10}

        monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
        r = await finance.update_transaction(
            _ctx_plano(),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_description="TV sala"),
        )
        assert r.read_only and r.message == "Ainda não mudei nada. Me pede a correção de novo."
        assert chamadas == []

    def test_o_sufixo_da_parcela_e_o_mesmo_da_rpc(self):
        """Segunda cópia do formato "(k/N)": se a RPC mudar, este teste quebra."""
        from pathlib import Path

        rpc = (Path(__file__).parents[2] / "supabase/migrations"
               / "20260920120000_parcelar_um_lancamento_que_ja_existe.sql").read_text()
        assert "description = nome || ' (' || t.installment_no || '/' || p_installments || ')'" in rpc
        assert "coalesce(p_description, p_merchant, 'Compra parcelada')" in rpc
        assert finance._SUFIXO_DA_PARCELA == "|| ' (' || t.installment_no || '/' || p.installments || ')'"
        # terceira cópia: renomear UMA parcela pelo snapshot
        fonte = Path(finance.__file__).read_text()
        assert "({antes['installment_no']}/{antes['plan_installments']})" in fonte

    @pytest.mark.asyncio
    async def test_valor_sem_unidade_nunca_cai_em_parcela(self, monkeypatch):
        """Checkpoint/pendência de antes do deploy: sem `amount_unit` não há default."""
        chamadas = []

        async def fetch_one(sql, *args):
            chamadas.append(sql)
            return None

        monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
        r = await finance.update_transaction(
            _ctx("installment_plans"),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=5000),
        )
        assert r.read_only and "de novo" in r.message
        assert chamadas == []

    @pytest.mark.asyncio
    async def test_valor_total_chama_update_installment_plan_com_os_8_argumentos(self, monkeypatch):
        """A RPC SOBRESCREVE com nulo: os campos que a pessoa não citou vão com o valor atual."""
        chamadas = []

        async def fetch_one(sql, *args):
            chamadas.append((" ".join(sql.split()), args))
            if "from public.installment_plans" in sql:
                return dict(PLANO_COMPLETO)
            return {"mexidas": 10}

        monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
        r = await finance.update_transaction(
            _ctx_plano(amount_unit="total"),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=240000,
                          new_description="TV da sala"),
        )
        leitura = chamadas[0]
        assert "workspace_id = %s" in leitura[0] and WS in leitura[1]
        rpc = [c for c in chamadas if "update_installment_plan" in c[0]]
        assert len(rpc) == 1
        assert rpc[0][1] == ("plano-1", 240000, 10, "2026-05-15", "TV da sala",
                             "eletrônicos", "Magalu", "acc-1")
        assert not r.read_only and "R$ 2.400,00" in r.message

    @pytest.mark.asyncio
    async def test_recusa_da_rpc_vira_a_mensagem_dela(self, monkeypatch):
        import psycopg

        class Recusa(psycopg.errors.RaiseException):
            pass

        async def fetch_one(sql, *args):
            if "update_installment_plan" in sql:
                erro = Recusa("Todas as parcelas já foram pagas: o total não muda mais.")
                raise erro
            return dict(PLANO_COMPLETO)

        monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
        with pytest.raises(Level1Error) as err:
            await finance.update_transaction(
                _ctx_plano(amount_unit="total"),
                FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=1000),
            )
        assert "o total não muda mais" in err.value.mensagem_usuario

    @pytest.mark.asyncio
    async def test_data_de_plano_nao_e_engolida(self, sql):
        with pytest.raises(Level1Error) as err:
            await finance.update_transaction(
                _ctx_plano(),
                FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_description="x",
                              new_occurred_at="2026-10-01"),
            )
        assert "Editar a compra no app" in err.value.mensagem_usuario

    @pytest.mark.asyncio
    async def test_snapshot_de_uma_linha_corrige_so_aquela_linha(self, monkeypatch):
        """"muda a 3ª parcela para 300": o id vem do snapshot congelado, nunca de uma busca."""
        chamadas = []
        LINHA = "aaaaaaaa-0000-0000-0000-000000000003"

        async def fetch_one(sql, *args):
            chamadas.append((" ".join(sql.split()), args))
            if sql.strip().startswith("select id, kind"):
                return {"id": LINHA, "kind": "expense", "amount_cents": 25000,
                        "category": "eletrônicos", "description": "TV (3/10)",
                        "occurred_at": "2026-07-15"}
            return {"id": LINHA}

        monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
        r = await finance.update_transaction(
            _ctx_snapshot({"id": LINHA, "installment_no": 3, "amount_cents": 25000}),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=30000),
        )
        update = [c for c in chamadas if "update public.transactions" in c[0]]
        assert len(update) == 1
        # o total do plano acompanha a linha, na MESMA operação e com workspace
        assert "update public.installment_plans" in update[0][0]
        assert "total_cents = u.amount_cents + coalesce((select sum(t.amount_cents)" in update[0][0]
        assert "p.workspace_id = u.workspace_id" in update[0][0]
        assert LINHA in update[0][1] and WS in update[0][1]
        assert "workspace_id = %s" in update[0][0]
        assert "parcela_travada" in update[0][0]
        assert not any("cleared" in c[0] for c in chamadas)
        assert not r.read_only

    @pytest.mark.asyncio
    async def test_valor_do_plano_manda_a_data_REAL_da_parcela_1(self, monkeypatch):
        """I1: sem parcela travada a RPC reescreve TODAS as datas a partir da que recebe.
        Com `first_occurred_at` do plano, uma parcela 1 editada à mão voltava ao
        calendário antigo e trocava de fatura em silêncio."""
        chamadas = []

        async def fetch_one(sql, *args):
            chamadas.append((" ".join(sql.split()), args))
            if "from public.installment_plans" in sql:
                return {**PLANO_COMPLETO, "editaveis": 10, "travado_cents": 0,
                        "primeira": "2026-05-20"}
            return {"mexidas": 10}

        monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
        await finance.update_transaction(
            _ctx_plano(amount_unit="total", candidates=[
                {"id": "plano-1", "label": "TV", "table": "installment_plans", "editaveis": 10}]),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=240000),
        )
        leitura = chamadas[0][0]
        assert "t1.installment_no = 1" in leitura and "t1.workspace_id = p.workspace_id" in leitura
        rpc = [a for q, a in chamadas if "update_installment_plan" in q]
        assert rpc[0][3] == "2026-05-20"

    @staticmethod
    def _duble_snapshot(monkeypatch, *, installment_no=3):
        chamadas = []
        LINHA = "aaaaaaaa-0000-0000-0000-000000000003"

        async def fetch_one(sql, *args):
            chamadas.append((" ".join(sql.split()), args))
            if sql.strip().startswith("select id, kind"):
                return {"id": LINHA, "kind": "expense", "amount_cents": 25000,
                        "category": "eletrônicos", "description": f"TV ({installment_no}/10)",
                        "occurred_at": "2026-07-15", "installment_no": installment_no,
                        "plan_installments": 10}
            return {"id": LINHA}

        monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
        return chamadas, LINHA

    @pytest.mark.asyncio
    async def test_snapshot_renomear_uma_parcela_mantem_o_sufixo_e_nao_mexe_no_total(self, monkeypatch):
        """M4: o nome saía sem "(k/N)" e o total do plano era recalculado à toa."""
        chamadas, linha = self._duble_snapshot(monkeypatch)
        await finance.update_transaction(
            _ctx_snapshot({"id": linha, "installment_no": 3}),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_description="TV da sala"),
        )
        update = [c for c in chamadas if "update public.transactions" in c[0]]
        assert "TV da sala (3/10)" in update[0][1]
        assert "update public.installment_plans" not in update[0][0]

    @pytest.mark.asyncio
    async def test_snapshot_data_da_parcela_1_move_a_data_do_plano(self, monkeypatch):
        """I1: a data da parcela 1 É a `first_occurred_at` do plano — mudar uma sem a
        outra fazia o próximo "Editar a compra" devolver a parcela à data velha."""
        chamadas, linha = self._duble_snapshot(monkeypatch, installment_no=1)
        await finance.update_transaction(
            _ctx_snapshot({"id": linha, "installment_no": 1}),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_occurred_at="2026-07-20"),
        )
        update = [c for c in chamadas if "update public.transactions" in c[0]][0][0]
        assert ("first_occurred_at = case when u.installment_no = 1 then u.occurred_at "
                "else p.first_occurred_at end") in update
        assert "p.workspace_id = u.workspace_id" in update
        assert "total_cents" not in update

    @pytest.mark.asyncio
    async def test_snapshot_de_varias_linhas_nao_corrige(self, sql):
        r = await finance.update_transaction(
            _ctx_snapshot({"id": "a", "installment_no": 1}, {"id": "b", "installment_no": 2}),
            FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, new_amount_cents=30000),
        )
        assert r.read_only
        assert "Consigo corrigir a compra inteira (as parcelas em aberto) ou uma parcela por vez." in r.message
        assert sql == []


class TestAlvoDefensivo:
    @pytest.mark.asyncio
    async def test_candidatos_vazios_nao_causam_index_error(self):
        ctx_vazio = ExecContext(
            user_id=UUID("11111111-1111-1111-1111-111111111111"),
            workspace_id=WS,
            phone="5551999999999",
            timezone="America/Sao_Paulo",
            texto="",
            source_message_id="w1",
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
