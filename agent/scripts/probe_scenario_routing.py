#!/usr/bin/env python3
"""O roteamento das perguntas HIPOTÉTICAS, contra o Gemini real.

A validação de 10/09/2026 mediu o defeito mais caro do agente, e ele não parecia defeito:
*"e se eu passar a receber 1.500 por mês, fico no vermelho?"* casava com `query_forecast`
(o prompt dizia literalmente *"vou ficar no vermelho?"*), que roda a projeção **REAL**,
ignora a premissa e devolve um número confiante que responde outra pergunta.

O pytest não pega isto: lá o modelo é dublê e dublê sempre concorda. Só uma chamada de
verdade diz se a pessoa pode perguntar do jeito dela.

    source .env && export GEMINI_API_KEY
    .venv/bin/python scripts/probe_scenario_routing.py

Custo: ~14 chamadas do Flash-Lite (cota grátis: 500/dia).
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import warnings

warnings.filterwarnings("ignore", category=UserWarning, module="langchain_google_genai.*")
logging.getLogger("google_genai").setLevel(logging.ERROR)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.graph.prompts import FINANCE_QUERY, user_turn  # noqa: E402
from app.graph.schemas import FinanceQueryPlan, FinanceQueryType  # noqa: E402
from app.services import gemini  # noqa: E402

VERDE, VERMELHO, CINZA, FIM = "\033[32m", "\033[31m", "\033[90m", "\033[0m"
SIM = FinanceQueryType.SIMULATE_SCENARIO
FC = FinanceQueryType.QUERY_FORECAST

# (mensagem, tipo esperado, campos que TÊM que vir preenchidos)
CASOS = [
    # — o que quebrava: hipótese de RECEITA e de RECORRÊNCIA —
    ("e se eu passar a receber 1500 por mes, fico no vermelho?", SIM, {"kind": "income", "mode": "monthly"}),
    ("e se eu receber um extra de 5000 em dezembro?", SIM, {"kind": "income"}),
    ("supondo que eu ganhe 2 mil a mais por mes", SIM, {"kind": "income", "mode": "monthly"}),
    ("e se eu gastar 2000 todo mes com aluguel?", SIM, {"kind": "expense", "mode": "monthly"}),
    # — o que já funcionava: não pode regredir —
    ("posso comprar um celular de 3000 em 10x?", SIM, {"kind": "expense", "mode": "total"}),
    ("da pra bancar uma parcela de 800?", SIM, {"kind": "expense"}),
    ("consigo comprar uma tv de 2500 a vista?", SIM, {"kind": "expense"}),
    # — o outro lado: pergunta SEM hipótese continua sendo projeção real —
    ("vou ficar no vermelho esse mes?", FC, {}),
    ("quanto vai sobrar na conta no fim do mes?", FC, {}),
    ("como fica meu saldo daqui a 3 meses?", FC, {}),
]


async def um(msg: str, esperado: FinanceQueryType, campos: dict) -> bool:
    modelo = gemini.structured(FinanceQueryPlan, gemini.GEMINI_PARSE)
    plano = await modelo.ainvoke(
        [("system", FINANCE_QUERY), ("human", user_turn(msg, "2026-09-10T15:00:00", "America/Sao_Paulo"))]
    )
    acoes = [a for a in plano.actions if a.type != FinanceQueryType.UNKNOWN]
    if not acoes:
        print(f"  {VERMELHO}✗{FIM} {msg[:52]:<54} {CINZA}nenhuma ação{FIM}")
        return False
    a = acoes[0]
    erros = []
    if a.type != esperado:
        erros.append(f"tipo={a.type.value} (esperado {esperado.value})")
    for campo, valor in campos.items():
        if (getattr(a, campo) or "").strip().lower() != valor:
            erros.append(f"{campo}={getattr(a, campo)!r} (esperado {valor!r})")
    if erros:
        print(f"  {VERMELHO}✗{FIM} {msg[:52]:<54} {CINZA}{'; '.join(erros)}{FIM}")
        return False
    extra = f"{a.kind or '-'}/{a.mode or '-'}" if a.type == SIM else "-"
    print(f"  {VERDE}✓{FIM} {msg[:52]:<54} {CINZA}{a.type.value} {extra}{FIM}")
    return True


async def main() -> int:
    if not os.getenv("GEMINI_API_KEY"):
        print(f"{VERMELHO}GEMINI_API_KEY não definida.{FIM}")
        return 1
    print(f"modelo: {gemini.GEMINI_PARSE}\n")
    ok = [await um(*c) for c in CASOS]
    print(f"\n{'-' * 70}\n{sum(ok)}/{len(ok)}")
    return 0 if all(ok) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
