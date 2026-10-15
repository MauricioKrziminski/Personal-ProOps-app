"""Sonda: o texto de uma notificação de banco vira o lançamento certo — ou nenhum.

Roda no Gemini GRATUITO (IA_TABELA=economica) e imprime quantas chamadas fará antes de fazer.
Os casos moram em `notificacoes_de_banco.py` (o simulador lê os mesmos).

    cd agent && .venv/bin/python scripts/probe_captura_notificacao.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("IA_TABELA", "economica")
os.environ["LANGFUSE_PUBLIC_KEY"] = ""

from app.graph import nodes  # noqa: E402
from scripts.eval_cache import com_paciencia  # noqa: E402
from app.routes.captures import BANCOS, origem_da_notificacao, texto_da_notificacao  # noqa: E402
from scripts.notificacoes_de_banco import CASOS  # noqa: E402

CRIA = {"create_expense", "create_income", "create_installment_purchase", "mark_paid"}


async def main() -> int:
    print(f"{len(CASOS)} chamadas ao modelo (parse).")
    erros = 0
    for pacote, titulo, texto, esperado in CASOS:
        banco = BANCOS[pacote]
        estado = {"text": texto_da_notificacao(titulo, texto), "origem": origem_da_notificacao(banco),
                  "timezone": "America/Sao_Paulo", "workspace_id": None, "messages": None,
                  "agora_local": "2026-10-12T13:05:00"}
        saida = await com_paciencia(lambda: nodes.finance_node(estado))
        acoes = [a for a in saida.get("finance_actions", []) if a.get("type") in CRIA]
        obtido = None
        if acoes:
            a = acoes[0]
            obtido = ("income" if a["type"] == "create_income" else "expense", a.get("amount_cents"))
        ok = obtido == esperado
        erros += not ok
        print(("ok   " if ok else "FALHA"), banco, "|", texto[:60], "→", obtido, "" if ok else f"(esperado {esperado})")
    print(f"\n{len(CASOS) - erros}/{len(CASOS)}")
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
