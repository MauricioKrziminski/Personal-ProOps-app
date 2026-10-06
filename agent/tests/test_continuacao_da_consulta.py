"""Quem decide se a consulta CONTINUA a anterior é o modelo, não uma lista de palavras (C2)."""

from __future__ import annotations

from uuid import UUID

import pytest

from app import db
from app.graph.schemas import FinanceQuery, FinanceQueryType
from app.tools import queries
from app.tools.base import ExecContext

WS = UUID("22222222-2222-2222-2222-222222222222")
CARD = UUID("33333333-3333-3333-3333-333333333333")
ITAU = UUID("44444444-4444-4444-4444-444444444444")
CONTAS = [
    {"id": CARD, "name": "Nubank Cartão", "type": "credit_card", "closing_day": 25, "due_day": 5},
    {"id": ITAU, "name": "Itaú Corrente", "type": "checking"},
]
ANTERIOR = {
    "blueprint": {
        "account_id": str(CARD), "account_name": "Nubank Cartão", "account_type": "credit_card",
        "start_date": "2026-08-26", "end_date": "2026-09-25", "offset": 3,
    },
}


@pytest.fixture
def banco(monkeypatch):
    chamadas = []

    async def accounts(workspace_id, only_cards=False):
        return CONTAS

    async def fetch(query, *args):
        chamadas.append(args)
        return []

    async def ciclo(workspace_id, dia):
        return None

    monkeypatch.setattr(db, "accounts", accounts)
    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "cycle", ciclo)
    return chamadas


def _ctx(texto: str) -> ExecContext:
    return ExecContext(
        user_id=UUID("11111111-1111-1111-1111-111111111111"), workspace_id=WS, phone=None,
        timezone="America/Sao_Paulo", texto=texto, source_message_id="m", last_query_data=ANTERIOR,
    )


def _q(**campos) -> FinanceQuery:
    return FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS, **campos)


@pytest.mark.asyncio
async def test_pergunta_nova_nao_herda_a_conta_mesmo_com_palavra_de_continuacao(banco):
    # "quanto gastei no total esse mês?" tem "mes" e "mais" por substring; o modelo disse que é nova
    res = await queries.query_transactions(_ctx("quanto gastei no total esse mês, mais ou menos?"), _q())

    assert banco[0][1] is None, "sem conta: não herdou o Nubank"
    assert res.data["account_id"] is None


@pytest.mark.asyncio
async def test_continua_anterior_herda_conta_e_janela(banco):
    await queries.query_transactions(_ctx("só as parcelas"), _q(continua_anterior=True))

    assert banco[0][1] == CARD
    assert (banco[0][5], banco[0][6]) == ("2026-08-26", "2026-09-25")


@pytest.mark.asyncio
async def test_continua_mas_cita_outra_conta_troca_de_conta_e_mantem_a_janela(banco):
    await queries.query_transactions(
        _ctx("e no itaú?"), _q(continua_anterior=True, account="Itaú Corrente")
    )

    assert banco[0][1] == ITAU
    assert (banco[0][5], banco[0][6]) == ("2026-08-26", "2026-09-25")


@pytest.mark.asyncio
async def test_a_janela_do_modelo_vence_a_herdada(banco):
    await queries.query_transactions(
        _ctx("e em julho?"),
        _q(continua_anterior=True, query_from="2026-07-01", query_to="2026-07-31"),
    )

    assert (banco[0][5], banco[0][6]) == ("2026-07-01", "2026-07-31")


@pytest.mark.asyncio
async def test_pagina_pelo_campo_do_modelo_usa_a_janela_anterior(banco):
    res = await queries.query_transactions(
        _ctx("ver mais"), _q(continua_anterior=True, mostrar="mais")
    )

    assert (banco[0][5], banco[0][6]) == ("2026-08-26", "2026-09-25")
    assert res.data["blueprint"]["account_id"] == str(CARD)


@pytest.mark.asyncio
async def test_texto_nao_decide_nada_sem_o_campo(banco):
    # "ver mais" escrito, mas o modelo não marcou continuação nem página: é consulta nova
    await queries.query_transactions(_ctx("ver mais todos"), _q())

    assert banco[0][1] is None
