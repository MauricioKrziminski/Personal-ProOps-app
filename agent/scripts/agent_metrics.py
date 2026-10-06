"""Imprime as leituras do ciclo de dados para um período: qualidade do agente
(`private.agent_quality`), unit economics de IA (`private.ai_unit_economics`) e chamadas por dia
de cada versão de prompt (o número que decide se o cache EXPLÍCITO do Gemini se paga).

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


# Cache explícito (auditoria, 06/10/2026): Lite cobra US$ 0,025/M em cache contra 0,25/M de entrada
# e US$ 1/M tokens/hora de armazenamento — um prompt de ~2 mil tokens só se paga acima de ~107
# chamadas/dia. No nível gratuito o limite de armazenamento é ZERO e o cache implícito deu 0 tokens
# no prefixo repetido. Quando uma versão passar disso por dia, vale ligar o cache para ela.
BREAK_EVEN_CHAMADAS_DIA = 107

CHAMADAS_POR_VERSAO = """
    select c->>'no' as no, c->>'versao_prompt' as versao, c->>'modelo' as modelo,
           count(*) as chamadas,
           round(count(*)::numeric / greatest(1, %(ate)s::date - %(de)s::date + 1), 1) as por_dia,
           round(avg((c->>'input_tokens')::int)) as entrada_media,
           coalesce(sum((c->>'cached_tokens')::int), 0) as em_cache
    from public.ai_events e, jsonb_array_elements(e.calls) c
    where jsonb_typeof(e.calls) = 'array'
      and e.created_at >= %(de)s and e.created_at < %(ate)s::date + 1
      and c->>'versao_prompt' is not null
    group by 1, 2, 3
    order by chamadas desc
"""


def main() -> None:
    hoje = date.today()
    p = argparse.ArgumentParser()
    p.add_argument("--de", type=date.fromisoformat, default=hoje.replace(day=1))
    p.add_argument("--ate", type=date.fromisoformat, default=hoje)
    args = p.parse_args()

    with psycopg.connect(get_settings().database_url, row_factory=dict_row, connect_timeout=30) as con:
        qualidade = con.execute("select * from private.agent_quality(%s, %s)", (args.de, args.ate)).fetchall()
        economia = con.execute("select * from private.ai_unit_economics(%s)", (args.de,)).fetchall()
        versoes = con.execute(CHAMADAS_POR_VERSAO, {"de": args.de, "ate": args.ate}).fetchall()

    print(f"Qualidade do agente · {args.de} a {args.ate}")
    _tabela(qualidade, ["dimensao", "chave", "total", "aprovadas", "corrigidas", "recusadas",
                        "expiradas", "taxa_aprovacao", "taxa_correcao"])
    print(f"\nCusto de IA por workspace · mês de {args.de:%Y-%m}")
    _tabela(economia, ["workspace_id", "plano", "turnos", "turnos_sem_custo", "custo_usd",
                       "custo_medio_turno_usd"])
    print(f"\nChamadas por versão de prompt · {args.de} a {args.ate} "
          f"(cache explícito se paga acima de ~{BREAK_EVEN_CHAMADAS_DIA}/dia)")
    for v in versoes:
        v["cache?"] = "vale" if v["por_dia"] >= BREAK_EVEN_CHAMADAS_DIA else "não"
    _tabela(versoes, ["no", "versao", "modelo", "chamadas", "por_dia", "entrada_media", "em_cache",
                      "cache?"])


if __name__ == "__main__":
    main()
