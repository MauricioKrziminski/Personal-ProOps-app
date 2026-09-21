"""Política de confirmação humana — pura, sem I/O e sem LangGraph.

Separada do nó `gate` de propósito: decidir O QUE precisa de um SIM é a regra de
segurança mais importante do produto, e regra de segurança que só dá para testar
subindo o grafo inteiro é regra que ninguém testa.
"""

from __future__ import annotations

from app.config import get_settings
from app.domain.dates import format_date_br
from app.domain.money import cents_to_brl
from app.graph.schemas import (
    DESTRUCTIVE,
    MONEY_WRITES,
    READ_ONLY,
    FinanceAction,
    FinanceActionType,
    FinanceQuery,
    NotesAction,
    ResourceAction,
)

CONFIDENCE_MINIMA = 0.6


# Altera registro existente mas NÃO passa pelo resolver (tem forma de duas
# etapas: conta -> fatura em aberto). Por isso entra explícito.
#
# Regras, metas e transferências também confirmam: alteram compromissos ou
# movimentam contas mesmo sem um alvo resolvido nesta fase.
ALWAYS_CONFIRM = {FinanceActionType.PAY_INVOICE, FinanceActionType.CREATE_GOAL,
                  FinanceActionType.SET_RULE, FinanceActionType.CREATE_TRANSFER}


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
    if isinstance(action, ResourceAction):
        return "cadastro ou alteração estrutural"
    if getattr(action, "recurrence", None) or action.type == FinanceActionType.CREATE_INSTALLMENT_PURCHASE:
        return "compromisso futuro"
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
    "pay_invoice": "pagar",
    "update_asset_value": "atualizar o valor de",
}


def _frase_correcao_plano(action: FinanceAction, target: dict, escolhido: dict) -> str:
    """Correção de VALOR num plano de parcelamento — por parcela, no total, ou sem dizer qual.

    `editaveis`/`travado_cents`/`total_cents`/`plan_installments` vêm CONGELADOS no
    candidato pelo resolvedor (via `private.parcela_travada`) — esta função só
    formata. `amount_unit` mora no ALVO, não na ação: só existe depois que o
    usuário escolheu entre os dois caminhos.

    ⚠️ Lê `editaveis`/`travado_cents` só DENTRO dos ramos que precisam deles: o
    candidato de hoje (antes de T3/T4 congelarem os campos novos) não os carrega,
    e o ramo sem `amount_unit` é exatamente o que roda nesse estado intermediário
    — ele não pode explodir num `KeyError` no meio de uma confirmação.
    """
    label = escolhido["label"]
    novo = action.new_amount_cents
    unit = target.get("amount_unit")
    if unit == "parcela":
        editaveis = escolhido["editaveis"]
        novo_total = escolhido["travado_cents"] + novo * editaveis
        return (
            f"corrigir {label}: {cents_to_brl(novo)} por parcela nas {editaveis} que ainda podem "
            f"mudar (novo total {cents_to_brl(novo_total)}); as pagas ficam como estão"
        )
    if unit == "total":
        editaveis = escolhido["editaveis"]
        diferenca = novo - escolhido["travado_cents"]
        return (
            f"corrigir o total de {label}: {cents_to_brl(escolhido['total_cents'])} → "
            f"{cents_to_brl(novo)} em {escolhido['plan_installments']}x "
            f"({cents_to_brl(diferenca)} divididos nas {editaveis} que podem mudar)"
        )
    # Sem unidade a frase não pode ler como "nada muda": diz o valor novo e
    # pergunta qual dos dois caminhos é — T3 garante que a execução recusa sem
    # `amount_unit`, então a pergunta aqui é honesta, não decorativa.
    return (
        f"corrigir {label}: novo valor {cents_to_brl(novo)} — é o total da compra ou o valor de "
        f"cada parcela? As pagas ficam como estão de qualquer forma"
    )


