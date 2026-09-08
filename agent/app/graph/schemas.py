"""Contratos de saída da IA — um schema por domínio.

O schema único excedeu a complexidade aceita pelo Gemini. Os domínios mantêm
campos com significado definido e formatos efetivamente medidos contra a API.
Não existe aqui uma garantia universal de "15 campos": enum, aninhamento e
limites de arrays também influenciam. Os testes prendem os formatos conhecidos;
ampliar exige sondagem real, além de validação Pydantic local.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, Field, WithJsonSchema, field_validator


class Domain(str, Enum):
    FINANCAS = "financas"
    FINANCAS_CONSULTA = "financas_consulta"
    NOTAS = "notas"
    GERAL = "geral"
    CADASTROS = "cadastros"


class RouterDecision(BaseModel):
    """Saída do nó Router. Lista, não escolha única: "gastei 45 e me lembra do
    aluguel" é finanças E notas, e um router exclusivo perderia metade da
    mensagem — o multi-intent é a melhor qualidade do produto hoje."""

    financial_entity: str | None = Field(None, description="For status/payment of EXISTING installments only: exact item/contract name, e.g. carro. Recover from clear history; null for creation or unclear reference.")
    discard_resource_draft: bool = Field(False, description="True somente quando o usuário cancela explicitamente o cadastro incompleto informado no contexto.")

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


class InstallmentScope(BaseModel):
    """Selection of existing installments; never a schedule correction."""

    mode: str = Field(
        description="first, last, range, dates, all, or unclear. all only for explicitly every installment without a bound."
    )
    count: int | None = None
    start: int | None = None
    end: int | None = None
    from_date: str | None = None
    through_date: str | None = None


def _parse_installment_scope(value):
    if not isinstance(value, str):
        return value
    parts = value.split(":")
    mode = parts[0]
    if mode in {"first", "last"} and len(parts) == 2:
        return {"mode": mode, "count": int(parts[1])}
    if mode == "range" and len(parts) == 3:
        return {"mode": mode, "start": int(parts[1]), "end": int(parts[2])}
    if mode == "dates" and len(parts) == 3:
        return {
            "mode": mode,
            "from_date": parts[1] or None,
            "through_date": parts[2] or None,
        }
    if mode in {"all", "unclear"} and len(parts) == 1:
        return {"mode": mode}
    raise ValueError("Invalid installment selector")


# Compact wire format tested against Gemini; typed object in checkpoints/tools.
# Nested scope caused INVALID_ARGUMENT, while 17 flat fields passed the real API.
CompactInstallmentScope = Annotated[
    InstallmentScope, BeforeValidator(_parse_installment_scope),
    WithJsonSchema({'type':'string'})
]


class FinanceAction(BaseModel):
    """17 propriedades × 14 valores de enum = 238, aceito no Gemini em 08/09/2026.

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
    current_installment: int | None = Field(
        None,
        description=(
            "Em qual parcela ele JÁ ESTÁ, quando a compra é antiga "
            "('tô na 4ª de 10' -> 4). Vazio se a compra é de agora."
        ),
    )
    installment_scope: CompactInstallmentScope | None = Field(
        None,
        description="EXISTING payment subset: first:8, last:2, range:3:8, dates:2026-01-01:2026-08-31, dates::2026-08-31, all, or unclear. Never current_installment.",
    )
    already_paid_count: int | None = Field(
        None,
        description="CREATION only: explicitly reported number of initial installments already paid, including zero. Current position/date alone does not prove payment.",
    )
    recurrence: str | None = Field(
        None, description="RRULE, ex.: FREQ=MONTHLY;BYMONTHDAY=5."
    )
    new_amount_cents: int | None = Field(None, description="Valor CORRIGIDO.")
    new_category: str | None = Field(None, description="Categoria CORRIGIDA.")
    new_account: str | None = Field(
        None,
        description="Nome da conta ou cartão CORRIGIDO. Sem conta remove o vínculo; account não é correção.",
    )
    new_occurred_at: str | None = Field(None, description="Data CORRIGIDA, YYYY-MM-DD.")
    target_ref: str | None = Field(
        None,
        description="Nome da meta, do bem, ou o gatilho da regra de categorização.",
    )


