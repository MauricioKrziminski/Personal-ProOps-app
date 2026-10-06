"""Cada ação do `registry`, rodada duas vezes (como `postgres` e sob RLS), e o resultado comparado.

    cd agent && PYTHONPATH=. .venv/bin/python scripts/verificar_rls_das_tools.py [--sem-migration] [-v]

Só STAGING, e NADA fica gravado: uma única conexão `autocommit=False` (sem `with`, que commitaria
na saída limpa), cada caso dentro de um savepoint que sempre volta, e `rollback()` + `close()` no
`finally`. O pool nunca abre: o que escapar da conexão cai em `RuntimeError("pool não aberto")`
em vez de gravar.

## Por que rodar DUAS vezes

RLS falha em silêncio: SELECT/UPDATE/DELETE bloqueado devolve zero linhas, a tool diz "não achei"
(`read_only`) e nada estoura. Só o INSERT `with check` levanta `42501`. Então "sem erro" não prova
nada: o caso passa quando o resultado sob RLS é o mesmo da base (`read_only`, `result_id` presente),
e o erro, se houver, é o mesmo.

## O negativo

(a) `ctx.workspace_id` de OUTRO workspace com o `user_id` do dono — o "bug futuro de Python" que a
RLS existe para conter: nada pode ser lido nem escrito. (b) id de linha alheia como alvo. O estado
da linha alheia é conferido depois, como `postgres`.

Ordem real da produção, preservada: reserva de `executed_actions` (postgres) → tool (authenticated)
→ carimbo (postgres) — o próprio `registry._escrever`.
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import subprocess
import sys
import uuid
from uuid import UUID

os.environ.setdefault("GEMINI_API_KEY", "fake")  # nenhuma chamada ao Gemini é feita

import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

AGENT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AGENT))

from app import db  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.graph.schemas import (  # noqa: E402
    FinanceAction, FinanceQuery, NotesAction, ResourceAction, READ_ONLY,
)
from app.tools import registry, resolve  # noqa: E402
from app.tools.base import ExecContext  # noqa: E402
from app.services import embeddings  # noqa: E402

import logging  # noqa: E402
logging.disable(logging.CRITICAL)  # ruído de falha esperada; o relatório é a saída


async def _sem_gemini(*_a, **_k):
    return None  # busca semântica cai no texto: nenhuma chamada de rede

embeddings.embed_consulta = _sem_gemini

STAGING_REF = "utkqoiigimqzeenxkxdl"
DEV_EMAIL = "dev@proops.local"
OUTRO_WS: UUID | None = None  # o workspace ALHEIO com mais lançamentos (descoberto em main)


def _url() -> str:
    comum = subprocess.run(
        ["git", "rev-parse", "--git-common-dir"], cwd=AGENT, capture_output=True, text=True, check=True
    ).stdout.strip()
    candidatos = [AGENT / ".env", (AGENT / comum).resolve().parent / "agent/.env"]
    for arq in candidatos:
        if arq.exists():
            for linha in arq.read_text().splitlines():
                if linha.startswith("DATABASE_URL="):
                    v = linha.split("=", 1)[1].strip().strip('"')
                    if STAGING_REF not in v:
                        raise SystemExit(f"recusado: {arq} não aponta para o staging ({STAGING_REF})")
                    return v
    raise SystemExit("sem agent/.env com DATABASE_URL do staging")


class _Volta(Exception):
    """Desfaz o savepoint do caso e carrega o que ele devolveu."""


async def isolado(fn):
    """Roda `fn` num savepoint que SEMPRE volta. Devolve ('ok', valor) ou ('erro', exceção)."""
    try:
        async with db.unidade_de_trabalho():
            try:
                valor = await fn()
            except Exception as err:  # noqa: BLE001
                raise _Volta(("erro", err)) from None
            raise _Volta(("ok", valor))
    except _Volta as v:
        return v.args[0]


def ctx_de(user, ws, texto="verif rls", target=None) -> ExecContext:
    return ExecContext(
        user_id=user, workspace_id=ws, phone=None, timezone="America/Sao_Paulo", texto=texto,
        source_message_id=f"rls-verif:{uuid.uuid4()}", action_index=0, target=target,
    )


async def despacha(ctx: ExecContext, action):
    """Mesmo caminho do `registry.execute`, SEM engolir exceção (queremos o SQLSTATE)."""
    tool = registry._tool(action)
    if action.type in READ_ONLY:
        return await registry._ler(ctx, action, tool)
    try:
        return await registry._escrever(ctx, action, tool)
    except registry._SemEscrita as sem:
        return sem.resultado


def _resumo(estado, valor):
    if estado == "erro":
        sq = getattr(valor, "sqlstate", None)
        return {"erro": f"{type(valor).__name__}{'/' + sq if sq else ''}: {str(valor)[:110]}"}
    return {"ro": valor.read_only, "id": valor.result_id is not None, "msg": valor.message}


def _mesmo(a, b) -> bool:
    if "erro" in a or "erro" in b:
        return a.get("erro", "")[:30] == b.get("erro", "")[:30] and ("erro" in a) == ("erro" in b)
    if a["ro"] and "uuid" not in a["msg"]:
        # consulta: o TEXTO tem que ser igual (a ordem de linhas empatadas não é garantida pelo wrapper)
        return a["ro"] == b["ro"] and sorted(a["msg"].splitlines()) == sorted(b["msg"].splitlines())
    return a["ro"] == b["ro"] and a["id"] == b["id"]


async def alvo_de(ws, user, acao, texto, antecedente=None):
    alvos = await resolve.for_actions(ws, [acao], texto, antecedente=antecedente)
    return alvos[0]


RELATORIO: list[tuple[str, str, str]] = []


async def caso(nome, user, ws, montar, *, esperado_vazio=False):
    """`montar(ctx_base)` -> corpo async que devolve ToolResult. Roda como postgres e sob RLS."""
    saida = {}
    for modo, flag in (("postgres", False), ("rls", True)):
        get_settings().agente_rls = flag

        async def corpo():
            return await montar(user, ws)

        saida[modo] = _resumo(*await isolado(corpo))
    get_settings().agente_rls = False
    base, rls = saida["postgres"], saida["rls"]
    base_ruim = "erro" in base or (base["ro"] and not esperado_vazio)
    if base_ruim:
        RELATORIO.append((nome, "CASO RUIM", f"base: {base}"))
    elif _mesmo(base, rls):
        RELATORIO.append((nome, "passa", base.get("msg", "")[:60].replace("\n", " ")))
    else:
        RELATORIO.append((nome, "FALHA", f"base={str(base)[:150]} | rls={str(rls)[:150]}"))


# ---------------------------------------------------------------------------
# casos
# ---------------------------------------------------------------------------
def fin(**k):
    return FinanceAction(**k)


def qry(**k):
    return FinanceQuery(**k)


def nota(**k):
    return NotesAction(**k)


async def escolhe_tx_simples(ws):
    r = await db.fetch_one(
        "select id, description from public.transactions where workspace_id=%s and kind='expense' "
        "and installment_plan_id is null and invoice_id is null and description is not null "
        "order by occurred_at desc limit 1", ws)
    return r


ALVO = "verif alvo"


async def semear_alvo(user, ws, status="pending"):
    """Lançamento avulso e pendente, criado COMO postgres antes do caso (a transação volta)."""
    await db.execute(
        "insert into public.transactions (workspace_id, user_id, kind, amount_cents, category, description, "
        "occurred_at, status, source) values (%s, %s, 'expense', 7777, 'mercado', %s, current_date, %s, 'app')",
        ws, user, ALVO, status)


def com_alvo(acao_fn, texto, antecedente_fn=None, semear=False):
    async def montar(user, ws):
        if semear:
            await semear_alvo(user, ws)
        acao = acao_fn()
        ante = await antecedente_fn(ws) if antecedente_fn else None
        alvo = await alvo_de(ws, user, acao, texto, ante)
        return await despacha(ctx_de(user, ws, texto, alvo), acao)
    return montar


def sem_alvo(acao_fn, texto="verif rls"):
    async def montar(user, ws):
        return await despacha(ctx_de(user, ws, texto), acao_fn())
    return montar


async def _ante_tx(ws):
    r = await escolhe_tx_simples(ws)
    return str(r["id"])


async def casos_financeiros(user, ws):
    await caso("create_expense", user, ws, sem_alvo(lambda: fin(
        type="create_expense", amount_cents=4500, category="mercado", description="verif rls", account="Nubank")))
    await caso("create_income", user, ws, sem_alvo(lambda: fin(
        type="create_income", amount_cents=50000, category="freela", description="verif rls", account="Nubank")))
    await caso("create_transfer", user, ws, sem_alvo(lambda: fin(
        type="create_transfer", amount_cents=10000, account="Nubank", counterparty_account="Poupança")))
    await caso("create_installment_purchase", user, ws, sem_alvo(lambda: fin(
        type="create_installment_purchase", amount_cents=90000, installments=3, description="verif rls",
        category="eletronicos", account="Nubank Cartão")))
    await caso("pay_invoice", user, ws, com_alvo(lambda: fin(
        type="pay_invoice", amount_cents=1000, account="Nubank Cartão", counterparty_account="Nubank"),
        "paguei 10 da fatura do nubank cartão"))
    await caso("mark_paid", user, ws, com_alvo(lambda: fin(
        type="mark_paid", description=ALVO), "paguei o verif alvo", semear=True))
    await caso("set_rule", user, ws, sem_alvo(lambda: fin(
        type="set_rule", target_ref="padaria", category="alimentacao")))
    await caso("update_transaction", user, ws, com_alvo(
        lambda: fin(type="update_transaction", description=ALVO, new_amount_cents=1234),
        ALVO, semear=True))
    await caso("delete_transaction", user, ws, com_alvo(
        lambda: fin(type="delete_transaction", description=ALVO), ALVO, semear=True))
    await caso("undo_last", user, ws, com_alvo(
        lambda: fin(type="undo_last"), "desfaz", antecedente_fn=_ante_tx))
    await caso("create_goal", user, ws, sem_alvo(lambda: fin(
        type="create_goal", target_ref="Meta verif rls", amount_cents=100000)))
    await caso("goal_deposit", user, ws, com_alvo(lambda: fin(
        type="goal_deposit", target_ref="notebook", amount_cents=5000), "guardei 50 no notebook"))
    await caso("update_asset_value", user, ws, com_alvo(lambda: fin(
        type="update_asset_value", target_ref="Carro", amount_cents=5000000), "o carro vale 50 mil"))


async def semear_detalhe(user, ws):
    """Detalhe (subcategoria) + regra do usuário que o aponta, como postgres (a transação volta)."""
    sub = (await db.fetch_one(
        "insert into public.subcategories (workspace_id, user_id, parent_category, parent_key, name, name_key) "
        "values (%s, %s, 'eletronicos', private.fold('eletronicos'), 'verif sub', private.fold('verif sub')) "
        "returning id", ws, user))["id"]
    await db.execute(
        "insert into public.categorization_rules (workspace_id, user_id, pattern, match_type, category, "
        "subcategory_id, priority) values (%s, %s, 'verifdet', 'contains', 'eletronicos', %s, 10)", ws, user, sub)
    return sub


def com_detalhe(acao_fn, atributos=False):
    async def montar(user, ws):
        sub = await semear_detalhe(user, ws)
        alvo = {"atributos": {"subcategory_id": str(sub), "subcategory_parent": "eletronicos",
                              "payment_method": "credit"}} if atributos else None
        return await despacha(ctx_de(user, ws, target=alvo), acao_fn())
    return montar


async def casos_detalhe(user, ws):
    await caso("create_expense (detalhe pela regra: match_rule_subcategory_do_membro)", user, ws, com_detalhe(
        lambda: fin(type="create_expense", amount_cents=3000, category="eletronicos", description="verifdet fone")))
    await caso("create_installment_purchase (detalhe pela regra: attach_import_rule_purchase)", user, ws, com_detalhe(
        lambda: fin(type="create_installment_purchase", amount_cents=90000, installments=3, category="eletronicos",
                    description="verifdet tv", account="Nubank Cartão")))
    await caso("create_installment_purchase (atributos: create_purchase via como_usuario)", user, ws, com_detalhe(
        lambda: fin(type="create_installment_purchase", amount_cents=90000, installments=3, category="eletronicos",
                    description="verif sem regra", account="Nubank Cartão"), atributos=True))
    await caso("resource_pay (debts)", user, ws,
               lambda u, w: _passo_recurso(u, w, "pay", "debts", "Carro", {"amount_cents": "148500", "account_id": "Nubank"}))
    await caso("resource_roll (cards)", user, ws,
               lambda u, w: _passo_recurso(u, w, "roll", "cards", "Nubank Cartão", {}))


async def casos_consulta(user, ws):
    s = sem_alvo
    await caso("query_balance", user, ws, s(lambda: qry(type="query_balance")), esperado_vazio=True)
    await caso("query_transactions", user, ws, s(lambda: qry(type="query_transactions", search_term="macbook")), esperado_vazio=True)
    await caso("query_budgets", user, ws, s(lambda: qry(type="query_budgets")), esperado_vazio=True)
    await caso("query_goals", user, ws, s(lambda: qry(type="query_goals")), esperado_vazio=True)
    await caso("query_invoice", user, ws, s(lambda: qry(type="query_invoice", account="Nubank Cartão")), esperado_vazio=True)
    await caso("query_forecast", user, ws, s(lambda: qry(type="query_forecast", query_to="2027-03-01")), esperado_vazio=True)
    await caso("query_net_worth", user, ws, s(lambda: qry(type="query_net_worth")), esperado_vazio=True)
    await caso("query_recurring", user, ws, s(lambda: qry(type="query_recurring")), esperado_vazio=True)
    await caso("query_debts", user, ws, s(lambda: qry(type="query_debts")), esperado_vazio=True)
    await caso("simulate_scenario", user, ws, s(lambda: qry(
        type="simulate_scenario", amount_cents=50000, kind="expense", mode="total", installments=3)), esperado_vazio=True)
    await caso("query_cycle", user, ws, s(lambda: qry(type="query_cycle")), esperado_vazio=True)
    await caso("query_spending_change", user, ws, s(lambda: qry(type="query_spending_change")), esperado_vazio=True)


async def casos_notas(user, ws):
    await caso("create_note", user, ws, sem_alvo(lambda: nota(type="create_note", content="verif rls nota")))
    await caso("append_note", user, ws, com_alvo(
        lambda: nota(type="append_note", append_text="mais uma linha", search_term="contador"), "contador"))
    await caso("query_notes", user, ws, sem_alvo(lambda: nota(type="query_notes", search_term="contador")), esperado_vazio=True)
    await caso("delete_note", user, ws, com_alvo(
        lambda: nota(type="delete_note", search_term="contador"), "contador"))
    await caso("create_reminder", user, ws, sem_alvo(lambda: nota(
        type="create_reminder", content="verif rls lembrete", remind_at="2030-01-01T09:00:00")))
    await caso("delete_reminder", user, ws, com_alvo(
        lambda: nota(type="delete_reminder", search_term="filtro de água"), "filtro de água"))
    await caso("query_reminders", user, ws, sem_alvo(lambda: nota(type="query_reminders")), esperado_vazio=True)


RECURSOS = {
    "accounts": {"name": "Conta verif", "type": "checking", "initial_balance_cents": "-100", "archived": "false"},
    "cards": {"name": "Cartao verif", "closing_day": "10", "due_day": "20", "credit_limit_cents": "100000",
              "payment_account_id": "Nubank", "archived": "false"},
    "folders": {"name": "Pasta verif"},
    "goals": {"name": "Meta verif", "target_cents": "10000", "deadline": "2027-10-01", "archived": "false"},
    "reminders": {"title": "Lembrete verif", "next_run_at": "2027-10-01T12:00:00-03:00",
                  "recurrence": "FREQ=MONTHLY", "channel": "both", "active": "true"},
    "recurring": {"description": "Serie verif", "kind": "expense", "amount_cents": "1000", "category": "mercado",
                  "account_id": "Nubank", "rrule": "FREQ=MONTHLY;BYMONTHDAY=5", "dtstart": "2027-10-01T12:00:00-03:00",
                  "auto_confirm": "false", "active": "true"},
    "debts": {"name": "Divida verif", "kind": "financing", "principal_cents": "100000", "remaining_cents": "80000",
              "interest_rate_monthly": "0.01", "installments": "12", "installments_paid": "2",
              "installment_cents": "8000", "due_day": "10", "account_id": "Nubank", "started_at": "2026-08-01",
              "archived": "false"},
    "budgets": {"category": "verif", "limit_cents": "10000", "month": "2027-10-01", "rollover": "true"},
    "assets": {"name": "Bem verif", "class": "vehicle", "current_value_cents": "100000", "is_liability": "false",
               "acquired_at": "2026-01-01", "archived": "false"},
    "rules": {"pattern": "padaria verif", "match_type": "contains", "category": "alimentacao",
              "account_id": "Nubank", "priority": "10"},
    "notes": {"content": "Nota verif", "pinned": "true"},
}
IDENT = {"recurring": "description", "budgets": "category", "rules": "pattern", "notes": "content", "reminders": "title"}


def _ra(op, recurso, nome, campos, mes=None):
    return ResourceAction(type="resource_" + op, resource=recurso, name=nome, target_month=mes,
                          fields=[{"name": k, "value": v} for k, v in campos.items()])


async def _passo_recurso(user, ws, op, recurso, nome, campos, mes=None):
    from app.tools import resources
    acao = _ra(op, recurso, nome, campos, mes)
    ctx = ctx_de(user, ws)
    ctx.target = {"prepared": await resources.prepare(ctx, acao)}
    return await despacha(ctx, acao)


async def duplicar(user, ws):
    await semear_alvo(user, ws, "cleared")
    return await _passo_recurso(user, ws, "create", "duplicar", ALVO, {})


async def casos_recursos(user, ws):
    for recurso, campos in RECURSOS.items():
        ident = IDENT.get(recurso, "name")
        nome = campos[ident]
        mes = "2027-10-01" if recurso == "budgets" else None

        async def ciclo(user, ws, recurso=recurso, campos=campos, ident=ident, nome=nome, mes=mes):
            r = None
            for op in ("create", "update", "list", "delete"):
                valores = dict(campos) if op in ("create", "update") else {}
                nome_op = nome
                if op == "update":
                    valores[ident] = nome + " alterado"
                    valores.pop("current_value_cents", None)
                if op in ("list", "delete") :
                    nome_op = nome + " alterado"
                r = await _passo_recurso(user, ws, op, recurso, nome_op if op != "create" else nome, valores,
                                         mes if op != "create" else None)
                if op != "list" and r.read_only:
                    return r  # trava o encadeamento: o resultado diz qual passo falhou
            return r
        await caso(f"resource/{recurso} (create>update>list>delete)", user, ws, ciclo)
    await caso("resource_create/duplicar", user, ws, duplicar)
    for rec in ("mes", "reserva", "plano_metas", "plano", "favoritos"):
        await caso(f"resource_list/{rec}", user, ws,
                   lambda u, w, rec=rec: _passo_recurso(u, w, "list", rec, None, {}), esperado_vazio=True)


# ---------------------------------------------------------------------------
# negativo
# ---------------------------------------------------------------------------
async def negativo(user, ws_dono):
    """Sob RLS, apontar a tool para o workspace ALHEIO não lê nem escreve nada."""
    falhas = []
    get_settings().agente_rls = True
    linha_alheia = await db.fetch_one(
        "select id, amount_cents, description from public.transactions where workspace_id=%s "
        "and kind='expense' and installment_plan_id is null and invoice_id is null and debt_id is null "
        "and pays_invoice_id is null limit 1", OUTRO_WS)
    antes = await db.fetch_one("select count(*) n, coalesce(sum(amount_cents),0) s from public.transactions where workspace_id=%s", OUTRO_WS)

    async def tenta(nome, montar, ok):
        # a mesma chamada como postgres tem que ESCREVER: sem isso o bloqueio poderia ser do teste
        get_settings().agente_rls = False
        e0, v0 = await isolado(montar)
        escreveria = e0 == "ok" and not v0.read_only
        get_settings().agente_rls = True
        estado, v = await isolado(montar)
        passou = escreveria and ok(estado, v)
        if not passou:
            falhas.append(f"{nome}: {_resumo(estado, v)}")
        RELATORIO.append((f"NEGATIVO {nome}", "bloqueado" if passou else "VAZOU",
                          f"postgres escreveria: {escreveria} | rls: {str(_resumo(estado, v))[:90]}"))

    # (a) leitura com o workspace alheio: como postgres a tool ENXERGA o dado (prova de que o teste
    # é válido); sob RLS não pode enxergar nada
    async def le():
        return await despacha(ctx_de(user, OUTRO_WS), qry(
            type="query_transactions", query_from="2000-01-01", query_to="2099-12-31"))
    get_settings().agente_rls = False
    estado, base = await isolado(le)
    com_dado = estado == "ok" and "Nenhum" not in base.message
    get_settings().agente_rls = True
    estado, v = await isolado(le)
    ok = com_dado and estado == "ok" and "Nenhum" in v.message
    RELATORIO.append(("NEGATIVO leitura (query_transactions no ws alheio)",
                      "bloqueado" if ok else "VAZOU",
                      f"postgres vê dado: {com_dado} | rls: {(v.message if estado == 'ok' else str(v))[:70]!r}"))
    if not ok:
        falhas.append("leitura")

    # (b) escrita: criar no workspace alheio (with check) e apagar/atualizar linha alheia
    async def cria():
        return await despacha(ctx_de(user, OUTRO_WS), fin(
            type="create_expense", amount_cents=999, category="x", description="invasor"))
    await tenta("escrita (create_expense no ws alheio)", cria,
                lambda e, v: e == "erro" or (e == "ok" and v.read_only))
    alvo = {"status": "found", "table": "transactions",
            "candidates": [{"id": str(linha_alheia["id"]), "label": "alheia", "amount_cents": linha_alheia["amount_cents"]}]}

    async def apaga():
        return await despacha(ctx_de(user, OUTRO_WS, target=alvo), fin(type="delete_transaction", description="alheia"))
    await tenta("escrita (delete_transaction de id alheio, ensure_owned burlado)", apaga,
                lambda e, v: e == "erro" or (e == "ok" and v.read_only))

    async def atualiza():
        return await despacha(ctx_de(user, OUTRO_WS, target=alvo), fin(
            type="update_transaction", description="alheia", new_amount_cents=1))
    await tenta("escrita (update_transaction de id alheio)", atualiza,
                lambda e, v: e == "erro" or (e == "ok" and v.read_only))
    get_settings().agente_rls = False
    depois = await db.fetch_one("select count(*) n, coalesce(sum(amount_cents),0) s from public.transactions where workspace_id=%s", OUTRO_WS)
    if depois != antes:
        falhas.append(f"estado do ws alheio mudou: {antes} -> {depois}")
    RELATORIO.append(("NEGATIVO estado do ws alheio", "intacto" if depois == antes else "ALTERADO", f"{antes} == {depois}"))
    return falhas


# ---------------------------------------------------------------------------
async def main():
    sem_migration = "--sem-migration" in sys.argv
    url = _url()
    assert STAGING_REF in url
    conn = None
    marca = None
    try:
        conn = await psycopg.AsyncConnection.connect(
            url, autocommit=False, row_factory=dict_row, prepare_threshold=None)
        await conn.execute("select 1")  # abre a transação real: tudo daqui é savepoint
        marca = db._uow.set(conn)
        if not sem_migration:
            sql = (AGENT.parent / "supabase/migrations/20261006140000_agente_rls.sql").read_text()
            await conn.execute(sql)
        r = await db.fetch_one("select id from auth.users where email=%s", DEV_EMAIL)
        user = r["id"]
        ws = (await db.fetch_one(
            "select id from public.workspaces where owner_id=%s order by created_at limit 1", user))["id"]
        print(f"usuário {user} workspace {ws} (migration {'não aplicada aqui' if sem_migration else 'aplicada na transação'})")
        await casos_financeiros(user, ws)
        await casos_consulta(user, ws)
        await casos_notas(user, ws)
        await casos_recursos(user, ws)
        await casos_detalhe(user, ws)
        global OUTRO_WS
        OUTRO_WS = (await db.fetch_one(
            "select workspace_id from public.transactions where workspace_id <> %s "
            "group by 1 order by count(*) desc limit 1", ws))["workspace_id"]
        falhas = await negativo(user, ws)
    finally:
        if marca is not None:
            db._uow.reset(marca)
        if conn is not None:
            await conn.rollback()
            await conn.close()
    larg = max(len(n) for n, _, _ in RELATORIO)
    for nome, estado, detalhe in RELATORIO:
        print(f"{nome:<{larg}}  {estado:<10} {detalhe if estado not in ('passa', 'bloqueado', 'intacto') or '-v' in sys.argv else ''}")
    ruins = [x for x in RELATORIO if x[1] in ("FALHA", "CASO RUIM", "VAZOU", "ALTERADO")]
    print(f"\n{len(RELATORIO) - len(ruins)}/{len(RELATORIO)} ok; nada gravado (rollback)")
    sys.exit(1 if ruins or falhas else 0)


if __name__ == "__main__":
    asyncio.run(main())