def _frase_conversao(action: FinanceAction, target: dict, escolhido: dict) -> str:
    """D1 — adotar um lançamento avulso como parcela 1 de uma compra parcelada nova.

    Sem valor por parcela de propósito: o cálculo mora no banco
    (`convert_transaction_to_installments`).
    """
    valor = action.new_amount_cents if action.new_amount_cents is not None else escolhido.get("amount_cents")
    valor_str = f" ({cents_to_brl(valor)})" if valor is not None else ""
    cartao = target["convert_account"]["name"]
    quando = escolhido.get("when", "")
    return (
        f"parcelar {escolhido['label']}{valor_str} em {action.installments}x "
        f"no cartão {cartao}, 1ª parcela em {quando}"
    )


def par_de_substituicao(acoes: list, alvos: list[dict | None]) -> set[int]:
    """Índices do lote quando ele mistura CRIAR algo novo com MUDAR o que já existe.

    Pura, sem I/O: `acoes`/`alvos` já vêm resolvidos. `undo_last` conta SEMPRE —
    ele sempre mira "o mais recente", com ou sem alvo resolvido. `delete_transaction`
    e `update_transaction` só contam com alvo `found` ou `ambiguous`: alvo `none`
    é busca que não achou nada, não uma mutação real.
    """
    tem_create = any(
        isinstance(getattr(a, "type", None), FinanceActionType) and a.type.value.startswith("create_")
        for a in acoes
    )
    if not tem_create:
        return set()

    muta_existente = {FinanceActionType.DELETE_TRANSACTION, FinanceActionType.UPDATE_TRANSACTION}
    for indice, acao in enumerate(acoes):
        tipo = getattr(acao, "type", None)
        if tipo == FinanceActionType.UNDO_LAST:
            return set(range(len(acoes)))
        alvo = alvos[indice] if indice < len(alvos) else None
        if tipo in muta_existente and (alvo or {}).get("status") in ("found", "ambiguous"):
            return set(range(len(acoes)))
    return set()


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
    if isinstance(action, ResourceAction):
        return (target or {}).get("prepared", {}).get("summary", "revisar cadastro")
    if target and target.get("candidates"):
        verbo = _VERBO.get(action.type.value, "mexer em")
        # Quitar a fatura sem caixa e pagar a fatura terminam com a mesma palavra na
        # tela ("paga"), e são efeitos diferentes: um mexe no saldo da conta pagadora
        # e o outro não. A frase tem que dizer QUAL dos dois, senão o SIM não distingue.
        #
        # ⚠️ **A condição é a AÇÃO, não a tabela do alvo** (11/09/2026). Escrita como
        # `table == "card_invoices"`, ela valia para qualquer ação que resolvesse uma
        # fatura — e até 11/09 só `mark_paid` resolvia. No mesmo dia `pay_invoice`
        # passou a resolver a fatura como alvo (para empate virar pergunta em vez de
        # pagar a mais antiga em silêncio), e herdou a frase: o agente perguntava
        # "marcar como paga, SEM tirar do caixa?" para a ação que TIRA do caixa.
        # Visto no emulador, e é o pior lugar possível para uma frase errada — ela é
        # exatamente o que o usuário aprova.
        if target.get("table") == "card_invoices" and action.type.value == "mark_paid":
            verbo = "marcar como paga, SEM tirar do caixa,"
        if target.get("status") == "found":
            escolhido = target["candidates"][0]
            if (
                target.get("table") == "installment_plans"
                and isinstance(action, FinanceAction)
                and action.type == FinanceActionType.UPDATE_TRANSACTION
                and action.new_amount_cents is not None
            ):
                return _frase_correcao_plano(action, target, escolhido)
            if (
                target.get("convert_account")
                and isinstance(action, FinanceAction)
                and action.type == FinanceActionType.UPDATE_TRANSACTION
                and (action.installments or 0) >= 2
            ):
                return _frase_conversao(action, target, escolhido)
            # O detalhe (valor, data) só existe onde o rótulo não coube — hoje o
            # plano de parcelamento. Numa confirmação DESTRUTIVA o usuário precisa
            # ver o dinheiro antes de dizer sim, não só o nome.
            extra = f" ({escolhido['when']})" if escolhido.get("when") else ""
            corrections = []
            if isinstance(action, FinanceAction) and action.type == FinanceActionType.UPDATE_TRANSACTION:
                if action.new_amount_cents is not None:
                    corrections.append(f"valor → {cents_to_brl(action.new_amount_cents)}")
                if action.new_category:
                    corrections.append(f"categoria → {action.new_category}")
                if action.new_occurred_at:
                    corrections.append(f"data → {format_date_br(action.new_occurred_at)}")
                if action.new_account:
                    account_name = (target.get("new_account") or {}).get("name", action.new_account)
                    corrections.append(f"conta → {account_name}")
                if action.new_description:
                    corrections.append(f"nome → {action.new_description}")
            suffix = f": {', '.join(corrections)}" if corrections else ""
            # Numa compra parcelada a correção vale para a parcela em aberto e as
            # seguintes, nunca para as já pagas. O rótulo do candidato diz "Tudo (10x)",
            # que é o alvo da BUSCA — sem esta linha o usuário confirmaria entendendo
            # que as dez mudam.
            if (target.get("table") == "installment_plans" and corrections
                    and isinstance(action, FinanceAction)
                    and action.type == FinanceActionType.UPDATE_TRANSACTION):
                suffix += " (só as parcelas em aberto; as pagas ficam como estão)"
            return f"{verbo} {escolhido['label']}{extra}{suffix}"
        # Empate: as opções REAIS vão na lista, então a frase só precisa dizer o
        # que vai acontecer. Cair no texto do modelo aqui reintroduzia o eco que
        # este desenho existe para eliminar ("apagar a nota sobre esse item").
        if isinstance(action, FinanceAction) and action.type == FinanceActionType.UPDATE_TRANSACTION:
            corrected = action.model_copy(update={"new_account": (target.get("new_account") or {}).get("name", action.new_account)})
            return describe_for_confirmation(corrected)
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
            account = (target or {}).get("new_account", {}).get("name", action.new_account)
            changes = ", ".join(x for x in (
                f"valor → {novo}" if novo else None,
                f"conta → {account}" if account else None,
                f"categoria → {action.new_category}" if action.new_category else None,
                f"data → {format_date_br(action.new_occurred_at)}" if action.new_occurred_at else None,
                f"nome → {action.new_description}" if action.new_description else None,
            ) if x)
            return f"corrigir {alvo}: {changes}" if changes else f"corrigir {alvo}"
        if tipo == "create_installment_purchase":
            paid=action.already_paid_count or 0
            return f"registrar {valor} em {action.installments}x no cartão {action.account or 'a informar'}: {paid} parcelas iniciais pagas e {(action.installments or 0)-paid} pendentes"
        if tipo == "pay_invoice":
            # com valor a frase precisa dizer QUANTO: pagamento parcial e quitação são efeitos
            # diferentes, e confirmar "o pagamento da fatura" não distingue os dois
            cartao = action.account or "cartão"
            return (
                f"registrar {valor} de pagamento na fatura do {cartao}" if valor
                else f"registrar o pagamento da fatura do {cartao}"
            )
        # A conta entra na frase quando o usuário citou uma: é o que permite corrigir o meio
        # ("não, foi no Itaú") antes da escrita, sem custar uma pergunta a mais. Quando ele não
        # citou, a frase CALA em vez de afirmar "na conta padrão" — pode não haver nenhuma, e
        # este módulo é puro de propósito: descobrir isso exigiria ir ao banco.
        onde = f", no {action.account}" if action.account else ""
        return f"registrar {valor} em {alvo}{onde}" if valor else f"registrar {alvo}{onde}"

    alvo = action.search_term or action.content or "esse item"
    if tipo == "delete_note":
        return f"apagar a nota sobre {alvo}"
    if tipo == "delete_reminder":
        return f"cancelar o lembrete de {alvo}"
    return f"salvar {alvo}"
