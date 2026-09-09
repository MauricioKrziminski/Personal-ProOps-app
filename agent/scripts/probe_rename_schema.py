#!/usr/bin/env python3
"""Renomear um lançamento pelo WhatsApp, contra o Gemini REAL.

    de agent/: .venv/bin/python scripts/probe_rename_schema.py

Duas coisas ao mesmo tempo:

1. **O schema cabe.** `FinanceAction` está em 18 propriedades × 14 tipos = 252 (soma 32), acima
   do teto anterior de 238/31. Medido e aceito em 09/09/2026 — a recusa da API é um
   `400 INVALID_ARGUMENT` SEM detalhe, então estimar aqui já custou uma quebra em produção.
2. **A separação se sustenta.** `description` é BUSCA e `new_description` é o nome novo. Se o
   modelo confundir os dois, ele procura pelo nome que o usuário ainda não deu e a correção não
   acha nada — falha silenciosa, do tipo que dublê nenhum pega.

O pytest usa dublês e dublê sempre concorda; só esta chamada responde se o modelo separa.
Sem banco, sem WhatsApp, sem escrita.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.graph.prompts import FINANCE
from app.graph.schemas import FinanceAction, FinanceActionType, FinancePlan
from app.services import gemini

# Formas diferentes de pedir a MESMA coisa. Uma lista de sinônimos no código seria a armadilha
# que `regex-nao-infere-sentido` descreve; aqui elas existem para MEDIR se o modelo aguenta.
FRASES = [
    'muda o nome do último lançamento para Mercado do Zé',
    'renomeia aquele gasto do mercado pra "Mercado do Zé"',
    'aquele lançamento do mercado, na verdade chama Mercado do Zé',
    'troca a descrição do mercado de ontem para Mercado do Zé',
]


async def main() -> int:
    p, e = len(FinanceAction.model_fields), len(list(FinanceActionType))
    print(f"schema: {p} propriedades × {e} tipos = {p * e}, soma {p + e}")
    falhas = 0
    for frase in FRASES:
        try:
            r = await gemini.structured(FinancePlan, gemini.GEMINI_PARSE).ainvoke(
                [("system", FINANCE), ("human", frase)]
            )
            a = r.actions[0]
            ok = (a.type == FinanceActionType.UPDATE_TRANSACTION
                  and a.new_description and "zé" in a.new_description.lower())
            print(f"{'ok  ' if ok else 'FALHOU'} {frase!r} -> new_description={a.new_description!r}, "
                  f"description={a.description!r}")
            falhas += 0 if ok else 1
        except Exception as exc:  # noqa: BLE001 — a recusa do schema é o que se quer ver
            print(f"FALHOU {frase!r}: {type(exc).__name__}: {str(exc)[:200]}")
            falhas += 1
    print(f"\n{len(FRASES) - falhas}/{len(FRASES)}")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
