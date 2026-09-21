"""Ações financeiras — determinísticas, tipadas, idempotentes.

Toda regra de negócio que já mora no banco continua no banco: ciclo de fatura é
o trigger `set_invoice`, parcelamento é `create_installment_plan`, aporte em meta
é `goal_deposit`. Duplicar isso em Python seria a segunda cópia da regra, e
duas cópias divergem.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

import psycopg

from app import db
from app.domain import matching
from app.domain.correcao_plano import (
    CARTAO_FALTANDO,
    CONTA_DO_PLANO,
    DATA_DO_PLANO,
    LINHA_SUMIU,
    NADA_EDITAVEL,
    PARCELA_TRAVADA,
    VARIAS_PARCELAS,
)
from app.domain.dates import add_months, format_date_br, local_iso_date, now_utc
from app.domain.money import cents_to_brl, parse_valor_em_centavos
from app.domain.recurrence import next_occurrence
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import guards
from app.tools.base import FATURA_ABERTA, ExecContext, ToolResult, ensure_owned
from app.tools.guards import Level1Error

log = logging.getLogger(__name__)

# Quantas parcelas do plano `p` ainda podem mudar e quanto já está travado, pela régua
# do BANCO (`private.parcela_travada`: baixa, fatura paga/adiada ou paga em parte).
# Contar por `status` aqui seria a segunda cópia da regra de `update_installment_plan`.
# `workspace_id` porque o agente conecta com papel que ignora RLS.
TRAVAS_DO_PLANO = """cross join lateral (
            select count(*) filter (where not private.parcela_travada(t.status, t.invoice_id)) as editaveis,
                   coalesce(sum(t.amount_cents) filter (
                     where private.parcela_travada(t.status, t.invoice_id)), 0) as travado_cents
            from public.transactions t
            where t.installment_plan_id = p.id and t.workspace_id = p.workspace_id) x"""

KIND_LABEL = {"expense": "gasto", "income": "receita", "transfer": "transferência"}
REFERENCE_WINDOW = 40
# Quantas ocorrências FUTURAS entram na janela, além das passadas. Ver `reference_window`.
REFERENCE_AHEAD = 10


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

    ⚠️ **Empate devolve `None`, e não a primeira da lista** (11/09/2026). O
    ramo exato fazia `return certos[0]["id"]` sem olhar quantas casaram: com
    "Nubank Conta" e "Nubank Cartão" cadastrados, "gastei 45 no nubank" caía na
    que viesse primeiro do banco. É o MESMO defeito que lançou um salário de
    R$ 4.000 dentro da fatura pelo app em 09/09/2026, e aqui era pior, porque
    não havia tela mostrando a escolha — só o lançamento certo na conta errada.
    Quem transforma esse `None` em pergunta é `conta_citada`.
    """
    if not name:
        return None
    linhas = await db.accounts(workspace_id, only_cards=only_cards)
    tipo = "credit_card" if only_cards else account_type

    certos = matching.match_accounts(
        name, linhas, semelhanca=False, account_type=tipo
    )
    if len(certos) == 1:
        return certos[0]["id"]
    if certos:
        return None

    por_semelhanca = matching.match_accounts(
        name, linhas, account_type=tipo
    )
    return por_semelhanca[0]["id"] if len(por_semelhanca) == 1 else None


async def conta_citada(
    workspace_id: UUID,
    nome: str | None,
    *,
    only_cards: bool = False,
    papel: str = "a conta",
) -> UUID | None:
    """A conta que o usuário CITOU — ou uma PERGUNTA, nunca um palpite.

    ⚠️ **`resolve_account` devolve `None` em três situações diferentes e o
    chamador não conseguia distingui-las**: o usuário não citou conta nenhuma,
    citou um nome que não existe, ou citou um nome que casa com DUAS contas. As
    três caíam no mesmo `or await default_account(...)` — então dizer "gastei 45
    no nubank", sem ter nenhum "nubank" cadastrado, gravava o gasto na conta
    padrão, calado. O dinheiro fica na conta errada e ninguém revisa lançamento
    que aparece certo.

    Aqui só a PRIMEIRA situação devolve `None` (e aí quem decide é o chamador:
    conta padrão, ou erro). As outras duas levantam a pergunta com os nomes que
    existem — é a regra do dono do produto, e ela vale para o agente inteiro:
    *"ele tem que perguntar sempre que tiver dúvida, nunca deduzir"*.
    """
    if not nome:
        return None

    # A resolução continua sendo a de `resolve_account`: uma regra de casamento
    # só. O que muda aqui é o que fazer quando ela NÃO acha.
    achada = await resolve_account(workspace_id, nome, only_cards=only_cards)
    if achada:
        return achada

    linhas = await db.accounts(workspace_id, only_cards=only_cards)
    parecidas = matching.match_accounts(
        nome, linhas, account_type="credit_card" if only_cards else None
    )

    if len(parecidas) > 1:
        opcoes = ", ".join(f"*{c['name']}*" for c in parecidas[:6])
        raise Level1Error(f"🤔 “{nome}” casa com mais de uma: {opcoes}. Qual delas?")

    existentes = ", ".join(f"*{c['name']}*" for c in linhas[:8]) or "nenhuma ainda"
    o_que = "cartão" if only_cards else "conta"
    raise Level1Error(
        f"🤔 Não achei {o_que} com o nome “{nome}”. Você tem: {existentes}. "
        f"Qual é {papel}?"
    )


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
    # conta arquivada não é padrão: o lançamento cairia numa conta que sumiu da tela
    linha = await db.fetch_one(
        "select a.id as default_account_id, a.archived from public.workspaces w "
        "join public.accounts a on a.id = w.default_account_id "
        "and a.workspace_id = w.id where w.id = %s",
        workspace_id,
    )
    return linha["default_account_id"] if linha and not linha.get("archived") else None


