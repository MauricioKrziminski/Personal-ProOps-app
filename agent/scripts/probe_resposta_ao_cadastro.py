#!/usr/bin/env python3
"""A resposta a uma pergunta de cadastro volta ao cadastro, contra o Gemini REAL (roteador).

    de agent/: .venv/bin/python scripts/probe_resposta_ao_cadastro.py

25/09/2026: "Qual conta foi usada para pagar a prestação?" → "nubank" virou "pagar qual?" com
nove opções. Uma chamada ao roteador (Flash-Lite) por caso.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.graph import nodes

RASCUNHO = [{"type": "resource_pay", "resource": "debts", "name": "carro", "fields": [
    {"name": "amount_cents", "value": "11500"}], "_pergunta": "Qual conta foi usada para pagar a prestação?"}]

# (frase, domínio esperado ou "descarta")
CASOS = [
    ("nubank", "cadastros"),
    ("foi pelo inter", "cadastros"),
    ("gastei 45 no mercado", "financas"),
    ("cancela", "descarta"),
]


async def main() -> int:
    print(f"{len(CASOS)} chamadas ao roteador (Flash-Lite).")
    falhas = 0
    for texto, esperado in CASOS:
        r = await nodes.route({"text": texto, "timezone": "America/Sao_Paulo", "resource_draft": RASCUNHO})
        obtido = "descarta" if r.get("halted") and r.get("resource_draft") == [] else ",".join(r["domains"])
        ok = esperado == obtido or (esperado != "descarta" and esperado in obtido.split(","))
        falhas += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FALHOU'} {texto!r:28} -> {obtido} (esperado {esperado})")
    print(f"\n{len(CASOS) - falhas}/{len(CASOS)}")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
