#!/usr/bin/env python3
"""Isola a CAUSA da recusa do schema de Finanças, em vez de tentar consertos.

O payload que sai daqui já é plano: só STRING e INTEGER, um enum, sem anyOf, sem
objeto aninhado, sem datetime/Decimal (verificado na conversão do
langchain-google-genai). Então a causa é uma destas três, e nenhuma delas dá para
descobrir lendo código:

    (a) o TAMANHO do enum de `type` — 22 valores contra os 7 de Notas
    (b) a presença de campos INTEGER
    (c) o número de propriedades

Cada variante abaixo muda UMA coisa em relação ao schema real. A que voltar a ser
aceita aponta o culpado.

    export GEMINI_API_KEY=...
    .venv/bin/python scripts/diagnose_finance_schema.py

Custo: 7 chamadas do Flash-Lite (cota grátis: 500/dia).
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import warnings

# A lib avisa em toda chamada que o Flash-Lite ignora `temperature` e que AFC
# está ativa. Verdade nas duas, e nenhuma muda o que este script mede — mas 7
# chamadas × 2 avisos enterrariam o veredito.
warnings.filterwarnings("ignore", category=UserWarning, module="langchain_google_genai.*")
logging.getLogger("google_genai").setLevel(logging.ERROR)
from enum import Enum
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pydantic import BaseModel, Field, create_model  # noqa: E402

from app.graph.schemas import (  # noqa: E402
    FinanceAction,
    FinanceActionType,
    FinancePlan,
    NotesPlan,
)
from app.services import gemini  # noqa: E402

# mesma classificação do validate_gemini_schemas.py: chave ruim / rede fora /
# cota estourada também devolvem 400 INVALID_ARGUMENT, e confundir isso com
# "schema recusado" faria alguém cortar campo por causa de um typo na chave
from scripts.validate_gemini_schemas import _erro_de_ambiente  # noqa: E402

VERDE, VERMELHO, AMARELO, CINZA, FIM = "\033[32m", "\033[31m", "\033[33m", "\033[90m", "\033[0m"

MENSAGEM = "mercado 200, uber 30 e recebi 500 de freela"
SISTEMA = "Extraia as ações financeiras da mensagem. Valores em centavos inteiros."

CAMPOS = list(FinanceAction.model_fields)          # ordem declarada
INTEIROS = [n for n, f in FinanceAction.model_fields.items() if "int" in str(f.annotation)]
TIPOS = [t.value for t in FinanceActionType]


def _campo(nome: str, tipo: type) -> tuple[Any, Any]:
    f = FinanceAction.model_fields[nome]
    return (tipo | None, Field(None, description=f.description))


def variante(nome: str, *, tipos: list[str], campos: list[str], inteiros_viram_str: bool):
    """Monta um FinanceAction alternativo e o embrulha igual ao FinancePlan real."""
    Tipo = Enum(f"Tipo_{nome}", {v.upper(): v for v in tipos}, type=str)  # type: ignore[misc]
    props: dict[str, Any] = {"type": (Tipo, ...)}
    for c in campos:
        if c == "type":
            continue
        eh_int = c in INTEIROS
        props[c] = _campo(c, str if (eh_int and inteiros_viram_str) else (int if eh_int else str))
    Acao = create_model(f"Acao_{nome}", **props)  # type: ignore[call-overload]
    return create_model(
        f"Plano_{nome}",
        actions=(list[Acao], Field(default_factory=list, max_length=10)),  # type: ignore[valid-type]
        confidence=(float, 1.0),
    )


async def tenta(rotulo: str, modelo: type[BaseModel], detalhe: str) -> bool:
    try:
        r = await gemini.structured(modelo, gemini.GEMINI_PARSE).ainvoke(
            [("system", SISTEMA), ("human", MENSAGEM)]
        )
    except Exception as err:  # noqa: BLE001
        texto = str(err)
        if _erro_de_ambiente(texto):
            print(f"  {AMARELO}⚠ {rotulo:<34}{FIM} {CINZA}não testado — ambiente{FIM}")
            print(f"      {AMARELO}{texto[:140]}{FIM}")
            raise SystemExit(
                f"\n{AMARELO}Interrompido: conserte o ambiente (chave/rede/cota) e rode de "
                f"novo. Nenhum schema foi julgado.{FIM}"
            )
        print(f"  {VERMELHO}✗ {rotulo:<34}{FIM} {CINZA}{detalhe}{FIM}")
        return False
    n = len(getattr(r, "actions", []) or [])
    print(f"  {VERDE}✓ {rotulo:<34}{FIM} {CINZA}{detalhe} — {n} ação(ões){FIM}")
    return True


async def main() -> int:
    if not os.getenv("GEMINI_API_KEY"):
        print(f"{VERMELHO}GEMINI_API_KEY não definida.{FIM}")
        return 1

    print(f"modelo: {gemini.GEMINI_PARSE}")
    print(f"real:   {len(CAMPOS)} propriedades, enum de {len(TIPOS)} valores, "
          f"{len(INTEIROS)} INTEGER ({', '.join(INTEIROS)})\n")

    r: dict[str, bool] = {}

    print("controles")
    r["notas"] = await tenta("Notas (passou antes)", NotesPlan, "9 props, enum 7, 0 int")
    r["real"] = await tenta("Finanças REAL", FinancePlan, f"15 props, enum {len(TIPOS)}, 3 int")

    print("\numa variável por vez")
    r["enum7"] = await tenta(
        "(a) enum cortado para 7", variante("enum7", tipos=TIPOS[:7], campos=CAMPOS, inteiros_viram_str=False),
        "15 props, enum 7, 3 int")
    r["semint"] = await tenta(
        "(b) INTEGER virou STRING", variante("semint", tipos=TIPOS, campos=CAMPOS, inteiros_viram_str=True),
        f"15 props, enum {len(TIPOS)}, 0 int")
    r["props9"] = await tenta(
        "(c) só 9 propriedades", variante("props9", tipos=TIPOS, campos=CAMPOS[:9], inteiros_viram_str=False),
        f"9 props, enum {len(TIPOS)}, int")

    print("\nonde exatamente o enum quebra")
    for n in (10, 16):
        r[f"enum{n}"] = await tenta(
            f"    enum de {n} valores", variante(f"e{n}", tipos=TIPOS[:n], campos=CAMPOS, inteiros_viram_str=False),
            f"15 props, enum {n}, 3 int")

    print(f"\n{'-' * 62}\nveredito")
    if r["real"]:
        print(f"  {AMARELO}O schema real passou agora. A recusa anterior foi transitória{FIM}")
        print("  (cota, indisponibilidade). Rode validate_gemini_schemas.py de novo.")
        return 0
    if not r["notas"]:
        print(f"  {AMARELO}Nem Notas passou — o problema não é o schema de Finanças.{FIM}")
        return 1
    if r["enum7"] and not r["semint"] and not r["props9"]:
        maior = max((n for n in (7, 10, 16) if r.get(f"enum{n}", n == 7)), default=7)
        print(f"  {VERDE}Causa: TAMANHO DO ENUM.{FIM} Passa com {maior}, quebra com {len(TIPOS)}.")
        print("  Correção: dividir Finanças em escrita/consulta/correção — o router")
        print("  já devolve lista de domínios, então não custa chamada a mais.")
    elif r["semint"] and not r["enum7"]:
        print(f"  {VERDE}Causa: campos INTEGER.{FIM} Troque para STRING no schema e converta")
        print("  no guards.py (que já valida o valor de qualquer forma).")
    elif r["props9"] and not r["enum7"] and not r["semint"]:
        print(f"  {VERDE}Causa: NÚMERO DE PROPRIEDADES{FIM} — e o teto é abaixo de 15 por este caminho.")
        print("  Correção: dividir o domínio (mesma solução, por outro motivo).")
    else:
        print(f"  {AMARELO}Combinação de fatores.{FIM} A divisão do domínio resolve as três de uma vez:")
        print("  menos propriedades E menos valores de enum em cada schema.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
