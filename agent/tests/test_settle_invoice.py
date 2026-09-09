"""Quitar fatura sem caixa — o `settle_invoice` da 0046 pelo WhatsApp.

Pagar e quitar terminam com a fatura "paga" e são efeitos diferentes no saldo:
`pay_invoice` cria a transferência, este caminho não cria nada. Confundir os dois
é errado nos dois sentidos, e o que separa é o ALVO resolvido (`card_invoices`),
não um tipo de ação novo — `FinanceAction` está no teto medido de 252/32.
"""

import pytest

from app.graph.policy import describe_for_confirmation, needs_confirmation
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance
from app.tools.base import ExecContext

ALVO = {
    "table": "card_invoices",
    "status": "found",
    "candidates": [{"id": "aaaaaaaa-1111-2222-3333-444444444444",
                    "label": "Fatura Nubank — vence 10/10/2026",
                    "table": "card_invoices"}],
}


def _ctx(alvo=ALVO):
    return ExecContext(
        "user", "workspace", None, "America/Sao_Paulo",
        "quita a fatura do nubank sem caixa", "app:1", target=alvo,
    )


@pytest.mark.asyncio
async def test_quita_pela_rpc_e_nao_cria_transferencia(monkeypatch):
    chamadas = []

    async def fetch_one(sql, *args):
        chamadas.append(sql)
        return {"id": ALVO["candidates"][0]["id"], "due_date": "2026-10-10",
                "card_name": "Nubank", "aberto": 37164}

    async def execute(sql, *args):
        chamadas.append(sql)

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    monkeypatch.setattr(finance.db, "execute", execute)

    r = await finance.mark_paid(_ctx(), FinanceAction(type=FinanceActionType.MARK_PAID))

    assert any("settle_invoice" in c for c in chamadas)
    # `pay_invoice` é a outra ação; se aparecesse aqui, a quitação teria inventado
    # uma saída de caixa que não houve
    assert not any("pay_invoice(" in c for c in chamadas)
    assert "371,64" in r.message and "sem sair do caixa" in r.message


@pytest.mark.asyncio
async def test_fatura_ja_quitada_nao_grava(monkeypatch):
    async def fetch_one(*a):
        return None

    async def boom(*a):
        raise AssertionError("não pode escrever numa fatura já paga")

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    monkeypatch.setattr(finance.db, "execute", boom)
    r = await finance.mark_paid(_ctx(), FinanceAction(type=FinanceActionType.MARK_PAID))
    assert r.read_only


def test_confirmacao_diz_que_o_caixa_nao_se_move():
    acao = FinanceAction(type=FinanceActionType.MARK_PAID)
    # a regra "alvo resolvido -> confirma" é derivada; a fatura entra nela de graça
    assert needs_confirmation(acao, 1.0, ALVO)
    frase = describe_for_confirmation(acao, ALVO)
    # "dar baixa na fatura" leria igual a pagar; o SIM tem que distinguir os dois
    assert "SEM tirar do caixa" in frase and "Nubank" in frase