async def _conta_padrao(ctx: ExecContext) -> UUID | None:
    """A conta padrão que a frase do SIM citou — congelada no alvo, nunca relida.

    Relendo aqui, trocar o padrão no app entre a pergunta e a resposta gravaria numa
    conta que o usuário não aprovou. O id congelado ainda passa por `ensure_owned`:
    ele veio do checkpoint, e escopo de workspace é código neste serviço. Alvo sem a
    chave (pendência de antes deste deploy) cai na leitura de sempre.
    """
    congelada = (ctx.target or {}).get("default_account")
    if congelada is None:
        return await default_account(ctx.workspace_id)
    if not congelada.get("id"):
        return None
    # posse (o id veio do checkpoint) e atividade numa consulta só: arquivada entre a
    # pergunta e o SIM, a frase citou uma conta que não pode mais receber lançamento
    linha = await db.fetch_one(
        "select archived from public.accounts where id = %s and workspace_id = %s",
        congelada["id"], ctx.workspace_id,
    )
    if linha is None:
        raise Level1Error("🤷 Não achei esse item por aqui.",
                          f"accounts:{congelada['id']} fora do workspace")
    if linha["archived"]:
        raise Level1Error(
            f"❌ A conta {congelada.get('name') or 'padrão'} foi arquivada. "
            "Me manda de novo dizendo a conta. Ainda não registrei nada."
        )
    return congelada["id"]


async def reference_window(
    workspace_id: UUID, action: FinanceAction | None = None
) -> list[dict]:
    """As transações alcançáveis quando o usuário aponta para uma ("o último", "o de 45").

    ⚠️ **Isto era `order by created_at desc limit 40` e em 10/09/2026 a janela ficou 40 de 40
    NO FUTURO.** O materializador passou de 90 para 365 dias e o cron gravou 200 ocorrências
    futuras num instante só; ordenado pela hora de CRIAÇÃO, o topo virou parcela de 2027 e
    nenhuma das 103 transações que de fato aconteceram sobrava na janela. Medido em produção:
    "apaga o último gasto" acertava *Manutenção dentista de 10/08/2027*, e o caminho passa por
    `interrupt()` — quem segurava era o usuário ler a pergunta e dizer não.

    A janela tem duas metades. **O passado primeiro**, do mais recente para trás: é o que "o
    último" quer dizer, e é a correção do defeito acima.

    **O futuro entra pela PISTA, não só pela proximidade.** Sem pista nenhuma, as ocorrências
    mais próximas bastam (é contexto, não alvo). Mas "muda a parcela do Mac de outubro" é
    pedido legítimo — `update_transaction_scoped` existe para ele —, e com 200 linhas futuras
    outubro está longe das 10 primeiras. Por isso valor, texto e data entram na consulta: o que
    volta é SUPERCONJUNTO do que o filtro em Python aceita, nunca menos. Filtrar aqui mais
    apertado que lá devolveria "não achei" para um alvo que existe, que é como uma janela de
    referência mente.
    """
    termo = (action.description or "").strip() if action else ""
    return await db.fetch(
        """
        with pista as (
          select nullif(%s, '')::text as termo, %s::bigint as cents, %s::date as dia
        )
        (select t.id, t.kind, t.amount_cents, t.category, t.description, t.merchant, t.occurred_at
           from public.transactions t
          where t.workspace_id = %s and t.occurred_at <= current_date
          order by t.occurred_at desc, t.created_at desc
          limit %s)
        union all
        (select t.id, t.kind, t.amount_cents, t.category, t.description, t.merchant, t.occurred_at
           from public.transactions t cross join pista p
          where t.workspace_id = %s and t.occurred_at > current_date
            and (
              (p.termo is null and p.cents is null and p.dia is null)
              or (p.termo is not null
                  and (t.description ilike '%%' || p.termo || '%%'
                       or t.merchant ilike '%%' || p.termo || '%%'
                       or t.category ilike '%%' || p.termo || '%%'))
              or (p.cents is not null and t.amount_cents = p.cents)
              or (p.dia is not null and t.occurred_at = p.dia)
            )
          order by t.occurred_at asc, t.created_at desc
          limit %s)
        """,
        termo,
        action.amount_cents if action else None,
        action.occurred_at if action else None,
        workspace_id,
        REFERENCE_WINDOW,
        workspace_id,
        REFERENCE_AHEAD,
    )


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
    # Citou conta que não existe (ou ambígua) -> pergunta. Só quem NÃO citou cai
    # na conta padrão, que é preferência do usuário e não dedução nossa.
    conta = await conta_citada(ctx.workspace_id, action.account) or await _conta_padrao(ctx)
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
    origem = await conta_citada(
        ctx.workspace_id, action.account, papel="a conta de onde saiu"
    ) or await _conta_padrao(ctx)
    destino = await conta_citada(
        ctx.workspace_id, action.counterparty_account, papel="a conta de destino"
    )
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
    conta = await conta_citada(
        ctx.workspace_id, action.account, only_cards=True, papel="o cartão"
    )
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


