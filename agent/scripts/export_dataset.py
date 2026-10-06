"""Exporta pares aprovados e revisados de `agent_feedback` como JSONL ANONIMIZADO, no formato de
ajuste supervisionado: `{"input": <texto + contexto mínimo>, "output": <ações aprovadas>}`.

    .venv/bin/python scripts/export_dataset.py --saida pares.jsonl [--de 2026-10-01]

⚠️ É o insumo de um fine-tuning FUTURO do modelo barato, e isso só faz sentido com MILHARES de pares
rotulados — com dezenas ele só decora os casos. Hoje serve para montar um golden set e para olhar os
erros. O que entra: `approved` (a proposta estava certa: a saída é ela) e `revised` (a proposta
estava errada e a pessoa a corrigiu: a saída é a proposta NOVA, em `revised_to`). Recusa e expiração
não têm "resposta certa" e ficam de fora.

Anonimização: e-mail, CPF/CNPJ, telefone e número longo são mascarados pelos MESMOS padrões do
Langfuse (`services/telemetry.mascarar`) em todo texto do par, inclusive dentro das ações. Nome
próprio não tem forma e NÃO é mascarado: revise o arquivo antes de sair da máquina, e use-o só com a
previsão nos termos de uso (LGPD). Lê o `DATABASE_URL` do `agent/.env` (staging). Só leitura.
"""

from __future__ import annotations

import argparse
import os
import sys
import json
from datetime import date

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import get_settings  # noqa: E402
from app.services.telemetry import mascarar


def par(linha: dict) -> dict | None:
    texto = linha["input_text"]
    if linha["outcome"] == "approved":
        saida = linha["proposal"]
    else:  # revised: a saída certa é a proposta NOVA, e a correção entra na entrada
        revisao = linha["revised_to"] or {}
        saida = revisao.get("proposal")
        if revisao.get("correction_text"):
            texto = f"{texto}\n{revisao['correction_text']}"
    if not texto or not saida:
        return None
    return mascarar(data={
        "input": {"text": texto, "channel": linha["channel"]},
        "output": saida,
    })


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--saida", required=True)
    p.add_argument("--de", type=date.fromisoformat, default=date(2000, 1, 1))
    args = p.parse_args()

    with psycopg.connect(get_settings().database_url, row_factory=dict_row, connect_timeout=30) as con:
        linhas = con.execute(
            """select channel, input_text, proposal, outcome, revised_to
               from public.agent_feedback
               where outcome in ('approved', 'revised') and created_at >= %s
               order by created_at""",
            (args.de,),
        ).fetchall()

    n = 0
    with open(args.saida, "w", encoding="utf-8") as fh:
        for linha in linhas:
            if (registro := par(linha)) is not None:
                fh.write(json.dumps(registro, ensure_ascii=False) + "\n")
                n += 1
    print(f"{n} pares gravados em {args.saida} ({len(linhas)} linhas lidas)")
    if n < 1000:
        print("Atenção: poucos pares para ajuste supervisionado (a régua é a casa dos milhares).")


if __name__ == "__main__":
    main()
