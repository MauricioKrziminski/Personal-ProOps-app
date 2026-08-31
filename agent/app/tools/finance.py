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
from app.domain.dates import add_months, format_date_br, local_iso_date, now_utc
from app.domain import matching
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
    workspace_id: UUID, name: str | None, *, only_cards: bool = False
) -> UUID | None:
    """Conta citada por nome. Sem match -> None.

    De propósito: o lançamento NUNCA falha por conta desconhecida. Perder o
    registro do gasto é pior do que registrá-lo sem conta.

    Era `ilike '%nome%' limit 1` **sem `order by`** — ou seja, com duas contas
    parecidas quem escolhia era a ordem que o Postgres devolvesse, e "itau"
    nunca achava "Itaú". Agora o casamento é normalizado e o desempate é
    ranqueado, então o mesmo nome sempre resolve para a mesma conta.

    ⚠️ **O tier de semelhança só vale quando é único aqui.** Este caminho resolve
    em SILÊNCIO, inclusive para `pay_invoice` e transferência; escolher a conta
    pagadora por parecença, sozinho, seria um modo de falha que o `ilike` antigo
    não tinha. Quem tem como perguntar (o rascunho) usa a lista inteira.

    `only_cards` existe porque nome de banco vira nome dos DOIS: quem tem a conta
    corrente "Itaú" e cria o cartão "Itaú" pelo WhatsApp passa a ter duas linhas
    que normalizam igual. Sem o filtro, o parcelamento podia cair na conta
    corrente — e aí `set_invoice` grava `invoice_id := null` em silêncio, que é
    exatamente o estado que "cartão obrigatório em parcelado" existe para
    impedir. Quem PRECISA de cartão pede cartão.
    """
    if not name:
        return None
    # ponytail: busca as contas do workspace por chamada (dezenas de linhas, não
    # milhares). Cache por turno se aparecer no perfil.
    linhas = await db.accounts(workspace_id, only_cards=only_cards)

    certos = matching.match_accounts(name, linhas, semelhanca=False)
    if certos:
        return certos[0]["id"]

    # Só typo sobrou. Um é conserto; dois é chute — e sem ninguém para perguntar,
    # chutar a conta é pior que lançar sem conta (que é um estado previsto).
    por_semelhanca = matching.match_accounts(name, linhas)
    return por_semelhanca[0]["id"] if len(por_semelhanca) == 1 else None


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
    return parse_valor_em_centavos(ctx.texto)


# ---------------------------------------------------------------------------
# escritas
# ---------------------------------------------------------------------------


