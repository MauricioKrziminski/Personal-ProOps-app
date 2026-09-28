#!/usr/bin/env python3
"""Parcelas de uma compra no ÚLTIMO dia de cada mês, contra o Gemini REAL (28/09/2026).

    de agent/: .venv/bin/python scripts/probe_parcelas_no_ultimo_dia.py

Sem campo novo (`FinanceAction` no teto de 252): `update_transaction` com
`recurrence="FREQ=MONTHLY;BYMONTHDAY=-1"`. As frases de controle NÃO podem ganhar a regra — um dia
citado é `new_occurred_at`, e corrigir valor ou nome não mexe em dia. Uma chamada ao parse por caso.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.correcao_plano import ultimo_dia_das_parcelas
from app.graph.nodes import finance_node
from app.graph.schemas import FinanceAction

# (frase, espera o último dia?)
CASOS = [
    ("passa as parcelas da geladeira para o último dia de cada mês", True),
    ("a geladeira vence sempre no fim do mês", True),
    ("muda as parcelas do sofá pro último dia do mês", True),
    ("coloca a compra do notebook para cair todo último dia", True),
    ("a primeira parcela da tv é dia 30/10", False),
    ("muda a geladeira para 300 por parcela", False),
    ("renomeia a compra do sofá para sofá da sala", False),
]


async def main() -> int:
    print(f"{len(CASOS)} chamadas ao modelo do parse.")
    falhas = 0
    for texto, espera in CASOS:
        r = await finance_node({"text": texto, "timezone": "America/Sao_Paulo"})
        acoes = [FinanceAction.model_validate(a) for a in (r.get("finance_actions") or [])]
        a = acoes[0] if acoes else None
        obtido = bool(a and ultimo_dia_das_parcelas(a))
        tipo_ok = bool(a and a.type.value == "update_transaction")
        ok = obtido == espera and tipo_ok
        falhas += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FALHOU'} {texto!r:66} -> "
              f"{a.type.value if a else '(vazio)'} rec={a.recurrence if a else None} "
              f"data={a.new_occurred_at if a else None} desc={a.description if a else None}")
    print(f"\n{len(CASOS) - falhas}/{len(CASOS)}")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
