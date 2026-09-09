#!/usr/bin/env python3
"""O modelo preenche `search_term` quando a pergunta cita um nome — e só então.

⚠️ **Isto é o que separa "a lista está certa" de "a resposta está certa".** Em 09/09/2026,
no corte do WhatsApp, "quando cai meu salário?" foi respondido com as 16 recorrências do dono
do produto, quatro delas salário. O tool estava correto e o dado também; o que faltava era o
filtro. O pytest usa dublê e dublê sempre concorda — só o Gemini real diz se a frase de uma
pessoa vira o campo certo.

O par é indivisível: pergunta ESPECÍFICA tem que preencher, pergunta GERAL tem que deixar
vazio. Só a primeira metade viraria um agente que nunca lista tudo; só a segunda é o defeito
de hoje.

    source .env && export GEMINI_API_KEY
    .venv/bin/python scripts/probe_query_search_term.py

Custo: 12 chamadas do Flash-Lite (cota grátis: 500/dia).
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

from app.graph.prompts import FINANCE_QUERY  # noqa: E402
from app.graph.schemas import FinanceQueryPlan, FinanceQueryType  # noqa: E402
from app.security import wrap_untrusted  # noqa: E402
from app.services import gemini  # noqa: E402

VERDE, VERMELHO, CINZA, FIM = "\033[32m", "\033[31m", "\033[90m", "\033[0m"

# (mensagem, tipo esperado, trechos aceitos — None = search_term tem que ficar VAZIO)
#
# São vários trechos por caso de propósito. Para "quanto falta do empréstimo do nubank?" o
# modelo devolveu "empréstimo", e a primeira versão deste probe reprovou esperando "nubank" —
# mas as duas palavras casam as MESMAS linhas ("Empréstimo Nubank", "Empréstimo Nubank 2").
# O que o filtro precisa é achar o registro certo; exigir uma palavra exata seria medir a
# redação do modelo em vez do efeito dela.
CASOS = [
    ("quando cai meu salário?", FinanceQueryType.QUERY_RECURRING, ["salár"]),
    ("que dia entra o salário", FinanceQueryType.QUERY_RECURRING, ["salár"]),
    ("quando vence o aluguel?", FinanceQueryType.QUERY_RECURRING, ["alugu"]),
    ("quanto é a mensalidade da vivo?", FinanceQueryType.QUERY_RECURRING, ["vivo"]),
    ("quais minhas recorrências?", FinanceQueryType.QUERY_RECURRING, None),
    ("o que entra todo mês?", FinanceQueryType.QUERY_RECURRING, None),
    ("quais contas fixas eu tenho?", FinanceQueryType.QUERY_RECURRING, None),
    ("quanto falta do carro?", FinanceQueryType.QUERY_DEBTS, ["carro"]),
    ("quanto ainda devo do financiamento do carro", FinanceQueryType.QUERY_DEBTS, ["carro"]),
    (
        "quanto falta do empréstimo do nubank?",
        FinanceQueryType.QUERY_DEBTS,
        ["nubank", "empréstimo", "emprestimo"],
    ),
    ("quanto falta da dívida?", FinanceQueryType.QUERY_DEBTS, None),
    ("quanto eu devo no total?", FinanceQueryType.QUERY_DEBTS, None),
]


async def main() -> int:
    if not os.getenv("GEMINI_API_KEY"):
        print(f"{VERMELHO}GEMINI_API_KEY não definida.{FIM}")
        return 1

    print(f"modelo: {gemini.GEMINI_PARSE}\n")
    falhas = 0
    for msg, tipo_esperado, trechos in CASOS:
        plano = await gemini.structured(FinanceQueryPlan, gemini.GEMINI_PARSE).ainvoke(
            [("system", FINANCE_QUERY), ("human", wrap_untrusted("user_input", msg))]
        )
        acao = plano.actions[0] if plano.actions else None
        tipo = acao.type if acao else None
        termo = (acao.search_term or "").strip().lower() if acao else ""

        tipo_ok = tipo == tipo_esperado
        termo_ok = any(t in termo for t in trechos) if trechos else (termo == "")
        alvo = "/".join(f"“{t}”" for t in trechos) if trechos else "vazio"
        if tipo_ok and termo_ok:
            print(f"  {VERDE}✓{FIM} {msg:<45} {CINZA}{tipo_esperado.value} · {alvo}{FIM}")
        else:
            falhas += 1
            achou = f"“{termo}”" if termo else "vazio"
            print(
                f"  {VERMELHO}✗{FIM} {msg:<45} "
                f"{CINZA}esperava {tipo_esperado.value}/{alvo}, veio "
                f"{tipo.value if tipo else 'nada'}/{achou}{FIM}"
            )

    print(f"\n{'-' * 70}")
    if falhas:
        print(f"{VERMELHO}{falhas} de {len(CASOS)} falharam{FIM}")
    else:
        print(f"{VERDE}{len(CASOS)}/{len(CASOS)} — específica filtra, geral lista tudo{FIM}")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
