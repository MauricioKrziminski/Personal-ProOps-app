"""Resolução do ALVO de uma mutação — a "Fase Cognitiva".

Roda ANTES do gate, e é o que permite a pergunta citar a linha real ("apagar o
gasto de R$ 45 em mercado, de 30/08") em vez do eco do modelo ("apagar a nota
sobre última mensagem"). Também é o que congela o id: o que volta do checkpoint
depois do SIM é o MESMO registro que o usuário leu, mesmo que ele tenha lançado
outra coisa no meio.

Substitui seis buscas `ilike ... limit 2` duplicadas inline em `finance.py` e
`notes.py`. Nenhuma tool importa este módulo — elas só leem `ctx.target` —, então
a direção é sempre `resolve -> tools`, sem ciclo.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

from app import db
from app.domain import matching
from app.domain.reference import clean_term, wants_latest, wants_whole_plan
from app.tools import finance
from app.graph.schemas import (
    FinanceAction,
    FinanceActionType,
    NotesActionType,
)

Status = Literal["found", "ambiguous", "none"]

# A janela de transações mora em `finance.reference_window` — era duplicada aqui como
# `REFERENCE_WINDOW = 40` e as duas cópias tinham o mesmo defeito de ordenação.
# Quantos candidatos mostrar num empate. 9 porque a Lista Interativa da Meta
# cabe 10 linhas e a última é sempre "Nenhuma dessas". Com 3 (o valor
# anterior) as faixas de 3-10 e >10 do formato híbrido eram inalcançáveis.
MOSTRAR = 9

# Que ação mira um registro que JÁ EXISTE -> qual fonte resolve o alvo dela.
TARGETS: dict[Any, str] = {
    FinanceActionType.UPDATE_TRANSACTION: "transactions",
    FinanceActionType.DELETE_TRANSACTION: "transactions",
    FinanceActionType.UNDO_LAST: "transactions",
    FinanceActionType.MARK_PAID: "pendentes",
    FinanceActionType.GOAL_DEPOSIT: "goals",
    FinanceActionType.UPDATE_ASSET_VALUE: "assets",
    NotesActionType.APPEND_NOTE: "notes",
    NotesActionType.DELETE_NOTE: "notes",
    NotesActionType.DELETE_REMINDER: "reminders",
}


def _primeira_linha(row: dict) -> str:
    texto = (row.get("content") or "").strip().splitlines()
    return texto[0][:80] if texto else "(vazia)"


def _rotulo_tx(row: dict) -> str:
    from app.tools.finance import describe

    return describe(row)


def _detalhe_tx(row: dict) -> str:
    """A data do lançamento — o que separa uma linha da outra numa lista.

    Sem isto, desambiguar era impossível de propósito nenhum: em 09/09/2026 a
    pergunta "apagar qual?" mostrou QUATRO linhas escritas
    `receita de R$ 4.000,00 em *salário* (Salário PJ)`, idênticas letra por
    letra, e três `gasto de R$ 88,85 em *contas* (DAS)`. Escolher entre opções
    iguais não é escolher — e é o que uma série recorrente sempre produz, já que
    o que muda entre as ocorrências é só a data.

    Vale também para o classificador semântico: `escolher_candidato` monta a
    lista que vai ao modelo com este mesmo campo, então "o de outubro" só passa
    a ser respondível depois que a data existe.
    """
    from app.domain.dates import format_date_br

    return format_date_br(row["occurred_at"]) if row.get("occurred_at") else ""


def _rotulo_fatura(row: dict) -> str:
    from app.domain.dates import format_date_br

    return f"Fatura {row['card_name']} — vence {format_date_br(row['due_date'])}"


def _detalhe_fatura(row: dict) -> str:
    from app.domain.money import cents_to_brl

    return f"{cents_to_brl(int(row.get('aberto') or 0))} em aberto"


def _rotulo_plano(row: dict) -> str:
    """O ESCOPO vem primeiro, e é isso que importa.

    Vira título de botão (20) ou de linha (24), e `_cut` corta no FIM. Com o nome
    na frente, "Televisão da sala — tudo (10x)" viraria "Televisão da sala — tud…"
    e perderia exatamente o que distingue a compra inteira de uma parcela solta —
    as duas apareceriam na MESMA pergunta com rótulos quase idênticos.
    """
    nome = (row.get("description") or "compra parcelada").strip()
    return f"Tudo ({row['installments']}x) — {nome}"


def _detalhe_plano(row: dict) -> str:
    """O que não cabe no título vai para a descrição da linha (72)."""
    from app.domain.dates import format_date_br
    from app.domain.money import cents_to_brl

    desde = format_date_br(row.get("first_occurred_at")) if row.get("first_occurred_at") else ""
    return f"{cents_to_brl(row['total_cents'])} total" + (f" · desde {desde}" if desde else "")


# chave lógica -> tabela REAL + SQL + rotulador.
#
# ⚠️ `table` é a tabela DE VERDADE, não a chave lógica: ela vai para o
# `ensure_owned`, cuja allowlist não conhece "pendentes".
_FONTES: dict[str, dict] = {
    "notes": {
        "table": "notes",
        "sql": """select id, content from public.notes
                  where workspace_id = %s and deleted_at is null and content ilike %s
                  order by updated_at desc limit %s""",
        "label": _primeira_linha,
    },
    "reminders": {
        "table": "reminders",
        "sql": """select id, title from public.reminders
                  where workspace_id = %s and title ilike %s
                  order by created_at desc limit %s""",
        "label": lambda r: r["title"],
    },
    "goals": {
        "table": "goals",
        "sql": """select id, name from public.goals
                  where workspace_id = %s and name ilike %s
                  order by created_at desc limit %s""",
        "label": lambda r: r["name"],
    },
    "assets": {
        "table": "assets",
        "sql": """select id, name from public.assets
                  where workspace_id = %s and name ilike %s
                  order by created_at desc limit %s""",
        "label": lambda r: r["name"],
    },
    "planos": {
        "table": "installment_plans",
        "sql": """select id, description, total_cents, installments, first_occurred_at
                  from public.installment_plans
                  where workspace_id = %s and coalesce(description,'') ilike %s
                  order by created_at desc limit %s""",
        "label": _rotulo_plano,
        "detalhe": _detalhe_plano,
    },
    "faturas": {
        "table": "card_invoices",
        "sql": """select ci.id, ci.due_date, ci.reference_month, a.name as card_name,
                         private.invoice_open_cents(ci.id) as aberto
                  from public.card_invoices ci
                  join public.accounts a
                    on a.id = ci.account_id and a.workspace_id = ci.workspace_id
                  where ci.workspace_id = %s and ci.status <> 'paid' and a.name ilike %s
                  order by ci.due_date limit %s""",
        "label": _rotulo_fatura,
        "detalhe": _detalhe_fatura,
    },
    "pendentes": {
        "table": "transactions",
        "sql": """select id, kind, amount_cents, category, description, occurred_at
                  from public.transactions
                  where workspace_id = %s and status = 'pending'
                    and (coalesce(description,'') ilike %s or coalesce(category,'') ilike %s)
                  order by coalesce(due_at, occurred_at) limit %s""",
        "label": _rotulo_tx,
        "detalhe": _detalhe_tx,
        "dois_termos": True,
    },
}


def veredito(
    linhas: list[dict],
    rotulo: Callable[[dict], str],
    tabela: str,
    detalhe: Callable[[dict], str] | None = None,
) -> tuple[Status, list[dict]]:
    """0 -> none, 1 -> found, N -> ambiguous. Empate NUNCA vira escolha nossa.

    Cada candidato carrega a própria `table`. Antes a tabela era só do alvo, uma
    só para a lista inteira — e é isso que permite a mesma pergunta misturar "a
    compra inteira" (um plano) com "a parcela 3/10" (uma transação).
    """
    cands = [
        {
            "id": str(r["id"]),
            "label": rotulo(r),
            "table": tabela,
            **({"when": detalhe(r)} if detalhe else {}),
            **({"plan_installments":r["installments"]} if tabela=="installment_plans" else {}),
        }
        for r in linhas[:MOSTRAR]
    ]
    if not cands:
        return "none", []
    if len(cands) == 1:
        return "found", cands
    return "ambiguous", cands


async def por_texto(fonte: str, workspace_id, termo: str) -> tuple[Status, list[dict]]:
    cfg = _FONTES[fonte]
    like = f"%{termo}%"
    args = (workspace_id, like, like, MOSTRAR) if cfg.get("dois_termos") else (
        workspace_id, like, MOSTRAR
    )
    linhas = await db.fetch(cfg["sql"], *args)
    return veredito(linhas, cfg["label"], cfg["table"], cfg.get("detalhe"))


async def por_transacao(
    workspace_id, action: FinanceAction, quer_recente: bool
) -> tuple[Status, list[dict]]:
    """Janela dos 40 mais recentes, filtrada pelos campos de BUSCA da ação.

    Diferença central em relação à versão anterior: **sem nenhum filtro e sem
    pedido explícito de recência, isto devolve `ambiguous`**, não a transação
    mais recente. Antes elegia a última em silêncio — foi assim que "apaga
    aquilo" virava um DELETE sem o usuário ter dito o quê.
    """
    linhas = await finance.reference_window(workspace_id, action)
    if not linhas:
        return "none", []

    filtrou = False
    if action.amount_cents:
        linhas = [t for t in linhas if t["amount_cents"] == action.amount_cents]
        filtrou = True
    if action.category:
        alvo = action.category.lower()
        linhas = [t for t in linhas if (t["category"] or "").lower() == alvo]
        filtrou = True
    termo = clean_term(action.description)
    if termo:
        t_low = termo.lower().strip()
        por_texto_ = [
            t for t in linhas
            if t_low in (t["description"] or "").lower()
            or t_low in (t["category"] or "").lower()
        ]
        # termo que não casa não pode zerar uma busca que já achou por valor
        if por_texto_:
            linhas, filtrou = por_texto_, True
    if action.occurred_at:
        por_data = [t for t in linhas if str(t["occurred_at"]) == action.occurred_at]
        if por_data:
            linhas, filtrou = por_data, True

    if not linhas:
        return "none", []
    if not filtrou and not quer_recente:
        # Sem pista E sem pedido de recência: NÃO é "o último", é vago.
        return veredito(linhas[:MOSTRAR], _rotulo_tx, "transactions", _detalhe_tx)
    if not filtrou:
        return veredito(linhas[:1], _rotulo_tx, "transactions", _detalhe_tx)
    return veredito(linhas, _rotulo_tx, "transactions", _detalhe_tx)


# Ações em que "a compra inteira" é uma resposta possível.
_ACEITA_PLANO = {
    FinanceActionType.DELETE_TRANSACTION,
    FinanceActionType.UPDATE_TRANSACTION,
    FinanceActionType.MARK_PAID,
}


async def _com_plano(workspace_id, candidatos: list[dict]) -> list[dict]:
    """Agrupa transações de compras parceladas em seus respectivos planos.

    Substitui as parcelas individuais pelo Plano de Parcelamento correspondente.
    Se o termo de busca casar com parcelas de um ou mais planos, não lista as
    parcelas soltas no menu do WhatsApp — agrupa no plano.
    """
    if not candidatos:
        return candidatos

    tx_ids = [c["id"] for c in candidatos if c.get("table", "transactions") == "transactions"]
    if not tx_ids:
        return candidatos

    rows = await db.fetch(
        """
        select t.id as tx_id, p.id as plan_id, p.description, p.total_cents, p.installments, p.first_occurred_at
        from public.transactions t
        join public.installment_plans p on p.id = t.installment_plan_id
        where t.id = any(%s) and t.workspace_id = %s and p.workspace_id = %s
        order by p.created_at desc
        """,
        tx_ids,
        workspace_id,
        workspace_id,
    )
    if not rows:
        return candidatos

    planos_unicos: dict[str, dict] = {}
    txs_em_planos = set()
    for r in rows:
        p_id = str(r["plan_id"])
        txs_em_planos.add(str(r["tx_id"]))
        if p_id not in planos_unicos:
            planos_unicos[p_id] = {
                "id": p_id,
                "label": _rotulo_plano(r),
                "table": "installment_plans",
                "when": _detalhe_plano(r),
            }

    plan_cands = list(planos_unicos.values())
    outras_txs = [c for c in candidatos if str(c["id"]) not in txs_em_planos]

    return [*plan_cands, *outras_txs][:MOSTRAR]


async def _bounded_plan_target(workspace_id, candidates, scope):
    from app.domain.installment_scope import select_rows
    from app.domain.money import cents_to_brl
    from app.domain.dates import format_date_br

    result = []
    for candidate in candidates:
        rows = await db.fetch(
            "select t.id, t.installment_no, t.amount_cents, t.occurred_at, t.status, t.paid_at, t.account_id, t.invoice_id, a.name as account_name "
            "from public.transactions t left join public.accounts a on a.id=t.account_id and a.workspace_id=t.workspace_id "
            "where t.installment_plan_id = %s and t.workspace_id = %s order by t.installment_no",
            candidate["id"],
            workspace_id,
        )
        try:
            selected = select_rows(
                rows, scope, total_installments=candidate.get("plan_installments")
            )
        except (ValueError, TypeError) as error:
            return {
                "table": "installment_plans",
                "status": "none",
                "candidates": [],
                "correction_error": str(error),
            }
        frozen = [
            {
                key: (
                    str(row[key])
                    if key
                    in {"id", "occurred_at", "paid_at", "account_id", "invoice_id"}
                    and row.get(key) is not None
                    else row.get(key)
                )
                for key in (
                    "id",
                    "installment_no",
                    "amount_cents",
                    "occurred_at",
                    "status",
                    "paid_at",
                    "account_id",
                    "invoice_id",
                )
            }
            for row in selected
        ]
        accounts = ", ".join(
            sorted(
                {
                    r.get("account_name")
                    or ("Conta vinculada" if r.get("account_id") else "Sem conta")
                    for r in selected
                }
            )
        )
        first, last = frozen[0], frozen[-1]
        total = sum(r["amount_cents"] for r in frozen)
        name = candidate["label"].split(" — ", 1)[-1]
        span = f"{first['installment_no']}–{last['installment_no']}"
        result.append(
            {
                **candidate,
                "label": f"{len(frozen)} parcelas ({span}) — {name}",
                "when": f"{cents_to_brl(total)} · {format_date_br(first['occurred_at'])} a {format_date_br(last['occurred_at'])} · {accounts}",
                "installment_snapshot": {
                    "version": 2,
                    "scope": scope.model_dump(),
                    "rows": frozen,
                    "total_cents": total,
                },
            }
        )
    return {
        "table": "installment_plans",
        "status": "found" if len(result) == 1 else ("ambiguous" if result else "none"),
        "candidates": result,
    }


async def _antecedente_da_conversa(workspace_id, tx_id: str | None) -> list[dict] | None:
    """O lançamento que ESTA conversa acabou de escrever, se ele ainda existe.

    É o que um demonstrativo significa. "Apague esse lançamento" logo depois de
    "gastei 20 no café" aponta para o café — não para "algum dos 40 mais
    recentes do workspace", que é coisa diferente e inclui o que o cron
    materializou às 3 da manhã. Em 09/09/2026 a pergunta que isto evita listou
    quatro salários iguais gerados pelo agendador.

    **A existência é reconferida sempre.** O id também é gravado quando a ação
    foi um DELETE, e aí a linha não está mais lá: devolver None manda o fluxo
    para a pergunta, que é o certo — depois de apagar, não há mais "esse".
    """
    if not tx_id:
        return None
    row = await db.fetch_one(
        """
        select id, kind, amount_cents, category, description, occurred_at
        from public.transactions where id = %s and workspace_id = %s
        """,
        tx_id,
        workspace_id,
    )
    if not row:
        return None
    _, cands = veredito([row], _rotulo_tx, "transactions", _detalhe_tx)
    return cands


async def for_actions(
    workspace_id, acoes: list, texto_cru: str, antecedente: str | None = None
) -> list[dict]:
    """Um alvo por ação, alinhado POR POSIÇÃO com a lista de ações.

    A posição é a mesma que `ctx.action_index` já usa para idempotência — não há
    segundo esquema de correspondência para divergir.
    """
    from app.domain.installment_scope import scope_from_text

    payment_actions = [
        a
        for a in acoes
        if getattr(a, "type", None)
        in {FinanceActionType.MARK_PAID, FinanceActionType.UPDATE_TRANSACTION}
    ]
    if len(payment_actions) > 1 and (
        scope_from_text(texto_cru) is not None
        or any(a.installment_scope for a in payment_actions)
    ):
        return [
            {
                "status": "none",
                "candidates": [],
                "correction_error": "Para preservar cada intervalo, peça a baixa de uma compra por mensagem.",
            }
            if a in payment_actions
            else {}
            for a in acoes
        ]
    saida: list[dict] = []
    for acao in acoes:
        fonte = TARGETS.get(getattr(acao, "type", None))
        if fonte is None:
            saida.append({})
            continue

        # `target_ref` é onde o nome da meta/bem vem em FinanceAction (ela não
        # tem search_term nem content). Sem ele, goal_deposit e update_asset_value
        # resolviam com termo vazio — ou seja, listavam TODAS as metas em vez de
        # achar "viagem".
        bruto = (
            getattr(acao, "search_term", None)
            or getattr(acao, "content", None)
            or getattr(acao, "target_ref", None)
            or getattr(acao, "description", None)
        )
        termo = clean_term(bruto)
        # a recência só é lida do texto cru quando NÃO sobrou termo de busca
        recente = wants_latest(bruto, getattr(acao, "description", None)) or (
            termo is None and wants_latest(texto_cru)
        )
        if acao.type == FinanceActionType.UNDO_LAST:
            recente = True

        # Demonstrativo ("esse", "isso", "esse lançamento") sem termo de busca e
        # sem pedido de recência: quem responde é o que a conversa acabou de
        # escrever. Sem antecedente vivo, segue para a pergunta de sempre — a
        # lista continua sendo a resposta certa para quem não apontou nada.
        #
        # Isto NÃO afrouxa a trava destrutiva: apagar e corrigir passam pelo
        # `interrupt()` de `policy.py` de qualquer jeito, e a confirmação diz
        # qual linha é ("Confirma apagar gasto de R$ 20,00 (café)?"). O que
        # muda é só o usuário parar de escolher entre nove opções para dizer o
        # que ele já tinha dito.
        # ponytail: o antecedente só resolve TRANSAÇÃO. Para nota, lembrete, meta
        # e bem o ponteiro cai no ramo "sem termo utilizável" mais abaixo, que
        # lista os recentes daquela fonte para escolher — resposta pior que o
        # alvo direto, melhor que a busca literal por "%essa nota%" que era o
        # comportamento anterior. Estender exige uma consulta de existência por
        # fonte; vale a pena quando alguém reclamar de nota, não antes.
        if fonte == "transactions" and termo is None and not recente:
            cands = await _antecedente_da_conversa(workspace_id, antecedente)
            if cands:
                saida.append({"status": "found", "candidates": cands,
                              "table": "transactions"})
                continue

        # Resolve bounded payment directly from plans, beyond the recent-40 window.
        if acao.type == FinanceActionType.MARK_PAID or (
            acao.type == FinanceActionType.UPDATE_TRANSACTION
            and (acao.installment_scope or acao.current_installment)
        ):
            from app.domain.installment_scope import scope_from_text
            from app.graph.schemas import InstallmentScope

            scope = scope_from_text(texto_cru, acao.installment_scope)
            if scope is not None or acao.current_installment:
                _, candidates = await por_texto("planos", workspace_id, termo or "")
                if candidates:
                    saida.append(
                        await _bounded_plan_target(
                            workspace_id,
                            candidates,
                            scope or InstallmentScope(mode="unclear"),
                        )
                    )
                else:
                    saida.append(
                        {
                            "table": "installment_plans",
                            "status": "none",
                            "candidates": [],
                            "correction_error": "Não encontrei a compra parcelada. Diga o nome do plano; se for financiamento cadastrado como dívida, diga isso.",
                        }
                    )
                continue
        # "por completo" busca na tabela de PLANOS, nunca deduzindo a partir das
        # transações: `por_transacao` só enxerga os 40 lançamentos mais recentes,
        # e as parcelas de uma compra antiga estão fora dessa janela justamente
        # quando alguém quer apagar tudo.
        if acao.type in _ACEITA_PLANO and wants_whole_plan(bruto, texto_cru):
            estado, cands = await por_texto("planos", workspace_id, termo or "")
            if cands:
                resolved = {
                    "table": "installment_plans",
                    "status": estado,
                    "candidates": cands,
                }
                if (
                    acao.type == FinanceActionType.UPDATE_TRANSACTION
                    and acao.new_account
                ):
                    resolved["correction_error"] = (
                        "Para trocar a conta de uma compra parcelada, edite a parcela individual no app. O plano inteiro não foi alterado."
                    )
                saida.append(resolved)
                continue

        if fonte == "transactions":
            estado, cands = await por_transacao(workspace_id, acao, recente)
            tabela = "transactions"
        elif termo:
            estado, cands = await por_texto(fonte, workspace_id, termo)
            tabela = _FONTES[fonte]["table"]
        else:
            # sem termo utilizável: mostra os recentes daquela fonte para escolher
            estado, cands = await por_texto(fonte, workspace_id, "")
            tabela = _FONTES[fonte]["table"]
            if estado == "found" and not recente:
                estado = "ambiguous"

        # A compra inteira vira a opção principal quando as parcelas casadas são de
        # um plano. Isso transforma "apaga a TV" / "editar o mac" numa ação no nível do plano.
        if acao.type in _ACEITA_PLANO and tabela == "transactions":
            com_plano = await _com_plano(workspace_id, cands)
            if any(c.get("table") == "installment_plans" for c in com_plano):
                cands = com_plano
                estado = "found" if len(cands) == 1 else "ambiguous"
                if len(cands) == 1 and cands[0].get("table") == "installment_plans":
                    tabela = "installment_plans"

        # Quitar a fatura SEM MOVIMENTAR CAIXA é "dar baixa", não "pagar": o dinheiro
        # já saiu, fora do app. É o botão "Quitar sem caixa" da tela de fatura, e o
        # verbo é o mesmo de dar baixa numa conta prevista — por isso mora em
        # `mark_paid` e não num tipo novo, que não caberia (o schema está no teto
        # medido de 252/32; 266 e 270 foram recusados pela API em 09/09/2026).
        #
        # A fatura só entra na lista quando o termo casa com o NOME DO CARTÃO, então
        # "marca a conta de luz como paga" continua achando só a conta prevista. Casando
        # os dois, vira empate e o usuário escolhe — que é a regra de todo o resto daqui.
        if acao.type == FinanceActionType.MARK_PAID and termo:
            _, faturas = await por_texto("faturas", workspace_id, termo)
            if faturas:
                cands = [*faturas, *cands][:MOSTRAR]
                estado = "found" if len(cands) == 1 else "ambiguous"
                if len(cands) == 1:
                    tabela = "card_invoices"

        if acao.type == FinanceActionType.MARK_PAID and any(
            c.get("table") == "installment_plans" for c in cands
        ):
            saida.append(
                {
                    "table": "installment_plans",
                    "status": "none",
                    "candidates": [],
                    "correction_error": "Quais parcelas deseja pagar? Diga a quantidade inicial, o intervalo ou até qual data.",
                }
            )
            continue

        resolved = {"table": tabela, "status": estado, "candidates": cands}
        if (
            acao.type == FinanceActionType.UPDATE_TRANSACTION
            and acao.new_account
            and (
                tabela == "installment_plans"
                or any(c.get("table") == "installment_plans" for c in cands)
            )
        ):
            resolved["correction_error"] = (
                "Para trocar a conta de uma compra parcelada, edite a parcela individual no app. O plano inteiro não foi alterado."
            )
        elif acao.type == FinanceActionType.UPDATE_TRANSACTION and acao.new_account:
            name = acao.new_account
            if matching.normalize(name) in {"sem conta", "nenhuma conta"}:
                resolved["new_account"] = {"id": None, "name": "Sem conta"}
            else:
                accounts = await db.accounts(workspace_id)
                matches = matching.match_accounts(
                    name, accounts, account_type=matching.infer_account_type(name)
                )
                if len(matches) == 1:
                    resolved["new_account"] = {
                        "id": str(matches[0]["id"]),
                        "name": matches[0]["name"],
                    }
                elif matches:
                    options = ", ".join(
                        f"{a['name']} ({a.get('type', 'conta')})" for a in matches
                    )
                    resolved["correction_error"] = (
                        f"Encontrei mais de uma conta: {options}. Diga qual conta ou cartão deve ficar no lançamento."
                    )
                else:
                    resolved["correction_error"] = (
                        f"Não encontrei uma conta ativa chamada {name}. Diga o nome de uma conta ou cartão cadastrado."
                    )
        saida.append(resolved)
    return saida
