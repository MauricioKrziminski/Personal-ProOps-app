"""Campos obrigatórios por ação — verificados ANTES de virar pergunta.

A `0040` diz, em comentário na própria tabela: "ActionSpec já validado pelo
Nível 1 ANTES de virar pergunta: nunca se pergunta sobre uma ação que não
passaria na validação". A intenção estava escrita; o código não existia. O
`guards.py` roda DENTRO das tools, ou seja, depois do gate — então uma ação sem
valor chegava a virar `pending_actions` e produzia a pergunta
**"Confirma registrar None em 12x?"**, que o usuário não tem como responder.

Isto aqui é a camada que faltava, e é determinística de propósito: o modelo pode
mudar, a exigência de um lançamento ter valor não muda.
"""

from __future__ import annotations

from app.domain.money import parse_valor_em_centavos
from app.graph.schemas import FinanceAction, FinanceActionType

# Ações que criam ou corrigem dinheiro e por isso exigem um valor. Deleção fica
# de fora de propósito: o alvo dela é resolvido pela Fase Cognitiva, e exigir
# valor ali obrigaria o usuário a saber de cor o que quer apagar.
EXIGEM_VALOR = {
    FinanceActionType.CREATE_EXPENSE,
    FinanceActionType.CREATE_INCOME,
    FinanceActionType.CREATE_TRANSFER,
    FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
    FinanceActionType.GOAL_DEPOSIT,
    FinanceActionType.UPDATE_ASSET_VALUE,
}

# Ações onde o usuário precisa dizer DE QUE se trata. "o item/serviço" mora em
# `description` ou `category` neste modelo — exigir só `description` reprovaria
# "gastei 45 no mercado", que é a forma mais comum do produto.
EXIGEM_IDENTIFICACAO = {
    FinanceActionType.CREATE_EXPENSE,
    FinanceActionType.CREATE_INCOME,
    FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
}


def _tem_valor(action: FinanceAction, texto_cru: str) -> bool:
    """Valor da IA ou, na falta dele, do texto cru.

    Usa a MESMA rede que as tools usam (`parse_valor_em_centavos`, que só aceita
    UM número plausível). Sem isso, "gastei 45 no mercado" com o modelo omitindo
    o campo viraria uma pergunta boba sobre um valor que está escrito ali.
    """
    if action.amount_cents:
        return True
    return parse_valor_em_centavos(texto_cru or "") is not None


def faltando(action, texto_cru: str = "") -> tuple[str, str] | None:
    """`(slot, pergunta)` do primeiro dado que falta, ou None se está completa.

    Devolve TEXTO pronto para o usuário, não código de erro: quem chama só
    repassa. É o "Esclarecimento Ativo" — em vez de recusar, o agente pede
    exatamente o que falta.

    A ORDEM importa: valor primeiro, cartão depois. Perguntar o cartão de uma
    compra cujo valor não se sabe é pedir na ordem errada.
    """
    if not isinstance(action, FinanceAction):
        return None

    tipo = action.type
    if tipo in EXIGEM_VALOR and not _tem_valor(action, texto_cru):
        if tipo is FinanceActionType.CREATE_INSTALLMENT_PURCHASE:
            parcelas = f" em {action.installments}x" if action.installments else ""
            return "amount", (
                f"💸 Entendi a compra parcelada{parcelas}, mas faltou o valor. "
                "Quanto foi no total (ou quanto é cada parcela)?"
            )
        return "amount", "💸 Faltou o valor. Quanto foi?"

    if tipo in EXIGEM_IDENTIFICACAO and not (action.description or action.category):
        return "description", "🛍️ Entendi os detalhes da compra, mas não identifiquei o que você comprou. Do que se trata? (ex: 'tv', 'mercado', 'almoço')"

    # Parcelamento vira fatura, e fatura tem dono: sem cartão o lançamento nasce
    # solto e o ciclo de fatura (o trigger `set_invoice`) não tem em que se
    # apoiar. Só para parcelado — compra à vista sem conta continua válida.
    if (
        tipo is FinanceActionType.CREATE_INSTALLMENT_PURCHASE
        and (action.installments or 0) > 1
        and not action.account
    ):
        return "account", "💳 Em qual cartão foi essa compra?"

    return None
