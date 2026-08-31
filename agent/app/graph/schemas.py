"""Contratos de saída da IA — um schema por domínio.

Por que separado por domínio: o schema único de hoje bateu no teto MEDIDO do
Gemini (15 propriedades e UM enum; a 16ª devolve 400 INVALID_ARGUMENT sem
detalhe). Para caber, os campos viraram multiuso — `content` é descrição, título
de lembrete, nome de meta, gatilho de regra E termo de busca. Cada significado
extra é uma chance a mais de o modelo escolher o errado.

Com um schema por domínio cada campo volta a ter um significado só, e mesmo
assim cada um fica DENTRO do teto (finanças: exatamente 15; notas: 9). O teto é
respeitado de propósito mesmo com o LangChain no meio — a medição foi feita no
responseSchema cru e não vale a pena descobrir na produção que o limite mudou.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class Domain(str, Enum):
    FINANCAS = "financas"
    FINANCAS_CONSULTA = "financas_consulta"
    NOTAS = "notas"
    GERAL = "geral"


class RouterDecision(BaseModel):
    """Saída do nó Router. Lista, não escolha única: "gastei 45 e me lembra do
    aluguel" é finanças E notas, e um router exclusivo perderia metade da
    mensagem — o multi-intent é a melhor qualidade do produto hoje."""

    domains: list[Domain] = Field(
        description="Domínios presentes na mensagem, na ordem em que aparecem."
    )
    confidence: float = Field(description="0..1 sobre a mensagem inteira.")


class FinanceActionType(str, Enum):
    """Só ESCRITA e CORREÇÃO. Consulta tem enum próprio (ver FinanceQueryType)."""

    CREATE_EXPENSE = "create_expense"
    CREATE_INCOME = "create_income"
    CREATE_TRANSFER = "create_transfer"
    CREATE_INSTALLMENT_PURCHASE = "create_installment_purchase"
    PAY_INVOICE = "pay_invoice"
    MARK_PAID = "mark_paid"
    SET_RULE = "set_rule"
    UPDATE_TRANSACTION = "update_transaction"
    DELETE_TRANSACTION = "delete_transaction"
    UNDO_LAST = "undo_last"
    CREATE_GOAL = "create_goal"
    GOAL_DEPOSIT = "goal_deposit"
    UPDATE_ASSET_VALUE = "update_asset_value"
    UNKNOWN = "unknown"


class FinanceAction(BaseModel):
    """13 propriedades × 14 valores de enum = 182, abaixo do 198 que passou.

    Escrita e correção ficam JUNTAS de propósito. Separá-las obrigaria o router a
    decidir se "o mercado de ontem foi 120" é lançamento novo ou correção — e
    errar isso cria a duplicata que o produto inteiro luta para evitar.
    """

    type: FinanceActionType
    amount_cents: int | None = Field(
        None, description="Valor em centavos inteiros. '45 reais' -> 4500."
    )
    category: str | None = Field(None, description="Categoria curta e minúscula.")
    description: str | None = Field(None, description="Do que se trata.")
    occurred_at: str | None = Field(None, description="Data do lançamento, YYYY-MM-DD.")
    account: str | None = Field(None, description="Nome da conta ou cartão citado.")
    counterparty_account: str | None = Field(
        None, description="Conta destino (transferência, pagamento de fatura)."
    )
    installments: int | None = Field(None, description="Número de parcelas.")
    recurrence: str | None = Field(None, description="RRULE, ex.: FREQ=MONTHLY;BYMONTHDAY=5.")
    new_amount_cents: int | None = Field(None, description="Valor CORRIGIDO.")
    new_category: str | None = Field(None, description="Categoria CORRIGIDA.")
    new_occurred_at: str | None = Field(None, description="Data CORRIGIDA, YYYY-MM-DD.")
    target_ref: str | None = Field(
        None, description="Nome da meta, do bem, ou o gatilho da regra de categorização."
    )


class FinancePlan(BaseModel):
    actions: list[FinanceAction] = Field(default_factory=list, max_length=10)
    confidence: float = 1.0


class FinanceQueryType(str, Enum):
    QUERY_BALANCE = "query_balance"
    QUERY_TRANSACTIONS = "query_transactions"
    QUERY_BUDGETS = "query_budgets"
    QUERY_GOALS = "query_goals"
    QUERY_INVOICE = "query_invoice"
    QUERY_FORECAST = "query_forecast"
    QUERY_NET_WORTH = "query_net_worth"
    SIMULATE_PURCHASE = "simulate_purchase"
    UNKNOWN = "unknown"


class FinanceQuery(BaseModel):
    """7 propriedades × 9 valores de enum = 63. Folga larga.

    Consulta nunca escreve, então nada de `description`, `recurrence` ou dos
    campos `new_*`: eles não teriam significado aqui.
    """

    type: FinanceQueryType
    category: str | None = Field(None, description="Filtrar por esta categoria.")
    account: str | None = Field(None, description="Conta ou cartão citado.")
    query_from: str | None = Field(None, description="Início do período, YYYY-MM-DD.")
    query_to: str | None = Field(None, description="Fim do período, YYYY-MM-DD.")
    amount_cents: int | None = Field(
        None, description="Valor da compra a simular, em centavos inteiros."
    )
    installments: int | None = Field(None, description="Parcelas da compra a simular.")


class FinanceQueryPlan(BaseModel):
    actions: list[FinanceQuery] = Field(default_factory=list, max_length=10)
    confidence: float = 1.0


class NotesActionType(str, Enum):
    CREATE_NOTE = "create_note"
    APPEND_NOTE = "append_note"
    QUERY_NOTES = "query_notes"
    DELETE_NOTE = "delete_note"
    CREATE_REMINDER = "create_reminder"
    DELETE_REMINDER = "delete_reminder"
    UNKNOWN = "unknown"


class NotesAction(BaseModel):
    type: NotesActionType
    content: str | None = Field(None, description="Texto da nota ou o que lembrar.")
    folder: str | None = Field(None, description="Pasta da nota, curta e minúscula.")
    search_term: str | None = Field(None, description="Trecho que ACHA a nota/lembrete.")
    append_text: str | None = Field(None, description="Texto a ACRESCENTAR numa nota existente.")
    remind_at: str | None = Field(None, description="Quando lembrar, ISO local do usuário.")
    recurrence: str | None = Field(None, description="RRULE quando o lembrete se repete.")
    query_from: str | None = Field(None, description="Início do período, YYYY-MM-DD.")
    query_to: str | None = Field(None, description="Fim do período, YYYY-MM-DD.")


class NotesPlan(BaseModel):
    actions: list[NotesAction] = Field(default_factory=list, max_length=10)
    confidence: float = 1.0


# Ações que apagam ou alteram dado de forma difícil de desfazer.
# Regra de categorização do usuário só se aplica a CRIAÇÃO. Em correção e
# deleção, `category` é campo de BUSCA — deixar a regra reescrevê-lo mudaria
# QUAL registro é apagado, em silêncio. Em `new_category` também não: ali o
# usuário ditou a categoria explicitamente, e regra não sobrepõe humano.
RULE_APPLIES = {
    FinanceActionType.CREATE_EXPENSE,
    FinanceActionType.CREATE_INCOME,
    FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
}

DESTRUCTIVE = {
    FinanceActionType.DELETE_TRANSACTION,
    FinanceActionType.UNDO_LAST,
    NotesActionType.DELETE_NOTE,
    NotesActionType.DELETE_REMINDER,
}

# Ações que movem dinheiro de verdade — passam pelo teto de valor do HITL.
MONEY_WRITES = {
    FinanceActionType.CREATE_EXPENSE,
    FinanceActionType.CREATE_INCOME,
    FinanceActionType.CREATE_TRANSFER,
    FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
    FinanceActionType.PAY_INVOICE,
    FinanceActionType.GOAL_DEPOSIT,
    FinanceActionType.UPDATE_TRANSACTION,
}

# Só leem. Nunca pedem confirmação, nunca gravam em executed_actions.
# Todo FinanceQueryType é leitura por construção — é o ganho de ter separado.
READ_ONLY = {*FinanceQueryType, NotesActionType.QUERY_NOTES}


class ConfirmDecision(BaseModel):
    """Classificação de uma resposta digitada a uma pergunta de confirmação.

    Enum de três valores de propósito: sem `unclear`, o modelo seria forçado a
    escolher entre aprovar e recusar quando o usuário disse "acho que sim" — e a
    escolha errada apaga dado.
    """

    decision: Literal["approve", "reject", "unclear"] = Field(
        description="approve, reject ou unclear"
    )


class DraftDecision(BaseModel):
    """O que a mensagem faz com um rascunho aberto.

    `unrelated` existe para o modelo não ser forçado a escolher entre completar e
    descartar quando o usuário simplesmente mudou de assunto.
    """

    decision: Literal["answer", "discard", "unrelated"] = Field(
        description="answer, discard ou unrelated"
    )
