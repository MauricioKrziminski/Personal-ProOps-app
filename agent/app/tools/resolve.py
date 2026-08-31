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
from app.domain.reference import clean_term, wants_latest
from app.graph.schemas import (
    FinanceAction,
    FinanceActionType,
    NotesAction,
    NotesActionType,
)

Status = Literal["found", "ambiguous", "none"]

# Janela de busca das transações: além dela, nada é alcançável.
REFERENCE_WINDOW = 40
# Quantos candidatos mostrar num empate.
MOSTRAR = 3

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
    linhas: list[dict], rotulo: Callable[[dict], str], tabela: str
) -> tuple[Status, list[dict]]:
    """0 -> none, 1 -> found, N -> ambiguous. Empate NUNCA vira escolha nossa."""
    cands = [{"id": str(r["id"]), "label": rotulo(r)} for r in linhas[:MOSTRAR]]
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
    return veredito(linhas, cfg["label"], cfg["table"])


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

        bruto = getattr(acao, "search_term", None) or getattr(acao, "content", None)
        termo = clean_term(bruto)
        # a recência só é lida do texto cru quando NÃO sobrou termo de busca
        recente = wants_latest(bruto, getattr(acao, "description", None)) or (
            termo is None and wants_latest(texto_cru)
        )
        if acao.type == FinanceActionType.UNDO_LAST:
            recente = True

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

        saida.append({"table": tabela, "status": estado, "candidates": cands})
    return saida
