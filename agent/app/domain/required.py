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


def faltando(action, texto_cru: str = "") -> str | None:
    """A pergunta a fazer ao usuário, ou None se a ação está completa.

    Devolve TEXTO para o usuário, não código de erro: quem chama só precisa
    repassar. É o "Esclarecimento Ativo" — em vez de recusar, o agente pede
    exatamente o que falta.
    """
    if not isinstance(action, FinanceAction):
        return None

    tipo = action.type
    if tipo in EXIGEM_VALOR and not _tem_valor(action, texto_cru):
        if tipo is FinanceActionType.CREATE_INSTALLMENT_PURCHASE:
            parcelas = f" em {action.installments}x" if action.installments else ""
            return (
                f"💸 Entendi a compra parcelada{parcelas}, mas faltou o valor. "
                "Quanto foi no total (ou quanto é cada parcela)?"
            )
        return "💸 Faltou o valor. Quanto foi?"

    if tipo in EXIGEM_IDENTIFICACAO and not (action.description or action.category):
        return "🤔 Entendi o valor, mas não o que foi. Isso foi com o quê?"

    return None