async def create_transaction(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    kind = "expense" if action.type == FinanceActionType.CREATE_EXPENSE else "income"
    valor = guards.require_amount(_amount_with_fallback(ctx, action))
    quando = guards.require_date(action.occurred_at, ctx.timezone)
    categoria = guards.clean_category(action.category)
    conta = await resolve_account(ctx.workspace_id, action.account)
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
    origem = await resolve_account(ctx.workspace_id, action.account)
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


async def create_installment_purchase(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    total = guards.require_amount(_amount_with_fallback(ctx, action), o_que="o valor total")
    parcelas = guards.require_installments(action.installments)
    atual = guards.require_current_installment(action.current_installment, parcelas)
    quando = guards.require_date(action.occurred_at, ctx.timezone)
    conta = await resolve_account(ctx.workspace_id, action.account, only_cards=True)
    if not conta:
        raise Level1Error("❌ Em qual cartão foi? Cadastra ele no app e me fala o nome.")
    await ensure_owned("accounts", conta, ctx.workspace_id)

    # "Tô na 4ª parcela de 10" é uma compra de TRÊS MESES ATRÁS, não uma compra
    # de hoje em 10x — e era assim que ela era gravada, com as 10 parcelas no
    # futuro. Recuar a data da 1ª parcela é tudo o que falta: a RPC gera cada
    # parcela em `add_months(occurred_at, i-1)` e marca `cleared` toda data que
    # não é futura (0013:269,278). As 1..3 nascem pagas, a 4ª cai no mês
    # corrente e as 5..10 ficam pendentes — sem nenhuma regra nova em Python.
    if atual > 1:
        quando = add_months(quando, -(atual - 1))

    row = await db.fetch_one(
        """
        select public.create_installment_plan(%s, %s, %s, %s, %s, %s) as id
        """,
        conta, total, parcelas, quando,
        action.description, guards.clean_category(action.category),
    )
    por_parcela = guards.split_installment_total(total, parcelas)[0]
    historico = (
        f"\nAs {atual - 1} anteriores entraram como pagas; você está na {atual}ª."
        if atual > 1
        else ""
    )
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
        select ci.id, ci.due_date
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

    pagadora = await resolve_account(ctx.workspace_id, action.counterparty_account)
    row = await db.fetch_one(
        "select public.pay_invoice(%s, %s, %s) as id",
        fatura["id"], pagadora, guards.require_date(action.occurred_at, ctx.timezone),
    )
    return ToolResult(
        f"✅ Fatura paga (vencimento {format_date_br(fatura['due_date'])}).",
        result_id=row["id"] if row else None,
    )


async def _baixa_em_parcelas(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    """"Já paguei a terceira" -> parcelas 1..3 viram `cleared`.

    ⚠️ **NÃO toca em `occurred_at`.** O trigger `set_invoice` é
    `before insert or update of account_id, occurred_at` (0013:211): escrever a
    data arrancaria a parcela da fatura em que ela nasceu e a jogaria na fatura de
    hoje. Status não dispara o trigger, e o total da fatura nem olha para status —
    ele soma por `invoice_id`.
    """
    plano = await db.fetch_one(
        """
        select id, description, installments from public.installment_plans
        where id = %s and workspace_id = %s
        """,
        ctx.target["candidates"][0]["id"], ctx.workspace_id,
    )
    if not plano:
        return ToolResult("🤷 Essa compra parcelada não está mais aqui.", read_only=True)

    ate = guards.require_current_installment(action.current_installment, plano["installments"])
    mudadas = await db.execute(
        """
        update public.transactions set status = 'cleared'
        where installment_plan_id = %s and workspace_id = %s
          and installment_no <= %s and status = 'pending'
        """,
        plano["id"], ctx.workspace_id, ate,
    )
    nome = plano["description"] or "compra parcelada"
    if not mudadas:
        # Desfecho legítimo, e comum: `_promote_due_transactions` (0014:50) já
        # promove toda parcela vencida. Dizer "marquei 1, 2 e 3" aqui seria mentir.
        return ToolResult(
            f"👍 As parcelas até a {ate}ª de *{nome}* já constavam pagas — não mudei nada.",
            result_id=plano["id"],
        )
    plural = "parcela" if mudadas == 1 else "parcelas"
    return ToolResult(
        f"✅ Marquei {mudadas} {plural} de *{nome}* como pagas (até a {ate}ª).",
        result_id=plano["id"],
    )


async def mark_paid(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    """Baixa numa conta PREVISTA. Diferente de create_expense: o lançamento já existe."""
    if _alvo_e_plano(ctx):
        return await _baixa_em_parcelas(ctx, action)
    # Antes havia um `limit 1` ordenado por vencimento: com duas contas em aberto
    # parecidas, ele dava baixa na mais antiga EM SILÊNCIO. Agora o empate vira
    # pergunta como todo o resto — quem resolve é a Fase Cognitiva.
    conta = await db.fetch_one(
        """
        select id, description, category, amount_cents
        from public.transactions where id = %s and workspace_id = %s
        """,
        ctx.target["candidates"][0]["id"], ctx.workspace_id,
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
    patch: dict = {}
    if action.new_amount_cents:
        patch["amount_cents"] = guards.require_amount(action.new_amount_cents, o_que="o valor novo")
    if action.new_category:
        patch["category"] = guards.clean_category(action.new_category)
    if action.new_occurred_at:
        patch["occurred_at"] = guards.require_date(action.new_occurred_at, ctx.timezone, default_hoje=False)
    if not patch:
        raise Level1Error(
            "❌ Não entendi o que mudar. Tenta \"muda o último pra 54\" "
            "ou \"o mercado de ontem era transporte\"."
        )

    # O alvo já veio resolvido e CONGELADO pela Fase Cognitiva; o registry barrou
    # antes de chegar aqui se não estivesse `found`. Buscar de novo aqui abriria a
    # janela que este desenho existe para fechar: entre a pergunta e o SIM o
    # usuário pode ter lançado outra coisa, e o "último" mudaria de dono.
    alvo_id = ctx.target["candidates"][0]["id"]
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
    await db.execute(
        f"update public.transactions set {colunas} where id = %s and workspace_id = %s",  # noqa: S608
        *patch.values(),
        antes["id"],
        ctx.workspace_id,
    )

    mudancas = []
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
    plano = await db.fetch_one(
        """
        select p.id, p.description, p.installments, p.total_cents,
               (select count(*) from public.transactions t
                 where t.installment_plan_id = p.id) as parcelas
        from public.installment_plans p
        where p.id = %s and p.workspace_id = %s
        """,
        ctx.target["candidates"][0]["id"], ctx.workspace_id,
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
    alvo = await db.fetch_one(
        """
        select id, kind, amount_cents, category, description
        from public.transactions where id = %s and workspace_id = %s
        """,
        ctx.target["candidates"][0]["id"], ctx.workspace_id,
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
    nome = guards.require_text(action.target_ref or action.description, o_que="em qual meta")
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
    nome = guards.require_text(action.target_ref or action.description, o_que="qual bem")
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
