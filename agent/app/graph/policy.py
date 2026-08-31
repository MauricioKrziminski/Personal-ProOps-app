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
    FinanceActionType,
    FinanceQuery,
    NotesAction,
)

CONFIDENCE_MINIMA = 0.6


# Altera registro existente mas NÃO passa pelo resolver (tem forma de duas
# etapas: conta -> fatura em aberto). Por isso entra explícito.
#
# `set_rule` fica FORA de propósito: é upsert com a chave que o próprio usuário
# acabou de ditar, não tem como acertar a linha errada, e é editável na tela.
ALWAYS_CONFIRM = {FinanceActionType.PAY_INVOICE}


# Abaixo disto o roteador não tem certeza do DOMÍNIO, e a pergunta certa é
# "como você quer registrar isso?" — antes de extrair qualquer campo. É outra
# pergunta, em outro momento, que a de confirmar uma ação (CONFIDENCE_MINIMA).
DOMINIO_MINIMO = 0.8

# Só entre estes dois faz sentido perguntar: são as duas formas de REGISTRAR a
# mesma frase. "geral" (saudação) e consulta não gravam nada.
_AMBIGUOS = {"financas", "notas"}


def dominio_incerto(domains: list[str], confidence: float) -> bool:
    """O roteador ficou em cima do muro entre gasto e nota?"""
    if confidence >= DOMINIO_MINIMO:
        return False
    if len(domains) != 1:
        # multi-intent é o router afirmando os dois, não hesitando entre eles
        return False
    return domains[0] in _AMBIGUOS


def needs_confirmation(
    action: FinanceAction | FinanceQuery | NotesAction,
    confidence: float,
    target: dict | None = None,
) -> str | None:
    """Motivo pelo qual esta ação precisa de um SIM, ou None.

    `target` vem por último para os testes existentes seguirem chamando com dois
    argumentos.

    A regra "teve alvo resolvido -> confirma" é DERIVADA, não uma lista: ela
    cobre update, delete, undo, mark_paid, goal_deposit, update_asset_value,
    append_note e delete_reminder de uma vez — e cobre o que for acrescentado
    depois sem ninguém precisar lembrar de atualizar um conjunto.
    """
    settings = get_settings()

    if action.type in READ_ONLY:
        return None
    if action.type in DESTRUCTIVE:
        return "destrutiva"
    if target:
        return "alterar item existente"
    if action.type in ALWAYS_CONFIRM:
        return "alterar item existente"
    if action.type in MONEY_WRITES:
        valor = getattr(action, "new_amount_cents", None) or getattr(action, "amount_cents", None)
        if valor and valor > settings.hitl_amount_threshold_cents:
            return "valor alto"
    if confidence < CONFIDENCE_MINIMA:
        return "baixa confiança"
    return None


_VERBO = {
    "delete_transaction": "apagar", "undo_last": "apagar",
    "delete_note": "apagar", "delete_reminder": "cancelar",
    "update_transaction": "corrigir", "append_note": "acrescentar em",
    "mark_paid": "dar baixa em", "goal_deposit": "aportar em",
    "update_asset_value": "atualizar o valor de",
}


def describe_for_confirmation(
    action: FinanceAction | FinanceQuery | NotesAction, target: dict | None = None
) -> str:
    """A frase que o usuário LÊ antes de dizer sim.

    Tem que descrever o efeito, não o nome interno da ação: ninguém confirma
    "delete_transaction", mas todo mundo entende "apagar o gasto de R$45".

    Com `target` resolvido, o alvo é a LINHA REAL. Sem ele a frase caía nos
    campos crus do modelo, e o usuário lia "apagar a nota sobre última mensagem"
    — confirmando o eco do modelo, não o que ia acontecer de verdade.
    """
    if target and target.get("candidates"):
        verbo = _VERBO.get(action.type.value, "mexer em")
        if target.get("status") == "found":
            escolhido = target["candidates"][0]
            # O detalhe (valor, data) só existe onde o rótulo não coube — hoje o
            # plano de parcelamento. Numa confirmação DESTRUTIVA o usuário precisa
            # ver o dinheiro antes de dizer sim, não só o nome.
            extra = f" ({escolhido['when']})" if escolhido.get("when") else ""
            return f"{verbo} {escolhido['label']}{extra}"
        # Empate: as opções REAIS vão na lista, então a frase só precisa dizer o
        # que vai acontecer. Cair no texto do modelo aqui reintroduzia o eco que
        # este desenho existe para eliminar ("apagar a nota sobre esse item").
        return f"{verbo} qual?"

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