async def _aviso_de_fatura_adiada_por_id(invoice_id, workspace_id) -> str | None:
    """Explica quando a fatura que o usuário escolheu já foi adiada.

    A janela entre resolver o alvo e executar é real: o cron `_roll_overdue_invoices`
    roda de hora em hora e pode adiar a fatura entre a pergunta e o SIM.
    """
    linha = await db.fetch_one(
        """
        select ci.status, ci.due_date, destino.due_date as destino_due
        from public.card_invoices ci
        left join public.card_invoices destino on destino.id = ci.rolled_into_invoice_id
        where ci.id = %s and ci.workspace_id = %s
        """,
        invoice_id,
        workspace_id,
    )
    if not linha or linha["status"] != "rolled":
        return None
    destino = (
        f" O saldo dela entrou na fatura de {format_date_br(linha['destino_due'])}."
        if linha.get("destino_due")
        else ""
    )
    return (
        f"🤷 Essa fatura (vencimento {format_date_br(linha['due_date'])}) foi adiada "
        f"para a próxima, não paga.{destino} Não há o que pagar nela."
    )


async def _conta_que_paga(workspace_id, cartao_id, citada: str | None):
    """De onde sai o dinheiro da fatura, na mesma ordem que a tela usa.

    Antes isto era `resolve_account(ws, action.counterparty_account)` e mais nada.
    `resolve_account` devolve None quando o nome vem vazio — e "paguei a fatura do
    nubank", que é como a frase sai na vida real, não cita conta nenhuma. O NULL
    chegava na RPC, onde a guarda `p_account_id = inv.account_id` não dispara
    (NULL = x é NULL, não TRUE) e o INSERT do `transfer` aceita origem nula: a
    fatura ficava paga e **nenhum saldo se mexia**.

    A ordem é a do produto, não inventada aqui: `accounts.payment_account_id` é o
    campo "Conta que paga a fatura", e a tela da fatura já o usa como sugestão
    (`invoice/[id].tsx:237`). A conta padrão do workspace vem depois, como em
    `create_transaction`.
    """
    if citada:
        # `account_type="checking"` não serve: a conta pagadora pode ser poupança
        # ou dinheiro. O que ela NÃO pode ser é cartão — a RPC só recusa o próprio
        # cartão (`p_account_id = inv.account_id`), então "paguei a fatura do nubank
        # pelo inter", com o Inter também cartão, passaria e criaria uma
        # transferência de cartão para cartão. O app filtra `type !== 'credit_card'`
        # na lista de pagadoras e o catálogo recusa com todas as letras; aqui não
        # havia nada.
        achada = await conta_citada(workspace_id, citada, papel="a conta que pagou")
        if achada:
            linha = await db.fetch_one(
                "select type from public.accounts where id = %s and workspace_id = %s",
                achada,
                workspace_id,
            )
            if linha and linha.get("type") == "credit_card":
                raise Level1Error(
                    "❌ Um cartão não paga a fatura de outro. De qual conta saiu o dinheiro?"
                )
            return achada

    linha = await db.fetch_one(
        "select payment_account_id from public.accounts where id = %s and workspace_id = %s",
        cartao_id,
        workspace_id,
    )
    if linha and linha.get("payment_account_id"):
        return linha["payment_account_id"]

    # ⚠️ **A conta padrão do workspace NÃO entra aqui** (11/09/2026). Ela entrava,
    # copiada de `create_transaction`, e as duas situações não são a mesma: lá o
    # padrão é onde o gasto do dia a dia cai quando ninguém diz nada; aqui ele
    # decidiria de qual conta sai uma transferência de mil reais, sem a pessoa
    # ter falado e sem a frase do SIM dizer qual é. `payment_account_id` fica
    # porque é o campo "Conta que paga a fatura" que o próprio usuário gravou no
    # cartão — preferência dele, não palpite nosso.
    contas = [c for c in await db.accounts(workspace_id) if c.get("type") != "credit_card"]
    nomes = ", ".join(f"*{c['name']}*" for c in contas[:8]) or "nenhuma cadastrada"
    raise Level1Error(
        f"🤔 De qual conta saiu o dinheiro? Você tem: {nomes}."
    )


async def _aviso_de_fatura_adiada(account_id, workspace_id) -> str | None:
    """Explica o silêncio quando o cartão não tem fatura aberta mas TEM uma adiada.

    Sem isto a resposta é "não achei fatura em aberto" — tecnicamente verdade e
    inútil: a pessoa está olhando a fatura na tela do app, marcada como Adiada.
    Roda só no caminho em que já íamos responder que não há nada, então não custa
    nada no caminho normal.
    """
    linha = await db.fetch_one(
        """
        select ci.due_date, destino.due_date as destino_due
        from public.card_invoices ci
        left join public.card_invoices destino on destino.id = ci.rolled_into_invoice_id
        where ci.account_id = %s and ci.workspace_id = %s and ci.status = 'rolled'
        order by ci.due_date desc
        limit 1
        """,
        account_id,
        workspace_id,
    )
    if not linha:
        return None
    venceu = format_date_br(linha["due_date"])
    if linha.get("destino_due"):
        return (
            f"A fatura que vencia em {venceu} foi adiada — o saldo dela, com juros e IOF, "
            f"entrou na fatura de {format_date_br(linha['destino_due'])}."
        )
    return f"A fatura que vencia em {venceu} foi adiada para a próxima."


