"""Política de confirmação humana — pura, sem I/O e sem LangGraph.

Separada do nó `gate` de propósito: decidir O QUE precisa de um SIM é a regra de
segurança mais importante do produto, e regra de segurança que só dá para testar
subindo o grafo inteiro é regra que ninguém testa.
"""

from __future__ import annotations

from app.config import get_settings
from app.domain.money import cents_to_brl
from app.graph.schemas import (
    DESTRUCTIVE,
    MONEY_WRITES,
    READ_ONLY,
    FinanceAction,
    FinanceQuery,
    NotesAction,
)

CONFIDENCE_MINIMA = 0.6


def needs_confirmation(
    action: FinanceAction | FinanceQuery | NotesAction, confidence: float
) -> str | None:
    """Motivo pelo qual esta ação precisa de um SIM, ou None."""
    settings = get_settings()

    if action.type in READ_ONLY:
        return None
    if action.type in DESTRUCTIVE:
        return "destrutiva"
    if action.type in MONEY_WRITES:
        valor = getattr(action, "new_amount_cents", None) or getattr(action, "amount_cents", None)
        if valor and valor > settings.hitl_amount_threshold_cents:
            return "valor alto"
    if confidence < CONFIDENCE_MINIMA:
        return "baixa confiança"
    return None


def describe_for_confirmation(action: FinanceAction | FinanceQuery | NotesAction) -> str:
    """A frase que o usuário LÊ antes de dizer sim.

    Tem que descrever o efeito, não o nome interno da ação: ninguém confirma
    "delete_transaction", mas todo mundo entende "apagar o gasto de R$45".
    """
    tipo = action.type.value
    if isinstance(action, FinanceAction):
        valor = cents_to_brl(action.amount_cents) if action.amount_cents else None
        alvo = action.description or action.target_ref or action.category or "esse item"
        if tipo == "undo_last":
            return "apagar o seu lançamento mais recente"
        if tipo == "delete_transaction":
            return f"apagar o lançamento de {valor}" if valor else f"apagar o lançamento de {alvo}"
        if tipo == "update_transaction":
            novo = cents_to_brl(action.new_amount_cents) if action.new_amount_cents else None
            return f"mudar {alvo} para {novo}" if novo else f"corrigir {alvo}"
        if tipo == "create_installment_purchase":
            return f"registrar {valor} em {action.installments}x"
        if tipo == "pay_invoice":
            return f"registrar o pagamento da fatura do {action.account or 'cartão'}"
        return f"registrar {valor} em {alvo}" if valor else f"registrar {alvo}"

    alvo = action.search_term or action.content or "esse item"
    if tipo == "delete_note":
        return f"apagar a nota sobre {alvo}"
    if tipo == "delete_reminder":
        return f"cancelar o lembrete de {alvo}"
    return f"salvar {alvo}"
