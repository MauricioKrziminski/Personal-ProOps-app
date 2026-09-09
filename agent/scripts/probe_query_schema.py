#!/usr/bin/env python3
"""Mede o teto dos schemas de CONSULTA antes de somar capacidade neles.

A auditoria de 09/09/2026 fechou as lacunas de MUTAÇÃO (`docs/AGENTE-PARIDADE-COM-O-APP.md`).
A de LEITURA ficou para depois, e é a que este probe habilita: para o agente responder
"quais minhas recorrências?", "quando cai meu salário?" e "quanto falta da dívida?" faltam
valores de enum em `FinanceQuery` e em `NotesAction`.

⚠️ **O limite é o PRODUTO propriedades × valores de enum, e ele é MEDIDO.** `ai-gemini.md`:
`15×22 = 330` recusa, `198`/`150`/`105` passam, e estimar já custou uma quebra em produção.
`FinanceAction` está no teto de 252; os schemas de consulta estão em 63 e a folga PARECE larga —
mas "parece" é exatamente o que esta suíte existe para não aceitar.

    source .env && export GEMINI_API_KEY
    .venv/bin/python scripts/probe_query_schema.py

Custo: 6 chamadas do Flash-Lite (cota grátis: 500/dia).
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import warnings

warnings.filterwarnings("ignore", category=UserWarning, module="langchain_google_genai.*")
logging.getLogger("google_genai").setLevel(logging.ERROR)

from enum import Enum  # noqa: E402
from typing import Any  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pydantic import BaseModel, Field, create_model  # noqa: E402

from app.graph.schemas import (  # noqa: E402
    FinanceQuery,
    FinanceQueryType,
    NotesAction,
    NotesActionType,
)
from app.services import gemini  # noqa: E402
from scripts.validate_gemini_schemas import _erro_de_ambiente  # noqa: E402

VERDE, VERMELHO, AMARELO, CINZA, FIM = "\033[32m", "\033[31m", "\033[33m", "\033[90m", "\033[0m"

SISTEMA = "Extraia a consulta da mensagem do usuário."
MENSAGEM = "quanto gastei esse mês e quais minhas recorrências?"


def _plano(nome: str, base: type[BaseModel], tipos: list[str], extras: int):
    """Monta uma variante de `base` com `len(tipos)` valores de enum e `extras` propriedades."""
    Tipo = Enum(f"T_{nome}", {v.upper(): v for v in tipos}, type=str)  # type: ignore[misc]
    props: dict[str, Any] = {"type": (Tipo, ...)}
    for campo, f in base.model_fields.items():
        if campo == "type":
            continue
        eh_int = "int" in str(f.annotation)
        props[campo] = (int | None if eh_int else str | None, Field(None, description=f.description))
    for i in range(extras):
        props[f"extra_{i}"] = (str | None, Field(None, description="Propriedade de teste."))
    Acao = create_model(f"A_{nome}", **props)  # type: ignore[call-overload]
    return create_model(
        f"P_{nome}",
        actions=(list[Acao], Field(default_factory=list, max_length=10)),  # type: ignore[valid-type]
        confidence=(float, 1.0),
    )


async def tenta(rotulo: str, modelo: type[BaseModel], props: int, enum: int) -> bool:
    detalhe = f"{props} props × enum {enum} = {props * enum}"
    try:
        await gemini.structured(modelo, gemini.GEMINI_PARSE).ainvoke(
            [("system", SISTEMA), ("human", MENSAGEM)]
        )
    except Exception as err:  # noqa: BLE001
        texto = str(err)
        if _erro_de_ambiente(texto):
            print(f"  {AMARELO}⚠ {rotulo:<40}{FIM} {CINZA}não testado — ambiente{FIM}")
            raise SystemExit(f"\n{AMARELO}Conserte chave/rede/cota. Nada foi julgado.{FIM}")
        print(f"  {VERMELHO}✗ {rotulo:<40}{FIM} {CINZA}{detalhe}{FIM}")
        return False
    print(f"  {VERDE}✓ {rotulo:<40}{FIM} {CINZA}{detalhe}{FIM}")
    return True


async def main() -> int:
    if not os.getenv("GEMINI_API_KEY"):
        print(f"{VERMELHO}GEMINI_API_KEY não definida.{FIM}")
        return 1

    fq = [t.value for t in FinanceQueryType]
    na = [t.value for t in NotesActionType]
    nfq, nna = len(FinanceQuery.model_fields), len(NotesAction.model_fields)
    print(f"modelo: {gemini.GEMINI_PARSE}")
    print(f"hoje: FinanceQuery {nfq}×{len(fq)}={nfq * len(fq)} · NotesAction {nna}×{len(na)}={nna * len(na)}\n")

    ok: dict[str, bool] = {}

    print("FinanceQuery — somar tipos de consulta")
    ok["fq_atual"] = await tenta("atual (controle)", _plano("fq0", FinanceQuery, fq, 0), nfq, len(fq))
    for n in (2, 3):
        tipos = fq + [f"query_extra_{i}" for i in range(n)]
        ok[f"fq+{n}"] = await tenta(f"+{n} tipos", _plano(f"fq{n}", FinanceQuery, tipos, 0), nfq, len(tipos))
    print("\nFinanceQuery — somar tipos E uma propriedade (alvo por texto)")
    tipos = fq + ["query_extra_0", "query_extra_1"]
    ok["fq+2+1p"] = await tenta(
        "+2 tipos, +1 propriedade", _plano("fqp", FinanceQuery, tipos, 1), nfq + 1, len(tipos)
    )

    print("\nNotesAction — somar consulta de lembretes")
    ok["na_atual"] = await tenta("atual (controle)", _plano("na0", NotesAction, na, 0), nna, len(na))
    tipos_na = na + ["query_extra_0"]
    ok["na+1"] = await tenta("+1 tipo", _plano("na1", NotesAction, tipos_na, 0), nna, len(tipos_na))

    print(f"\n{'-' * 62}\nveredito")
    if not (ok["fq_atual"] and ok["na_atual"]):
        print(f"  {VERMELHO}os CONTROLES falharam — o problema não é tamanho de schema{FIM}")
        return 1
    for chave, rotulo in (
        ("fq+2", "FinanceQuery cabe +2 tipos"),
        ("fq+3", "FinanceQuery cabe +3 tipos"),
        ("fq+2+1p", "FinanceQuery cabe +2 tipos e +1 propriedade"),
        ("na+1", "NotesAction cabe +1 tipo"),
    ):
        cor = VERDE if ok.get(chave) else VERMELHO
        print(f"  {cor}{'sim' if ok.get(chave) else 'NÃO':<4}{FIM} {rotulo}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
