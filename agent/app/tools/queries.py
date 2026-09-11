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

import json
from datetime import date
from uuid import UUID

from app import db
from app.domain import matching
from app.domain.dates import (
    add_months,
    format_date_br,
    invoice_cycle_window,
    local_iso_date,
)
from app.domain.recurrence import descreve_rrule
from app.domain.money import cents_to_brl
from app.graph.schemas import FinanceQuery, FinanceQueryType
from app.jobs.scheduler import HORIZON_DAYS
from app.tools.base import ExecContext, ToolResult

KIND_EMOJI = {"expense": "💸", "income": "💰"}

# As contas que GUARDAM dinheiro. Cópia literal de `GUARDA_DINHEIRO` em
# `src/app/finance/accounts.tsx:63` — o WhatsApp e a tela têm que agrupar igual, senão o
# usuário vê dois "saldos" diferentes e nenhum dos dois ganha confiança.
GUARDA_DINHEIRO = ("checking", "savings", "cash")


async def query_balance(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    """O saldo, com a mesma aritmética da tela Contas.

    Três defeitos foram corrigidos aqui em 09/09/2026, e os três produziam um número que
    parecia certo:

    1. **Somava `balance_cents`**, que inclui `pending` — ou seja, dizia que o dinheiro do Pix
       que o terceiro ainda não mandou já estava na conta. A coluna certa é `cleared_cents`
       (`20260909140000`), a mesma que `private.cash_total` usa.
    2. **Somava o CARTÃO dentro do "saldo total"**, misturando o que a pessoa tem com o que ela
       deve num número só. Um cartão com R$ 21.360 de fatura aberta derrubava o "saldo" para
       perto de zero e a mensagem não dizia por quê.
    3. **Não avisava de nada**: nem do previsto a receber, nem do previsto a pagar.

    Cartão fica FORA do dinheiro e aparece como dívida, exatamente como na tela — e ali o número
    certo é `balance_cents`, porque parcela futura de cartão é dívida já assumida.
    """
    rows = await db.fetch("select * from public._account_balances(%s)", ctx.user_id)
    if not rows:
        return ToolResult("💼 Você ainda não tem contas nem lançamentos.", read_only=True)

    dinheiro = [r for r in rows if r["type"] in GUARDA_DINHEIRO or r["account_id"] is None]
    investimentos = [r for r in rows if r["type"] == "investment"]
    cartoes = [r for r in rows if r["type"] == "credit_card"]

    def col(linha, nome: str) -> int:
        """Coluna da `20260909140000`, com queda para o comportamento antigo.

        O código sobe por deploy e a coluna por migration, e nada garante a ordem. Sem esta
        queda, um deploy que chegasse ANTES da migration levantava `KeyError` — ou seja,
        "Não consegui processar essa mensagem" para qualquer pergunta de saldo, que é o pior
        jeito de descobrir uma ordem errada. `.get` com default mantém a resposta de pé com o
        número antigo (o total), que é o que a versão anterior já respondia.
        """
        valor = linha.get(nome)
        return int(valor) if valor is not None else int(linha["balance_cents"] if nome == "cleared_cents" else 0)

    caixa = sum(col(r, "cleared_cents") for r in dinheiro)
    investido = sum(col(r, "cleared_cents") for r in investimentos)
    # `min(0, ...)` como na tela: cartão com saldo positivo (crédito a favor) não vira "dívida
    # negativa" nem some do total.
    divida = sum(min(0, int(r["balance_cents"])) for r in cartoes)
    a_receber = sum(col(r, "pending_in_cents") for r in dinheiro)
    a_pagar = sum(col(r, "pending_out_cents") for r in dinheiro)
    parcelas_futuras = sum(col(r, "pending_out_cents") for r in cartoes)

    partes = [f"💼 Dinheiro disponível: *{cents_to_brl(caixa)}*"]
    partes += [
        f"  • {r['name']}: {cents_to_brl(col(r, 'cleared_cents'))}"
        for r in dinheiro
        if col(r, "cleared_cents") != 0 or col(r, "pending_in_cents") != 0
    ]

    if investido:
        partes.append(f"\n📈 Investido: {cents_to_brl(investido)}")

    if divida:
        partes.append(f"\n💳 Dívida de cartão: {cents_to_brl(divida)}")
        partes += [
            f"  • {r['name']}: {cents_to_brl(r['balance_cents'])}"
            for r in cartoes
            if int(r["balance_cents"]) < 0
        ]
        if parcelas_futuras:
            partes.append(f"  ({cents_to_brl(parcelas_futuras)} são parcelas de meses à frente)")

    # Os avisos. Ficam DEPOIS e FORA do total de propósito: somá-los seria repetir o defeito que
    # esta função tinha. Cada um diz o que fazer.
    if a_receber:
        partes.append(
            f"\n⏳ A receber: {cents_to_brl(a_receber)} previstos e ainda não confirmados."
            '\n   Conta na projeção, não no saldo. Quando cair, me manda "recebi".'
        )
    if a_pagar:
        partes.append(
            f"\n📅 A pagar: {cents_to_brl(a_pagar)} de contas previstas que ainda não saíram."
        )

    return ToolResult("\n".join(partes), read_only=True)


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
            or last_blueprint.get("start_date")
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
            "pagina seguinte",
            "mostrar mais",
            "mais compras",
            "proximos lancamentos",
            "proximas compras",
            "outras compras",
            "mais gastos",
            "outros gastos",
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
            "expandir", "continua", "continuacao", "anteriores", "proximos",
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

    termos_projecao = [
        "projecao", "proximos", "futuros", "futuras", "proximas faturas",
        "previsao", "proximos 90 dias", "proximos 3 meses", "proximos 60 dias", "proximos 30 dias",
    ]
    is_projection_requested = (
        any(t in texto_norm for t in termos_projecao)
        or bool(last_blueprint.get("include_projection"))
        or (bool(action.query_to) and action.query_to > hoje)
    )

    # 3. Resolução da Janela Temporal com Blueprint
    include_projection = False
    if is_explicit_broad_history:
        de = add_months(hoje, -12)
        ate = hoje
    elif is_projection_requested and not (is_qpage or is_pagination_text or (is_all_items and not any(t in texto_norm for t in termos_projecao))):
        # Pedido de projeção futura explícito (ex: "últimos 60 dias e projeção dos próximos 90 dias", "próximos 90 dias", etc.)
        if action.query_from:
            de = action.query_from
        elif any(t in texto_norm for t in ["ultimos 180 dias", "ultimos 6 meses", "180 dias", "6 meses"]):
            de = add_months(hoje, -6)
        elif any(t in texto_norm for t in ["ultimos 60 dias", "ultimos 2 meses", "60 dias", "2 meses"]):
            de = add_months(hoje, -2)
        elif any(t in texto_norm for t in ["ultimos 30 dias", "ultimos 1 mes", "30 dias", "1 mes", "mes passado"]):
            de = add_months(hoje, -1)
        elif any(t in texto_norm for t in ["ultimos 90 dias", "ultimos 3 meses", "90 dias", "3 meses", "passados", "ultimos"]):
            de = add_months(hoje, -3)
        else:
            de = hoje

        if action.query_to and action.query_to > hoje:
            ate = action.query_to
        elif any(t in texto_norm for t in ["proximos 180 dias", "proximos 6 meses", "180 dias", "6 meses"]):
            ate = add_months(hoje, 6)
        elif any(t in texto_norm for t in ["proximos 60 dias", "proximos 2 meses", "60 dias", "2 meses"]):
            ate = add_months(hoje, 2)
        elif any(t in texto_norm for t in ["proximos 30 dias", "proximos 1 mes", "30 dias", "1 mes", "proximo mes"]):
            ate = add_months(hoje, 1)
        else:
            ate = add_months(hoje, 3)
        include_projection = True
    elif (is_qpage or is_pagination_text) and (last_blueprint or last_query.get("periodo")):
        # Paginando: PRESERVA rigorosamente a janela do blueprint original (incluindo projeção futura)
        de = last_blueprint.get("start_date") or (last_query.get("periodo") or {}).get("de")
        ate = last_blueprint.get("end_date") or (last_query.get("periodo") or {}).get("ate")
        include_projection = bool(last_blueprint.get("include_projection", False)) or (bool(ate) and ate > hoje)
    elif is_refinement and is_all_items and (last_blueprint or last_query.get("periodo")):
        # Expansão de itens sobre o MESMO período
        de = last_blueprint.get("start_date") or (last_query.get("periodo") or {}).get("de")
        ate = last_blueprint.get("end_date") or (last_query.get("periodo") or {}).get("ate")
        include_projection = bool(last_blueprint.get("include_projection", False)) or (bool(ate) and ate > hoje)
    elif action.query_from and action.query_to:
        de = action.query_from
        ate = action.query_to
        include_projection = ate > hoje
    elif action.query_from:
        de = action.query_from
        ate = hoje
    elif action.query_to:
        ate = action.query_to
        de = add_months(ate, -1)
        include_projection = ate > hoje
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
            # Geral / Conta corrente: o MÊS DO USUÁRIO, não 30 dias corridos.
            #
            # A janela de 30 dias não termina em borda nenhuma: com fechamento no
            # dia 10, "quanto gastei esse mês" somava de 11/08 a 10/09 na tela e
            # os últimos 30 dias no WhatsApp, e os dois números discordavam sem
            # erro nenhum. Quem não configurou nada continua vendo do dia 1 até
            # hoje, que é o que o app sempre mostrou.
            #
            # ⚠️ Só o `de` muda. Mexer no `ate` mexeria em `include_projection`
            # logo abaixo, que decide se as ocorrências futuras entram na conta.
            c = await db.cycle(ctx.workspace_id, hoje)
            de = c["ini"].isoformat() if c else add_months(hoje, -1)
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
               a.type as account_type,
               t.installment_plan_id
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

    # 5. Fatiamento por Paginação / Expansão Unificada (Acumulativa)
    if is_explicit_full_request:
        total_exibidos = total_items
        mostrados_rows = rows
        ocultos_rows = []
        is_expanded_view = True
    elif offset > 0:
        page_size = 5
        total_exibidos = min(total_items, offset + page_size)
        # Visualização Unificada: exibe cumulativamente os itens do início até total_exibidos!
        mostrados_rows = rows[:total_exibidos]
        ocultos_rows = rows[total_exibidos:]
        is_expanded_view = True
    else:
        limite_display = 5 if total_items <= 5 else 3
        total_exibidos = min(total_items, limite_display)
        mostrados_rows = rows[:total_exibidos]
        ocultos_rows = rows[total_exibidos:]
        is_expanded_view = False

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
        "include_projection": bool(include_projection) or (bool(ate) and ate > hoje),
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
        "is_expanded_view": is_expanded_view,
        "total_geral_itens": total_items,
        "total_exibidos": total_exibidos,
        "offset": total_exibidos,
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
    # hoje do USUÁRIO: date.today() é o dia em UTC, e depois das 21h em
    # GMT-3 isso já é amanhã — a armadilha que este projeto testa contra
    hoje = date.fromisoformat(local_iso_date(ctx.timezone))
    dias, ate_o_ciclo = 30, None

    if action.query_to:
        try:
            dias = max(1, (date.fromisoformat(action.query_to) - hoje).days)
        except ValueError:
            dias = 30
    else:
        # Sem data pedida, o horizonte é o FIM DO MÊS DO USUÁRIO, não 30 dias
        # corridos. "quanto vai sobrar no fim do mês" com fechamento no dia 10
        # respondia sobre 30 dias a partir de hoje — uma janela que não termina
        # em borda nenhuma e não bate com nada da tela. O painel da Hoje já
        # mostra "Saldo projetado em <fim do ciclo>"; agora os dois concordam.
        c = await db.cycle(ctx.workspace_id, hoje.isoformat())
        if c:
            dias = int(c["dias_ate_o_fim"])
            ate_o_ciclo = c

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
    # Dizer a DATA do fim é mais útil que dizer "em N dias", e é o que a tela
    # escreve. `rows[-1]` é o último dia que a projeção realmente devolveu — ler
    # daí, e não do que foi pedido, é a regra que já existe para o horizonte.
    quando = (
        f"até {format_date_br(fim['day'])}, quando seu mês fecha"
        if ate_o_ciclo
        else f"em {dias} dias"
    )
    return ToolResult(
        f"🔮 {quando.capitalize()} você deve ficar com *{cents_to_brl(fim['balance_cents'])}*.{aviso}",
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


def _rascunho(action: FinanceQuery, hoje: date) -> dict:
    """Uma hipótese no formato que `private.draft_effect` entende.

    Mesmo dicionário que a tela monta em `forecast.tsx` — `kind`, `amount_cents`,
    `installments`, `start`, `mode`. É o contrato do motor, e ele é um só.
    """
    from app.tools.guards import require_amount

    valor = require_amount(action.amount_cents, o_que="o valor a simular")
    # Fora do enum cai no lado conservador: dinheiro que SAI. Supor uma entrada que o usuário
    # não pediu deixaria a projeção otimista, que é o erro caro dos dois.
    kind = "income" if (action.kind or "").strip().lower() == "income" else "expense"
    mode = "monthly" if (action.mode or "").strip().lower() == "monthly" else "total"
    # `monthly` repete o valor CHEIO todo mês: dividir em parcelas ali erraria por um fator de N.
    parcelas = 1 if mode == "monthly" else min(max(action.installments or 1, 1), 72)

    inicio = hoje
    if action.query_from:
        try:
            inicio = max(date.fromisoformat(action.query_from), hoje)
        except ValueError:
            inicio = hoje
    return {
        "kind": kind,
        "amount_cents": valor,
        "installments": parcelas,
        "start": inicio.isoformat(),
        "mode": mode,
    }


def _janela(rascunhos: list[dict], action: FinanceQuery, hoje: date) -> int:
    """Até onde projetar para a hipótese CABER na resposta.

    ⚠️ É o mesmo cuidado do "Somar" da tela: supor num mês além do horizonte aberto e não
    esticar a janela faz a hipótese entrar na conta e NADA mudar no que o usuário lê — ela
    parece ter sido ignorada.
    """
    precisa = 0
    for r in rascunhos:
        inicio = date.fromisoformat(r["start"])
        # `monthly` não termina — mostra um ano dela, que é a pergunta que a pessoa fez
        meses = 12 if r["mode"] == "monthly" else r["installments"] - 1
        precisa = max(precisa, (inicio - hoje).days + meses * 31 + 31)

    pedido = 0
    if action.query_to:
        try:
            pedido = (date.fromisoformat(action.query_to) - hoje).days
        except ValueError:
            pedido = 0
    # ⚠️ `query_to` ESTICA a janela, nunca encolhe abaixo do que a hipótese precisa.
    # "e se eu receber 5.000 em dezembro, como fico até novembro?" fecharia a janela ANTES do
    # início da suposição: ela mexeria no saldo (o delta vale para todo dia >= início) e não
    # teria dia nenhum para aparecer em "entra/sai" — o mesmo sintoma que a `20260910233000`
    # matou pelo outro lado, e igualmente mudo.
    # ⚠️ Sem teto AQUI de propósito. Quem corta é `private.clamp_forecast_days`, e ele existe
    # justamente porque o horizonte já esteve cravado em dois lugares — a tela parava em
    # "6 meses" sem ninguém entender por quê. Pedir demais devolve o máximo; a frase lê a data
    # do ÚLTIMO dia que VOLTOU, então ela nunca promete um horizonte que não existe.
    return max(30, max(pedido, precisa))


def _frase(r: dict) -> str:
    """A hipótese em português, para a resposta repetir o que ENTENDEU."""
    verbo = "receber" if r["kind"] == "income" else "gastar"
    valor = cents_to_brl(r["amount_cents"])
    quando = f" a partir de {format_date_br(r['start'])}"
    if r["mode"] == "monthly":
        return f"{verbo} {valor} por mês{quando}"
    if r["installments"] > 1:
        parcela = cents_to_brl(r["amount_cents"] // r["installments"])
        return f"{verbo} {valor} em {r['installments']}x de {parcela}{quando}"
    return f"{verbo} {valor}{quando}"


async def simulate_scenario(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    """O "E se…?" da tela de Projeção, pelo texto. NÃO registra nada.

    ⚠️ **Mesmo motor e mesmo VEREDITO da tela** (10/09/2026). Antes isto chamava
    `_affordability`, e o número podia discordar do que o app mostrava para a mesma hipótese,
    por três construções diferentes:

    1. **Janela.** `_affordability` filtra `day <= add_months(current_date, parcelas)` — numa
       compra à vista, UM mês. Medido na produção: o pior ponto em 1 mês era −3.547,28 e no
       horizonte da tela, −3.781,13. O agente enxergava R$ 233,85 a menos de buraco, e é esse
       delta que vira "cabe" numa conta que não está negativa.
    2. **Pior ≠ primeiro.** Ele devolve o MÍNIMO da série; a tela avisa no PRIMEIRO dia
       negativo (`serie.find`). Mesma hipótese, datas diferentes — medido: 04/11 contra 10/09.
    3. **Só gasto, só hoje, uma só.** Nem receita, nem hipótese que repete todo mês, nem data
       de início, nem empilhar.

    `_affordability` continua existindo e intacta: APK antigo em campo ainda chama
    `affordability` por RPC, e derrubar isso seria a regressão que este conserto quer evitar.

    ⚠️ A data que a frase MOSTRA é a de hoje no fuso do usuário; o piso que o motor aplica é
    `current_date`, que é UTC. Das 21h à meia-noite de Brasília os dois diferem por um dia e a
    frase pode dizer "a partir de 10/09" para uma hipótese que o banco começou em 11/09. É
    rótulo, não conta — o saldo está certo nos dois casos.

    ⚠️ **As hipóteses do mesmo plano EMPILHAM numa resposta só**, como na tela. Responder duas
    vezes, cada uma ignorando a outra, é o erro que a feature existe para não cometer: quem
    pergunta "e se eu receber 1.500 e gastar 3.000 em 6x?" quer o saldo com AS DUAS.
    """
    hoje = date.fromisoformat(local_iso_date(ctx.timezone))

    # Todas as simulações deste plano, na ordem. Quem responde é a PRIMEIRA; as outras saem
    # caladas (mensagem vazia não entra na resposta).
    irmas = [
        (i, a)
        for i, a in (ctx.siblings or [])
        if isinstance(a, FinanceQuery) and a.type == FinanceQueryType.SIMULATE_SCENARIO
    ]
    if not irmas:
        irmas = [(ctx.action_index, action)]
    if ctx.action_index != irmas[0][0]:
        return ToolResult("", read_only=True)

    rascunhos = [_rascunho(a, hoje) for _, a in irmas]
    dias = _janela(rascunhos, action, hoje)

    rows = await db.fetch(
        "select * from public._forecast_with_drafts(%s, %s, %s::jsonb)",
        ctx.user_id,
        dias,
        json.dumps(rascunhos),
    )
    if not rows:
        return ToolResult("🤔 Não consegui simular agora. Tenta de novo?", read_only=True)

    negativo = next((r for r in rows if int(r["balance_cents"]) < 0), None)
    fim = rows[-1]
    hipoteses = "\n".join(f"  • {_frase(r)}" for r in rascunhos)
    veredito = (
        f"⚠️ Você fica no vermelho em {format_date_br(negativo['day'])} "
        f"({cents_to_brl(negativo['balance_cents'])})."
        if negativo
        else "✅ Você não fica no vermelho nesse período."
    )
    return ToolResult(
        f"🔮 Simulando:\n{hipoteses}\n\n{veredito}\n"
        f"  Saldo em {format_date_br(fim['day'])}: *{cents_to_brl(fim['balance_cents'])}*\n"
        f"  _Nada disso foi salvo._",
        read_only=True,
    )


async def query_recurring(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    """As séries recorrentes, com valor, regra em português e a PRÓXIMA data.

    ⚠️ **Existe porque "não achei" era a resposta errada.** A série vive em
    `recurring_transactions`; os lançamentos dela só existem depois que o
    `finance-scheduler` materializa a janela de um ano. Perguntar "quando cai meu salário?"
    caía em `query_transactions`, que olha `transactions`, não achava a ocorrência e respondia
    que não existia — sobre uma série cadastrada e correta. Foi o caso do dono do produto em
    09/09/2026, com o `finance-scheduler` pausado no Cloud Scheduler.

    ⚠️ **`next_run_at` é `timestamptz` (UTC) e a data do usuário é a do FUSO DELE.** Formatar o
    instante cru mostraria o dia anterior toda vez que a ocorrência cair antes das 03h de
    Brasília — que é justamente a madrugada em que o cron roda. Quem converte é
    `local_iso_date(ctx.timezone, ...)`, com queda para America/Sao_Paulo.

    ⚠️ **Pergunta específica pede resposta específica** (09/09/2026). Sem `search_term` este
    tool devolvia SEMPRE a lista inteira: "quando cai meu salário?" era respondido com as 16
    séries do usuário, quatro delas salário, e ele que achasse. Devolver tudo não é errado
    tecnicamente — é errado como resposta, que é o que o produto entrega. Com o filtro a lista
    vem ordenada pela PRÓXIMA data, então a primeira linha É o "quando".

    Escopo: filtro obrigatório por `workspace_id`, nome de tabela literal, nenhum id vindo do
    modelo. O serviço conecta com papel que IGNORA RLS — aqui a proteção é esta linha. O
    `search_term` entra como parâmetro (`ilike %%s`), nunca concatenado.
    """
    alvo = (action.search_term or "").strip()
    linhas_sql = await db.fetch(
        """
        select kind, amount_cents, description, category, rrule, next_run_at, end_date, active
        from public.recurring_transactions
        where workspace_id = %s
          and (%s = '' or description ilike %s or category ilike %s)
        order by active desc, next_run_at, kind
        limit 20
        """,
        ctx.workspace_id,
        alvo,
        f"%{alvo}%",
        f"%{alvo}%",
    )
    # Filtro que não acha nada cai na lista inteira, com o aviso. "Não achei" sobre uma série
    # que existe foi o defeito que criou este tool; repetir isso por causa de uma palavra
    # diferente seria o mesmo erro com outra roupa.
    #
    # ⚠️ **`ilike` não ignora acento**: "emprestimo" não casa "Empréstimo". É teto conhecido, e
    # a queda para a lista inteira é justamente a rede — o pior caso vira o comportamento de
    # antes do filtro, nunca um "não achei". Resolver de verdade pede a extensão `unaccent`,
    # que é migration; só vale a pena se aparecer no uso real.
    se_esvaziou = ""
    if alvo and not linhas_sql:
        se_esvaziou = f"Não achei recorrência com “{alvo}”. Estas são todas:\n"
        alvo = ""
        linhas_sql = await db.fetch(
            """
            select kind, amount_cents, description, category, rrule, next_run_at, end_date, active
            from public.recurring_transactions
            where workspace_id = %s
            order by active desc, next_run_at, kind
            limit 20
            """,
            ctx.workspace_id,
        )
    if not linhas_sql:
        return ToolResult(
            "🔁 Você ainda não tem nada recorrente. Tenta "
            '"todo dia 5 pago 1800 de aluguel" ou "meu salário de 3000 cai todo dia 20".',
            read_only=True,
        )

    def linha(r) -> str:
        nome = r["description"] or r["category"] or "sem descrição"
        quando = descreve_rrule(r["rrule"])
        proxima = format_date_br(local_iso_date(ctx.timezone, r["next_run_at"]))
        ate = f" · até {format_date_br(r['end_date'])}" if r["end_date"] else ""
        return (
            f"  • {nome}: {cents_to_brl(r['amount_cents'])} — {quando} · "
            f"próxima em {proxima}{ate}"
        )

    def bloco(kind: str, titulo: str) -> list[str]:
        itens = [r for r in linhas_sql if r["kind"] == kind and r["active"]]
        if not itens:
            return []
        return [titulo] + [linha(r) for r in itens]

    # Filtrado, o título é a PERGUNTA e a divisão entra/sai vira ruído — normalmente todos os
    # achados são do mesmo lado. Sem filtro, os dois blocos são o que organiza a lista longa.
    if alvo:
        partes = [f"🔁 *{alvo.capitalize()}*"]
        for r in [x for x in linhas_sql if x["active"]]:
            partes.append(linha(r))
    else:
        partes = [f"{se_esvaziou}🔁 *Suas recorrências*"]
        partes += bloco("income", "\n*Entra*")
        partes += bloco("expense", "\n*Sai*")

    pausadas = [r for r in linhas_sql if not r["active"]]
    if pausadas:
        nomes = ", ".join((r["description"] or r["category"] or "sem descrição") for r in pausadas[:5])
        partes.append(f"\n⏸️ Pausadas: {nomes}")

    if len(partes) == 1:
        return ToolResult(
            "🔁 Suas recorrências estão todas pausadas no momento.", read_only=True
        )
    # A janela é do materializador, não um número solto: `HORIZON_DAYS` em `jobs/scheduler.py`.
    # E agora ela é LIDA de lá — a frase dizia "90 dias" cravado logo abaixo deste comentário,
    # então mudar o horizonte para um ano teria feito a mensagem mentir para o usuário.
    partes.append(
        f"\nOs lançamentos dos próximos {HORIZON_DAYS // 30} meses já estão no seu extrato."
    )
    return ToolResult("\n".join(partes), read_only=True)


async def query_debts(ctx: ExecContext, action: FinanceQuery) -> ToolResult:
    """As dívidas em aberto, com saldo, prestação e quanto já foi pago.

    `interest_rate_monthly` é FRAÇÃO mensal (1,99% a.m. = 0.0199) — multiplicar por 100 na
    exibição é obrigatório, e é o erro que faz um financiamento parecer de graça.

    `search_term` responde "quanto falta do CARRO?" com o carro, não com as três dívidas —
    mesma régua de `query_recurring`. Filtro que não acha nada cai na lista inteira com aviso:
    a pessoa perguntou de algo que ela acha que existe, e a lista é o que resolve a dúvida.

    Escopo por `workspace_id`, tabela literal, nenhum id do modelo. `search_term` entra
    parametrizado (`ilike %%s`), nunca concatenado.
    """
    alvo = (action.search_term or "").strip()
    SQL = """
        select name, kind, remaining_cents, principal_cents, installment_cents,
               interest_rate_monthly, installments, installments_paid, due_day
        from public.debts
        where workspace_id = %s and archived = false
          and (%s = '' or name ilike %s)
        order by remaining_cents desc
        limit 20
    """
    rows = await db.fetch(SQL, ctx.workspace_id, alvo, f"%{alvo}%")
    aviso = ""
    if alvo and not rows:
        aviso = f"Não achei dívida com “{alvo}”. Estas são todas:\n"
        alvo = ""
        rows = await db.fetch(SQL, ctx.workspace_id, "", "%")
    if not rows:
        return ToolResult(
            "🎉 Você não tem nenhuma dívida cadastrada.", read_only=True
        )

    partes = [f"{aviso}💳 *{alvo.capitalize() if alvo else 'Suas dívidas'}*"]
    for d in rows:
        partes.append(
            f"  • {d['name']}: faltam {cents_to_brl(d['remaining_cents'])} "
            f"de {cents_to_brl(d['principal_cents'])}"
        )
        detalhe = []
        if d["installment_cents"]:
            detalhe.append(f"parcela {cents_to_brl(d['installment_cents'])}")
        taxa = float(d["interest_rate_monthly"] or 0)
        if taxa > 0:
            # vírgula, nunca ponto — mesma régua de `formatNumberBR` no app
            detalhe.append(f"{taxa * 100:.2f}".replace(".", ",") + "% a.m.")
        if d["installments"]:
            detalhe.append(f"{d['installments_paid']} de {d['installments']} pagas")
        if d["due_day"]:
            detalhe.append(f"vence dia {d['due_day']}")
        if detalhe:
            partes.append(f"    {' · '.join(detalhe)}")

    # Soma de UM item é eco, não resumo — a mesma régua que tirou o card de total de Cartões.
    if len(rows) > 1:
        total = sum(int(d["remaining_cents"]) for d in rows)
        partes.append(f"\n*Total em aberto:* {cents_to_brl(total)}")
    return ToolResult("\n".join(partes), read_only=True)


async def query_cycle(ctx: ExecContext, query: FinanceQuery) -> ToolResult:
    """De quando a quando vai o mês do usuário, e que dia ele fecha.

    É CONFIGURAÇÃO, não dinheiro: quem responde "quanto sobra até lá" é
    `query_forecast`, que agora usa estas mesmas bordas como horizonte padrão.

    A frase usa o vocabulário da tela ("Fecha todo dia 10" / "Último dia do mês",
    `profile/index.tsx`), não o jargão da coluna — o usuário nunca viu a palavra
    `cycle_close_day` e não deveria ver agora.
    """
    hoje = local_iso_date(ctx.timezone)
    c = await db.cycle(ctx.workspace_id, hoje)
    if not c:
        return ToolResult("🤷 Não consegui ler o seu mês agora.", read_only=True)

    de, ate = format_date_br(c["ini"]), format_date_br(c["fim"])
    dias = int(c["dias_ate_o_fim"])
    quando = (
        f"fecha todo dia {c['close_day']}"
        if c["close_day"]
        else "fecha no último dia do mês"
    )
    falta = "fecha hoje" if c["fim"].isoformat() == hoje else (
        f"falta {dias} dia" if dias == 1 else f"faltam {dias} dias"
    )
    return ToolResult(
        f"📅 Seu mês ({c['rotulo']}) vai de {de} a {ate} — {quando}.\n{falta[0].upper()}{falta[1:]} para fechar.",
        read_only=True,
        data={"close_day": c["close_day"], "de": de, "ate": ate, "dias": dias},
    )