class FinancePlan(BaseModel):
    actions: list[FinanceAction] = Field(default_factory=list)
    confidence: float = 1.0

    @field_validator("actions")
    @classmethod
    def limit_actions(cls, actions):
        if len(actions) > 10:
            raise ValueError("At most 10 financial actions per turn")
        return actions


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


class PendingReplyDecision(BaseModel):
    """A typed reply to available proposal options, never a new financial write."""
    decision: Literal["approve", "reject", "change_card", "revise_scope", "revise_purchase", "new_intent", "unclear"]
    new_installments: int | None = Field(None, description="Explicit revised purchase installment count, never a payment scope.")
    new_account: str | None = Field(None, description="Only the explicitly named replacement card; null for an unspecified other card.")
    installment_scope: CompactInstallmentScope | None = Field(None, description="Only a revised existing-installment bound: first:8, last:2, range:3:8, dates::2026-08-31. Never infer all.")


class DraftDecision(BaseModel):
    """O que a mensagem faz com um rascunho aberto — e QUAL é a entidade citada.

    `unrelated` existe para o modelo não ser forçado a escolher entre completar e
    descartar quando o usuário simplesmente mudou de assunto.

    `extracted_value` cabe na MESMA chamada de propósito: separar em duas
    dobraria a latência e comeria duas das 500 requisições diárias do Flash-Lite
    para chegar no mesmo lugar. É `str` com default `""` e não `Optional[str]`
    porque união vira `anyOf`, que o structured output do Gemini lida mal.
    """

    decision: Literal["answer", "discard", "unrelated"] = Field(
        description="answer, discard ou unrelated"
    )
    extracted_value: str = Field(
        default="",
        description=(
            "Só quando decision=answer: o nome próprio da conta/cartão citado, "
            "limpo, sem o resto da frase. Vazio se não houver."
        ),
    )
    amount_type: Literal["total", "per_installment", "ambiguous", "none"] = Field(
        default="none",
        description=(
            "O que o número da mensagem SIGNIFICA numa compra parcelada. "
            "per_installment quando ele disser que é o valor de cada parcela "
            "('700 cada', 'por mês', 'a parcela', 'cada uma sai'); "
            "total quando disser que é o preço cheio ('no total', 'ao todo', "
            "'saiu por'); ambiguous quando for um número solto e as duas "
            "leituras couberem; none quando não houver número."
        ),
    )
    already_paid_count: int | None = Field(
        default=None,
        description=(
            "Quantidade de parcelas que o usuário disse que JÁ PAGOU "
            "('já paguei 2 parcelas', 'já foram 2', 'paguei duas' -> 2). "
            "Vazio se não mencionou parcelas já pagas."
        ),
    )


class ResourceActionType(str, Enum):
    CREATE = 'resource_create'
    UPDATE = 'resource_update'
    DELETE = 'resource_delete'
    LIST = 'resource_list'
    PAY = 'resource_pay'


class ResourceField(BaseModel):
    """Field names and values are data, validated against the server catalogue."""
    name: str
    value: str | None = None


class ResourceAction(BaseModel):
    target_month: str | None = Field(None, description="Só para localizar orçamento existente: YYYY-MM-01 ou default (padrão). Não é o novo mês.")
    type: ResourceActionType
    resource: str = Field(description='Recurso do catálogo: accounts, cards, debts, goals, budgets, assets, recurring, rules, notes, reminders, folders.')
    name: str | None = Field(None, description='Nome do novo item ou nome EXATO do item existente. Não inventar IDs.')
    # Gemini rejects the combined nested maxItems (10 actions × 20 fields).
    # Keep the safety bound in server validation without exporting maxItems.
    fields: list[ResourceField] = Field(default_factory=list)

    @field_validator("fields")
    @classmethod
    def bound_fields(cls, fields: list[ResourceField]) -> list[ResourceField]:
        if len(fields) > 20:
            raise ValueError("No máximo 20 campos por cadastro.")
        return fields


class ResourcePlan(BaseModel):
    actions: list[ResourceAction] = Field(default_factory=list, max_length=10)
    confidence: float = 1.0


READ_ONLY.add(ResourceActionType.LIST)
