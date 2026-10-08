"""O lançamento de um adiantamento de parcelas (20261010130000) pela conversa.

Aplicar e editar são do app. Pela conversa: apagar DESFAZ (as parcelas voltam), e corrigir valor,
data, título, conta ou parcelas é recusado ANTES do SIM — só a categoria muda por aqui.
"""

from uuid import UUID

import pytest

from app.domain.correcao_plano import ADIANTAMENTO_SO_NO_APP, recusa_de_conversao
from app.graph.policy import erro_de_correcao
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance, resolve
from app.tools.base import ExecContext

WS = UUID("22222222-2222-2222-2222-222222222222")
UPD = FinanceActionType.UPDATE_TRANSACTION
DEL = FinanceActionType.DELETE_TRANSACTION
ALVO = {"status": "found", "table": "transactions",
        "candidates": [{"id": "tx-ad", "label": "x", "table": "transactions", "adiantamento": True}]}


def _ctx(target=ALVO):
    return ExecContext(
        user_id=UUID("11111111-1111-1111-1111-111111111111"), workspace_id=WS,
        phone="5551999999999", timezone="America/Sao_Paulo", texto="",
        source_message_id="w1", target=target,
    )


@pytest.mark.parametrize("campo", [
    {"new_amount_cents": 50000}, {"new_occurred_at": "2026-12-01"}, {"new_description": "outro"},
    {"new_account": "Inter"}, {"installments": 3},
])
def test_corrigir_o_adiantamento_e_recusado_antes_do_sim(campo):
    assert erro_de_correcao(FinanceAction(type=UPD, description="tv", **campo), ALVO) == ADIANTAMENTO_SO_NO_APP


def test_a_categoria_do_adiantamento_muda_pela_conversa():
    assert erro_de_correcao(FinanceAction(type=UPD, description="tv", new_category="lazer"), ALVO) is None


def test_lancamento_comum_nao_cai_na_recusa():
    alvo = {**ALVO, "candidates": [{"id": "tx", "label": "x", "table": "transactions"}]}
    assert erro_de_correcao(FinanceAction(type=UPD, description="tv", new_amount_cents=5000), alvo) is None


def test_o_adiantamento_nao_vira_compra_parcelada():
    assert recusa_de_conversao({"kind": "expense", "adiantamento": True}, 3) == ADIANTAMENTO_SO_NO_APP


def test_a_marca_chega_ao_candidato():
    _, cands = resolve.veredito([{"id": "a", "amount_cents": 1, "adiantamento": True},
                                 {"id": "b", "amount_cents": 2, "adiantamento": False}],
                                lambda r: r["id"], "transactions")
    assert cands[0]["adiantamento"] is True and "adiantamento" not in cands[1]


def _banco(monkeypatch, linha):
    feitas = []

    async def fetch_one(sql, *args):
        return dict(linha)

    async def execute(sql, *args):
        feitas.append(" ".join(sql.split()))
        return 1

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    monkeypatch.setattr(finance.db, "execute", execute)
    return feitas


LINHA = {"id": "tx-ad", "kind": "expense", "amount_cents": 45000, "category": "eletrônicos",
         "description": "Adiantei 2 da tv"}


@pytest.mark.asyncio
@pytest.mark.parametrize("tool", [finance.delete_transaction, finance.undo_last])
async def test_apagar_o_adiantamento_da_compra_desfaz(monkeypatch, tool):
    feitas = _banco(monkeypatch, {**LINHA, "adiantamento": True, "adiantamento_da_compra": True})
    r = await tool(_ctx(), FinanceAction(type=DEL, description="tv"))
    assert feitas == ["select private.desfazer_adiantamento_da_compra(%s)"]
    assert "voltaram para a compra" in r.message and not r.read_only


@pytest.mark.asyncio
async def test_apagar_o_adiantamento_da_divida_e_o_delete_que_o_gatilho_desfaz(monkeypatch):
    feitas = _banco(monkeypatch, {**LINHA, "adiantamento": True, "adiantamento_da_compra": False})
    r = await finance.delete_transaction(_ctx(), FinanceAction(type=DEL, description="tv"))
    assert feitas == ["delete from public.transactions where id = %s and workspace_id = %s"]
    assert "voltou como era" in r.message


@pytest.mark.asyncio
async def test_apagar_lancamento_comum_nao_muda(monkeypatch):
    feitas = _banco(monkeypatch, {**LINHA, "adiantamento": False, "adiantamento_da_compra": False})
    r = await finance.undo_last(_ctx(), FinanceAction(type=DEL))
    assert feitas == ["delete from public.transactions where id = %s and workspace_id = %s"]
    assert r.message == "🗑️ Apagado: gasto de R$ 450,00 em *eletrônicos* (Adiantei 2 da tv)."
