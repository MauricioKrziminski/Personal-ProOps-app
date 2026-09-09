"""Ações financeiras — determinísticas, tipadas, idempotentes.

Toda regra de negócio que já mora no banco continua no banco: ciclo de fatura é
o trigger `set_invoice`, parcelamento é `create_installment_plan`, aporte em meta
é `goal_deposit`. Duplicar isso em Python seria a segunda cópia da regra, e
duas cópias divergem.
"""

from __future__ import annotations

import logging
from uuid import UUID

from app import db
from app.domain import matching
from app.domain.dates import add_months, format_date_br, local_iso_date, now_utc
from app.domain.money import cents_to_brl, parse_valor_em_centavos
from app.domain.recurrence import next_occurrence
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import guards
from app.tools.base import ExecContext, ToolResult, ensure_owned
from app.tools.guards import Level1Error

log = logging.getLogger(__name__)

KIND_LABEL = {"expense": "gasto", "income": "receita", "transfer": "transferência"}
REFERENCE_WINDOW = 40


# ---------------------------------------------------------------------------
# resolução de referências
# ---------------------------------------------------------------------------


async def resolve_account(
    workspace_id: UUID,
    name: str | None,
    *,
    only_cards: bool = False,
    account_type: str | None = None,
) -> UUID | None:
    """Acha a conta ou cartão pelo nome livre vindo da IA.

    De propósito: o lançamento NUNCA falha por conta desconhecida. Perder o
    registro do gasto é pior do que registrá-lo sem conta.
    """
    if not name:
        return None
    linhas = await db.accounts(workspace_id, only_cards=only_cards)
    tipo = "credit_card" if only_cards else account_type

    certos = matching.match_accounts(
        name, linhas, semelhanca=False, account_type=tipo
    )
    if certos:
        return certos[0]["id"]

    por_semelhanca = matching.match_accounts(
        name, linhas, account_type=tipo
    )
    return por_semelhanca[0]["id"] if len(por_semelhanca) == 1 else None


async def default_account(workspace_id: UUID) -> UUID | None:
    """A conta padrão do espaço — para onde vai o lançamento que não cita conta.

    "gastei 45 no mercado" não diz de onde saiu o dinheiro, e `resolve_account` devolve
    None de propósito: perder o registro do gasto é pior que registrá-lo sem conta. O
    preço aparece na hora de perguntar PARA ONDE o dinheiro foi — sem padrão, tudo cai
    num balde só, chamado "Sem conta".

    Só vale para gasto/receita/transferência. Compra parcelada e fatura pedem CARTÃO, e
    a conta padrão nunca é cartão (o banco recusa) — cair nela ali seria trocar o
    contrato por outro em silêncio.
    """
    linha = await db.fetch_one(
        "select default_account_id from public.workspaces where id = %s", workspace_id
    )
    return linha["default_account_id"] if linha else None


async def resolve_transaction(
    workspace_id: UUID, action: FinanceAction
) -> tuple[str, list[dict]]:
    """Acha o lançamento citado ("o último", "o de 45", "o mercado de ontem").

    Devolve ("found"|"ambiguous"|"none", candidatos). Empate PERGUNTA em vez de
    chutar: alterar o lançamento errado é pior que uma mensagem a mais.
    """
    candidatos = await db.fetch(
        """
        select id, kind, amount_cents, category, description, occurred_at
        from public.transactions
        where workspace_id = %s
        order by created_at desc
        limit %s
        """,
        workspace_id,
        REFERENCE_WINDOW,
    )
    if not candidatos:
        return "none", []

    filtrou = False
    if action.amount_cents:
        candidatos = [t for t in candidatos if t["amount_cents"] == action.amount_cents]
        filtrou = True
    if action.category:
        alvo = action.category.lower()
        candidatos = [t for t in candidatos if (t["category"] or "").lower() == alvo]
        filtrou = True
    if action.description:
        termo = action.description.lower().strip()
        por_texto = [
            t
            for t in candidatos
            if termo in (t["description"] or "").lower()
            or termo in (t["category"] or "").lower()
        ]
        # termo que não casa com nada não pode zerar uma busca que já achou por valor
        if por_texto:
            candidatos, filtrou = por_texto, True
    if action.occurred_at:
        por_data = [t for t in candidatos if str(t["occurred_at"]) == action.occurred_at]
        if por_data:
            candidatos, filtrou = por_data, True

    if not candidatos:
        return "none", []
    if not filtrou:
        return "found", candidatos[:1]  # sem pista nenhuma, "o último" é a leitura certa
    if len(candidatos) > 1:
        return "ambiguous", candidatos[:3]
    return "found", candidatos