async def pay_invoice(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    """Pagar a fatura: o dinheiro SAI de uma conta agora.

    O alvo vem do `ctx.target`, resolvido e congelado na Fase Cognitiva — não de
    um SELECT aqui. Antes esta tool fazia o próprio `order by due_date limit 1` e
    pagava a fatura mais antiga em silêncio; com três faturas vencidas no mesmo
    cartão, a confirmação dizia "na fatura do nubank" e não dava para saber qual.
    Agora duas faturas em aberto viram pergunta, e uma só entra na frase do SIM
    com o vencimento — que é a regra de `base.py:31-34` para todo o resto daqui.
    """
    alvo = (ctx.target or {}).get("candidates") or []
    if not alvo:
        return ToolResult("✅ Não achei fatura em aberto nesse cartão.", read_only=True)

    fatura = await db.fetch_one(
        f"""
        select ci.id, ci.due_date, ci.account_id,
               private.invoice_open_cents(ci.id) as aberto
        from public.card_invoices ci
        where ci.id = %s and ci.workspace_id = %s and ci.{FATURA_ABERTA}
        """,
        alvo[0]["id"],
        ctx.workspace_id,
    )
    if not fatura:
        aviso = await _aviso_de_fatura_adiada_por_id(alvo[0]["id"], ctx.workspace_id)
        return ToolResult(aviso or "✅ Essa fatura já está paga.", read_only=True)

    # "paguei 800 da fatura do nubank" é pagamento PARCIAL: o resto fica na fatura, como fica no
    # rotativo do cartão de verdade. Sem valor, paga o que falta e quita.
    aberto = int(fatura["aberto"] or 0)
    valor = guards.optional_amount(action.amount_cents)
    if valor is not None and valor > aberto:
        raise Level1Error(
            f"❌ Essa fatura está com {cents_to_brl(aberto)} em aberto — o valor que você "
            f"falou passa disso. Confere?"
        )

    pagadora = await _conta_que_paga(ctx.workspace_id, fatura["account_id"], action.counterparty_account)
    # A conta pagadora entra na RESPOSTA. Quando ela veio do `payment_account_id`
    # do cartão, a pessoa não a citou nesta frase — e "✅ Fatura paga" não dizia
    # de onde o dinheiro saiu, num movimento que muda dois saldos.
    de_onde = await db.fetch_one(
        "select name from public.accounts where id = %s and workspace_id = %s",
        pagadora, ctx.workspace_id,
    )
    origem = f" — saiu de *{de_onde['name']}*" if de_onde else ""
    row = await db.fetch_one(
        "select public.pay_invoice(%s, %s, %s, %s) as id",
        fatura["id"], pagadora, guards.require_date(action.occurred_at, ctx.timezone), valor,
    )
    vencimento = format_date_br(fatura["due_date"])
    if valor is None or valor >= aberto:
        texto = f"✅ Fatura paga (vencimento {vencimento}){origem}."
    else:
        texto = (
            f"✅ Registrei {cents_to_brl(valor)} na fatura do vencimento {vencimento}{origem}. "
            f"Ainda faltam {cents_to_brl(aberto - valor)}."
        )
    return ToolResult(texto, result_id=row["id"] if row else None)


async def verificar_limite_disponivel(
    workspace_id: UUID | str,
    user_id: UUID | str,
    account_id: UUID | str | None,
    valor_total_centavos: int,
) -> dict:
    """Verifica se a compra excede o limite disponível do cartão (Soft Warning).

    Quem calcula é `public._card_summary`, a MESMA RPC que `query_invoice` usa —
    não uma soma aqui. Antes havia um `select sum(amount_cents)` próprio, e ele
    errava de duas formas que ninguém via na tela:

    * contava a fatura ADIADA (`status <> 'paid'` inclui `'rolled'`) junto com o
      principal que já migrou para a fatura seguinte — o mesmo dinheiro duas
      vezes, exatamente o erro que a 20260911040000 corrigiu nas 9 funções do
      SQL e não alcançou aqui;
    * somava `amount_cents` cru, ignorando `paid_cents`: quem pagou R$ 800 da
      fatura continuava com os R$ 800 comendo o limite.

    `available_limit_cents` sai de `invoice_open_cents` sobre faturas
    `not in ('paid','rolled')` e acerta os dois.

    O escopo vem da cadeia, não desta query: `account_id` já foi resolvido por
    `resolve_account(workspace_id, ...)`, que filtra pelo workspace da conversa.
    """
    vazio = {
        "excedeu": False,
        "limite_centavos": None,
        "disponivel_centavos": None,
        "card_name": "",
        "account_id": str(account_id) if account_id else None,
    }
    if not account_id:
        return vazio

    # `_card_summary` só devolve cartão de crédito ativo: conta corrente, conta
    # arquivada e cartão sem limite simplesmente não aparecem, e aí não há aviso
    # a dar — que é o comportamento antigo, sem o `if` de tipo.
    linha = await db.fetch_one(
        """
        select name, credit_limit_cents, available_limit_cents
        from public._card_summary(%s)
        where account_id = %s
        """,
        user_id,
        account_id,
    )
    if not linha or not linha.get("credit_limit_cents"):
        return vazio

    limite = int(linha["credit_limit_cents"])
    if limite <= 0:
        return {**vazio, "limite_centavos": limite, "card_name": linha.get("name") or ""}

    disponivel = int(linha["available_limit_cents"] or 0)
    return {
        "excedeu": valor_total_centavos > disponivel,
        "limite_centavos": limite,
        "disponivel_centavos": disponivel,
        "card_name": linha.get("name") or "Cartão",
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
    if (ctx.target or {}).get("table") == "card_invoices":
        return await _quitar_fatura(ctx)
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


async def _quitar_fatura(ctx: ExecContext) -> ToolResult:
    """Fatura paga FORA do app: marca como paga sem criar a transferência.

    É o `settle_invoice` da `0046`, o mesmo que o botão "Quitar sem caixa" da tela.
    Pagamento de verdade continua sendo `pay_invoice` — aqui o dinheiro não sai do
    caixa de propósito, e inventar a transferência quebraria o saldo da conta
    pagadora que já refletiu a saída na vida real.

    A RPC é `security invoker` e daqui a RLS não vale (o serviço ignora RLS), então
    o `ensure_owned` do registry é o que segura o escopo — a mesma regra do resto.
    """
    cands = (ctx.target or {}).get("candidates") or []
    if not cands:
        return ToolResult("🤷 Não achei essa fatura em aberto.", read_only=True)

    # Traz o STATUS em vez de filtrar por ele: "paga" e "adiada" são situações
    # diferentes e a resposta precisa dizer qual das duas. Filtrando, as duas
    # viravam a mesma frase — e "já está quitada" para uma fatura que ninguém
    # pagou é a mentira que o rotativo introduziu aqui.
    # A janela entre resolver o alvo e executar é real: o cron adia sozinho de
    # hora em hora.
    fatura = await db.fetch_one(
        """
        select ci.id, ci.due_date, ci.status, a.name as card_name,
               destino.due_date as destino_due,
               private.invoice_open_cents(ci.id) as aberto
        from public.card_invoices ci
        join public.accounts a on a.id = ci.account_id and a.workspace_id = ci.workspace_id
        left join public.card_invoices destino on destino.id = ci.rolled_into_invoice_id
        where ci.id = %s and ci.workspace_id = %s
        """,
        cands[0]["id"], ctx.workspace_id,
    )
    if not fatura:
        return ToolResult("🤷 Não achei essa fatura em aberto.", read_only=True)
    if fatura["status"] == "rolled":
        destino = (
            f" O saldo dela entrou na fatura de {format_date_br(fatura['destino_due'])}."
            if fatura.get("destino_due")
            else ""
        )
        return ToolResult(
            f"🤷 Essa fatura do *{fatura['card_name']}* (vencimento "
            f"{format_date_br(fatura['due_date'])}) foi adiada, não paga.{destino} "
            f"Quitar aqui não mudaria nada.",
            read_only=True,
        )
    if fatura["status"] == "paid":
        return ToolResult("✅ Essa fatura já está quitada.", read_only=True)


    await db.execute("select public.settle_invoice(%s, %s)",
                     fatura["id"], local_iso_date(ctx.timezone))
    return ToolResult(
        f"✅ Fatura do *{fatura['card_name']}* (vencimento {format_date_br(fatura['due_date'])}) "
        f"marcada como paga — {cents_to_brl(int(fatura['aberto'] or 0))} quitados sem sair do caixa.",
        result_id=str(fatura["id"]),
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

    # Update NUNCA dá baixa: o desvio para `_baixa_em_parcelas` que morava aqui fazia uma
    # correção ("muda a 3ª parcela") marcar parcelas como pagas.
    alvo_id = cands[0]["id"]
    parcela_do_snapshot = False
    # D1: parcelar o lançamento. Candidato com `plan_installments` já é parcela de um
    # plano (installments igual ao N é só pista) e segue a correção comum.
    if (not _alvo_e_plano(ctx) and (action.installments or 0) >= 2
            and not cands[0].get("plan_installments")):
        return await _parcelar(ctx, action)
    if _alvo_e_plano(ctx):
        snapshot = cands[0].get("installment_snapshot")
        if not snapshot:
            return await _corrigir_plano(ctx, action)
        linhas = snapshot.get("rows") or []
        if len(linhas) != 1:
            return ToolResult(VARIAS_PARCELAS, read_only=True)
        # O id congelado no snapshot é o que a pessoa leu no SIM; buscar de novo aqui
        # abriria a janela entre a pergunta e a execução.
        alvo_id = linhas[0]["id"]
        parcela_do_snapshot = True

    patch: dict = {}
    if action.new_amount_cents is not None:
        patch["amount_cents"] = guards.require_amount(action.new_amount_cents, o_que="o valor novo")
    if action.new_category:
        patch["category"] = guards.clean_category(action.new_category)
    if action.new_occurred_at:
        patch["occurred_at"] = guards.require_date(action.new_occurred_at, ctx.timezone, default_hoje=False)
    if action.new_description:
        patch["description"] = guards.require_text(action.new_description, o_que="a descrição nova", maximo=200)
    frozen_account = None
    if action.new_account:
        frozen_account = (ctx.target or {}).get("new_account")
        if not frozen_account or "id" not in frozen_account:
            raise Level1Error("A conta corrigida não foi confirmada. Peça a correção novamente.")
        patch["account_id"] = frozen_account["id"]
    if not patch:
        raise Level1Error(
            "❌ Não entendi o que mudar. Tenta \"muda o último pra 54\", "
            "\"o mercado de ontem era transporte\" ou \"renomeia pra Mercado do Zé\"."
        )

    # O alvo já veio resolvido e CONGELADO pela Fase Cognitiva; o registry barrou
    # antes de chegar aqui se não estivesse `found`. Buscar de novo aqui abriria a
    # janela que este desenho existe para fechar: entre a pergunta e o SIM o
    # usuário pode ter lançado outra coisa, e o "último" mudaria de dono.
    antes = await db.fetch_one(
        """
        select id, kind, amount_cents, category, description, occurred_at, installment_no,
               (select p.installments from public.installment_plans p
                 where p.id = t.installment_plan_id and p.workspace_id = t.workspace_id
               ) as plan_installments
        from public.transactions t where id = %s and workspace_id = %s
        """,
        alvo_id, ctx.workspace_id,
    )
    if not antes:
        return ToolResult("🤷 Esse lançamento não está mais aqui.", read_only=True)
    if "description" in patch and antes.get("installment_no") and antes.get("plan_installments"):
        # ponytail: terceira cópia do formato "(k/N)" (ver `_SUFIXO_DA_PARCELA`);
        # `test_o_sufixo_da_parcela_e_o_mesmo_da_rpc` prende as três
        patch["description"] += f" ({antes['installment_no']}/{antes['plan_installments']})"
    colunas = ", ".join(f"{c} = %s" for c in patch)
    args = [*patch.values(), antes["id"], ctx.workspace_id]
    account_guard = ""
    if frozen_account and frozen_account["id"] is not None:
        account_guard = " and exists (select 1 from public.accounts a where a.id = %s and a.workspace_id = %s and not a.archived)"
        args.extend([frozen_account["id"], ctx.workspace_id])
    # Parcela travada não se move (valor, data, conta) — a régua do banco, a mesma de
    # `update_installment_plan`. Mexer nela deixa a fatura paga/parcial sem fechar.
    trava = ""
    if parcela_do_snapshot and patch.keys() & {"amount_cents", "occurred_at", "account_id"}:
        trava = " and not private.parcela_travada(status, invoice_id)"
    # Linha de compra parcelada: o total do plano acompanha, na MESMA operação (a
    # soma é "as outras linhas + o valor novo", porque um CTE não enxerga o update do
    # irmão). Sem isto a tela mostrava um total que não é a soma do que está embaixo.
    # A data da parcela 1 É a `first_occurred_at` do plano: mudar só a linha fazia o
    # próximo "Editar a compra" (a RPC recalcula as datas dela) devolvê-la à velha.
    # Não é `update_transaction_scoped(..., 'one', ...)`, que também recalcula: ela
    # copia nome/categoria da PARCELA para o PLANO e não aceita data.
    do_plano = []
    if "amount_cents" in patch:
        do_plano.append("""total_cents = u.amount_cents + coalesce((select sum(t.amount_cents)
                     from public.transactions t
                     where t.installment_plan_id = p.id and t.workspace_id = p.workspace_id
                       and t.id <> u.id), 0)""")
    if "occurred_at" in patch:
        do_plano.append("first_occurred_at = case when u.installment_no = 1 then u.occurred_at "
                        "else p.first_occurred_at end")
    plano_cte = (f""", plano as (
            update public.installment_plans p
               set {", ".join(do_plano)}, updated_at = now()
            from u where p.id = u.installment_plan_id and p.workspace_id = u.workspace_id
        )""" if do_plano else "")
    updated = await db.fetch_one(
        f"""
        with u as (
            update public.transactions set {colunas}
            where id = %s and workspace_id = %s{trava}{account_guard}
            returning id, amount_cents, occurred_at, installment_no, installment_plan_id,
                      workspace_id
        ){plano_cte}
        select id from u
        """,
        *args,
    )
    if not updated and trava:
        return ToolResult(PARCELA_TRAVADA, read_only=True)
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
    if "description" in patch:
        mudancas.append(f"nome → *{patch['description']}*")
    return ToolResult(
        f"✏️ Corrigido ({describe(antes)}): {', '.join(mudancas)}.", result_id=antes["id"]
    )


async def _corrigir_plano(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    """A COMPRA inteira. Com VALOR (total ou por parcela, e nome/categoria junto) vai
    pela RPC do "Editar a compra" do app, `update_installment_plan`, com o MESMO número
    de parcelas e a data REAL da parcela 1. Só nome/categoria vai por `_renomear_plano`
    (sem parcela travada a RPC reescreveria valor, data e conta de todas as linhas) — e
    só com candidato do gate novo (`editaveis`): a frase de antes prometia outra coisa.

    Por que não `update_transaction_scoped`: ela mexe em parcela `pending` de fatura
    paga EM PARTE, e a frase do SIM promete que as pagas ficam como estão. Quem decide
    o que está travado e redistribui o saldo é a RPC, pela mesma régua.

    A unidade (D2) foi escolhida no `gate` e está congelada no alvo (`amount_unit`).
    Sem ela — checkpoint ou pendência de antes do deploy — NÃO há default: "parcela"
    num total de R$ 2.400 em 10x vira R$ 24.000.

    ⚠️ A RPC SOBRESCREVE com nulo (description, category, merchant, account): os 8
    argumentos vão sempre, com o que está no plano AGORA, trocando só o que a pessoa
    pediu. A releitura com `workspace_id` é a checagem de dono: a RPC é `security
    invoker` e acha o plano só pelo id, e o agente conecta com papel que ignora RLS.
    """
    # segunda trava: o `gate` já recusa isto antes do SIM (`policy.erro_de_correcao`)
    if action.new_occurred_at:
        raise Level1Error(DATA_DO_PLANO)
    if action.new_account:
        raise Level1Error(CONTA_DO_PLANO)
    unidade = (ctx.target or {}).get("amount_unit")
    if action.new_amount_cents is not None and unidade not in ("total", "parcela"):
        return ToolResult(
            "Não sei se o valor era o total da compra ou cada parcela. Ainda não mudei nada; "
            "me pede a correção de novo.",
            read_only=True,
        )
    if action.new_amount_cents is None and not (action.new_description or action.new_category):
        raise Level1Error(
            "❌ Numa compra parcelada dá para corrigir valor, categoria ou nome. "
            "Tenta \"muda o notebook para 300 por parcela\"."
        )

    cands = (ctx.target or {}).get("candidates") or []
    if action.new_amount_cents is None:
        if cands[0].get("editaveis") is None:
            # pendência de antes do deploy: a frase que ela mostrou prometia "só as
            # parcelas em aberto", e renomear muda TODAS — o SIM não cobre isso
            return ToolResult("Ainda não mudei nada. Me pede a correção de novo.", read_only=True)
        return await _renomear_plano(ctx, action, cands[0])
    plano = await db.fetch_one(
        f"""
        select p.id, p.total_cents, p.installments, p.first_occurred_at, p.description,
               p.category, p.merchant, p.account_id, x.editaveis, x.travado_cents,
               -- a data REAL da parcela 1 (editada à mão ou não): sem parcela travada a
               -- RPC recalcula TODAS as datas a partir desta. Com parcela travada a RPC
               -- exige a do plano (e não mexe em data nenhuma), daí o `case`.
               case when x.travado_cents = 0 then (
                 select t1.occurred_at from public.transactions t1
                 where t1.installment_plan_id = p.id and t1.workspace_id = p.workspace_id
                   and t1.installment_no = 1) end as primeira
        from public.installment_plans p
        {TRAVAS_DO_PLANO}
        where p.id = %s and p.workspace_id = %s
        """,
        cands[0]["id"], ctx.workspace_id,
    )
    if not plano:
        return ToolResult("🤷 Essa compra parcelada não está mais aqui.", read_only=True)

    valor = guards.require_amount(action.new_amount_cents, o_que="o valor novo")
    if unidade == "total":
        total = valor
    else:
        # lido AGORA, não do que a frase do SIM congelou: entre a pergunta e o SIM
        # uma fatura pode ter sido paga
        editaveis = int(plano["editaveis"] or 0)
        if editaveis == 0:
            return ToolResult(NADA_EDITAVEL, read_only=True)
        total = int(plano["travado_cents"] or 0) + valor * editaveis
    descricao = (guards.require_text(action.new_description, o_que="a descrição nova", maximo=200)
                 if action.new_description else plano["description"])
    categoria = guards.clean_category(action.new_category) if action.new_category else plano["category"]
    try:
        await db.fetch_one(
            "select public.update_installment_plan(%s, %s, %s, %s, %s, %s, %s, %s) as mexidas",
            plano["id"], total, plano["installments"],
            plano.get("primeira") or plano["first_occurred_at"],
            descricao, categoria, plano["merchant"], plano["account_id"],
        )
    except psycopg.errors.RaiseException as err:
        # Só P0001 (o `raise exception` da RPC, escrito para a pessoa). Aqui e não no
        # registry: nem toda RPC do repo escreve a recusa em português de usuário.
        motivo = (err.diag.message_primary or str(err)).strip().rstrip(".")
        raise Level1Error(f"❌ {motivo}. Ainda não mudei nada.") from err

    nome = descricao or plano["merchant"] or "a compra"
    texto = (f"✏️ Corrigi *{nome}*: total {cents_to_brl(int(plano['total_cents']))} → "
             f"{cents_to_brl(total)} em {plano['installments']}x — as já pagas ficaram como estavam")
    outras = _nome_e_categoria(action, descricao, categoria)
    if outras:
        texto += f"; {outras} em todas as parcelas"
    return ToolResult(texto + ".", result_id=str(plano["id"]))


async def _parcelar(ctx: ExecContext, action: FinanceAction) -> ToolResult:
    """D1 — o lançamento avulso vira a parcela 1 de uma compra parcelada, pela MESMA
    RPC do botão "Parcelar" do app (`convert_transaction_to_installments`). O id não
    muda, e chamar de novo é recusa da RPC, nunca um segundo plano.

    ⚠️ A RPC SOBRESCREVE com nulo: description, category e merchant vão com o que está
    na linha AGORA, trocando só o que a pessoa pediu — omitir virava "Compra parcelada
    (1/2)" sem categoria. A releitura com `workspace_id` é a checagem de dono (a RPC é
    `security invoker` e acha a linha só pelo id; o agente ignora RLS). As parcelas
    2..N nascem `source='app'` na RPC.
    """
    cartao = (ctx.target or {}).get("convert_account") or {}
    if not cartao.get("id"):
        # segunda trava: o resolvedor já pergunta o cartão antes do SIM
        return ToolResult(CARTAO_FALTANDO, read_only=True)
    linha = await db.fetch_one(
        """
        select id, amount_cents, occurred_at, description, category, merchant
        from public.transactions where id = %s and workspace_id = %s
        """,
        ctx.target["candidates"][0]["id"], ctx.workspace_id,
    )
    if not linha:
        return ToolResult(LINHA_SUMIU, read_only=True)
    congelado = ctx.target["candidates"][0].get("amount_cents")
    if (action.new_amount_cents is None and congelado is not None
            and int(linha["amount_cents"]) != int(congelado)):
        # a frase do SIM disse o valor congelado; o da linha agora é outro
        return ToolResult(
            f"O valor desse lançamento mudou desde a confirmação ({cents_to_brl(int(congelado))} → "
            f"{cents_to_brl(int(linha['amount_cents']))}). Ainda não mudei nada; me pede de novo.",
            read_only=True,
        )
    total = (guards.require_amount(action.new_amount_cents, o_que="o valor novo")
             if action.new_amount_cents is not None else linha["amount_cents"])
    primeira = (guards.require_date(action.new_occurred_at, ctx.timezone, default_hoje=False)
                if action.new_occurred_at else str(linha["occurred_at"]))
    descricao = (guards.require_text(action.new_description, o_que="a descrição nova", maximo=200)
                 if action.new_description else linha["description"])
    categoria = guards.clean_category(action.new_category) if action.new_category else linha["category"]
    try:
        await db.fetch_one(
            "select public.convert_transaction_to_installments(%s, %s, %s, %s, %s, %s, %s, %s) as plano",
            linha["id"], total, action.installments, primeira,
            descricao, categoria, linha["merchant"], cartao["id"],
        )
    except psycopg.errors.RaiseException as err:
        # P0001: a recusa da RPC já está escrita para a pessoa (mesmo padrão de _corrigir_plano)
        motivo = (err.diag.message_primary or str(err)).strip().rstrip(".")
        raise Level1Error(f"❌ {motivo}. Ainda não mudei nada.") from err
    nome = descricao or linha["merchant"] or "o lançamento"
    return ToolResult(
        f"✂️ Parcelei *{nome}*: {cents_to_brl(total)} em {action.installments}x no cartão "
        f"*{cartao['name']}*, 1ª parcela em {format_date_br(primeira)}.",
        result_id=linha["id"],
    )


def _nome_e_categoria(action: FinanceAction, descricao, categoria) -> str:
    partes = []
    if action.new_description:
        partes.append(f"nome → *{descricao}*")
    if action.new_category:
        partes.append(f"categoria → *{categoria}*")
    return ", ".join(partes)


# ponytail: segunda cópia do formato "(k/N)" da descrição da parcela — a primeira é o
# ramo `else` de `update_installment_plan` (20260920120000). A RPC não tem modo "só
# nome": sem parcela travada ela reescreve valor, data e conta de todas as linhas.
# `test_o_sufixo_da_parcela_e_o_mesmo_da_rpc` prende as duas; mudou lá, muda aqui.
_SUFIXO_DA_PARCELA = "|| ' (' || t.installment_no || '/' || p.installments || ')'"


async def _renomear_plano(ctx: ExecContext, action: FinanceAction, cand: dict) -> ToolResult:
    """Nome e categoria da compra inteira — no plano e em TODAS as linhas, inclusive as
    pagas (Reparcelar, finance.md: nome e categoria são da COMPRA). Dinheiro, data e
    conta não são tocados. Um statement só: o plano e as linhas mudam juntos ou nada."""
    descricao = (guards.require_text(action.new_description, o_que="a descrição nova", maximo=200)
                 if action.new_description else None)
    categoria = guards.clean_category(action.new_category) if action.new_category else None
    row = await db.fetch_one(
        f"""
        with p as (
            update public.installment_plans p
               set description = coalesce(%s, p.description),
                   category = coalesce(%s, p.category),
                   updated_at = now()
            where p.id = %s and p.workspace_id = %s
            returning p.id, p.workspace_id, p.description, p.merchant, p.category, p.installments
        ), linhas as (
            update public.transactions t
               set description = coalesce(p.description, p.merchant, 'Compra parcelada')
                                 {_SUFIXO_DA_PARCELA},
                   merchant = p.merchant,
                   category = p.category
            from p
            where t.installment_plan_id = p.id and t.workspace_id = p.workspace_id
              and t.installment_no is not null
            returning t.id
        )
        select p.id, p.description, p.merchant, (select count(*) from linhas) as linhas from p
        """,
        descricao, categoria, cand["id"], ctx.workspace_id,
    )
    if not row:
        return ToolResult("🤷 Essa compra parcelada não está mais aqui.", read_only=True)
    nome = row.get("description") or row.get("merchant") or cand.get("label") or "a compra"
    return ToolResult(
        f"✏️ Corrigi *{nome}*: {_nome_e_categoria(action, descricao, categoria)} "
        "em todas as parcelas.",
        result_id=str(row["id"]),
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
