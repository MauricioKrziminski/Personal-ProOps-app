#!/usr/bin/env python3
"""Mede o teto de `FinanceQuery` antes de o agente ganhar o "E se…?" da tela.

A validação de 10/09/2026 achou o buraco: a tela simula receita, hipótese que REPETE todo mês,
data de início e várias suposições empilhadas; o agente só sabia "posso comprar X em Nx",
sempre gasto, sempre começando hoje. Fechar isso pede campos novos — e `ai-gemini.md` é
explícito: **o limite é o PRODUTO propriedades × valores de enum, e ele é MEDIDO.** A recusa é
um `400 INVALID_ARGUMENT` sem detalhe, e estimar aqui já custou uma quebra em produção.

Hoje: 8 props × 11 enums = 88. Teto conhecido: 8×13 = 104 (`probe_query_schema.py`, 09/09).
As formas candidatas:

  • **+2 props** (`kind`, `mode`), reusando `query_from` como início e `query_to` como
    horizonte → 10×11 = 110. É a forma limpa: um campo, um significado.
  • **+1 prop** (`scenario`, um campo só com 4 valores mágicos em texto) → 9×11 = 99. É o
    plano B, e é pior para o modelo: dois eixos escondidos num string.
  • **+3 props** mede a folga que sobra depois.

    source .env && export GEMINI_API_KEY
    .venv/bin/python scripts/probe_scenario_schema.py

Custo: 4 chamadas do Flash-Lite (cota grátis: 500/dia).
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

from app.graph.schemas import FinanceQuery, FinanceQueryType  # noqa: E402
from scripts.probe_query_schema import VERDE, VERMELHO, FIM, _plano, tenta  # noqa: E402


async def main() -> int:
    if not os.getenv("GEMINI_API_KEY"):
        print(f"{VERMELHO}GEMINI_API_KEY não definida.{FIM}")
        return 1

    tipos = [t.value for t in FinanceQueryType]
    n = len(FinanceQuery.model_fields)
    print(f"hoje: FinanceQuery {n}×{len(tipos)}={n * len(tipos)}\n")

    ok = {}
    ok["controle"] = await tenta("atual (controle)", _plano("s0", FinanceQuery, tipos, 0), n, len(tipos))
    for extras in (1, 2, 3):
        ok[extras] = await tenta(
            f"+{extras} propriedade(s)",
            _plano(f"s{extras}", FinanceQuery, tipos, extras),
            n + extras,
            len(tipos),
        )

    print(f"\n{'-' * 62}\nveredito")
    if not ok["controle"]:
        print(f"  {VERMELHO}o CONTROLE falhou — o problema não é tamanho de schema{FIM}")
        return 1
    for extras, rotulo in (
        (1, "cabe +1 prop  (plano B: campo `scenario` único)  = 99"),
        (2, "cabe +2 props (`kind` + `mode`, a forma limpa)   = 110"),
        (3, "cabe +3 props (folga depois disso)               = 121"),
    ):
        cor = VERDE if ok.get(extras) else VERMELHO
        print(f"  {cor}{'sim' if ok.get(extras) else 'NÃO':<4}{FIM} {rotulo}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
