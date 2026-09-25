"""Dar baixa com o valor que de fato saiu — "paguei a luz, foi 230" (25/09/2026).

O app ganhou a folha "Quanto saiu?" no Paguei; o agente faz o mesmo pelo `mark_paid` com
`new_amount_cents` (sem campo novo: `FinanceAction` está no teto medido de 252). A frase do SIM
diz o valor pago, e a baixa grava o valor e o status NUMA escrita — falhando, nada fica pago.
"""

import pytest

from app.graph.policy import describe_for_confirmation, erro_de_correcao, valor_pago
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance, resolve
from app.tools.base import ExecContext

LUZ = {
    "table": "transactions",
    "status": "found",
    "candidates": [{"id": "11111111-1111-1111-1111-111111111111",
                    "label": "gasto de R$ 210,00 em *contas* (Luz)",
                    "table": "transactions", "amount_cents": 21000,
                    "when": "01/10/2026"}],
}


def _baixa(**campos):
    return FinanceAction(type=FinanceActionType.MARK_PAID, description="luz", **campos)


def test_o_valor_pago_vem_da_correcao_ou_do_valor_dito():
    assert valor_pago(_baixa(new_amount_cents=23000), LUZ) == 23000
    # "paguei 230 da luz": numa conta prevista, o valor dito é o que saiu
    assert valor_pago(_baixa(amount_cents=23000), LUZ) == 23000
    assert valor_pago(_baixa(), LUZ) is None


def test_frase_do_sim_diz_quanto_saiu_quando_difere_do_previsto():
    frase = describe_for_confirmation(_baixa(new_amount_cents=23000), LUZ)
    assert "Luz" in frase and "com R$ 230,00 pagos" in frase.replace("\xa0", " ")
    # o mesmo valor do previsto não acrescenta nada
    igual = describe_for_confirmation(_baixa(amount_cents=21000), LUZ)
    assert "pagos" not in igual


def test_fatura_quitada_fora_do_app_nao_aceita_valor():
    fatura = {"table": "card_invoices", "status": "found",
              "candidates": [{"id": "f", "label": "Fatura Nubank", "table": "card_invoices"}]}
    assert "paguei" in (erro_de_correcao(_baixa(new_amount_cents=80000), fatura) or "")
    # sem valor, quitar continua valendo
    assert erro_de_correcao(_baixa(), fatura) is None


def test_varias_parcelas_com_valor_diferente_pede_uma_por_vez():
    def plano(n):
        rows = [{"id": str(i), "installment_no": i, "amount_cents": 10000} for i in range(1, n + 1)]
        return {"table": "installment_plans", "status": "found",
                "candidates": [{"id": "p", "label": "TV", "table": "installment_plans",
                                "installment_snapshot": {"version": 2, "rows": rows,
                                                         "total_cents": 10000 * n}}]}
    assert "uma parcela por vez" in (erro_de_correcao(_baixa(new_amount_cents=12000), plano(3)) or "")
    assert erro_de_correcao(_baixa(new_amount_cents=12000), plano(1)) is None
    assert erro_de_correcao(_baixa(), plano(3)) is None


def test_lancamento_previsto_aceita_valor():
    assert erro_de_correcao(_baixa(new_amount_cents=23000), LUZ) is None


def test_candidato_de_conta_prevista_leva_o_valor_previsto():
    _, cands = resolve.veredito(
        [{"id": "x", "kind": "expense", "amount_cents": 21000, "category": "contas",
          "description": "Luz", "occurred_at": "2026-10-01"}],
        lambda r: r["description"], "transactions",
    )
    assert cands[0]["amount_cents"] == 21000


def _ctx(alvo=LUZ):
    return ExecContext("user", "workspace", None, "America/Sao_Paulo",
                       "paguei a luz, foi 230", "app:1", target=alvo)


@pytest.mark.asyncio
async def test_baixa_com_outro_valor_grava_valor_e_status_numa_escrita(monkeypatch):
    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append((sql, args))
        if "returning" in sql:
            return {"id": LUZ["candidates"][0]["id"]}
        return {"id": LUZ["candidates"][0]["id"], "description": "Luz", "category": "contas",
                "amount_cents": 21000, "installment_plan_id": None}

    async def execute(sql, *args):
        raise AssertionError("a baixa com valor é UMA escrita, com trava")

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    monkeypatch.setattr(finance.db, "execute", execute)
    r = await finance.mark_paid(_ctx(), _baixa(new_amount_cents=23000))

    sql, args = chamadas[-1]
    assert "amount_cents = %s" in sql and "status = 'cleared'" in sql
    assert "parcela_travada" in sql
    assert 23000 in args
    msg = r.message.replace("\xa0", " ")
    assert "R$ 230,00" in msg and "previsto R$ 210,00" in msg and not r.read_only


@pytest.mark.asyncio
async def test_baixa_no_valor_previsto_segue_o_caminho_de_sempre(monkeypatch):
    escritas = []

    async def fetch_one(sql, *args):
        return {"id": LUZ["candidates"][0]["id"], "description": "Luz", "category": "contas",
                "amount_cents": 21000, "installment_plan_id": None}

    async def execute(sql, *args):
        escritas.append(sql)

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    monkeypatch.setattr(finance.db, "execute", execute)
    r = await finance.mark_paid(_ctx(), _baixa(amount_cents=21000))
    assert len(escritas) == 1 and "amount_cents" not in escritas[0]
    assert "previsto" not in r.message


@pytest.mark.asyncio
async def test_parcela_em_fatura_fechada_nao_muda_de_valor_nem_fica_paga(monkeypatch):
    async def fetch_one(sql, *args):
        if "returning" in sql:
            return None  # a trava `parcela_travada` segurou
        return {"id": "t", "description": "TV (3/10)", "category": "eletrônicos",
                "amount_cents": 10000, "installment_plan_id": "p"}

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    r = await finance.mark_paid(_ctx(), _baixa(new_amount_cents=12000))
    assert r.read_only and "Não dei baixa" in r.message


@pytest.mark.asyncio
async def test_uma_parcela_de_compra_com_outro_valor_grava_o_valor_e_o_total_do_plano(monkeypatch):
    linha = {"id": "22222222-2222-2222-2222-222222222222", "installment_no": 3,
             "amount_cents": 10000, "occurred_at": "2026-10-05", "status": "pending",
             "paid_at": None, "account_id": None, "invoice_id": None}
    alvo = {"table": "installment_plans", "status": "found",
            "candidates": [{"id": "33333333-3333-3333-3333-333333333333", "label": "TV (3/10)",
                            "table": "installment_plans",
                            "installment_snapshot": {"version": 2, "rows": [linha],
                                                     "total_cents": 10000}}]}
    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append((sql, args))
        return {"matched": 1, "changed": 1}

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    r = await finance.mark_paid(_ctx(alvo), _baixa(new_amount_cents=12000))
    sql, args = chamadas[-1]
    assert "amount_cents" in sql.split("changed as")[1] and 12000 in args
    assert "installment_plans" in sql and "parcela_travada" in sql
    assert "R$ 120,00" in r.message.replace("\xa0", " ")
