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

from uuid import UUID

from app import db
from app.domain import matching
from app.domain.dates import add_months, format_date_br, invoice_cycle_window, local_iso_date
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
    """Consulta lançamentos com blueprint completo, State Cache Locking e Button Sentry."""
    hoje = local_iso_date(ctx.timezone)
    account_id = None
    account_name = None
    account_type = None
    category = action.category
    achados = []

    last_query = ctx.last_query_data or {}
    last_blueprint = last_query.get("blueprint") or {}
    has_last_query = bool(
        last_query
        and (
            last_query.get("account_id")
            or last_blueprint.get("account_id")
            or last_query.get("periodo")
        )
    )
    texto_norm = matching.normalize(ctx.texto)
    clicked_id = getattr(ctx, "clicked_id", None) or ""

    is_qpage = clicked_id.startswith("qpage:")
    is_pagination_text = any(
        t in texto_norm
        for t in [
            "ver mais",
            "mais lancamentos",
            "proxima pagina",
            "proximos",
            "mostrar mais",
            "mais compras",
        ]
    )

    offset = 0
    if is_qpage:
        partes = clicked_id.split(":")
        if len(partes) >= 3 and partes[2].isdigit():
            offset = int(partes[2])
        elif last_blueprint.get("offset"):
            offset = int(last_blueprint["offset"])
    elif is_pagination_text and last_blueprint.get("offset"):
        offset = int(last_blueprint["offset"])

    termos_ano_todo = [
        "ano todo", "do ano", "desde o inicio", "historico completo",
        "de 1 ano", "12 meses", "ano passado", "todo o ano",
    ]
    is_explicit_broad_history = any(t in texto_norm for t in termos_ano_todo)
    is_all_items = any(
        t in texto_norm
        for t in [
            "todos", "todas", "tudo", "resto", "outras", "completa", "completo",
            "todas as compras", "mostrar tudo",
        ]
    )
    is_today_explicit = any(
        t in texto_norm for t in ["hoje", "de hoje", "agora", "neste dia", "nesse dia"]
    )

    # 1. State Cache Locking e Herança de Blueprint
    is_refinement = False
    if is_qpage or is_pagination_text:
        is_refinement = True
    elif has_last_query:
        last_acc_norm = matching.normalize(
            last_blueprint.get("account_name") or last_query.get("account_name") or ""
        )
        termos_continuacao = [
            "todos", "todas", "tudo", "resto", "mais", "parcelas",
            "mes", "meses", "outras", "detalha", "completo", "fatura",
        ]
        if (
            not action.account
            or (action.account and matching.normalize(action.account) in last_acc_norm)
            or any(w in texto_norm for w in termos_continuacao)
        ):
            is_refinement = True

    if is_refinement and (last_blueprint or last_query):
        ref_acc_id = last_blueprint.get("account_id") or last_query.get("account_id")
        account_id = UUID(str(ref_acc_id)) if ref_acc_id else None
        account_name = last_blueprint.get("account_name") or last_query.get("account_name")
        account_type = last_blueprint.get("account_type") or last_query.get("account_type")
        category = last_blueprint.get("category") or action.category

    # 2. Resolução normal de conta se não for refinamento
    if not is_refinement and action.account:
        inferred_type = matching.infer_account_type(f"{ctx.texto} {action.account or ''}")
        linhas = await db.accounts(ctx.workspace_id)
        achados = matching.match_accounts(
            action.account, linhas, account_type=inferred_type
        )
        if achados:
            acc = achados[0]
            account_id = acc["id"]
            account_name = acc["name"]
            account_type = acc.get("type")

    # 3. Resolução da Janela Temporal com Blueprint
    if is_explicit_broad_history:
        de = add_months(hoje, -12)
        ate = hoje
    elif (is_qpage or is_pagination_text) and (last_blueprint or last_query.get("periodo")):
        # Paginando: PRESERVA rigorosamente a janela do blueprint original (incluindo projeção futura)
        de = last_blueprint.get("start_date") or last_query["periodo"]["de"]
        ate = last_blueprint.get("end_date") or last_query["periodo"]["ate"]
    elif is_refinement and is_all_items and (last_blueprint or last_query.get("periodo")):
        # Expansão de itens sobre o MESMO período
        de = last_blueprint.get("start_date") or last_query["periodo"]["de"]
        ate = last_blueprint.get("end_date") or last_query["periodo"]["ate"]
    elif action.query_from and action.query_to:
        de = action.query_from
        ate = action.query_to
    elif action.query_from:
        de = action.query_from
        ate = hoje
    elif action.query_to:
        ate = action.query_to
        de = add_months(ate, -1)
    elif is_today_explicit:
        de = hoje
        ate = hoje
    elif is_all_items and not has_last_query:
        de = add_months(hoje, -12)
        ate = hoje
    else:
        # Sem datas explícitas
        if account_type == "credit_card":
            linhas = await db.accounts(ctx.workspace_id, only_cards=True)
            card_acc = (
                next((a for a in linhas if str(a["id"]) == str(account_id)), None)
                if account_id
                else (achados[0] if achados else None)
            )
            closing = card_acc.get("closing_day") if card_acc else None
            due = card_acc.get("due_day") if card_acc else None
            if closing:
                de, ate = invoice_cycle_window(closing, due, hoje)
            else:
                de = f"{add_months(hoje, -1)[:7]}-25"
                ate = hoje
        else:
            # Geral / Conta corrente: últimos 30 dias por padrão
            de = add_months(hoje, -1)
            ate = hoje

    is_explicit_full_request = (
        is_refinement and is_all_items
    ) or any(
        t in texto_norm
        for t in [
            "quero ver as", "ver todas", "mostra todas", "me mostre todas",
            "me mostre todos", "mostra todos", "mostrar tudo", "mostrar todas",
            "lista completa", "todas as compras", "detalha todas",
        ]
    )

    # 4. Busca registros no banco (com limite de segurança de 100 itens)
    rows = await db.fetch(
        """
        select t.id, t.description, t.amount_cents, t.category as category_name,
               t.kind, t.occurred_at, t.status,
               t.installment_no as current_installment,
               p.installments as total_installments,
               a.name as account_name,
               a.type as account_type
        from public.transactions t
        left join public.accounts a on a.id = t.account_id
        left join public.installment_plans p on p.id = t.installment_plan_id
        where t.workspace_id = %s
          and (%s::uuid is null or t.account_id = %s)
          and (%s::text is null or lower(t.category) = lower(%s))
          and t.occurred_at >= %s and t.occurred_at <= %s
        order by t.occurred_at desc, t.created_at desc
        limit 100
        """,
        ctx.workspace_id,
        account_id,
        account_id,
        category,
        category,
        de,
        ate,
    )

    total_items = len(rows)

    # 5. Fatiamento por Paginação / Expansão
    if is_explicit_full_request:
        mostrados_rows = rows
        total_exibidos = total_items
        ocultos_rows = []
    elif offset > 0:
        page_size = 5
        mostrados_rows = rows[offset : offset + page_size]
        total_exibidos = min(total_items, offset + len(mostrados_rows))
        ocultos_rows = rows[total_exibidos:]
    else:
        limite_display = 5 if total_items <= 5 else 3
        mostrados_rows = rows[:limite_display]
        total_exibidos = len(mostrados_rows)
        ocultos_rows = rows[limite_display:]

    ocultos_restantes = max(0, total_items - total_exibidos)
    ocultos_total_gastos = sum(
        int(r["amount_cents"]) for r in ocultos_rows if r["kind"] == "expense"
    )
    ocultos_total_receitas = sum(
        int(r["amount_cents"]) for r in ocultos_rows if r["kind"] == "income"
    )

    # Agrupamento semântico por mês
    agrupamento_meses: dict[str, dict] = {}
    meses_pt = {
        "01": "Janeiro", "02": "Fevereiro", "03": "Março", "04": "Abril",
        "05": "Maio", "06": "Junho", "07": "Julho", "08": "Agosto",
        "09": "Setembro", "10": "Outubro", "11": "Novembro", "12": "Dezembro",
    }
    for r in rows:
        m_key = str(r["occurred_at"])[:7]  # YYYY-MM
        if m_key not in agrupamento_meses:
            ano, mes = m_key.split("-") if "-" in m_key else (m_key, "")
            mes_label = f"{meses_pt.get(mes, mes)}/{ano}" if mes else m_key
            agrupamento_meses[m_key] = {
                "mes_label": mes_label,
                "total_gastos_centavos": 0,
                "total_receitas_centavos": 0,
                "contagem": 0,
            }
        if r["kind"] == "expense":
            agrupamento_meses[m_key]["total_gastos_centavos"] += int(r["amount_cents"])
        else:
            agrupamento_meses[m_key]["total_receitas_centavos"] += int(r["amount_cents"])
        agrupamento_meses[m_key]["contagem"] += 1

    blueprint = {
        "account_id": str(account_id) if account_id else None,
        "account_name": account_name,
        "account_type": account_type,
        "start_date": de,
        "end_date": ate,
        "category": category,
        "include_projection": ate > hoje if ate else False,
        "limit": 5,
        "offset": total_exibidos,
    }

    data = {
        "blueprint": blueprint,
        "periodo": {
            "de": de,
            "ate": ate,
            "de_br": format_date_br(de),
            "ate_br": format_date_br(ate),
        },
        "account_id": str(account_id) if account_id else None,
        "account_name": account_name,
        "account_type": account_type,
        "filtro_conta": account_name,
        "total_geral_itens": total_items,
        "total_exibidos": total_exibidos,
        "total_gastos_centavos": sum(
            int(r["amount_cents"]) for r in rows if r["kind"] == "expense"
        ),
        "total_receitas_centavos": sum(
            int(r["amount_cents"]) for r in rows if r["kind"] == "income"
        ),
        "resumo_ocultos": {
            "quantidade_oculta": ocultos_restantes,
            "total_gastos_ocultos_centavos": ocultos_total_gastos,
            "total_receitas_ocultas_centavos": ocultos_total_receitas,
        } if ocultos_restantes > 0 else None,
        "agrupamento_meses": list(agrupamento_meses.values()) if len(agrupamento_meses) > 1 else None,
        "lancamentos": [
            {
                "id": str(r["id"]),
                "description": r["description"] or r["category_name"] or "Lançamento",
                "amount_cents": int(r["amount_cents"]),
                "amount_brl": cents_to_brl(r["amount_cents"]),
                "category_name": r["category_name"] or "outros",
                "kind": r["kind"],
                "occurred_at": format_date_br(r["occurred_at"]),
                "account_name": r["account_name"] or "Sem conta",
                "current_installment": r["current_installment"],
                "total_installments": r["total_installments"],
                "installment_label": (
                    f"{r['current_installment']}/{r['total_installments']}"
                    if r["current_installment"] and r["total_installments"]
                    else None
                ),
            }
            for r in mostrados_rows
        ],
    }

    from app.services.gemini import format_query_response

    msg = await format_query_response(
        user_prompt=ctx.texto,
        data=data,
        timezone_name=ctx.timezone,
    )

    # 6. Button Sentry: Condição de Parada Rígida de Botões
    spec = None
    botoes = []
    acc_tag = str(account_id) if account_id else "all"

    # Regra de Ouro: Só gera o botão [Ver mais] se ainda houver itens ocultos no banco
    if total_exibidos < total_items and ocultos_restantes > 0:
        botoes.append((f"qpage:{acc_tag}:{total_exibidos}", "Ver mais"))

    if any(r.get("current_installment") for r in rows):
        botoes.append((f"qfilter:parcelas:{acc_tag}", "Ver Parcelas"))
    if len(agrupamento_meses) > 1:
        botoes.append((f"qfilter:meses:{acc_tag}", "Filtrar por Mês"))

    if botoes:
        spec = {
            "ui": "buttons",
            "body": msg,
            "buttons": botoes[:3],
            "text": f"{msg}\n\nResponda 'ver mais', 'ver parcelas' ou escolha uma opção.",
        }

    return ToolResult(msg, read_only=True, interactive_spec=spec, data=data)


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
