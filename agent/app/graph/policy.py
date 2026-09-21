"""Política de confirmação humana — pura, sem I/O e sem LangGraph.

Separada do nó `gate` de propósito: decidir O QUE precisa de um SIM é a regra de
segurança mais importante do produto, e regra de segurança que só dá para testar
subindo o grafo inteiro é regra que ninguém testa.
"""

from __future__ import annotations

from app.config import get_settings
from app.domain.correcao_plano import (
    CONTA_DO_PLANO,
    DATA_DO_PLANO,
    MUDAR_PARCELAS,
    PARCELA_TRAVADA,
    SEM_CORRECAO,
    VARIAS_PARCELAS,
    e_conversao,
)
from app.domain.dates import format_date_br
from app.domain.money import cents_to_brl
from app.domain.recurrence import descreve_rrule
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

    ⚠️ **Toda escrita pede SIM** (21/09/2026, decisão do dono do produto). Até
    então gasto/receita abaixo de `hitl_amount_threshold_cents`, nota e lembrete
    simples gravavam direto. Os motivos específicos continuam (são o que diz ao
    worker POR QUE perguntou); o que não tem nenhum cai em "registro novo". Só
    consulta (`READ_ONLY`) e `unknown` — que o registry transforma em ajuda sem
    tocar no banco — passam sem pergunta.

    "Item existente" é alvo RESOLVIDO (tem `status`), não qualquer dict: a conta
    padrão congelada no alvo de uma criação (`resolve.conta_padrao`) não é alvo.
    """
    settings = get_settings()

    if action.type in READ_ONLY or action.type.value == "unknown":
        return None
    if isinstance(action, ResourceAction):
        return "cadastro ou alteração estrutural"
    if getattr(action, "recurrence", None) or action.type == FinanceActionType.CREATE_INSTALLMENT_PURCHASE:
        return "compromisso futuro"
    if action.type in DESTRUCTIVE:
        return "destrutiva"
    if target and target.get("status"):
        return "alterar item existente"
    if action.type in ALWAYS_CONFIRM:
        return "alterar item existente"
    if action.type in MONEY_WRITES:
        valor = getattr(action, "new_amount_cents", None) or getattr(action, "amount_cents", None)
        if valor and valor > settings.hitl_amount_threshold_cents:
            return "valor alto"
    if confidence < CONFIDENCE_MINIMA:
        return "baixa confiança"
    return "registro novo"


_VERBO = {
    "delete_transaction": "apagar", "undo_last": "apagar",
    "delete_note": "apagar", "delete_reminder": "cancelar",
    "update_transaction": "corrigir", "append_note": "acrescentar em",
    "mark_paid": "dar baixa em", "goal_deposit": "aportar em",
    "pay_invoice": "pagar",
    "update_asset_value": "atualizar o valor de",
}


def _outras_correcoes(action: FinanceAction, target: dict) -> list[str]:
    """Os `new_*` que a correção comum mostra, MENOS o valor — que quem chama já
    trata sozinho (editaveis/travado ou o valor cru da conversão).

    A frase de plano tem que listar `nome → X`/`categoria → X`/etc. igual à
    correção comum: um SIM que muda valor E nome só pode aprovar os dois se a
    frase falar dos dois — perder um aqui é o usuário aprovando um efeito que
    não leu.
    """
    outras = []
    if action.new_category:
        outras.append(f"categoria → {action.new_category}")
    if action.new_occurred_at:
        outras.append(f"data → {format_date_br(action.new_occurred_at)}")
    if action.new_account:
        account_name = (target.get("new_account") or {}).get("name", action.new_account)
        outras.append(f"conta → {account_name}")
    if action.new_description:
        outras.append(f"nome → {action.new_description}")
    return outras


def _frase_correcao_plano(action: FinanceAction, target: dict, escolhido: dict) -> str:
    """Correção de VALOR num plano de parcelamento — por parcela, no total, ou sem dizer qual.

    `editaveis`/`travado_cents`/`total_cents`/`plan_installments` vêm CONGELADOS no
    candidato pelo resolvedor (via `private.parcela_travada`) — esta função só
    formata. `amount_unit` mora no ALVO, não na ação: só existe depois que o
    usuário escolheu entre os dois caminhos.

    ⚠️ Lê `editaveis`/`travado_cents` só DENTRO dos ramos que precisam deles: o
    candidato de uma pendência de antes do deploy não os carrega, e o ramo sem
    `amount_unit` é exatamente o que roda nesse estado — ele não pode explodir num
    `KeyError` no meio de uma confirmação.
    """
    label = escolhido["label"]
    novo = action.new_amount_cents
    unit = target.get("amount_unit")
    outras = _outras_correcoes(action, target)
    # "as pagas ficam como estão" vale para o VALOR; nome e categoria da compra mudam
    # em todas as parcelas, inclusive as pagas (Reparcelar, finance.md)
    suffix = f"; {', '.join(outras)} em todas as parcelas" if outras else ""
    if unit == "parcela":
        editaveis = escolhido["editaveis"]
        novo_total = escolhido["travado_cents"] + novo * editaveis
        onde = ("na única que ainda pode mudar" if editaveis == 1
                else f"nas {editaveis} que ainda podem mudar")
        return (
            f"corrigir {label}: {cents_to_brl(novo)} por parcela {onde} "
            f"(novo total {cents_to_brl(novo_total)}; as pagas ficam como estão){suffix}"
        )
    if unit == "total":
        editaveis = escolhido["editaveis"]
        diferenca = novo - escolhido["travado_cents"]
        onde = ("na única que pode mudar" if editaveis == 1
                else f"divididos nas {editaveis} que podem mudar")
        return (
            f"corrigir o total de {label}: {cents_to_brl(escolhido['total_cents'])} → "
            f"{cents_to_brl(novo)} em {escolhido['plan_installments']}x "
            f"({cents_to_brl(diferenca)} {onde}){suffix}"
        )
    # Sem unidade: só a pendência de antes do deploy chega aqui — hoje o `gate`
    # pergunta "total ou cada parcela?" (`_perguntar_unidade`) antes do SIM, e
    # `_corrigir_plano` recusa sem `amount_unit`. A frase diz o valor novo e a
    # pergunta; "as pagas ficam" vale só para o VALOR (nome e categoria mudam em todas).
    return (
        f"corrigir {label}: novo valor {cents_to_brl(novo)} — é o total da compra ou "
        f"o valor de cada parcela? No valor, as pagas ficam como estão{suffix}"
    )


def _frase_conversao(action: FinanceAction, target: dict, escolhido: dict) -> str:
    """D1 — adotar um lançamento avulso como parcela 1 de uma compra parcelada nova.

    Sem valor por parcela de propósito: o cálculo mora no banco
    (`convert_transaction_to_installments`). `nome`, `amount_cents` e `occurred_at`
    vêm congelados no candidato pelo resolvedor — o `label` é a sentença inteira de
    `describe()` e repetiria o valor. Nome e categoria novos entram na frase porque a
    RPC os grava: o SIM não aprova efeito que a frase não disse. A data nova é a da
    1ª parcela, e o cartão já está na frase — por isso nem "data →" nem "conta →".
    """
    valor = action.new_amount_cents if action.new_amount_cents is not None else escolhido.get("amount_cents")
    valor_str = f" ({cents_to_brl(valor)})" if valor is not None else ""
    cartao = target["convert_account"]["name"]
    data = action.new_occurred_at or escolhido.get("occurred_at")
    quando = format_date_br(data) if data else escolhido.get("when")
    quando_str = f", 1ª parcela em {quando}" if quando else ""
    outras = [o for o in _outras_correcoes(action, target)
              if not o.startswith(("data →", "conta →"))]
    outras_str = f"; {', '.join(outras)}" if outras else ""
    nome = escolhido.get("nome") or escolhido["label"]
    return (
        f"parcelar {nome}{valor_str} em {action.installments}x "
        f"no cartão {cartao}{quando_str}{outras_str}"
    )


def plano_inteiro(target: dict | None) -> bool:
    """O alvo é a COMPRA inteira (não uma parcela congelada no snapshot)."""
    target = target or {}
    cands = target.get("candidates") or []
    return (target.get("table") == "installment_plans" and target.get("status") == "found"
            and bool(cands) and not cands[0].get("installment_snapshot"))


def erro_de_correcao(action, target: dict | None) -> str | None:
    """Correção que não dá para confirmar — recusada ANTES do SIM, não depois dele.

    Pura, e roda no `gate` (a cada resume, inclusive de pendência antiga) e de novo
    depois da escolha no empate. Plano inteiro: data e conta só em "Editar a compra"
    do app. Snapshot: uma parcela por vez, e parcela travada não muda de dinheiro.
    A tool repete as recusas como segunda trava.
    """
    if getattr(action, "type", None) != FinanceActionType.UPDATE_TRANSACTION:
        return None
    # recusa congelada no candidato escolhido num empate (ex.: conversão sem cartão)
    if (target or {}).get("correction_error"):
        return target["correction_error"]
    cands = (target or {}).get("candidates") or []
    n_plano = (cands[0].get("plan_installments")
               if (target or {}).get("status") == "found" and cands else None)
    # `installments` só é correção quando MUDA algo: igual ao N do plano é pista de
    # busca, e 1 sozinho não parcela nada.
    muda_parcelas = bool(action.installments) and action.installments != n_plano and (
        n_plano is not None or action.installments >= 2)
    if not any([action.new_amount_cents is not None, action.new_category, action.new_occurred_at,
                action.new_description, action.new_account, muda_parcelas]):
        return SEM_CORRECAO
    if n_plano is not None and muda_parcelas:
        return MUDAR_PARCELAS
    if plano_inteiro(target):
        if action.new_occurred_at:
            return DATA_DO_PLANO
        if action.new_account:
            return CONTA_DO_PLANO
        return None
    target = target or {}
    cands = target.get("candidates") or []
    snapshot = cands[0].get("installment_snapshot") if cands else None
    if target.get("status") == "found" and snapshot:
        linhas = snapshot.get("rows") or []
        if len(linhas) != 1:
            return VARIAS_PARCELAS
        # Reparcelar, regra 1: parcela travada não muda valor, data nem conta; nome e
        # categoria sim. A trava vem congelada do banco (`private.parcela_travada`).
        mexe_dinheiro = (action.new_amount_cents is not None or action.new_occurred_at
                         or action.new_account)
        if linhas[0].get("travada") and mexe_dinheiro:
            return PARCELA_TRAVADA
    return None


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
    action: FinanceAction | FinanceQuery | NotesAction, target: dict | None = None,
    hoje: str | None = None,
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
                # UMA parcela congelada ("muda a 3ª para 300") não tem "total ou cada?"
                and not escolhido.get("installment_snapshot")
            ):
                return _frase_correcao_plano(action, target, escolhido)
            if (
                target.get("table") == "transactions"
                and target.get("convert_account")
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
            # Compra inteira sem valor = nome/categoria (data e conta são recusadas em
            # `erro_de_correcao`), e a `update_installment_plan` aplica os dois a TODAS
            # as parcelas, inclusive as pagas — a frase diz isso em vez de prometer o
            # contrário.
            if (target.get("table") == "installment_plans" and corrections
                    and not escolhido.get("installment_snapshot")
                    and isinstance(action, FinanceAction)
                    and action.type == FinanceActionType.UPDATE_TRANSACTION):
                suffix += " (vale para todas as parcelas, inclusive as pagas)"
            return f"{verbo} {escolhido['label']}{extra}{suffix}"
        # Empate: as opções REAIS vão na lista, então a frase só precisa dizer o
        # que vai acontecer. Cair no texto do modelo aqui reintroduzia o eco que
        # este desenho existe para eliminar ("apagar a nota sobre esse item").
        if e_conversao(action):
            return f"parcelar {action.description or 'o lançamento'} em {action.installments}x — qual?"
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
            nome = f" de {action.description}" if action.description else ""
            return f"registrar {valor}{nome} em {action.installments}x no cartão {action.account or 'a informar'}: {paid} parcelas iniciais pagas e {(action.installments or 0)-paid} pendentes"
        if tipo == "pay_invoice":
            # com valor a frase precisa dizer QUANTO: pagamento parcial e quitação são efeitos
            # diferentes, e confirmar "o pagamento da fatura" não distingue os dois
            cartao = action.account or "cartão"
            return (
                f"registrar {valor} de pagamento na fatura do {cartao}" if valor
                else f"registrar o pagamento da fatura do {cartao}"
            )
        # A conta entra na frase: é o que permite corrigir o meio ("não, foi no Itaú")
        # antes da escrita. Citada, é a citada. Não citada, é a conta padrão que
        # `resolve.conta_padrao` congelou no alvo (21/09/2026 — "a resposta diz o que
        # foi decidido por ela" vale também na pergunta). Sem o nome congelado (ação
        # que não cai na conta padrão), a frase cala em vez de adivinhar.
        padrao = (target or {}).get("default_account")
        if action.account:
            onde = f", no {action.account}"
        elif padrao is not None:
            onde = f", na conta {padrao['name']}" if padrao.get("name") else ", sem conta"
        else:
            onde = ""
        if tipo == "create_transfer":
            # sem origem conhecida a frase cala sobre ela — a tool recusa sem as duas contas
            origem = action.account or (padrao or {}).get("name")
            de = f" de {origem}" if origem else ""
            destino = action.counterparty_account or "a conta de destino"
            return f"transferir {valor or 'o valor'}{de} para {destino}"
        o_que = {"create_expense": "gasto de ", "create_income": "receita de "}.get(tipo, "")
        # A data só entra quando NÃO é hoje (`hoje` vem do fuso do usuário, pelo gate):
        # "gastei 45 ontem" aprovado como se fosse hoje é o efeito que a frase esconde.
        # Sem `hoje` (chamador que não sabe o fuso), a data aparece sempre que existir.
        quando = (f" em {format_date_br(action.occurred_at)}"
                  if action.occurred_at and action.occurred_at[:10] != hoje else "")
        repete = f", repete {descreve_rrule(action.recurrence)}" if action.recurrence else ""
        if valor:
            return f"registrar {o_que}{valor} em {alvo}{quando}{onde}{repete}"
        return f"registrar {alvo}{quando}{onde}{repete}"

    alvo = action.search_term or action.content or "esse item"
    if tipo == "delete_note":
        return f"apagar a nota sobre {alvo}"
    if tipo == "delete_reminder":
        return f"cancelar o lembrete de {alvo}"
    if tipo == "create_note":
        pasta = f" na pasta {action.folder}" if action.folder else ""
        return f"criar a nota «{action.content or ''}»{pasta}"
    if tipo == "create_reminder":
        quando = ""
        if action.remind_at:
            hora = str(action.remind_at)[11:16]
            quando = f" para {format_date_br(action.remind_at)}" + (f" às {hora}" if hora else "")
        repete = " (repete)" if action.recurrence else ""
        return f"criar o lembrete «{action.content or ''}»{quando}{repete}"
    return f"salvar {alvo}"
