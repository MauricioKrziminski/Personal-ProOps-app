#!/usr/bin/env python3
"""Dar baixa com o valor que saiu ("paguei a luz, foi 230"), contra o Gemini REAL.

    de agent/: .venv/bin/python scripts/probe_baixa_com_valor.py

O valor pago vai em `new_amount_cents` de um `mark_paid` (sem campo novo: `FinanceAction` está no
teto medido de 252). Numa conta prevista `amount_cents` também serve (`policy.valor_pago`), porque
a busca de `pendentes` é só por texto. Sem valor dito, nenhum dos dois pode aparecer — senão a baixa
gravaria um valor que a pessoa não disse. Uma chamada ao modelo do PARSE (Flash-Lite) por caso.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.graph.nodes import finance_node
from app.graph.schemas import FinanceAction

# (frase, tipo esperado, valor pago esperado ou None)
CASOS = [
    ("paguei a luz, foi 230", "mark_paid", 23000),
    ("a conta de água veio 98,50, já paguei", "mark_paid", 9850),
    ("paguei o condomínio, deu 612 esse mês", "mark_paid", 61200),
    ("paguei a internet", "mark_paid", None),
    ("gastei 230 no mercado", "create_expense", 23000),
]


async def main() -> int:
    print(f"{len(CASOS)} chamadas ao modelo do parse (Flash-Lite).")
    falhas = 0
    for texto, tipo, valor in CASOS:
        r = await finance_node({"text": texto, "timezone": "America/Sao_Paulo"})
        acoes = [FinanceAction.model_validate(a) for a in (r.get("finance_actions") or [])]
        a = acoes[0] if acoes else None
        obtido_tipo = a.type.value if a else "(vazio)"
        if a and tipo == "mark_paid":
            obtido_valor = a.new_amount_cents if a.new_amount_cents is not None else a.amount_cents
        else:
            obtido_valor = a.amount_cents if a else None
        ok = obtido_tipo == tipo and obtido_valor == valor
        falhas += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FALHOU'} {texto!r:50} -> {obtido_tipo} {obtido_valor} "
              f"(esperado {tipo} {valor}; new={a.new_amount_cents if a else None} amount={a.amount_cents if a else None})")
    print(f"\n{len(CASOS) - falhas}/{len(CASOS)}")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
