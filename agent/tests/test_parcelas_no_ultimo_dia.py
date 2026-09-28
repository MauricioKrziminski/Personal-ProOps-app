"""Pelo agente, a compra parcelada FORA do cartão vai para o último dia de cada mês (28/09/2026).

Sem campo novo (o schema está no teto): a regra de repetição `BYMONTHDAY=-1`, que o prompt já
ensina para "todo último dia do mês", numa correção da compra. A política recusa o cartão antes
do SIM e a frase diz o efeito; a tool grava pela porta do app (`private.parcelas_no_ultimo_dia`),
com a correção junto numa instrução só.
"""

import pytest

from app.domain.correcao_plano import ULTIMO_DIA, ULTIMO_DIA_NO_CARTAO, ULTIMO_DIA_SO_NA_COMPRA
from app.graph import policy
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance
from tests.test_plano_alvo import PLANO_COMPLETO, _ctx_plano

FIM = "FREQ=MONTHLY;BYMONTHDAY=-1"


def _acao(**campos):
    return FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, description="geladeira",
                         recurrence=FIM, **campos)


def _alvo(tipo="checking", tabela="installment_plans", **cand):
    return {"table": tabela, "status": "found", "candidates": [{
        "id": "plano-1", "label": "geladeira — tudo (8x)", "table": tabela,
        "plan_installments": 8, "total_cents": 80000, "editaveis": 6, "travado_cents": 20000,
        "travadas": 2, "travadas_fatura": 0, "ultima_travada": 2, "pagas": 2, "piso_pagas": 0,
        "account_type": tipo, "account_name": "Nubank", "account_id": "acc-1", **cand}]}


def test_so_o_ultimo_dia_e_correcao_e_a_frase_diz_o_efeito():
    assert policy.erro_de_correcao(_acao(), _alvo()) is None
    frase = policy.describe_for_confirmation(_acao(), _alvo())
    assert ULTIMO_DIA in frase, frase


def test_no_cartao_recusa_antes_do_sim():
    assert policy.erro_de_correcao(_acao(), _alvo(tipo="credit_card")) == ULTIMO_DIA_NO_CARTAO


def test_uma_parcela_nao_tem_todo_mes_e_lancamento_solto_segue_como_antes():
    parcela = _alvo(installment_snapshot={"version": 2, "rows": [{"id": "p3"}], "total_cents": 0})
    assert policy.erro_de_correcao(_acao(), parcela) == ULTIMO_DIA_SO_NA_COMPRA
    solto = {"table": "transactions", "status": "found",
             "candidates": [{"id": "tx-1", "label": "aluguel", "table": "transactions"}]}
    sem_regra = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, description="aluguel")
    assert policy.erro_de_correcao(_acao(), solto) == policy.erro_de_correcao(sem_regra, solto), \
        "numa recorrente/avulso a regra não muda nada do que já acontecia" 


def test_sem_a_regra_nada_muda_na_politica():
    acao = FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, description="geladeira")
    assert policy.erro_de_correcao(acao, _alvo()) is not None, "sem correção nenhuma continua perguntando"


@pytest.mark.asyncio
async def test_so_o_dia_chama_a_porta_do_app_e_nao_reescreve_a_compra(monkeypatch):
    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append((" ".join(sql.split()), args))
        if "from public.installment_plans" in sql:
            return {**PLANO_COMPLETO, "account_type": "checking", "travado_cents": 0,
                    "travadas_fatura": 0, "editaveis": 10}
        return {"mexidas": 8}

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    r = await finance.update_transaction(_ctx_plano(), _acao())
    assert any("private.parcelas_no_ultimo_dia" in q and a == ("plano-1",) for q, a in chamadas)
    assert not any("update_installment_plan" in q for q, _ in chamadas)
    assert ULTIMO_DIA in r.message and not r.read_only


@pytest.mark.asyncio
async def test_com_outra_correcao_as_duas_numa_instrucao_so(monkeypatch):
    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append((" ".join(sql.split()), args))
        if "from public.installment_plans" in sql:
            return {**PLANO_COMPLETO, "account_type": "checking", "travado_cents": 0,
                    "travadas_fatura": 0, "editaveis": 10}
        return {"mexidas": 10, "no_fim": 10}

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    await finance.update_transaction(_ctx_plano(), _acao(new_description="geladeira nova"))
    (q, a), = [(q, a) for q, a in chamadas if "update_installment_plan" in q]
    assert "private.parcelas_no_ultimo_dia" in q, "correção e fim do mês na MESMA instrução"
    assert a[-1] == "plano-1" and a[4] == "geladeira nova"


@pytest.mark.asyncio
async def test_no_cartao_a_tool_recusa_de_novo(monkeypatch):
    async def fetch_one(sql, *args):
        if "from public.installment_plans" in sql:
            return {**PLANO_COMPLETO, "account_type": "credit_card", "travado_cents": 0,
                    "travadas_fatura": 0, "editaveis": 10}
        raise AssertionError("não pode escrever")

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    r = await finance.update_transaction(_ctx_plano(), _acao())
    assert r.read_only and r.message == ULTIMO_DIA_NO_CARTAO
