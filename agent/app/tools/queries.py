"""Consultas. Só leem — nunca pedem confirmação, nunca gravam idempotência.

Toda agregação sai de RPC (padrão interna `_nome(uid, ...)` chamada com o
service_role). Somar transação no cliente é como o número da tela deixa de bater
com o número do WhatsApp.

A formatação da resposta é template Python puro: NUNCA uma segunda chamada de
LLM para escrever texto sobre números que já temos. Um modelo escrevendo
"você gastou aproximadamente" em cima de um valor exato é alucinação com etapa
extra de custo.
"""

from __future__ import annotations

from app import db
from app.domain import matching
from app.domain.dates import format_date_br, local_iso_date
from app.domain.money import cents_to_brl
from app.graph.schemas import FinanceQuery
from app.tools.base import ExecContext, ToolResult

KIND_EMOJI = {"expense": "💸", "income": "💰"}


async def query_balance(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    rows = await db.fetch("select * from public._account_balances(%s)", ctx.user_id)
    if not rows:
        return ToolResult("💼 Você ainda não tem contas nem lançamentos.", read_only=True)
    total = sum(int(r["balance_cents"]) for r in rows)
    linhas = [f"  • {r['name']}: {cents_to_brl(r['balance_cents'])}" for r in rows]
    return ToolResult(
        f"💼 Saldo total: *{cents_to_brl(total)}*\n" + "\n".join(linhas), read_only=True
    )


async def query_transactions(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    ate = action.query_to or local_iso_date(ctx.timezone)
    de = action.query_from or f"{ate[:7]}-01"

    rows = await db.fetch(
        "select * from public._tx_summary(%s, %s, %s)", ctx.user_id, de, ate
    )
    if action.category:
        alvo = action.category.lower()
        rows = [r for r in rows if (r["category"] or "").lower() == alvo]
    if not rows:
        return ToolResult(
            f"📊 Nada registrado entre {format_date_br(de)} e {format_date_br(ate)}.",
            read_only=True,
        )

    gasto = sum(int(r["total_cents"]) for r in rows if r["kind"] == "expense")
    recebido = sum(int(r["total_cents"]) for r in rows if r["kind"] == "income")
    cabecalho = " | ".join(
        p
        for p in (
            f"Gastos: *{cents_to_brl(gasto)}*" if gasto else None,
            f"Receitas: *{cents_to_brl(recebido)}*" if recebido else None,
        )
        if p
    )
    linhas = [
        f"  • {KIND_EMOJI.get(r['kind'], '•')} {r['category']}: "
        f"{cents_to_brl(r['total_cents'])} ({r['tx_count']}x)"
        for r in rows[:8]
    ]
    return ToolResult(
        f"📊 {format_date_br(de)} a {format_date_br(ate)} — {cabecalho}\n" + "\n".join(linhas),
        read_only=True,
    )


async def query_budgets(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    rows = await db.fetch(
        "select * from public._budgets_status(%s, %s)",
        ctx.user_id,
        local_iso_date(ctx.timezone),
    )
    if not rows:
        return ToolResult(
            "📉 Você ainda não definiu orçamentos. Cria na aba Financeiro do app!", read_only=True
        )
    linhas = []
    for r in rows:
        limite = int(r["limit_cents"]) or 1
        pct = round(int(r["spent_cents"]) / limite * 100)
        flag = "🔴" if pct >= 100 else "🟡" if pct >= 80 else "🟢"
        linhas.append(
            f"  {flag} {r['category']}: {cents_to_brl(r['spent_cents'])} "
            f"de {cents_to_brl(r['limit_cents'])} ({pct}%)"
        )
    return ToolResult("📉 Orçamentos do mês:\n" + "\n".join(linhas), read_only=True)


async def query_goals(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    rows = await db.fetch(
        """
        select name, target_cents, saved_cents, deadline
        from public.goals
        where workspace_id = %s and archived = false
        order by created_at
        """,
        ctx.workspace_id,
    )
    if not rows:
        return ToolResult(
            "🎯 Você ainda não tem metas. Tenta \"quero juntar 3000 pra viagem até dezembro\"!",
            read_only=True,
        )
    linhas = []
    for g in rows:
        alvo = int(g["target_cents"]) or 1
        pct = min(100, round(int(g["saved_cents"]) / alvo * 100))
        prazo = f" — até {format_date_br(g['deadline'])}" if g["deadline"] else ""
        linhas.append(
            f"  • {g['name']}: {cents_to_brl(g['saved_cents'])} "
            f"de {cents_to_brl(g['target_cents'])} ({pct}%){prazo}"
        )
    return ToolResult("🎯 Suas metas:\n" + "\n".join(linhas), read_only=True)


async def query_invoice(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    rows = await db.fetch("select * from public._card_summary(%s)", ctx.user_id)
    if action.account:
        # mesmo casamento da execução e da validação do rascunho: "itau" tem que
        # achar "Itaú" aqui também, senão a consulta de fatura responde "não
        # achei esse cartão" para um cartão que existe
        rows = matching.match_accounts(action.account, rows) or []
    if not rows:
        return ToolResult("💳 Não achei esse cartão. Cadastra ele no app!", read_only=True)

    linhas = []
    for c in rows:
        venc = format_date_br(c["due_date"]) if c.get("due_date") else "—"
        limite = (
            f" • limite livre {cents_to_brl(c['available_limit_cents'])}"
            if c.get("available_limit_cents") is not None
            else ""
        )
        linhas.append(
            f"  💳 {c['name']}: fatura {cents_to_brl(c.get('invoice_total_cents') or 0)} "
            f"(vence {venc}){limite}"
        )
    return ToolResult("💳 Cartões:\n" + "\n".join(linhas), read_only=True)


async def query_forecast(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    dias = 30
    if action.query_to:
        from datetime import date

        try:
            # hoje do USUÁRIO: date.today() é o dia em UTC, e depois das 21h em
            # GMT-3 isso já é amanhã — a armadilha que este projeto testa contra
            hoje = date.fromisoformat(local_iso_date(ctx.timezone))
            dias = max(1, (date.fromisoformat(action.query_to) - hoje).days)
        except ValueError:
            dias = 30

    rows = await db.fetch(
        "select * from public._cash_flow_forecast(%s, %s)", ctx.user_id, dias
    )
    if not rows:
        return ToolResult("🔮 Ainda não tenho dados suficientes para projetar.", read_only=True)

    fim = rows[-1]
    pior = min(rows, key=lambda r: int(r["balance_cents"]))
    aviso = (
        f"\n⚠️ O ponto mais apertado é {format_date_br(pior['day'])}: "
        f"{cents_to_brl(pior['balance_cents'])}."
        if int(pior["balance_cents"]) < 0
        else ""
    )
    return ToolResult(
        f"🔮 Em {dias} dias você deve ficar com *{cents_to_brl(fim['balance_cents'])}*.{aviso}",
        read_only=True,
    )


async def query_net_worth(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    row = await db.fetch_one(
        """
        select cash_cents, investments_cents, other_assets_cents, liabilities_cents, net_cents
        from public.net_worth_snapshots
        where workspace_id = %s
        order by as_of desc limit 1
        """,
        ctx.workspace_id,
    )
    if not row:
        return ToolResult(
            "🏦 Ainda não tenho a foto do seu patrimônio (ela é tirada uma vez por dia). "
            "Cadastra seus bens no app que amanhã já aparece aqui!",
            read_only=True,
        )
    return ToolResult(
        f"🏦 Patrimônio líquido: *{cents_to_brl(row['net_cents'])}*\n"
        f"  💵 em conta: {cents_to_brl(row['cash_cents'])}\n"
        f"  📈 investido: {cents_to_brl(row['investments_cents'])}\n"
        f"  🏠 outros bens: {cents_to_brl(row['other_assets_cents'])}\n"
        f"  🧾 dívidas e faturas: -{cents_to_brl(row['liabilities_cents'])}",
        read_only=True,
    )


async def simulate_purchase(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    """Simulação NÃO registra nada — é a pergunta "posso comprar isso?"."""
    from app.tools.guards import require_amount

    valor = require_amount(action.amount_cents, o_que="o valor da compra")
    parcelas = action.installments or 1

    row = await db.fetch_one(
        "select * from public._affordability(%s, %s, %s)", ctx.user_id, valor, parcelas
    )
    if not row:
        return ToolResult("🤔 Não consegui simular agora. Tenta de novo?", read_only=True)

    veredito = "✅ Cabe" if row.get("can_afford") else "⚠️ Aperta"
    parcela = (
        f" ({parcelas}x de {cents_to_brl(row.get('installment_cents') or 0)})"
        if parcelas > 1
        else ""
    )
    pior = (
        f"\n  Pior dia: {format_date_br(row['worst_day'])} com "
        f"{cents_to_brl(row.get('worst_balance_cents') or 0)}"
        if row.get("worst_day")
        else ""
    )
    return ToolResult(
        f"{veredito}: {cents_to_brl(valor)}{parcela}.{pior}", read_only=True
    )
