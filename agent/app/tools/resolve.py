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
from app.domain.correcao_plano import (
    CONTA_DO_PLANO,
    LINHA_SUMIU,
    QUAL_PARCELA,
    SEM_CARTAO,
    e_conversao,
    qual_cartao,
    recusa_de_conversao,
)
from app.domain.reference import clean_term, wants_latest, wants_whole_plan
from app.tools import finance
from app.tools.base import FATURA_ABERTA
from app.tools.guards import Level1Error
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
    # Pagar a fatura passou a resolver alvo como todo o resto (11/09/2026). Antes
    # `pay_invoice` fazia o próprio `order by due_date limit 1` e pagava a fatura
    # MAIS ANTIGA em silêncio — com três faturas vencidas no mesmo cartão, "paguei
    # 800 da fatura do nubank" mexia na de julho e a confirmação dizia só "na
    # fatura do nubank", sem vencimento nenhum. É o mesmo `limit 1` que já tinha
    # sido removido de `mark_paid` por dar baixa "na mais antiga EM SILÊNCIO", e
    # aqui o valor é maior.
    FinanceActionType.PAY_INVOICE: "faturas",
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
    # `merchant` no meio: mesma régua da linha de transação (`description ?? merchant`) e do
    # app (`plan.description || plan.merchant`, desde 15/09/2026 — ele era o INVERSO disto, e
    # por isso a mesma compra tinha um nome em Parceladas e outro na fatura). Sem ele a compra
    # cujo nome vive no estabelecimento aparecia na pergunta como "Tudo (2x) — compra parcelada".
    nome = (row.get("description") or row.get("merchant") or "compra parcelada").strip()
    return f"Tudo ({row['installments']}x) — {nome}"


def _detalhe_plano(row: dict) -> str:
    """O que não cabe no título vai para a descrição da linha (72)."""
    from app.domain.dates import format_date_br
    from app.domain.money import cents_to_brl

    desde = format_date_br(row.get("first_occurred_at")) if row.get("first_occurred_at") else ""
    return f"{cents_to_brl(row['total_cents'])} total" + (f" · desde {desde}" if desde else "")


# O que a frase do SIM e a pergunta "total ou cada parcela?" leem do plano, congelado
# na resolução. "Travada" é a régua do BANCO (`private.parcela_travada`: baixa, fatura
# paga/adiada ou com pagamento parcial) — contar por `status` aqui seria a segunda cópia
# da regra que a RPC `update_installment_plan` aplica, e a que diverge é a que mexe em
# dinheiro. `workspace_id` porque o agente conecta com papel que ignora RLS.
_TRAVAS_DO_PLANO = finance.TRAVAS_DO_PLANO


