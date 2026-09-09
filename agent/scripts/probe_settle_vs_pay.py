#!/usr/bin/env python3
"""Quitar a fatura SEM CAIXA vs pagar a fatura, contra o Gemini REAL.

    de agent/: .venv/bin/python scripts/probe_settle_vs_pay.py

Os dois efeitos terminam com a fatura "paga" e são diferentes no saldo: `pay_invoice`
cria a transferência da conta pagadora, `mark_paid` sobre a fatura não cria nada
(`settle_invoice`, migration 0046). Cruzar é caro nos DOIS sentidos — pagar quando
era quitar inventa uma saída que não houve; quitar quando era pagar deixa o saldo da
conta pagadora alto para sempre.

Não cabia um tipo novo: `FinanceAction` está no teto medido de 252/32 e a API recusou
266 (uma propriedade a mais) e 270 (um valor de enum a mais) em 09/09/2026. Daí o
verbo ser o mesmo de dar baixa numa conta prevista, e a separação ser SEMÂNTICA — que
é exatamente o que só o modelo real responde.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.graph.nodes import finance_node
from app.graph.schemas import FinanceAction

CASOS = [
    ("essa fatura do nubank eu já tinha pago antes de usar o app, só marca como paga", "mark_paid"),
    ("quita a fatura do nubank sem caixa", "mark_paid"),
    ("marca a fatura do nubank como paga, o dinheiro já saiu", "mark_paid"),
    ("a fatura do nubank já estava paga, não precisa tirar do caixa", "mark_paid"),
    ("paguei a fatura do nubank", "pay_invoice"),
    ("paguei 800 da fatura do nubank", "pay_invoice"),
    ("paguei a fatura do nubank pelo itau hoje", "pay_invoice"),
]


async def main() -> int:
    falhas = 0
    for texto, esperado in CASOS:
        r = await finance_node({"text": texto, "timezone": "America/Sao_Paulo"})
        acoes = r.get("finance_actions") or []
        obtido = FinanceAction.model_validate(acoes[0]).type.value if acoes else "(vazio)"
        ok = obtido == esperado
        falhas += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FALHOU'} {texto!r:70} -> {obtido} (esperado {esperado})")
    print(f"\n{len(CASOS) - falhas}/{len(CASOS)}")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
