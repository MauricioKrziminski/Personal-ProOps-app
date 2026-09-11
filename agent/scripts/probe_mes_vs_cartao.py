#!/usr/bin/env python3
"""'Fecha dia N' é duas coisas, e só o substantivo as separa.

O mês do usuário e a fatura do cartão fecham num dia, e a frase é quase a mesma:
*"meu mês fecha dia 10"* × *"cadastra o Inter que fecha dia 7"*. Trocar um pelo
outro move a régua de leitura do workspace inteiro achando que cadastrou um
cartão — ou cria um cartão achando que mudou o mês.

Metade ACEITAR (resource=mes) e metade DISCRIMINAR (resource=cards). As duas
passam ou a mudança não fechou.

    source .env && export GEMINI_API_KEY
    .venv/bin/python scripts/probe_mes_vs_cartao.py

Custo: ~16 chamadas do Flash-Lite (cota grátis: 500/dia).
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
from app.graph.prompts import _ANTI_INJECTION  # noqa: E402
from app.graph.prompts import user_turn  # noqa: E402
from app.graph.schemas import ResourcePlan  # noqa: E402
from app.services import gemini  # noqa: E402
from app.tools import resources  # noqa: E402

VERDE, VERMELHO, CINZA, FIM = "\033[32m", "\033[31m", "\033[90m", "\033[0m"

CASOS: list[tuple[str, str, str | None]] = [
    # texto, recurso esperado, campo que tem que aparecer
    ("meu mes fecha dia 10", "mes", "cycle_close_day"),
    ("quero que meu mes feche todo dia 5", "mes", "cycle_close_day"),
    ("meu periodo financeiro vai do dia 15 ao dia 15", "mes", "cycle_close_day"),
    ("muda meu mes pra fechar no dia 20", "mes", "cycle_close_day"),
    ("meu mes volta a fechar no fim do mes", "mes", "cycle_close_day"),
    # --- o cartão continua sendo cartão ---
    ("cadastra o cartao Inter que fecha dia 7", "cards", "closing_day"),
    ("o fechamento do nubank e dia 3", "cards", "closing_day"),
    ("meu cartao fecha dia 10 e vence dia 17", "cards", "closing_day"),
    ("novo cartao Itau, fecha 20 vence 27", "cards", "closing_day"),
    # --- rotativo ---
    ("liga o rotativo do nubank", "cards", "rotativo_auto"),
    ("deixa a fatura do nubank rolar sozinha se eu nao pagar", "cards", "rotativo_auto"),
    ("os juros do rotativo do nubank sao 12,876%", "cards", "rotativo_rate_monthly"),
    ("desliga o rotativo automatico do inter", "cards", "rotativo_auto"),
]


async def rodar(texto: str):
    prompt = (
        "Extraia cadastros do app. Tipos resource_create, resource_update, resource_delete, "
        "resource_list, resource_pay. resource é uma chave do catálogo; name identifica o item. "
        "fields contém pares name/value; valores são strings.\nCatálogo:\n"
        + resources.prompt_catalogue()
        + "\n"
        + _ANTI_INJECTION
    )
    modelo = gemini.structured(ResourcePlan, gemini.GEMINI_PARSE)
    try:
        plano = await modelo.ainvoke(
            [
                ("system", prompt),
                ("human", user_turn(texto, local_datetime_iso("America/Sao_Paulo"), "America/Sao_Paulo")),
            ]
        )
    except Exception as err:  # noqa: BLE001
        return None, [], str(err)[:60]
    if not plano.actions:
        return None, [], "sem ação"
    a = plano.actions[0]
    return a.resource, [f.name for f in a.fields], None


async def main() -> int:
    print(f"modelo: {gemini.GEMINI_PARSE}\n")
    falhas = 0
    for texto, esperado, campo in CASOS:
        recurso, campos, erro = await rodar(texto)
        ok = recurso == esperado and (campo is None or campo in campos)
        falhas += 0 if ok else 1
        marca = f"{VERDE}✓{FIM}" if ok else f"{VERMELHO}✗{FIM}"
        detalhe = erro or f"{recurso} {campos}"
        print(f"  {marca} {texto:<48} {CINZA}{detalhe:<44} (esperado {esperado}.{campo}){FIM}")

    print(f"\n{'-' * 84}")
    if falhas:
        print(f"  {VERMELHO}{falhas} de {len(CASOS)} erraram{FIM}")
        return 1
    print(f"  {VERDE}{len(CASOS)}/{len(CASOS)} — 'fecha dia N' não troca o mês pelo cartão{FIM}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
