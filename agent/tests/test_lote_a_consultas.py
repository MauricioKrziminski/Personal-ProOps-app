"""Lote A da paridade, lado da LEITURA: "por que o gasto mudou" (F15) e o filtro por forma de
pagamento (F05). Dublê no lugar do banco: o que se prova é a janela que o agente pede, o filtro que
vai ao SQL e a frase que sai."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from uuid import UUID

import pytest

from app import db
from app.domain.payment_method import forma_de_pagamento
from app.graph.schemas import FinanceQuery, FinanceQueryType
from app.tools import queries
from app.tools.base import ExecContext

WS = UUID("22222222-2222-2222-2222-222222222222")
USER = UUID("11111111-1111-1111-1111-111111111111")


def ctx(texto="", **extra):
    return ExecContext(USER, WS, None, "America/Sao_Paulo", texto, "w1", **extra)


# ------------------------------------------------------------------ F15: janelas


def test_mes_anterior_espelha_o_shiftmonth_do_app():
    assert queries.mes_anterior("2026-10") == "2026-09"
    assert queries.mes_anterior("2026-01") == "2025-12"
    assert queries.mes_anterior("2026-03") == "2026-02"
    fonte = Path(__file__).resolve().parents[2] / "src/components/finance/month-picker.tsx"
    if fonte.exists():  # o app escolhe o anterior pelo RÓTULO do mês: se isto mudar, esta régua muda junto
        assert "new Date(y, m - 1 + delta, 1)" in fonte.read_text(encoding="utf-8")


def test_periodo_anterior_de_mes_inteiro_volta_um_mes_inteiro():
    assert queries.periodo_anterior(date(2026, 9, 1), date(2026, 9, 30)) == (date(2026, 8, 1), date(2026, 8, 31))
    assert queries.periodo_anterior(date(2026, 3, 1), date(2026, 3, 31)) == (date(2026, 2, 1), date(2026, 2, 28))
    # trimestre inteiro volta um trimestre
    assert queries.periodo_anterior(date(2026, 7, 1), date(2026, 9, 30)) == (date(2026, 4, 1), date(2026, 6, 30))


def test_periodo_anterior_de_janela_solta_volta_os_mesmos_dias():
    assert queries.periodo_anterior(date(2026, 9, 11), date(2026, 10, 10)) == (date(2026, 8, 12), date(2026, 9, 10))


def instala(monkeypatch, resposta, ciclos=None):
    chamadas = []

    async def cycle(ws, hoje):
        return {"mes": "2026-10", "ini": date(2026, 9, 11), "fim": date(2026, 10, 10)}

    async def cycle_of_month(ws, mes):
        chamadas.append(("cycle_of_month", mes))
        return {"ini": date(2026, 8, 11), "fim": date(2026, 9, 10)}

    class Tx:
        async def fetch_one(self, sql, *args):
            chamadas.append(("rpc", sql, args))
            return {"r": resposta}

    @asynccontextmanager
    async def como_usuario(uid):
        chamadas.append(("como_usuario", uid))
        yield Tx()

    monkeypatch.setattr(db, "cycle", cycle)
    monkeypatch.setattr(db, "cycle_of_month", cycle_of_month)
    monkeypatch.setattr(db, "como_usuario", como_usuario)
    return chamadas


RESPOSTA = {
    "current_cents": "120000", "previous_cents": "100000", "delta_cents": "20000", "percent_bp": 2000,
    "rows": [
        {"key": "lazer", "label": "lazer", "current_cents": "30000", "previous_cents": "20000", "delta_cents": "10000"},
        {"key": "mercado", "label": "mercado", "current_cents": "60000", "previous_cents": "40000", "delta_cents": "20000"},
        {"key": "saude", "label": "saúde", "current_cents": "0", "previous_cents": "10000", "delta_cents": "-10000"},
        {"key": "x", "label": "igual", "current_cents": "5", "previous_cents": "5", "delta_cents": "0"},
    ],
}


@pytest.mark.asyncio
async def test_ciclo_corrente_contra_o_ciclo_do_mes_anterior(monkeypatch):
    chamadas = instala(monkeypatch, RESPOSTA)
    out = await queries.query_spending_change(ctx(), FinanceQuery(type=FinanceQueryType.QUERY_SPENDING_CHANGE))
    assert ("como_usuario", USER) in chamadas
    assert ("cycle_of_month", "2026-09") in chamadas  # o RÓTULO anterior ao ciclo de outubro
    rpc = [c for c in chamadas if c[0] == "rpc"][0]
    assert "spending_change" in rpc[1] and rpc[1].rstrip().endswith("'category') as r")
    assert rpc[2] == (date(2026, 9, 11), date(2026, 10, 10), date(2026, 8, 11), date(2026, 9, 10))
    assert out.read_only
    assert "Subiu *R$ 200,00* (+20%)" in out.message
    # as linhas que mais explicam, maiores primeiro, sem a que não mudou
    assert out.message.index("mercado") < out.message.index("lazer") < out.message.index("saúde")
    assert "igual" not in out.message
    assert "+R$ 200,00 (de R$ 400,00 para R$ 600,00)" in out.message
    assert "−R$ 100,00 (de R$ 100,00 para R$ 0,00)" in out.message


@pytest.mark.asyncio
async def test_janela_dita_usa_o_periodo_equivalente_anterior(monkeypatch):
    chamadas = instala(monkeypatch, RESPOSTA)
    await queries.query_spending_change(ctx(), FinanceQuery(
        type=FinanceQueryType.QUERY_SPENDING_CHANGE, query_from="2026-09-01", query_to="2026-09-30"))
    rpc = [c for c in chamadas if c[0] == "rpc"][0]
    assert rpc[2] == (date(2026, 9, 1), date(2026, 9, 30), date(2026, 8, 1), date(2026, 8, 31))
    assert not any(c[0] == "cycle_of_month" for c in chamadas)


@pytest.mark.asyncio
async def test_anterior_zero_nao_inventa_percentual(monkeypatch):
    zero = {**RESPOSTA, "previous_cents": "0", "percent_bp": None, "delta_cents": "120000", "rows": [
        {"key": "a", "label": "mercado", "current_cents": "120000", "previous_cents": "0", "delta_cents": "120000"}]}
    instala(monkeypatch, zero)
    out = await queries.query_spending_change(ctx(), FinanceQuery(type=FinanceQueryType.QUERY_SPENDING_CHANGE))
    assert "sem gasto no período anterior" in out.message and "%" not in out.message


@pytest.mark.asyncio
async def test_sem_diferenca(monkeypatch):
    igual = {"current_cents": "100", "previous_cents": "100", "delta_cents": "0", "percent_bp": 0, "rows": []}
    instala(monkeypatch, igual)
    out = await queries.query_spending_change(ctx(), FinanceQuery(type=FinanceQueryType.QUERY_SPENDING_CHANGE))
    assert "Ficaram iguais." in out.message


# ------------------------------------------------------------------ F05: forma de pagamento


def test_forma_de_pagamento_aceita_o_codigo_e_a_palavra():
    assert forma_de_pagamento("pix") == "pix"
    assert forma_de_pagamento("Crédito") == "credit"
    assert forma_de_pagamento("cartão de débito") == "debit"
    assert forma_de_pagamento("bank_transfer") == "bank_transfer"
    assert forma_de_pagamento("não informado") == "not_informed"
    assert forma_de_pagamento("") is None and forma_de_pagamento(None) is None
    with pytest.raises(ValueError):
        forma_de_pagamento("cheque")


def instala_lancamentos(monkeypatch):
    feitas = []

    async def accounts(workspace_id, only_cards=False):
        return []

    async def cycle(ws, hoje):
        return None

    async def fetch(sql, *args):
        feitas.append((sql, args))
        return [
            {"id": UUID(int=i), "description": f"c{i}", "amount_cents": 1000 * i, "category_name": "mercado",
             "kind": "expense", "occurred_at": date(2026, 10, 1), "status": "cleared",
             "current_installment": None, "total_installments": None, "account_name": "Nubank",
             "account_type": "checking", "installment_plan_id": None}
            for i in range(1, 9)
        ]

    monkeypatch.setattr(db, "accounts", accounts)
    monkeypatch.setattr(db, "cycle", cycle)
    monkeypatch.setattr(db, "fetch", fetch)
    return feitas


@pytest.mark.asyncio
async def test_filtro_por_forma_vai_ao_sql_e_ao_blueprint(monkeypatch):
    feitas = instala_lancamentos(monkeypatch)
    out = await queries.query_transactions(
        ctx("quanto gastei no pix"),
        FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS, payment_method="pix"),
    )
    sql, args = feitas[0]
    assert "t.payment_method = %s" in sql and "'not_informed'" in sql
    assert args[-3:] == ("pix", "pix", "pix")
    assert out.data["blueprint"]["payment_method"] == "pix"
    assert "forma de pagamento: *Pix*" in out.message


@pytest.mark.asyncio
async def test_ver_mais_mantem_o_filtro(monkeypatch):
    feitas = instala_lancamentos(monkeypatch)
    anterior = {"blueprint": {"account_id": None, "start_date": "2026-10-01", "end_date": "2026-10-05",
                              "payment_method": "pix", "offset": 3}}
    out = await queries.query_transactions(
        ctx("ver mais", clicked_id="qpage:all:3", last_query_data=anterior),
        FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS),
    )
    assert feitas[0][1][-3:] == ("pix", "pix", "pix")
    assert out.data["blueprint"]["payment_method"] == "pix"


@pytest.mark.asyncio
async def test_nao_informado_filtra_por_nulo(monkeypatch):
    feitas = instala_lancamentos(monkeypatch)
    await queries.query_transactions(
        ctx("o que ficou sem forma"),
        FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS, payment_method="not_informed"),
    )
    sql, args = feitas[0]
    assert "t.payment_method is null" in sql and args[-3] == "not_informed"


@pytest.mark.asyncio
async def test_forma_desconhecida_nao_vira_lista_sem_filtro(monkeypatch):
    feitas = instala_lancamentos(monkeypatch)
    out = await queries.query_transactions(
        ctx("quanto gastei no cheque"),
        FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS, payment_method="cheque"),
    )
    assert feitas == []  # nem foi ao banco
    assert "Não conheço a forma de pagamento" in out.message and "Pix" in out.message


@pytest.mark.asyncio
async def test_sem_forma_nao_filtra(monkeypatch):
    feitas = instala_lancamentos(monkeypatch)
    await queries.query_transactions(ctx("quanto gastei"), FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS))
    assert feitas[0][1][-3:] == (None, None, None)
