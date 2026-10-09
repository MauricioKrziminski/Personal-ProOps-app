"""As três correções novas do agente contra o Gemini REAL (26/09/2026, "tudo que se cria se edita").

    de agent/: .venv/bin/python scripts/probe_tudo_se_edita.py

1. "Parcelas já pagas" de uma compra que existe -> update_transaction com already_paid_count.
2. Corrigir um aporte de meta -> resource_update goals com aporte_do_dia/novo_valor_do_aporte
   (update_transaction com target_ref voltava SEM os valores no Lite, em toda redação medida).
3. Desmarcar a fatura como paga / desfazer o adiamento -> resource_update cards
   fatura_paga=false / fatura_adiada=false.

Cada bloco tem os NEGATIVOS que não podem mudar de caminho: dar baixa numa parcela, criar compra
com parcelas pagas, guardar mais na meta, adiar a fatura, ligar o rotativo, pagar a fatura.
Roteador, nó de finanças e nó de cadastros de VERDADE; o banco do cadastro é dublê (o `prepare`
não roda). Tudo no modelo do router/parse (Flash-Lite, cota grátis de 500/dia).
"""
from __future__ import annotations

import asyncio
import logging
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", category=UserWarning, module="langchain_google_genai.*")
logging.getLogger("google_genai").setLevel(logging.ERROR)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.eval_cache import usar_modelos_economicos  # noqa: E402

usar_modelos_economicos()

from app.graph import nodes  # noqa: E402
from app.graph.schemas import FinanceAction, ResourceAction  # noqa: E402
from app import db  # noqa: E402
from app.tools import resources  # noqa: E402

TZ = "America/Sao_Paulo"

# texto, domínio que tem que estar entre os devolvidos
ROTEADOR = [
    ("na verdade só paguei 2 parcelas da tv", "financas"),
    ("o aporte de ontem na viagem foi 200, não 100", "cadastros"),
    ("corrige o último aporte da reserva para 150", "cadastros"),
    ("desmarca a fatura do nubank como paga", "cadastros"),
    ("desfaz o adiamento da fatura do nubank", "cadastros"),
    ("marquei a fatura de agosto do inter como paga sem querer", "cadastros"),
    # negativos
    ("paguei a fatura do nubank", "financas"),
    ("guardei 200 na viagem", "financas"),
    ("adia a fatura do nubank", "cadastros"),
]

# texto, tipo esperado, conferência extra
FINANCAS = [
    ("na verdade só paguei 2 parcelas da tv", "update_transaction",
     lambda a: a.already_paid_count == 2),
    ("a geladeira tem 3 parcelas pagas, não 5", "update_transaction",
     lambda a: a.already_paid_count == 3),
    ("nenhuma parcela do sofá foi paga ainda", "update_transaction",
     lambda a: a.already_paid_count == 0),
    # negativos
    ("paguei a 3ª parcela da tv", "mark_paid", lambda a: a.already_paid_count is None),
    ("comprei uma tv em 10x de 300 no nubank, já paguei 2", "create_installment_purchase",
     lambda a: a.already_paid_count == 2),
    ("guardei 200 na viagem", "goal_deposit", lambda a: a.amount_cents == 20000),
    ("o mercado de ontem foi 120, não 100", "update_transaction",
     lambda a: a.new_amount_cents == 12000 and not a.target_ref),
]

# texto, tipo, campo esperado (nome=valor) ou None
CADASTROS = [
    ("desmarca a fatura do nubank como paga", "resource_update", "fatura_paga=false"),
    ("a fatura do inter não estava paga, reabre ela", "resource_update", "fatura_paga=false"),
    ("marquei a fatura de agosto do inter como paga sem querer", "resource_update", "fatura_paga=false"),
    ("desfaz o adiamento da fatura do nubank", "resource_update", "fatura_adiada=false"),
    ("volta a fatura do inter que eu joguei pra próxima", "resource_update", "fatura_adiada=false"),
    ("o aporte de ontem na viagem foi 200, não 100", "resource_update", "novo_valor_do_aporte=20000"),
    ("corrige o último aporte da reserva para 150", "resource_update", "novo_valor_do_aporte=15000"),
    ("o aporte da viagem de dia 20 foi no dia 21", "resource_update", "nova_data_do_aporte=2026-09-21"),
    # negativos
    ("adia a fatura do nubank", "resource_roll", None),
    ("liga o rotativo do nubank", "resource_update", "rotativo_auto=true"),
]


