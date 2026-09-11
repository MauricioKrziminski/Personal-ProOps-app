#!/usr/bin/env python3
"""'Ciclo' é duas coisas, e o modelo tem que separar as duas.

A prova que motivou este arquivo foi feita no emulador em 11/09/2026: perguntei
*"qual e o meu ciclo atual"* ao agente de staging e ele respondeu com a **lista
de faturas de cartão**. Não era o modelo errando — a palavra "ciclo" não existia
em `prompts.py`, e "ciclo" sem mais nada é o ciclo do cartão.

Metade ACEITAR (o mês do usuário, dito de qualquer jeito — inclusive sem a
palavra "ciclo", que é como fala quem não sabe o nome da feature) e metade
DISCRIMINAR (o cartão continua sendo cartão, e dinheiro continua sendo projeção). As duas passam ou a mudança não fechou: regressão em "aceitar" é o
agente ficando surdo; regressão em "discriminar" é ele responder sobre o cartão
errado com cara de certeza.

    source .env && export GEMINI_API_KEY
    .venv/bin/python scripts/probe_cycle_routing.py

Custo: ~20 chamadas do Flash-Lite (cota grátis: 500/dia).
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

from app.domain.dates import local_datetime_iso  # noqa: E402
from app.graph import prompts  # noqa: E402
from app.graph.schemas import FinanceQueryPlan, FinanceQueryType  # noqa: E402
from app.services import gemini  # noqa: E402

VERDE, VERMELHO, CINZA, FIM = "\033[32m", "\033[31m", "\033[90m", "\033[0m"

CY, INV, FC, TX = (
    FinanceQueryType.QUERY_CYCLE,
    FinanceQueryType.QUERY_INVOICE,
    FinanceQueryType.QUERY_FORECAST,
    FinanceQueryType.QUERY_TRANSACTIONS,
)

CASOS: list[tuple[str, set[FinanceQueryType]]] = [
    # --- aceitar: o mês do usuário ---
    ("qual e o meu ciclo atual?", {CY}),
    ("quando fecha o meu mes?", {CY}),
    ("de quando a quando vai esse mes?", {CY}),
    ("meu mes fecha que dia?", {CY}),
    ("que periodo ta valendo agora?", {CY}),
    ("qual meu ciclo financeiro?", {CY}),
    ("meu mes comeca que dia?", {CY}),
    # --- sem a palavra "ciclo" e sem "meu mês": é assim que fala quem não sabe
    #     o nome da feature, e é o caso que o dono do produto levantou ---
    ("de quando a quando conta meus gastos?", {CY}),
    ("qual o meu periodo?", {CY}),
    ("quando vira a virada?", {CY}),
    ("a partir de que dia conta o mes novo?", {CY}),
    ("qual a data de corte?", {CY}),
    ("quando zera minha contagem de gastos?", {CY}),
    ("qual o meu fechamento?", {CY}),
    # --- discriminar: o cartão continua sendo o cartão ---
    ("quando fecha a fatura do nubank?", {INV}),
    ("qual o ciclo do nubank?", {INV}),
    ("que dia fecha meu cartao?", {INV}),
    ("dia de fechamento do inter", {INV}),
    ("quanto ta a fatura do nubank?", {INV}),
    ("quanto sobrou de limite no cartao?", {INV}),
    # --- discriminar: dinheiro é projeção, não configuração ---
    ("quanto vai sobrar ate o fim do ciclo?", {FC}),
    ("quanto sobra no fim do mes?", {FC}),
    ("vou ficar no vermelho esse mes?", {FC}),
    # --- discriminar: lista é lista ---
    ("quanto gastei esse mes?", {TX}),
    ("meus lancamentos do mes", {TX}),
]


async def rodar(texto: str) -> FinanceQueryType | None:
    modelo = gemini.structured(FinanceQueryPlan, gemini.GEMINI_PARSE)
    try:
        plano = await modelo.ainvoke(
            [
                ("system", prompts.FINANCE_QUERY),
                ("human", prompts.user_turn(
                    texto, local_datetime_iso("America/Sao_Paulo"), "America/Sao_Paulo"
                )),
            ]
        )
    except Exception as err:  # noqa: BLE001
        print(f"  {VERMELHO}erro{FIM} {texto}: {err}")
        return None
    return plano.actions[0].type if plano.actions else None


async def main() -> int:
    print(f"modelo: {gemini.GEMINI_PARSE}\n")
    falhas = 0
    for texto, esperado in CASOS:
        veio = await rodar(texto)
        ok = veio in esperado
        falhas += 0 if ok else 1
        marca = f"{VERDE}✓{FIM}" if ok else f"{VERMELHO}✗{FIM}"
        alvo = "/".join(sorted(e.value for e in esperado))
        print(f"  {marca} {texto:<42} {CINZA}{veio.value if veio else '—':<20} (esperado {alvo}){FIM}")

    print(f"\n{'-' * 72}")
    if falhas:
        print(f"  {VERMELHO}{falhas} de {len(CASOS)} erraram{FIM}")
        return 1
    print(f"  {VERDE}{len(CASOS)}/{len(CASOS)} — o ciclo do mês e o do cartão não se cruzam{FIM}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