def describe(tx: dict) -> str:
    partes = f"{KIND_LABEL.get(tx['kind'], tx['kind'])} de {cents_to_brl(tx['amount_cents'])}"
    if tx.get("category"):
        partes += f" em *{tx['category']}*"
    if tx.get("description"):
        partes += f" ({tx['description']})"
    return partes


async def apply_rules(workspace_id: UUID, action: FinanceAction) -> FinanceAction:
    """Regra do usuário GANHA da IA.

    É o antídoto para "categorizou errado e não tem como consertar", que é a
    queixa que os concorrentes colecionam.
    """
    texto = " ".join(p for p in (action.description, action.category) if p)
    if not texto:
        return action

    regra = await db.fetch_one(
        "select * from public._match_rule(%s, %s) limit 1", workspace_id, texto
    )
    if not regra:
        return action

    try:
        await db.execute("select public._bump_rule_hits(%s)", regra["rule_id"])
    except Exception as err:  # noqa: BLE001 — contador não derruba lançamento
        log.debug("bump_rule_hits ignorado: %s", err)

    return action.model_copy(update={"category": regra["category"] or action.category})


def _amount_with_fallback(ctx: ExecContext, action: FinanceAction) -> int | None:
    """Valor da IA ou, se ela omitiu, do texto cru.

    O modelo devolve a ação certa sem o valor de vez em quando — e com confiança
    1.0, que escalonamento nenhum pega. O parser determinístico não depende de
    cota nem de humor do modelo.
    """
    if action.amount_cents:
        return action.amount_cents
    if action.type == FinanceActionType.CREATE_INSTALLMENT_PURCHASE:
        from app.domain.money import parse_installment_total
        return parse_installment_total(ctx.texto, action.installments)
    return parse_valor_em_centavos(ctx.texto)


# ---------------------------------------------------------------------------
# escritas
# ---------------------------------------------------------------------------


