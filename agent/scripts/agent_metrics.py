"""Imprime as duas leituras do ciclo de dados para um período: qualidade do agente
(`private.agent_quality`) e unit economics de IA (`private.ai_unit_economics`).

    .venv/bin/python scripts/agent_metrics.py --de 2026-10-01 --ate 2026-10-31

Lê `DATABASE_URL` do `agent/.env` (o STAGING; produção mora em `.env.production` e nunca é lida por
padrão). Só leitura. Rode de dentro de `agent/`.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import get_settings  # noqa: E402


def _tabela(linhas: list[dict], colunas: list[str]) -> None:
    if not linhas:
        print("  (sem dados no período)")
        return
    largura = {c: max(len(c), *(len(str(l[c])) for l in linhas)) for c in colunas}
    print("  " + "  ".join(c.ljust(largura[c]) for c in colunas))
    for l in linhas:
        print("  " + "  ".join(str(l[c]).ljust(largura[c]) for c in colunas))


def main() -> None:
    hoje = date.today()
    p = argparse.ArgumentParser()
    p.add_argument("--de", type=date.fromisoformat, default=hoje.replace(day=1))
    p.add_argument("--ate", type=date.fromisoformat, default=hoje)
    args = p.parse_args()

    with psycopg.connect(get_settings().database_url, row_factory=dict_row, connect_timeout=30) as con:
        qualidade = con.execute("select * from private.agent_quality(%s, %s)", (args.de, args.ate)).fetchall()
        economia = con.execute("select * from private.ai_unit_economics(%s)", (args.de,)).fetchall()

    print(f"Qualidade do agente · {args.de} a {args.ate}")
    _tabela(qualidade, ["dimensao", "chave", "total", "aprovadas", "corrigidas", "recusadas",
                        "expiradas", "taxa_aprovacao", "taxa_correcao"])
    print(f"\nCusto de IA por workspace · mês de {args.de:%Y-%m}")
    _tabela(economia, ["workspace_id", "plano", "turnos", "turnos_sem_custo", "custo_usd",
                       "custo_medio_turno_usd"])


if __name__ == "__main__":
    main()