def _candidato_plano(row: dict) -> dict:
    """Os campos congelados de um plano; `.get` porque candidato de antes do deploy não os tem."""
    return {
        "plan_installments": row.get("installments"),
        "total_cents": row.get("total_cents"),
        "editaveis": row.get("editaveis"),
        "travado_cents": row.get("travado_cents"),
    }


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
    # ⚠️ `merchant` entra na projeção E no filtro: o nome da compra pode estar só nele (quem
    # preencheu "Estabelecimento" e deixou a descrição vazia). Sem isso, "apaga a nuuvem por
    # completo" não achava o PLANO — só as parcelas, pelo texto delas —, e o rótulo saía
    # "Tudo (2x) — compra parcelada", que é o genérico de novo.
    "planos": {
        "table": "installment_plans",
        "sql": f"""select p.id, p.description, p.merchant, p.total_cents, p.installments,
                         p.first_occurred_at, x.editaveis, x.travado_cents
                  from public.installment_plans p
                  {_TRAVAS_DO_PLANO}
                  where p.workspace_id = %s
                    and (coalesce(p.description,'') ilike %s or coalesce(p.merchant,'') ilike %s)
                  order by p.created_at desc limit %s""",
        "dois_termos": True,
        "label": _rotulo_plano,
        "detalhe": _detalhe_plano,
    },
    # ⚠️ **Fatura com R$ 0,00 em aberto NÃO é candidata.** `status <> 'paid'` não
    # basta: o ciclo em que a pessoa não comprou nada nasce aberto e vazio, e ele
    # entrava na pergunta "qual delas?" junto com as que têm dívida. Com nove
    # candidatos e as três primeiras zeradas, a lista do WhatsApp (teto de 10
    # linhas) empurra para fora justamente as faturas que se quer pagar — e no app
    # a pessoa lê nove opções para escolher entre seis.
    "faturas": {
        "table": "card_invoices",
        "sql": f"""select ci.id, ci.due_date, ci.reference_month, a.name as card_name,
                         private.invoice_open_cents(ci.id) as aberto
                  from public.card_invoices ci
                  join public.accounts a
                    on a.id = ci.account_id and a.workspace_id = ci.workspace_id
                  where ci.workspace_id = %s and ci.{FATURA_ABERTA} and a.name ilike %s
                    and private.invoice_open_cents(ci.id) > 0
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
            **(_candidato_plano(r) if tabela == "installment_plans" else {}),
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
    # Termo ausente casa tudo (`%%`), e não a string "None". É o que faz
    # "paguei a fatura" (sem citar cartão) virar a lista de faturas em aberto
    # em vez de uma busca literal que não acha nada.
    like = f"%{termo or ''}%"
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
        # ⚠️ `merchant` entra aqui porque ele é NOME, igual à descrição — e porque a busca do
        # APP (`use-finance.ts`) já casa os três (`description`, `merchant`, `category`).
        # Sem ele o agente respondia "não achei nada com «nuuvem»" para uma compra cujo
        # estabelecimento é exatamente "nuuvem": as duas pontas procurando coisas diferentes
        # no mesmo dado. Medido em 15/09/2026, junto com a correção do app que parou de
        # descartar o campo (`create_installment_plan_with_history` nunca recebia `p_merchant`).
        por_texto_ = [
            t for t in linhas
            if t_low in (t["description"] or "").lower()
            or t_low in ((t.get("merchant") or "")).lower()
            or t_low in (t["category"] or "").lower()
        ]
        if por_texto_:
            linhas, filtrou = por_texto_, True
        elif not filtrou:
            # ⚠️ **O que o usuário DISSE e não existe é "não achei", nunca "então toma a
            # lista".** O `elif` guarda o caso legítimo: com valor ou categoria já casando, um
            # termo que não bate não pode ZERAR uma busca que achou — era só para isso que a
            # guarda existia. Sem o `not filtrou` ela virava o contrário: quando o termo era a
            # ÚNICA pista, o filtro se descartava em silêncio, `filtrou` ficava False e o
            # código caía na janela dos 40 mais recentes.
            #
            # Medido em produção em 15/09/2026: *"remove o lançamento nuuvem"* — palavra que
            # não existe no workspace — devolveu uma lista com IOF do rotativo, dentista,
            # cabeleireiro e dois planos de parcelamento. A queixa foi literal: *"ele nunca
            # deve generalizar algo que eu especifiquei"*.
            #
            # ⚠️ E a lista era o ramo MENOS perigoso. Com `quer_recente` junto ("apaga o
            # último lançamento da nuuvem") o mesmo `filtrou=False` caía em `linhas[:1]` e
            # devolvia `found` na transação mais recente — um DELETE confirmado com uma frase
            # que nomeava outro lançamento.
            return "none", []
    if action.occurred_at:
        por_data = [t for t in linhas if str(t["occurred_at"]) == action.occurred_at]
        if por_data:
            linhas, filtrou = por_data, True
        elif not filtrou:
            # Mesma régua para a data: "apaga o de 14/09" sem nada em 14/09 é "não achei".
            return "none", []

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
        select t.id as tx_id, p.id as plan_id, p.description, p.merchant, p.total_cents, p.installments,
               p.first_occurred_at, x.editaveis, x.travado_cents
        from public.transactions t
        join public.installment_plans p on p.id = t.installment_plan_id
        """ + _TRAVAS_DO_PLANO + """
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
                **_candidato_plano(r),
            }

    plan_cands = list(planos_unicos.values())
    outras_txs = [c for c in candidatos if str(c["id"]) not in txs_em_planos]

    return [*plan_cands, *outras_txs][:MOSTRAR]


async def _bounded_plan_target(workspace_id, candidates, scope, *, correcao: bool = False):
    """As parcelas escolhidas, CONGELADAS (id, valor, data, status, trava).

    `correcao`: o escopo veio de um update, não de uma baixa — os erros de
    `select_rows` falam em "pagar", e ali a pessoa quer corrigir.
    """
    from app.domain.installment_scope import select_rows
    from app.domain.money import cents_to_brl
    from app.domain.dates import format_date_br

    result = []
    for candidate in candidates:
        rows = await db.fetch(
            "select t.id, t.installment_no, t.amount_cents, t.occurred_at, t.status, t.paid_at, t.account_id, t.invoice_id, a.name as account_name, "
            "private.parcela_travada(t.status, t.invoice_id) as travada "
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
                "correction_error": QUAL_PARCELA if correcao else str(error),
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
                    "travada",
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
                "label": (f"parcela {first['installment_no']} — {name}" if len(frozen) == 1
                          else f"{len(frozen)} parcelas ({span}) — {name}"),
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


def _bruto_de(acao) -> str | None:
    """De onde sai o termo de busca de cada tipo de ação, CRU.

    `target_ref` é onde o nome da meta/bem vem em FinanceAction (ela não tem
    search_term nem content). Sem ele, goal_deposit e update_asset_value
    resolviam com termo vazio — ou seja, listavam TODAS as metas em vez de
    achar "viagem".
    """
    if getattr(acao, "type", None) == FinanceActionType.PAY_INVOICE:
        # O alvo aqui é a FATURA, e quem a identifica é o nome do cartão — que em
        # FinanceAction mora em `account`, não em `description`. Sem esta linha o
        # termo sairia de `description` ("fatura", vazio) e a resolução listaria
        # as faturas de todos os cartões.
        return getattr(acao, "account", None)
    return (
        getattr(acao, "search_term", None)
        or getattr(acao, "content", None)
        or getattr(acao, "target_ref", None)
        or getattr(acao, "description", None)
    )


def termo_de(acao) -> str | None:
    """O termo que o USUÁRIO disse, limpo de ponteiro ("esse lançamento").

    Um lugar só, com DOIS leitores: `for_actions` resolve o alvo com ele e
    `registry._sem_alvo` cita ele no "não achei". Duplicar a cadeia de campos
    lá seria a segunda cópia que diverge — e divergir aqui é o "não achei
    nenhum lançamento com «nuuvem»" virar "não achei esse item", genérico de
    novo.
    """
    return clean_term(_bruto_de(acao))


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

        bruto = _bruto_de(acao)
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
        #
        # ⚠️ O antecedente pode ser PARCELA de um plano (logo depois de "parcela em
        # 2x"): nas ações que aceitam plano ele segue o caminho comum lá embaixo
        # (`_com_plano`), senão "na verdade foi 120" corrigia UMA linha, sem a
        # pergunta total/parcela e sem a trava de parcela paga.
        ante = None
        if fonte == "transactions" and termo is None and not recente:
            ante = await _antecedente_da_conversa(workspace_id, antecedente)
            if ante and acao.type not in _ACEITA_PLANO:
                saida.append({"status": "found", "candidates": ante,
                              "table": "transactions"})
                continue

        # Resolve bounded payment directly from plans, beyond the recent-40 window.
        if not ante and (acao.type == FinanceActionType.MARK_PAID or (
            acao.type == FinanceActionType.UPDATE_TRANSACTION
            and (acao.installment_scope or acao.current_installment)
        )):
            from app.domain.installment_scope import scope_from_text
            from app.graph.schemas import InstallmentScope

            scope = scope_from_text(texto_cru, acao.installment_scope)
            corrige = acao.type == FinanceActionType.UPDATE_TRANSACTION
            if (corrige and acao.current_installment and not acao.installment_scope
                    and (scope is None or scope.mode == "unclear")):
                # "muda a 3ª parcela": numa CORREÇÃO a parcela citada é a própria linha
                n = acao.current_installment
                scope = InstallmentScope(mode="range", start=n, end=n)
            if scope is not None or acao.current_installment:
                _, candidates = await por_texto("planos", workspace_id, termo or "")
                if candidates:
                    saida.append(
                        await _bounded_plan_target(
                            workspace_id,
                            candidates,
                            scope or InstallmentScope(mode="unclear"),
                            correcao=corrige,
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
        if not ante and acao.type in _ACEITA_PLANO and wants_whole_plan(bruto, texto_cru):
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
                        CONTA_DO_PLANO
                    )
                saida.append(resolved)
                continue

        if ante:
            estado, cands, tabela = "found", ante, "transactions"
        elif fonte == "transactions":
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
        # Na conversão (D1) a conta citada é o CARTÃO da compra, não uma troca de conta:
        # quem a resolve é `conversoes`, só entre cartões.
        if (
            acao.type == FinanceActionType.UPDATE_TRANSACTION
            and acao.new_account
            and not e_conversao(acao)
            and (
                tabela == "installment_plans"
                or any(c.get("table") == "installment_plans" for c in cands)
            )
        ):
            resolved["correction_error"] = (
                CONTA_DO_PLANO
            )
        elif (acao.type == FinanceActionType.UPDATE_TRANSACTION and acao.new_account
              and not e_conversao(acao)):
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
    return await conversoes(workspace_id, acoes, saida)


# ---------------------------------------------------------------------------
# D1: parcelar um lançamento que já existe
# ---------------------------------------------------------------------------

# O estado da linha que a `convert_transaction_to_installments` recusa, lido ANTES do
# SIM. `parcela_travada('pending', ...)` isola o lado da FATURA, igual à RPC (a linha
# `cleared` é liberada lá). `workspace_id` porque o agente ignora RLS.
_DETALHE_DA_LINHA = """
    select t.id, t.kind, t.amount_cents, t.occurred_at, t.description, t.merchant, t.category,
           t.installment_plan_id, p.installments as plan_installments,
           t.recurring_id, t.debt_id, t.rollover_of_invoice_id,
           private.parcela_travada('pending', t.invoice_id) as fatura_travada,
           a.id as account_id, a.name as account_name, a.type as account_type
    from public.transactions t
    left join public.installment_plans p
      on p.id = t.installment_plan_id and p.workspace_id = t.workspace_id
    left join public.accounts a
      on a.id = t.account_id and a.workspace_id = t.workspace_id and not a.archived
    where t.id = any(%s::uuid[]) and t.workspace_id = %s
"""


async def _cartao_citado(workspace_id, nome: str, cartoes: list[dict]):
    """(cartão, None) ou (None, pergunta). Só entre CARTÕES: conta corrente não parcela.

    Sem rascunho de propósito (exclusão declarada): `draft.mesclar` grava em `account`
    e completar o rascunho re-resolveria o alvo sem congelar. A pessoa manda de novo.
    """
    if not cartoes:
        return None, SEM_CARTAO
    achado = await finance.resolve_account(workspace_id, nome, only_cards=True)
    if achado:
        c = next((c for c in cartoes if str(c["id"]) == str(achado)), None)
        if c:
            return {"id": str(c["id"]), "name": c["name"]}, None
    parecidas = matching.match_accounts(nome, cartoes, account_type="credit_card")
    if len(parecidas) > 1:
        opcoes = ", ".join(f"*{c['name']}*" for c in parecidas[:6])
        return None, f"🤔 “{nome}” casa com mais de um cartão: {opcoes}. Me manda de novo dizendo qual."
    return None, f"🤔 Não achei cartão com o nome “{nome}”. " + qual_cartao([c["name"] for c in cartoes])


async def conversoes(workspace_id, acoes: list, alvos: list[dict]) -> list[dict]:
    """Congela no candidato de transação o que a conversão lê: `nome` curto,
    `amount_cents`, `occurred_at` e `convert_account` ({id, name}) — ou `convert_error`.

    Recusa ANTES do SIM tudo que o estado da linha já decide (as recusas da RPC) e a
    falta de cartão. Com alvo `found` o resultado sobe para o alvo (`convert_account` /
    `correction_error`); no empate fica no candidato e o `gate` levanta o do escolhido.
    """
    for i, acao in enumerate(acoes):
        alvo = alvos[i] if i < len(alvos) else {}
        if (not e_conversao(acao) or alvo.get("correction_error")
                or alvo.get("status") not in ("found", "ambiguous")):
            continue
        def e_tx(c):
            return c.get("table", alvo.get("table")) == "transactions"
        ids = [str(c["id"]) for c in alvo.get("candidates") or [] if e_tx(c)]
        if not ids:
            continue
        linhas = {str(r["id"]): r for r in await db.fetch(_DETALHE_DA_LINHA, ids, workspace_id)}
        cartoes = await db.accounts(workspace_id, only_cards=True)
        citado, erro_citado = (await _cartao_citado(workspace_id, acao.new_account, cartoes)
                               if acao.new_account else (None, None))
        cands = []
        for c in alvo["candidates"]:
            if not e_tx(c):
                cands.append(c)
                continue
            linha = linhas.get(str(c["id"]))
            if not linha:
                cands.append({**c, "convert_error": LINHA_SUMIU})
                continue
            recusa = recusa_de_conversao(linha, acao.installments)
            if linha.get("installment_plan_id"):
                # já é parcela: igual ao N do plano é pista de busca (segue a correção comum)
                if not recusa and acao.new_account:
                    recusa = CONTA_DO_PLANO
                cands.append({**c, "plan_installments": linha.get("plan_installments"),
                              **({"convert_error": recusa} if recusa else {})})
                continue
            cartao = None
            if not recusa:
                recusa = erro_citado
            if not recusa:
                cartao = citado or (
                    {"id": str(linha["account_id"]), "name": linha["account_name"]}
                    if linha.get("account_type") == "credit_card" else None)
                if not cartao:
                    recusa = qual_cartao([k["name"] for k in cartoes]) if cartoes else SEM_CARTAO
            cands.append({
                **c,
                "nome": linha.get("description") or linha.get("merchant") or linha.get("category")
                or "lançamento",
                "amount_cents": linha["amount_cents"],
                "occurred_at": str(linha["occurred_at"]),
                **({"convert_error": recusa} if recusa else {"convert_account": cartao}),
            })
        novo = {**alvo, "candidates": cands}
        if alvo["status"] == "found":
            if cands[0].get("convert_error"):
                novo["correction_error"] = cands[0]["convert_error"]
            elif cands[0].get("convert_account"):
                novo["convert_account"] = cands[0]["convert_account"]
        alvos[i] = novo
    return alvos


# ---------------------------------------------------------------------------
# conta citada que não existe: pergunta ANTES da confirmação
# ---------------------------------------------------------------------------

# (campo, só cartões, como a pergunta chama esse papel)
_CONTAS_CITADAS: dict[Any, tuple[tuple[str, bool, str], ...]] = {
    FinanceActionType.CREATE_EXPENSE: (("account", False, "a conta"),),
    FinanceActionType.CREATE_INCOME: (("account", False, "a conta"),),
    FinanceActionType.CREATE_TRANSFER: (
        ("account", False, "a conta de onde saiu"),
        ("counterparty_account", False, "a conta de destino"),
    ),
    FinanceActionType.CREATE_INSTALLMENT_PURCHASE: (("account", True, "o cartão"),),
    FinanceActionType.PAY_INVOICE: (("counterparty_account", False, "a conta que pagou"),),
}


def conta_e_cartao(tipo) -> bool | None:
    """A conta desta ação é um CARTÃO? `None` quando ela não pede conta nenhuma.

    Aceita o enum ou a string gravada no rascunho. A régua já existia em
    `_CONTAS_CITADAS` e estava sendo lida só aqui dentro; quem PERGUNTA "qual
    conta?" precisa dela também, para não oferecer os dois cartões a quem lançou
    um gasto em conta corrente. Uma tabela só — duas divergiriam no dia em que
    uma ação nova entrasse numa e não na outra.
    """
    if not isinstance(tipo, FinanceActionType):
        try:
            tipo = FinanceActionType(tipo)
        except ValueError:
            return None
    campos = _CONTAS_CITADAS.get(tipo)
    return campos[0][1] if campos else None


async def contas_citadas(
    workspace_id, acoes: list, alvos: list[dict], pular: set[int] | None = None
) -> list[dict]:
    """Marca `correction_error` onde o usuário citou uma conta que não bate.

    ⚠️ **Isto roda na fase de RESOLUÇÃO, e não dentro da tool, porque a
    confirmação é montada antes da tool rodar.** A checagem existia só em
    `conta_citada` (dentro da tool) e o efeito era este, medido em 11/09/2026:

        "comprei uma tv em 10x de 300 no santander"
        ⚠️ Confirma registrar R$ 3.000,00 em 10x no cartão santander?

    Não existe cartão Santander. O usuário lia uma frase que descrevia algo
    impossível, dizia SIM, e SÓ ENTÃO recebia a pergunta. Confirmar uma coisa e
    receber outra é o oposto de pedir confirmação.

    `correction_error` já é o caminho que o `gate` usa para parar antes de
    perguntar "confirma?" — ele existia para `new_account` de correção e vale
    igual aqui.
    """
    from app.tools.finance import conta_citada

    alvos = [*alvos] + [{}] * max(0, len(acoes) - len(alvos))
    for i, acao in enumerate(acoes):
        campos = _CONTAS_CITADAS.get(getattr(acao, "type", None))
        # ⚠️ **Uma pergunta por turno.** Ação a que já falta VALOR não é
        # perguntada duas vezes: "comprei uma tv em 10x no itau" respondia
        # "faltou o valor" E "não achei o cartão itau" no mesmo balão, e a
        # pessoa não sabe qual das duas responder. `faltando` já declara a
        # ordem — valor primeiro, cartão depois —, e o cartão volta a ser
        # perguntado no turno seguinte, quando o valor entrar.
        if not campos or alvos[i].get("correction_error") or i in (pular or set()):
            continue
        for campo, so_cartoes, papel in campos:
            nome = getattr(acao, campo, None)
            if not nome:
                continue
            try:
                await conta_citada(workspace_id, nome, only_cards=so_cartoes, papel=papel)
            except Level1Error as err:
                # `account_error` é o MESMO texto, com outro nome: `correction_error`
                # é o que faz o gate parar, e este é o que diz que a parada tem
                # resposta possível — um rascunho de slot `account`, com os
                # botões das contas que existem. Sem ele a pergunta era um beco:
                # medido em 15/09/2026, "paguei 45 no mercado com o cartao" →
                # "qual delas?" → "nubank" respondia *"Para trocar a conta de uma
                # compra parcelada, edite a parcela individual no app"*, e os
                # R$ 45 nunca eram registrados.
                #
                # ⚠️ **SÓ para o campo `account`, e a restrição é o que impede um
                # loop pior que o beco.** O rascunho inteiro — `parse_slot_click`,
                # `_cartao_do_rascunho`, `draft.mesclar`, o CHECK de
                # `draft_actions.slot` — conhece UM campo. Marcando aqui a falha
                # de `counterparty_account` (o destino de uma transferência, a
                # conta que paga a fatura), a resposta do usuário seria gravada
                # em `account`: "transferi 100 da nubank pro bradesco", sem
                # Bradesco, escolher *Inter* na lista APAGARIA a origem correta e
                # deixaria o destino quebrado — e a mesma pergunta voltaria para
                # sempre. Campo novo exige slot novo e migration; até lá esses
                # dois continuam sendo texto, como antes.
                if campo == "account":
                    alvos[i] = {**alvos[i], "account_error": err.mensagem_usuario}
                alvos[i] = {**alvos[i], "correction_error": err.mensagem_usuario}
                break
    return alvos
