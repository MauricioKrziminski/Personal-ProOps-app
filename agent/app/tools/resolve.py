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

from typing import Any, Callable, Literal

from app import db
from app.domain.reference import clean_term, wants_latest, wants_whole_plan
from app.graph.schemas import (
    FinanceAction,
    FinanceActionType,
    NotesAction,
    NotesActionType,
)

Status = Literal["found", "ambiguous", "none"]

# Janela de busca das transações: além dela, nada é alcançável.
REFERENCE_WINDOW = 40
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
    "pendentes": {
        "table": "transactions",
        "sql": """select id, kind, amount_cents, category, description, occurred_at
                  from public.transactions
                  where workspace_id = %s and status = 'pending'
                    and (coalesce(description,'') ilike %s or coalesce(category,'') ilike %s)
                  order by coalesce(due_at, occurred_at) limit %s""",
        "label": _rotulo_tx,
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
    linhas = await db.fetch(
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
        return veredito(linhas[:MOSTRAR], _rotulo_tx, "transactions")
    if not filtrou:
        return veredito(linhas[:1], _rotulo_tx, "transactions")
    return veredito(linhas, _rotulo_tx, "transactions")


# Ações em que "a compra inteira" é uma resposta possível. Fora daqui, plano nunca
# entra na lista: corrigir o valor de UMA parcela é uma coisa, e mexer no plano
# inteiro é outra.
_ACEITA_PLANO = {FinanceActionType.DELETE_TRANSACTION, FinanceActionType.MARK_PAID}


async def _com_plano(workspace_id, candidatos: list[dict]) -> list[dict]:
    """Põe a COMPRA INTEIRA como primeira opção, quando ela existe.

    `TARGETS` mapeia uma fonte por tipo de ação, então o plano não vem da
    resolução normal — ele é acrescentado depois. Só quando as linhas casadas
    pertencem a UM plano só: com duas compras parceladas no meio, "a compra
    inteira" não teria significado único, e adivinhar qual é o erro que a
    Fase Cognitiva existe para não cometer.
    """
    if not candidatos:
        return candidatos
    linha = await db.fetch_one(
        """
        select p.id, p.description, p.total_cents, p.installments, p.first_occurred_at
        from public.installment_plans p
        where p.workspace_id = %s
          and p.id = (
            select distinct t.installment_plan_id
            from public.transactions t
            where t.id = any(%s) and t.workspace_id = %s
              and t.installment_plan_id is not null
          )
        """,
        workspace_id,
        [c["id"] for c in candidatos],
        workspace_id,
    )
    if not linha:
        return candidatos
    cabeca = {
        "id": str(linha["id"]),
        "label": _rotulo_plano(linha),
        "table": "installment_plans",
        "when": _detalhe_plano(linha),
    }
    # o plano ocupa uma vaga; o resto continua cabendo no limite da Meta
    return [cabeca, *candidatos][:MOSTRAR]


async def for_actions(workspace_id, acoes: list, texto_cru: str) -> list[dict]:
    """Um alvo por ação, alinhado POR POSIÇÃO com a lista de ações.

    A posição é a mesma que `ctx.action_index` já usa para idempotência — não há
    segundo esquema de correspondência para divergir.
    """
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

        # "por completo" busca na tabela de PLANOS, nunca deduzindo a partir das
        # transações: `por_transacao` só enxerga os 40 lançamentos mais recentes,
        # e as parcelas de uma compra antiga estão fora dessa janela justamente
        # quando alguém quer apagar tudo.
        if acao.type in _ACEITA_PLANO and wants_whole_plan(bruto, texto_cru):
            estado, cands = await por_texto("planos", workspace_id, termo or "")
            if cands:
                saida.append({"table": "installment_plans", "status": estado,
                              "candidates": cands})
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

        # A compra inteira vira a PRIMEIRA opção quando as parcelas casadas são de
        # um plano só. Isso transforma "apaga a TV" numa pergunta honesta em vez
        # de um empate entre dez parcelas iguais.
        if acao.type in _ACEITA_PLANO and tabela == "transactions":
            com_plano = await _com_plano(workspace_id, cands)
            if len(com_plano) != len(cands):
                cands = com_plano
                estado = "found" if len(cands) == 1 else "ambiguous"

        saida.append({"table": tabela, "status": estado, "candidates": cands})
    return saida