async def create_transaction(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    kind = "expense" if action.type == FinanceActionType.CREATE_EXPENSE else "income"
    valor = guards.require_amount(_amount_with_fallback(ctx, action))
    quando = guards.require_date(action.occurred_at, ctx.timezone)
    categoria = guards.clean_category(action.category)
    conta = await resolve_account(ctx.workspace_id, action.account) or await default_account(
        ctx.workspace_id
    )
    rrule = guards.clean_rrule(action.recurrence)

    if rrule:
        proxima = next_occurrence(rrule, now_utc(), ctx.timezone)
        if proxima is None:
            raise Level1Error("❌ Não entendi a recorrência. Tenta \"todo dia 5\" ou \"toda segunda\".")
        row = await db.fetch_one(
            """
            insert into public.recurring_transactions
              (user_id, workspace_id, kind, amount_cents, currency, category,
               description, account_id, rrule, dtstart, next_run_at)
            values (%s, %s, %s, %s, 'BRL', %s, %s, %s, %s, %s, %s)
            returning id
            """,
            ctx.user_id, ctx.workspace_id, kind, valor, categoria,
            action.description, conta, rrule, proxima, proxima,
        )
        emoji = "🔁💸" if kind == "expense" else "🔁💰"
        return ToolResult(
            f"{emoji} Recorrente criado: {cents_to_brl(valor)}"
            + (f" em *{categoria}*" if categoria else "")
            + f" — próxima em {format_date_br(proxima.date())}.",
            result_id=row["id"] if row else None,
        )

    row = await db.fetch_one(
        """
        insert into public.transactions
          (user_id, workspace_id, kind, amount_cents, currency, category,
           description, account_id, occurred_at, source)
        values (%s, %s, %s, %s, 'BRL', %s, %s, %s, %s, 'whatsapp')
        returning id
        """,
        ctx.user_id, ctx.workspace_id, kind, valor, categoria,
        action.description, conta, quando,
    )
    emoji = "💸" if kind == "expense" else "💰"
    return ToolResult(
        f"{emoji} {'Gasto' if kind == 'expense' else 'Receita'} de *{cents_to_brl(valor)}*"
        + (f" em *{categoria}*" if categoria else "")
        + f" em {format_date_br(quando)}.",
        result_id=row["id"] if row else None,
    )


async def create_transfer(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    valor = guards.require_amount(_amount_with_fallback(ctx, action))
    quando = guards.require_date(action.occurred_at, ctx.timezone)
    origem = await resolve_account(ctx.workspace_id, action.account) or await default_account(
        ctx.workspace_id
    )
    destino = await resolve_account(ctx.workspace_id, action.counterparty_account)
    if not origem or not destino:
        raise Level1Error(
            "❌ Para transferir eu preciso das duas contas. "
            "Tenta \"passei 200 da corrente pra poupança\"."
        )
    if origem == destino:
        raise Level1Error("❌ Origem e destino são a mesma conta.")

    row = await db.fetch_one(
        """
        insert into public.transactions
          (user_id, workspace_id, kind, amount_cents, currency, description,
           account_id, counterparty_account_id, occurred_at, source)
        values (%s, %s, 'transfer', %s, 'BRL', %s, %s, %s, %s, 'whatsapp')
        returning id
        """,
        ctx.user_id, ctx.workspace_id, valor, action.description, origem, destino, quando,
    )
    return ToolResult(
        f"🔄 Transferência de *{cents_to_brl(valor)}* registrada.",
        result_id=row["id"] if row else None,
    )


async def create_installment_purchase(
    ctx: ExecContext, action: FinanceAction
) -> ToolResult:
    total = guards.require_amount(
        _amount_with_fallback(ctx, action), o_que="o valor total"
    )
    parcelas = guards.require_installments(action.installments)
    atual = guards.require_current_installment(action.current_installment, parcelas)
    quando = guards.require_date(action.occurred_at, ctx.timezone)
    conta = await resolve_account(ctx.workspace_id, action.account, only_cards=True)
    if not conta:
        raise Level1Error(
            "❌ Em qual cartão foi? Cadastra ele no app e me fala o nome."
        )
    await ensure_owned("accounts", conta, ctx.workspace_id)

    paid = action.already_paid_count
    historical = atual > 1 or quando < local_iso_date(ctx.timezone)
    if (historical and paid is None) or (
        paid is not None and not 0 <= paid <= parcelas
    ):
        raise Level1Error(
            "Quantas parcelas já foram pagas? Diga a quantidade, incluindo zero se nenhuma."
        )
    paid = paid or 0
    # Current position only anchors the schedule; it never determines payment.
    if atual > 1:
        quando = add_months(quando, -(atual - 1))
    row = await db.fetch_one(
        "select public.create_installment_plan_with_history(%s, %s, %s, %s, %s, %s, %s) as id",
        conta,
        total,
        parcelas,
        quando,
        paid,
        action.description,
        guards.clean_category(action.category),
    )
    por_parcela = guards.split_installment_total(total, parcelas)[0]
    historico = f"\n{paid} parcelas iniciais pagas; {parcelas - paid} pendentes."
    return ToolResult(
        f"🧾 Parcelado: *{cents_to_brl(total)}* em {parcelas}x de "
        f"{cents_to_brl(por_parcela)} (a última acerta os centavos).{historico}",
        result_id=row["id"] if row else None,
    )


async def pay_invoice(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    cartao = await resolve_account(ctx.workspace_id, action.account, only_cards=True)
    if not cartao:
        raise Level1Error("❌ Qual cartão? Me fala o nome dele (ex.: \"paguei a fatura do nubank\").")

    fatura = await db.fetch_one(
        """
        select ci.id, ci.due_date, private.invoice_open_cents(ci.id) as aberto
        from public.card_invoices ci
        where ci.account_id = %s and ci.workspace_id = %s and ci.status <> 'paid'
        order by ci.due_date
        limit 1
        """,
        cartao,
        ctx.workspace_id,
    )
    if not fatura:
        return ToolResult("✅ Não achei fatura em aberto nesse cartão.", read_only=True)

    # "paguei 800 da fatura do nubank" é pagamento PARCIAL: o resto fica na fatura, como fica no
    # rotativo do cartão de verdade. Sem valor, paga o que falta e quita.
    aberto = int(fatura["aberto"] or 0)
    valor = guards.optional_amount(action.amount_cents)
    if valor is not None and valor > aberto:
        raise Level1Error(
            f"❌ Essa fatura está com {cents_to_brl(aberto)} em aberto — o valor que você "
            f"falou passa disso. Confere?"
        )

    pagadora = await resolve_account(ctx.workspace_id, action.counterparty_account)
    row = await db.fetch_one(
        "select public.pay_invoice(%s, %s, %s, %s) as id",
        fatura["id"], pagadora, guards.require_date(action.occurred_at, ctx.timezone), valor,
    )
    vencimento = format_date_br(fatura["due_date"])
    if valor is None or valor >= aberto:
        texto = f"✅ Fatura paga (vencimento {vencimento})."
    else:
        texto = (
            f"✅ Registrei {cents_to_brl(valor)} na fatura do vencimento {vencimento}. "
            f"Ainda faltam {cents_to_brl(aberto - valor)}."
        )
    return ToolResult(texto, result_id=row["id"] if row else None)


async def verificar_limite_disponivel(
    workspace_id: UUID | str, account_id: UUID | str | None, valor_total_centavos: int
) -> dict:
    """Verifica se a compra excede o limite disponível do cartão de crédito (Soft Warning)."""
    if not account_id:
        return {
            "excedeu": False,
            "limite_centavos": None,
            "disponivel_centavos": None,
            "card_name": "",
            "account_id": None,
        }

    acc = await db.fetch_one(
        """
        select id, name, type, credit_limit_cents
        from public.accounts
        where id = %s and workspace_id = %s
        """,
        account_id,
        workspace_id,
    )
    if not acc or acc.get("type") != "credit_card" or not acc.get("credit_limit_cents"):
        return {
            "excedeu": False,
            "limite_centavos": None,
            "disponivel_centavos": None,
            "card_name": acc.get("name", "") if acc else "",
            "account_id": str(account_id),
        }

    limite = int(acc["credit_limit_cents"])
    if limite <= 0:
        return {
            "excedeu": False,
            "limite_centavos": limite,
            "disponivel_centavos": None,
            "card_name": acc.get("name", ""),
            "account_id": str(account_id),
        }

    aberto_row = await db.fetch_one(
        """
        select coalesce(sum(t.amount_cents), 0) as total
        from public.transactions t
        join public.card_invoices ci on ci.id = t.invoice_id
        where ci.account_id = %s and ci.status <> 'paid' and t.workspace_id = %s
        """,
        account_id,
        workspace_id,
    )
    aberto_cents = int(aberto_row["total"] or 0) if aberto_row else 0
    disponivel = limite - aberto_cents
    excedeu = valor_total_centavos > disponivel

    return {
        "excedeu": excedeu,
        "limite_centavos": limite,
        "disponivel_centavos": disponivel,
        "card_name": acc.get("name", "Cartão"),
        "account_id": str(account_id),
    }


async def _baixa_em_parcelas(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    cands = (ctx.target or {}).get("candidates") or []
    if not cands:
        return ToolResult(
            "🤷 Essa compra parcelada não está mais aqui.", read_only=True
        )

    # Old checkpoints only froze the plan ID. Never replay their broad effect.
    snapshot = cands[0].get("installment_snapshot") or {}
    rows = snapshot.get("rows") or []
    if (
        snapshot.get("version") != 2
        or not rows
        or snapshot.get("total_cents") != sum(r["amount_cents"] for r in rows)
    ):
        return ToolResult(
            "Essa confirmação antiga não detalha as parcelas. Peça a baixa novamente para revisar o intervalo e o valor.",
            read_only=True,
        )
    import json

    # One statement locks and checks EVERY reviewed record before updating ANY.
    # A changed amount/date/status, removed row or ownership mismatch rejects all.
    updated = await db.fetch_one(
        """
        with reviewed as (
            select * from jsonb_to_recordset(%s::jsonb) as r(
                id uuid, installment_no int, amount_cents bigint, occurred_at date,
                status text, paid_at date, account_id uuid, invoice_id uuid)
        ), locked as materialized (
            select t.* from public.transactions t join reviewed r on r.id=t.id
            where t.workspace_id=%s and t.installment_plan_id=%s
            order by t.id for update of t
        ), valid as (
            select count(*) as n from locked t join reviewed r on r.id=t.id
            where t.installment_no=r.installment_no and t.amount_cents=r.amount_cents
              and t.occurred_at=r.occurred_at and t.status::text=r.status
              and t.paid_at is not distinct from r.paid_at
              and t.account_id is not distinct from r.account_id
              and t.invoice_id is not distinct from r.invoice_id
        ), changed as (
            update public.transactions t set status='cleared',paid_at=%s
            from locked l where t.id=l.id and l.status::text<>'cleared'
              and (select n from valid)=%s
            returning t.id
        ) select (select n from valid) as matched, (select count(*) from changed) as changed
        """,
        json.dumps(rows),
        ctx.workspace_id,
        cands[0]["id"],
        local_iso_date(ctx.timezone),
        len(rows),
    )
    if not updated or updated["matched"] != len(rows):
        return ToolResult(
            "As parcelas mudaram desde a confirmação. Não alterei nada; peça a baixa novamente.",
            read_only=True,
        )
    return ToolResult(
        f"✅ {cands[0].get('label', 'Parcelas')} — {cents_to_brl(snapshot['total_cents'])}. "
        f"{updated['changed']} parcelas marcadas como pagas; as que já estavam pagas foram preservadas.",
        result_id=cands[0]["id"],
        read_only=updated["changed"] == 0,
    )


async def mark_paid(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    """Baixa numa conta PREVISTA. Diferente de create_expense: o lançamento já existe."""
    if _alvo_e_plano(ctx):
        return await _baixa_em_parcelas(ctx, action)
    cands = (ctx.target or {}).get("candidates") or []
    if not cands:
        return ToolResult("🤷 Não achei essa conta em aberto.", read_only=True)
    # Antes havia um `limit 1` ordenado por vencimento: com duas contas em aberto
    # parecidas, ele dava baixa na mais antiga EM SILÊNCIO. Agora o empate vira
    # pergunta como todo o resto — quem resolve é a Fase Cognitiva.
    conta = await db.fetch_one(
        """
        select id, description, category, amount_cents
        from public.transactions where id = %s and workspace_id = %s
        """,
        cands[0]["id"], ctx.workspace_id,
    )
    if not conta:
        return ToolResult("🤷 Não achei essa conta em aberto.", read_only=True)

    # `paid_at`, NUNCA `occurred_at`. Reescrever a data do lançamento fazia a
    # conta de agosto paga em setembro migrar de mês em todo relatório — o mês
    # fechado encolhia sozinho. E numa parcela de cartão era pior: o trigger
    # `set_invoice` é `before update of account_id, occurred_at` e arrancava a
    # parcela da fatura em que ela nasceu, que é a mesma armadilha que o ramo de
    # plano acima já evitava. O app parou de fazer isso na 0046; aqui é o outro
    # lado da mesma decisão.
    await db.execute(
        "update public.transactions set status = 'cleared', paid_at = %s "
        "where id = %s and workspace_id = %s",
        local_iso_date(ctx.timezone),
        conta["id"],
        ctx.workspace_id,
    )
    nome = conta["description"] or conta["category"] or "conta"
    return ToolResult(
        f"✅ Baixa dada: {nome} — {cents_to_brl(conta['amount_cents'])}.",
        result_id=conta["id"],
    )


async def set_rule(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    padrao = guards.require_text(action.target_ref or action.description, o_que="o que disparar a regra")
    categoria = guards.clean_category(action.category)
    if not categoria:
        raise Level1Error("❌ Para qual categoria? Tenta \"sempre que eu falar ifood, põe em restaurante\".")

    row = await db.fetch_one(
        """
        insert into public.categorization_rules
          (workspace_id, user_id, match_type, pattern, category, source)
        values (%s, %s, 'contains', %s, %s, 'user')
        on conflict (workspace_id, match_type, pattern)
          do update set category = excluded.category
        returning id
        """,
        ctx.workspace_id, ctx.user_id, padrao, categoria,
    )
    return ToolResult(
        f"📌 Anotado: tudo que falar *{padrao}* vai para *{categoria}*.\n"
        "Dá para ver e apagar suas regras no app.",
        result_id=row["id"] if row else None,
    )


async def update_transaction(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    cands = (ctx.target or {}).get("candidates") or []
    if not cands:
        return ToolResult("🤷 Esse lançamento não está mais aqui.", read_only=True)

    if _alvo_e_plano(ctx):
        if action.installment_scope or action.current_installment:
            return await _baixa_em_parcelas(ctx, action)
        return ToolResult(
            "🤷 Para compras parceladas, você pode mudar as parcelas pagas ou excluir o plano.",
            read_only=True,
        )

    patch: dict = {}
    if action.new_amount_cents is not None:
        patch["amount_cents"] = guards.require_amount(action.new_amount_cents, o_que="o valor novo")
    if action.new_category:
        patch["category"] = guards.clean_category(action.new_category)
    if action.new_occurred_at:
        patch["occurred_at"] = guards.require_date(action.new_occurred_at, ctx.timezone, default_hoje=False)
    frozen_account = None
    if action.new_account:
        frozen_account = (ctx.target or {}).get("new_account")
        if not frozen_account or "id" not in frozen_account:
            raise Level1Error("A conta corrigida não foi confirmada. Peça a correção novamente.")
        patch["account_id"] = frozen_account["id"]
    if not patch:
        raise Level1Error(
            "❌ Não entendi o que mudar. Tenta \"muda o último pra 54\" "
            "ou \"o mercado de ontem era transporte\"."
        )

    # O alvo já veio resolvido e CONGELADO pela Fase Cognitiva; o registry barrou
    # antes de chegar aqui se não estivesse `found`. Buscar de novo aqui abriria a
    # janela que este desenho existe para fechar: entre a pergunta e o SIM o
    # usuário pode ter lançado outra coisa, e o "último" mudaria de dono.
    alvo_id = cands[0]["id"]
    antes = await db.fetch_one(
        """
        select id, kind, amount_cents, category, description, occurred_at
        from public.transactions where id = %s and workspace_id = %s
        """,
        alvo_id, ctx.workspace_id,
    )
    if not antes:
        return ToolResult("🤷 Esse lançamento não está mais aqui.", read_only=True)
    colunas = ", ".join(f"{c} = %s" for c in patch)
    args = [*patch.values(), antes["id"], ctx.workspace_id]
    account_guard = ""
    if frozen_account and frozen_account["id"] is not None:
        account_guard = " and exists (select 1 from public.accounts a where a.id = %s and a.workspace_id = %s and not a.archived)"
        args.extend([frozen_account["id"], ctx.workspace_id])
    updated = await db.fetch_one(
        f"update public.transactions set {colunas} where id = %s and workspace_id = %s{account_guard} returning id",
        *args,
    )
    if not updated:
        return ToolResult("O lançamento ou a conta mudou desde a confirmação. Não alterei nada; peça a correção novamente.", read_only=True)

    mudancas = []
    if frozen_account:
        mudancas.append(f"conta → *{frozen_account['name']}*")
    if "amount_cents" in patch:
        mudancas.append(f"{cents_to_brl(antes['amount_cents'])} → {cents_to_brl(patch['amount_cents'])}")
    if "category" in patch:
        mudancas.append(f"categoria → *{patch['category']}*")
    if "occurred_at" in patch:
        mudancas.append(f"data → {format_date_br(patch['occurred_at'])}")
    return ToolResult(
        f"✏️ Corrigido ({describe(antes)}): {', '.join(mudancas)}.", result_id=antes["id"]
    )


def _alvo_e_plano(ctx: ExecContext) -> bool:
    """O usuário escolheu a COMPRA INTEIRA, não uma parcela.

    A tabela vem do candidato congelado no checkpoint — é o mesmo id que ele LEU
    quando confirmou.
    """
    return (ctx.target or {}).get("table") == "installment_plans"


async def _apagar_plano(ctx: ExecContext) -> ToolResult:
    """Apaga a compra parcelada inteira.

    Um `delete` só: `transactions.installment_plan_id` tem `on delete cascade`
    (0013:142), então as N parcelas caem junto. Contar antes é o que permite dizer
    quantas foram — e apagar uma de cada vez deixaria o plano órfão mentindo
    `installments = 10` com 9 parcelas vivas, que era o estado anterior.
    """
    cands = (ctx.target or {}).get("candidates") or []
    if not cands:
        return ToolResult("🤷 Essa compra parcelada não está mais aqui.", read_only=True)

    plano = await db.fetch_one(
        """
        select p.id, p.description, p.installments, p.total_cents,
               (select count(*) from public.transactions t
                 where t.installment_plan_id = p.id) as parcelas
        from public.installment_plans p
        where p.id = %s and p.workspace_id = %s
        """,
        cands[0]["id"], ctx.workspace_id,
    )
    if not plano:
        return ToolResult("🤷 Essa compra parcelada não está mais aqui.", read_only=True)
    await db.execute(
        "delete from public.installment_plans where id = %s and workspace_id = %s",
        plano["id"], ctx.workspace_id,
    )
    nome = plano["description"] or "compra parcelada"
    return ToolResult(
        f"🗑️ Apaguei *{nome}* por completo — {plano['parcelas']} parcelas, "
        f"{cents_to_brl(plano['total_cents'])}.",
        result_id=plano["id"],
    )


async def delete_transaction(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    if _alvo_e_plano(ctx):
        return await _apagar_plano(ctx)
    cands = (ctx.target or {}).get("candidates") or []
    if not cands:
        return ToolResult("🤷 Esse lançamento não está mais aqui.", read_only=True)

    alvo = await db.fetch_one(
        """
        select id, kind, amount_cents, category, description
        from public.transactions where id = %s and workspace_id = %s
        """,
        cands[0]["id"], ctx.workspace_id,
    )
    if not alvo:
        return ToolResult("🤷 Esse lançamento não está mais aqui.", read_only=True)
    await db.execute(
        "delete from public.transactions where id = %s and workspace_id = %s",
        alvo["id"], ctx.workspace_id,
    )
    return ToolResult(f"🗑️ Apagado: {describe(alvo)}.", result_id=alvo["id"])


async def undo_last(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    # O "último" também vem congelado: se o usuário lançar algo entre a pergunta
    # e o SIM, apagar é o que ele LEU, não o que virou último no meio do caminho.
    alvo = await db.fetch_one(
        """
        select id, kind, amount_cents, category, description
        from public.transactions where id = %s and workspace_id = %s
        """,
        ctx.target["candidates"][0]["id"], ctx.workspace_id,
    )
    if not alvo:
        return ToolResult("🤷 Não achei nenhum lançamento para apagar.", read_only=True)

    # `workspace_id` no DELETE: o id já vem de um select escopado, mas depender
    # disso é depender de quem chama. Aqui a garantia é local.
    await db.execute(
        "delete from public.transactions where id = %s and workspace_id = %s",
        alvo["id"], ctx.workspace_id,
    )
    return ToolResult(f"🗑️ Apagado: {describe(alvo)}.", result_id=alvo["id"])


async def create_goal(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    nome = guards.require_text(action.target_ref or action.description, o_que="o nome da meta")
    alvo = guards.require_amount(_amount_with_fallback(ctx, action), o_que="o valor da meta")
    prazo = guards.optional_date(action.occurred_at, ctx.timezone)

    row = await db.fetch_one(
        """
        insert into public.goals (user_id, workspace_id, name, target_cents, deadline)
        values (%s, %s, %s, %s, %s)
        returning id
        """,
        ctx.user_id, ctx.workspace_id, nome, alvo, prazo,
    )
    return ToolResult(
        f"🎯 Meta *{nome}*: {cents_to_brl(alvo)}"
        + (f" até {format_date_br(prazo)}" if prazo else "")
        + ".",
        result_id=row["id"] if row else None,
    )


async def goal_deposit(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    """Aporte NÃO vira transação: é movimento entre contas do próprio usuário e
    lançar como despesa inflaria o gasto do mês."""
    # Só valida: o nome exibido sai do alvo congelado, logo abaixo.
    guards.require_text(action.target_ref or action.description, o_que="em qual meta")
    valor = guards.require_amount(_amount_with_fallback(ctx, action), o_que="o valor do aporte")

    # alvo congelado; `ensure_owned` já rodou no registry, num ponto só
    metas = [{"id": ctx.target["candidates"][0]["id"],
              "name": ctx.target["candidates"][0]["label"]}]
    row = await db.fetch_one(
        "select public.goal_deposit(%s, %s, %s) as saved",
        metas[0]["id"], valor, guards.require_date(action.occurred_at, ctx.timezone),
    )
    return ToolResult(
        f"🎯 +{cents_to_brl(valor)} em *{metas[0]['name']}* "
        f"(total guardado: {cents_to_brl(row['saved'] if row else 0)}).",
        result_id=metas[0]["id"],
    )


async def update_asset_value(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    # Só valida: o nome exibido sai do alvo congelado, logo abaixo.
    guards.require_text(action.target_ref or action.description, o_que="qual bem")
    valor = guards.require_amount(_amount_with_fallback(ctx, action), o_que="o valor novo")

    # alvo congelado; `ensure_owned` já rodou no registry, num ponto só
    ativos = [{"id": ctx.target["candidates"][0]["id"],
               "name": ctx.target["candidates"][0]["label"]}]
    await db.execute(
        "select public.update_asset_value(%s, %s, %s)",
        ativos[0]["id"], valor, local_iso_date(ctx.timezone),
    )
    return ToolResult(
        f"📈 *{ativos[0]['name']}* atualizado para {cents_to_brl(valor)}.",
        result_id=ativos[0]["id"],
    )