def _estado(texto: str, dominios: list[str] | None = None) -> dict:
    return {"text": texto, "timezone": TZ, "user_id": "u", "workspace_id": "w",
            "source_message_id": "probe", "domains": dominios or []}


async def main() -> int:
    # `probe_tudo_se_edita.py aporte mercado` roda só os casos com esses trechos (iterar sem gastar)
    filtro = sys.argv[1:]
    if filtro:
        global ROTEADOR, FINANCAS, CADASTROS
        so = lambda casos: [c for c in casos if any(f in c[0] for f in filtro)]  # noqa: E731
        ROTEADOR, FINANCAS, CADASTROS = so(ROTEADOR), so(FINANCAS), so(CADASTROS)
    total = len(ROTEADOR) + len(FINANCAS) + len(CADASTROS)
    print(f"{total} chamadas ao Flash-Lite (roteador + parse), uma a cada 4,5 s.\n", flush=True)

    async def sem_banco(ctx, acao):  # o `prepare` fala com o banco: aqui só a extração importa
        return {}
    resources.prepare = sem_banco

    # o roteador confere `financial_entity` no banco: sem banco aqui, nada casa
    async def vazio(*a, **k):
        return []

    async def nenhum(*a, **k):
        return None
    db.fetch, db.fetch_one = vazio, nenhum

    falhas = 0
    print("roteador")
    for texto, dominio in ROTEADOR:
        await asyncio.sleep(4.5)  # a cota grátis do Lite é 15 por minuto
        r = await nodes.route(_estado(texto))
        ok = dominio in (r.get("domains") or [])
        falhas += 0 if ok else 1
        print(f"  {'ok  ' if ok else 'FALHOU'} {texto!r:62} -> {r.get('domains')}")

    print("\nfinanças")
    for texto, tipo, confere in FINANCAS:
        await asyncio.sleep(4.5)  # a cota grátis do Lite é 15 por minuto
        r = await nodes.finance_node(_estado(texto, ["financas"]))
        acoes = [FinanceAction.model_validate(a) for a in (r.get("finance_actions") or [])]
        a = acoes[0] if acoes else None
        ok = bool(a and a.type.value == tipo and confere(a))
        falhas += 0 if ok else 1
        resumo = (a.model_dump(exclude_none=True, mode="json") if a else "(vazio)")
        print(f"  {'ok  ' if ok else 'FALHOU'} {texto!r:62} -> {resumo}")

    print("\ncadastros")
    for texto, tipo, campo in CADASTROS:
        await asyncio.sleep(4.5)  # a cota grátis do Lite é 15 por minuto
        r = await nodes.resource_node(_estado(texto, ["cadastros"]))
        acoes = [ResourceAction.model_validate(a) for a in (r.get("resource_actions") or [])]
        a = acoes[0] if acoes else None
        campos = {f.name: (f.value or "").lower() for f in (a.fields if a else [])}
        recurso = "goals" if "aporte" in texto else "cards"
        ok = bool(a and a.type.value == tipo and a.resource == recurso and (
            campo is None or campos.get(campo.split("=")[0]) == campo.split("=")[1]))
        falhas += 0 if ok else 1
        resumo = (f"{a.type.value} {a.resource} name={a.name} month={a.target_month} {campos}"
                  if a else "(vazio)")
        print(f"  {'ok  ' if ok else 'FALHOU'} {texto!r:62} -> {resumo}")

    print(f"\n{total - falhas}/{total}")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
