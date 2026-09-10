"""Closed catalogue for app records. Prepare is read-only; execute uses frozen data.

All identifiers below are server literals. User/model data is always bound as values.
Updates compare the record snapshot in the same SQL statement as the write.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from app import db
from app.domain.dates import now_utc, to_instant, local_iso_date
from app.domain.money import cents_to_brl, MAX_CENTS
from app.domain.recurrence import next_occurrence
from app.domain.categories import normalize
from app.graph.schemas import ResourceAction, ResourceActionType as Op
from app.tools.base import ExecContext, ToolResult
from app.tools.guards import Level1Error, clean_rrule

# table, identifying column, deletion semantics, editable columns
CATALOG = {
    "accounts": (
        "accounts",
        "name",
        "archived",
        "name type initial_balance_cents archived is_default",
    ),
    "cards": (
        "accounts",
        "name",
        "archived",
        "name closing_day due_day credit_limit_cents payment_account_id archived",
    ),
    "debts": (
        "debts",
        "name",
        "archived",
        "name kind calculation_mode principal_cents remaining_cents interest_rate_monthly installments installments_paid installment_cents due_day account_id started_at archived",
    ),
    "goals": ("goals", "name", "archived", "name target_cents deadline archived"),
    "budgets": ("budgets", "category", None, "category limit_cents rollover month"),
    "assets": (
        "assets",
        "name",
        "archived",
        "name class is_liability current_value_cents acquired_at archived",
    ),
    "recurring": (
        "recurring_transactions",
        "description",
        "active",
        "kind amount_cents category description account_id rrule dtstart auto_confirm active",
    ),
    "rules": (
        "categorization_rules",
        "pattern",
        None,
        "match_type pattern category account_id priority",
    ),
    "notes": ("notes", "content", "deleted_at", "content folder_id pinned trashed"),
    "reminders": (
        "reminders",
        "title",
        "active",
        "title recurrence next_run_at channel active",
    ),
    "folders": ("note_folders", "name", None, "name parent_id"),
}
REQUIRED = {
    "accounts": ("name", "type"),
    "cards": ("name", "closing_day", "due_day"),
    "debts": ("name", "kind"),
    "goals": ("name", "target_cents"),
    "budgets": ("category", "limit_cents"),
    "assets": ("name", "class", "current_value_cents"),
    "recurring": ("kind", "amount_cents", "description", "rrule", "dtstart"),
    "rules": ("pattern", "category", "match_type"),
    "notes": ("content",),
    "reminders": ("title", "next_run_at"),
    "folders": ("name",),
}
# O modo é do CONTRATO, não do formulário. `fixed_installments` (o "Simples" do
# app, migration 20260908201355) descreve o total das parcelas — juros dentro,
# sem separar —; `amortized` descreve principal e taxa. O app passou a abrir em
# Simples e o agente ficou preso no detalhado: pedia principal, saldo devedor e
# taxa mensal de um contrato que a pessoa não tem em mãos, e repetia a mesma
# frase para sempre porque não havia resposta possível.
DEBT_REQUIRED = {
    "fixed_installments": ("installment_cents", "installments"),
    "amortized": ("principal_cents", "remaining_cents", "interest_rate_monthly"),
}
LABELS = {
    "accounts": "conta",
    "cards": "cartão",
    "debts": "dívida/financiamento",
    "goals": "meta",
    "budgets": "orçamento",
    "assets": "bem/investimento",
    "recurring": "lançamento recorrente",
    "rules": "regra de categoria",
    "notes": "nota",
    "reminders": "lembrete",
    "folders": "pasta",
    "name": "nome",
    "closing_day": "dia de fechamento",
    "due_day": "dia de vencimento",
    "credit_limit_cents": "limite",
    "type": "tipo de conta",
    "kind": "tipo",
    "calculation_mode": "modo de cálculo",
    "principal_cents": "principal original",
    "remaining_cents": "saldo devedor atual",
    "interest_rate_monthly": "juros ao mês",
    "installments": "parcelas totais",
    "installments_paid": "parcelas já pagas",
    "installment_cents": "valor da parcela",
    "account_id": "conta",
    "payment_account_id": "conta pagadora",
    "initial_balance_cents": "saldo inicial",
    "target_cents": "valor da meta",
    "deadline": "prazo",
    "category": "categoria",
    "limit_cents": "limite",
    "rollover": "acumular sobra",
    "month": "mês",
    "class": "classe",
    "is_liability": "é passivo",
    "current_value_cents": "valor atual",
    "acquired_at": "data de aquisição",
    "amount_cents": "valor",
    "description": "descrição",
    "rrule": "frequência",
    "dtstart": "primeira ocorrência",
    "auto_confirm": "confirmar automaticamente",
    "active": "ativo",
    "archived": "arquivado",
    "pattern": "termo",
    "match_type": "tipo de correspondência",
    "priority": "prioridade",
    "content": "conteúdo",
    "folder_id": "pasta",
    "pinned": "fixada",
    "title": "título",
    "recurrence": "frequência",
    "next_run_at": "próximo envio",
    "channel": "canal",
    "parent_id": "pasta superior",
    "started_at": "início do contrato",
    "paid_at": "data do pagamento",
    "is_default": "conta padrão",
    "trashed": "na lixeira",
}
ENUMS = {
    ("accounts", "type"): {"checking", "savings", "cash", "investment"},
    ("debts", "kind"): {"loan", "financing", "credit_card", "person", "other"},
    ("debts", "calculation_mode"): {"amortized", "fixed_installments"},
    ("assets", "class"): {
        "investment",
        "real_estate",
        "vehicle",
        "crypto",
        "equity",
        "receivable",
        "other",
    },
    ("recurring", "kind"): {"expense", "income"},
    ("reminders", "channel"): {"push", "whatsapp", "both"},
    ("rules", "match_type"): {"contains", "merchant"},
}
BOOLS = {"archived", "active", "rollover", "is_liability", "auto_confirm", "pinned", "is_default", "trashed"}
LINKS = {
    "account_id": "accounts",
    "payment_account_id": "accounts",
    "folder_id": "note_folders",
    "parent_id": "note_folders",
}


def _error(text):
    raise Level1Error(text)


def validate_fields(action: ResourceAction) -> dict:
    if action.resource not in CATALOG:
        _error(
            "Esse recurso não está disponível. Posso gerenciar contas, cartões, dívidas, metas, orçamentos, recorrências, patrimônio, notas, lembretes, pastas e regras."
        )
    _, identity, _, columns = CATALOG[action.resource]
    if action.type == Op.PAY:
        if action.resource != "debts":
            _error("O pagamento de prestação deve indicar uma dívida ou financiamento.")
        columns = "amount_cents account_id paid_at"
    values = {}
    for field in action.fields:
        key, value = field.name, field.value
        if key not in columns.split() or key in values:
            _error("Campo não permitido ou repetido nesta operação.")
        if value is None:
            if key in BOOLS or key in {
                "initial_balance_cents",
                "interest_rate_monthly",
                "installments_paid",
                "priority",
                "started_at",
                "paid_at",
            }:
                _error(f"{LABELS[key]} não pode ficar vazio.")
            values[key] = None
            continue
        value = value.strip()
        if key in BOOLS:
            if value not in {"true", "false"}:
                _error(f"Informe sim ou não para {LABELS[key]}.")
            value = value == "true"
        elif key.endswith("_cents") or key in {
            "closing_day",
            "due_day",
            "installments",
            "installments_paid",
            "priority",
        }:
            try:
                value = int(value)
            except ValueError:
                _error(f"Informe um número inteiro para {LABELS[key]}.")
            minimum = -MAX_CENTS if key == "initial_balance_cents" else 0
            if not minimum <= value <= MAX_CENTS:
                _error(f"Valor inválido para {LABELS[key]}.")
            if key in {"closing_day", "due_day"} and not 1 <= value <= 31:
                _error("Dia deve estar entre 1 e 31.")
            if (
                key
                in {
                    "amount_cents",
                    "target_cents",
                    "limit_cents",
                    "installment_cents",
                    "principal_cents",
                    "installments",
                }
                and value <= 0
            ):
                _error(f"{LABELS[key]} deve ser positivo.")
            if key == "installments" and value > 1200:
                _error("Número de parcelas fora do intervalo permitido.")
        elif key == "interest_rate_monthly":
            try:
                n = Decimal(value.replace(",", "."))
            except InvalidOperation:
                _error("Informe a taxa mensal do contrato.")
            if not n.is_finite() or not 0 <= n <= 1:
                _error("Taxa mensal inválida.")
            value = str(n)
        elif key in {"started_at", "acquired_at", "deadline", "month", "paid_at"}:
            try:
                value = date.fromisoformat(value).isoformat()
            except ValueError:
                _error(f"Data inválida: {LABELS[key]}.")
            if key == "month" and not value.endswith("-01"):
                _error("O mês do orçamento deve começar no dia 1.")
        elif key in {"rrule", "recurrence"}:
            value = clean_rrule(value)
        elif not value or len(value) > 20000:
            _error(f"Informe {LABELS.get(key, key)} válido.")
        if (action.resource, key) in ENUMS and value not in ENUMS[action.resource, key]:
            _error(
                f"Tipo inválido para {LABELS[key]}. Opções: {', '.join(sorted(ENUMS[action.resource, key]))}."
            )
        values[key] = value
    if action.type == Op.CREATE and action.name and identity not in values:
        values[identity] = action.name.strip()
    if action.resource == "folders":
        if "name" in values:
            values["name"] = normalize(values["name"])
            if not values["name"] or len(values["name"]) > 40:
                _error("Nome de pasta deve ter entre 1 e 40 caracteres.")
    if (
        action.resource == "debts"
        and action.type == Op.UPDATE
        and "installments_paid" in values
        and "remaining_cents" not in values
    ):
        _error(
            "Essas parcelas já estão consideradas no saldo devedor? Informe quantas já foram pagas e o saldo devedor atual para corrigir o histórico sem lançar novo pagamento."
        )
    if action.type != Op.CREATE and "calculation_mode" in values:
        # Mesma regra do trigger `tg_debts_calculation_mode`: dito aqui, o usuário
        # lê o motivo em vez de uma exceção do Postgres.
        _error(
            "O modo de cálculo de um financiamento não muda depois de criado. "
            "Cadastre outro contrato se for o caso."
        )
    if action.type == Op.CREATE:
        if action.resource == "recurring":
            values.setdefault("auto_confirm", False)
        requeridos = REQUIRED[action.resource]
        if action.resource == "debts":
            requeridos = (*requeridos, *_debt_mode(values))
        for key in requeridos:
            if values.get(key) is None or values.get(key) == "":
                _error(
                    f"Para cadastrar {LABELS[action.resource]}, informe {LABELS[key]}. Ainda não salvei nada."
                )
        # O que só um CONTRATO COM PARCELAS precisa. "Devo 500 pro João" não tem
        # cadência nem vencimento, e exigir isso ali travaria a conversa por um
        # dado que não existe.
        #
        # Os dois numa pergunta só, e não uma por turno: são duas palavras na
        # resposta ("8, dia 10") e o modelo preenche as duas de uma vez. Faltando
        # apenas um, a frase encolhe sozinha e pergunta só o que falta.
        #
        # `due_day` entrou em 09/09/2026: sem ele o cronograma ancorava no dia de
        # HOJE, então a data da próxima parcela andava um dia por dia — e com ela
        # a projeção de caixa, as contas a pagar e o histórico estimado.
        if action.resource == "debts" and values.get("installments"):
            pedidos = []
            if values.get("installments_paid") is None:
                pedidos.append("quantas parcelas você já pagou (zero se nenhuma)")
            if values.get("due_day") is None:
                pedidos.append("que dia do mês vence a parcela")
            if pedidos:
                _error(
                    "Me diz " + " e ".join(pedidos)
                    + ". Ainda não salvei o financiamento."
                )
        if action.resource == "debts" and values["calculation_mode"] == "fixed_installments":
            _derive_fixed_installments(values)
        if action.resource == "cards":
            values["type"] = "credit_card"
        if action.resource == "reminders":
            values.setdefault("channel", "push")
    return values


def _debt_mode(values: dict) -> tuple[str, ...]:
    """Fixa `calculation_mode` e devolve o que o modo exige ao criar.

    Sem o campo, o modo sai do que FOI informado: principal ou saldo devedor é
    contrato detalhado, o resto é o simples. Depender do modelo lembrar de uma
    chave a mais seria o mesmo defeito por outra porta — taxa zero não conta
    como juros informados.
    """
    taxa = values.get("interest_rate_monthly")
    detalhado = bool(
        values.get("principal_cents")
        or values.get("remaining_cents")
        or (taxa is not None and Decimal(taxa) > 0)
    )
    modo = values.get("calculation_mode") or ("amortized" if detalhado else "fixed_installments")
    values["calculation_mode"] = modo
    return DEBT_REQUIRED[modo]


def _derive_fixed_installments(values: dict) -> None:
    """Principal, saldo e taxa SAEM da parcela.

    O check `debts_fixed_installments_check` exige exatamente estas igualdades;
    derivar aqui é o que impede o agente e o app de gravarem dois números
    diferentes para o mesmo contrato.
    """
    parcela, total, pagas = (
        values["installment_cents"], values["installments"], values["installments_paid"]
    )
    if not 0 <= pagas <= total:
        _error(f"Parcelas já pagas devem ficar entre 0 e {total}.")
    if parcela * total > MAX_CENTS:
        _error("O total das parcelas ultrapassa o limite permitido.")
    values["principal_cents"] = parcela * total
    values["remaining_cents"] = parcela * (total - pagas)
    values["interest_rate_monthly"] = "0"


def _where(resource, lixeira=None):
    if resource == "cards":
        return " and type = 'credit_card'"
    if resource == "accounts":
        return " and type <> 'credit_card'"
    if resource == "notes":
        # `trashed` no pedido é o usuário dizendo que fala da LIXEIRA — restaurar
        # ("tira da lixeira") e apagar de vez só alcançam a nota se a busca parar
        # de filtrar `deleted_at is null`. Sem isto o "não encontrei" seria mentira:
        # a nota existe, só está do outro lado do filtro.
        return " and deleted_at is not null" if lixeira is not None else " and deleted_at is null"
    return ""


async def prepare(ctx: ExecContext, action: ResourceAction) -> dict:
    values = validate_fields(action)
    table, identity, deletion, _ = CATALOG[action.resource]
    prepared = {
        "table": table,
        "values": values,
        "resource": action.resource,
        "operation": action.type.value,
    }
    # Campos VIRTUAIS: o modelo fala a linguagem do app e o SQL fica com a coluna real.
    # Saem de `values` ANTES de qualquer ramo porque tanto o INSERT quanto o UPDATE de
    # `execute` são montados a partir destas chaves — um `is_default` sobrando viraria
    # `insert into accounts (..., is_default)` numa coluna que não existe.
    if "is_default" in values:
        prepared["set_default"] = values.pop("is_default")
    lixeira = None
    if "trashed" in values:
        lixeira = queria_lixeira = values.pop("trashed")
        if action.type == Op.UPDATE:
            # false = tirar da lixeira (é o `useRestoreNote` do app). true seria mandar
            # para a lixeira, que já é o que `resource_delete` faz.
            values["deleted_at"] = now_utc().isoformat() if queria_lixeira else None
        elif action.type == Op.DELETE and not queria_lixeira:
            _error("Para apagar de vez, diga que a nota está na lixeira.")
        elif action.type == Op.CREATE:
            _error("Uma nota nova não nasce na lixeira.")
    if values.get("calculation_mode"):
        prepared["calculation_mode"] = values["calculation_mode"]
    if action.type == Op.LIST:
        prepared["summary"] = f"listar {LABELS[action.resource]}"
        return prepared
    if action.type != Op.CREATE:
        if not action.name:
            _error(f"Qual {LABELS[action.resource]}? Informe o nome exato.")
        lookup_name = (
            normalize(action.name) if action.resource == "folders" else action.name
        )
        selector = ""
        params = [ctx.workspace_id, lookup_name]
        if action.resource == "budgets" and action.target_month:
            if action.target_month == "default":
                selector = " and month is null"
            else:
                try:
                    month = date.fromisoformat(action.target_month)
                except ValueError:
                    _error("Informe o mês do orçamento em YYYY-MM-01.")
                if month.day != 1:
                    _error("Informe o primeiro dia do mês do orçamento.")
                selector = " and month = %s"
                params.append(month.isoformat())
        rows = await db.fetch(
            f"select *, xmin::text as row_version from public.{table} where workspace_id = %s and {identity} = %s"
            + _where(action.resource, lixeira)
            + selector,
            *params,
        )
        if len(rows) != 1:
            _error(
                "Não encontrei um único item com esse nome. Informe o nome exato (e o mês, no caso de orçamento). Nada foi alterado."
            )
        old = rows[0]
        if action.resource == "debts":
            prepared["calculation_mode"] = old.get("calculation_mode") or "amortized"
            if (
                prepared["calculation_mode"] == "fixed_installments"
                and action.type == Op.UPDATE
                and values.keys() & {
                    "principal_cents", "remaining_cents", "interest_rate_monthly",
                    "installments", "installments_paid", "installment_cents",
                }
            ):
                _error(
                    "Esse financiamento usa parcelas fixas com taxa não informada. "
                    "Revise os valores e o histórico no app; não posso converter "
                    "o total das parcelas em principal ou calcular amortização por aqui."
                )
        if (
            action.resource == "debts"
            and action.type == Op.UPDATE
            and "installments_paid" in values
        ):
            payments = await db.fetch(
                "select id from public.transactions where debt_id=%s and workspace_id=%s limit 1",
                old["id"],
                ctx.workspace_id,
            )
            if payments:
                _error(
                    "Essa dívida já possui pagamentos registrados. Revise os pagamentos existentes; não posso substituir a contagem histórica por aqui."
                )
        prepared.update(id=str(old["id"]), version=old["row_version"])
        if action.type == Op.PAY:
            if old.get("archived"):
                _error("Essa dívida está arquivada. Revise o cadastro antes de pagar.")
            if not values.get("amount_cents"):
                _error("Qual o valor da prestação paga? Ainda não registrei nada.")
            # Quem denuncia "isso são N parcelas de uma vez" é a ARITMÉTICA do
            # contrato, não uma palavra na frase. Havia um regex vetando qualquer
            # pagamento cuja mensagem contivesse "parcelas": ele deixava passar
            # "quitei as anteriores da moto" e barrava "paguei as parcelas de
            # setembro". Múltiplo exato da prestação é a assinatura de baixa
            # retroativa em lote — que gravaria UMA despesa gigante que nunca
            # saiu da conta —, e amortização extra raramente cai num múltiplo
            # redondo. Na dúvida ele PERGUNTA; nunca grava sozinho.
            parcela = old.get("installment_cents") or 0
            pago = values["amount_cents"]
            if parcela and pago >= parcela * 2 and pago % parcela == 0:
                _error(
                    f"Esse valor são {pago // parcela} prestações de "
                    f"{cents_to_brl(parcela)}. Se elas já foram pagas antes e você só "
                    "quer registrar o histórico, me diga quantas parcelas já foram "
                    "pagas e o saldo devedor atual — isso não tira dinheiro da conta. "
                    "Se foi um pagamento único de amortização agora, me confirme o "
                    "valor dizendo que é amortização. Ainda não registrei nada."
                )
            values.setdefault("paid_at", local_iso_date(ctx.timezone))
            if not values.get("account_id"):
                values["account_id"] = (
                    str(old["account_id"]) if old.get("account_id") else None
                )
            if not values["account_id"]:
                _error("Qual conta foi usada para pagar a prestação?")
        if action.resource == "budgets":
            prepared["target_label"] = str(old.get("month") or "padrão")
        if action.type == Op.DELETE:
            if prepared.pop("set_default", None) is not None:
                _error("Para tirar a conta padrão, peça para deixá-la sem ser a padrão.")
            # Nota JÁ na lixeira e o usuário pediu de novo: o segundo apagar é o
            # definitivo (o `usePurgeNote` do app). Sem isto, apagar uma nota já
            # apagada só regravava o mesmo `deleted_at` e a lixeira nunca esvaziava.
            if action.resource == "notes" and old.get("deleted_at") is not None:
                deletion = None
            if deletion == "archived":
                values = {"archived": True}
            elif deletion == "active":
                values = {"active": False}
            elif deletion == "deleted_at":
                values = {"deleted_at": now_utc().isoformat()}
            else:
                values = {}
            prepared["values"] = values
        elif not values and "set_default" not in prepared:
            _error("O que você quer alterar?")
        if (
            action.resource == "accounts"
            and "type" in values
            and values["type"] != old["type"]
        ):
            _error(
                "O tipo de uma conta com histórico não pode ser convertido por aqui. Crie outra conta e transfira o saldo."
            )
        if action.resource == "assets" and "current_value_cents" in values:
            _error(
                'Para mudar a avaliação, peça "atualize o valor do bem"; isso registra também o histórico.'
            )
        merged = {**old, **values}
    else:
        merged = values
    # Never let a new non-nullable value become null during an edit.
    if action.type != Op.DELETE:
        protegidos = REQUIRED[action.resource]
        if action.resource == "debts":
            # `REQUIRED["debts"]` encolheu porque o obrigatório passou a depender
            # do MODO. A trava de "não pode virar null numa edição" vale para os
            # dois modos — sem esta linha, encolher a lista afrouxaria a edição.
            protegidos = (*protegidos, *sorted({k for campos in DEBT_REQUIRED.values() for k in campos}))
        for key in protegidos:
            if key in values and values[key] is None:
                _error(f"{LABELS[key]} não pode ficar vazio.")
    display = {}
    for key, linked_table in LINKS.items():
        if values.get(key):
            rows = await db.fetch(
                "select id, name"
                + (", type" if linked_table == "accounts" else "")
                + f" from public.{linked_table} where workspace_id = %s and (id::text = %s or name = %s)"
                + (" and not archived" if linked_table == "accounts" else ""),
                ctx.workspace_id,
                values[key],
                values[key],
            )
            if len(rows) != 1:
                _error(
                    f"Não encontrei {LABELS[key]} nesse espaço. Informe o nome exato."
                )
            row = rows[0]
            if (key == "payment_account_id" or action.resource == "debts") and row.get(
                "type"
            ) == "credit_card":
                _error("Escolha uma conta pagadora que não seja cartão.")
            if key == "parent_id" and str(row["id"]) == prepared.get("id"):
                _error("Uma pasta não pode ser sua própria pasta superior.")
            values[key] = str(row["id"])
            display[key] = row["name"]
    if action.resource == "folders" and values.get("parent_id"):
        ancestors = await db.fetch(
            """with recursive parents as (
              select id, parent_id from public.note_folders where id = %s and workspace_id = %s
              union select f.id, f.parent_id from public.note_folders f
              join parents p on p.parent_id = f.id where f.workspace_id = %s
            ) select id from parents""",
            values["parent_id"],
            ctx.workspace_id,
            ctx.workspace_id,
        )
        if prepared.get("id") in {str(row["id"]) for row in ancestors}:
            _error("Uma pasta não pode ser movida para dentro de uma descendente.")
    if action.resource == "debts" and action.type != Op.DELETE:
        if int(merged.get("installments_paid") or 0) > int(
            merged.get("installments") or 1200
        ):
            _error("Parcelas pagas não podem ultrapassar as parcelas totais.")
        if int(merged.get("remaining_cents") or 0) > int(
            merged.get("principal_cents") or 0
        ):
            _error("Confira principal original e saldo devedor do contrato.")
    if action.resource in {"recurring", "reminders"} and action.type != Op.DELETE:
        timekey = "dtstart" if action.resource == "recurring" else "next_run_at"
        if values.get(timekey):
            try:
                datetime.fromisoformat(values[timekey].replace("Z", "+00:00"))
                instant = to_instant(values[timekey], ctx.timezone)
            except (ValueError, TypeError):
                _error("Informe data e hora válidas para o agendamento.")
            values[timekey] = instant.isoformat()
            if action.resource == "recurring":
                values["next_run_at"] = instant.isoformat()
        rule = merged.get("rrule") or merged.get("recurrence")
        if rule and next_occurrence(rule, now_utc(), ctx.timezone) is None:
            _error("Recorrência sem próximas ocorrências.")
        if action.type == Op.CREATE and action.resource == "reminders":
            values["timezone"] = ctx.timezone
    verb = {
        Op.CREATE: "criar",
        Op.UPDATE: "alterar",
        Op.DELETE: (
            "arquivar"
            if deletion == "archived"
            else "desativar"
            if deletion == "active"
            else "mandar para a lixeira"
            if deletion == "deleted_at"
            else "apagar DE VEZ (não dá para desfazer)"
            if action.resource == "notes"
            else "excluir"
        ),
        Op.PAY: "registrar pagamento de",
    }[action.type]
    # No modo simples, principal, saldo e taxa são ECO da parcela — foram
    # derivados dela, não informados. Mostrá-los na confirmação escrevia
    # "juros ao mês: 0%" na mesma frase que termina em "taxa não informada", que
    # é exatamente o zero que a doc do modo simples proíbe apresentar como
    # ausência de juros. Quem diz o que eles significam é a linha do rodapé.
    derivados = (
        {"calculation_mode", "principal_cents", "remaining_cents", "interest_rate_monthly"}
        if prepared.get("calculation_mode") == "fixed_installments"
        else set()
    )
    details = []
    for key, value in values.items():
        if key in {"timezone", "type"} and action.resource == "cards":
            continue
        if key in derivados:
            continue
        shown = display.get(key, value)
        if key.endswith("_cents") and value is not None:
            shown = cents_to_brl(value)
        elif key == "interest_rate_monthly" and value is not None:
            shown = f"{Decimal(str(value)) * 100:g}%".replace(".", ",")
        elif (action.resource, key) in ENUMS:
            shown = {
                "checking": "conta corrente",
                "savings": "poupança",
                "cash": "dinheiro",
                "investment": "investimento",
                "loan": "empréstimo",
                "financing": "financiamento",
                "credit_card": "cartão",
                "person": "pessoa",
                "other": "outro",
                "real_estate": "imóvel",
                "vehicle": "veículo",
                "crypto": "criptoativo",
                "equity": "participação",
                "receivable": "valor a receber",
                "expense": "gasto",
                "income": "receita",
                "push": "notificação no app",
                "whatsapp": "WhatsApp",
                "both": "notificação no app e WhatsApp",
                "contains": "contém o termo",
                "merchant": "estabelecimento",
            }.get(str(value), value)
        elif isinstance(value, bool):
            shown = "sim" if value else "não"
        details.append(
            f"{LABELS.get(key, key)}: {shown if shown is not None else 'não informado'}"
        )
    prepared["summary"] = (
        f"{verb} {LABELS[action.resource]} {action.name or ''} — " + "; ".join(details)
    )
    if prepared.get("calculation_mode") == "fixed_installments":
        prepared["summary"] += "; parcelas fixas, juros incluídos no valor e taxa não informada"
    if prepared.get("target_label"):
        prepared["summary"] += "; orçamento de " + prepared["target_label"]
    if action.type == Op.DELETE and action.resource == "reminders":
        prepared["summary"] += "; registros já gerados continuam no histórico"
    if action.type == Op.DELETE and action.resource == "recurring":
        # O trigger `recurring_drop_future` (20260909090000) leva as ocorrências futuras
        # ainda em aberto. Esta frase é o que a pessoa lê ANTES de aprovar — dizer que
        # "os registros já gerados continuam" virou mentira no dia em que o trigger entrou.
        prepared["summary"] += (
            "; o que já aconteceu e o que está atrasado ficam, mas as ocorrências futuras "
            "ainda em aberto saem junto"
        )
    if len(prepared["summary"]) > 3500:
        _error(
            "Essa alteração é longa demais para revisar em uma confirmação. Peça uma alteração menor ou edite o conteúdo completo no app."
        )
    return prepared


async def execute(ctx: ExecContext, action: ResourceAction) -> ToolResult:
    proposal = (ctx.target or {}).get("prepared")
    if (
        not proposal
        or proposal.get("operation") != action.type.value
        or proposal.get("resource") != action.resource
    ):
        raise Level1Error("A proposta não está pronta. Peça a operação novamente.")
    table, identity, deletion, columns = CATALOG[action.resource]
    if action.type == Op.LIST:
        rows = await db.fetch(
            f"select {identity} as label from public.{table} where workspace_id = %s"
            + _where(action.resource)
            + f" order by {identity} limit 50",
            ctx.workspace_id,
        )
        return ToolResult(
            "\n".join(str(r["label"]) for r in rows) or "Nenhum item cadastrado.",
            read_only=True,
        )
    values = dict(proposal["values"])
    guards, link_args = [], []
    for key, linked_table in LINKS.items():
        if values.get(key):
            condition = f"EXISTS (select 1 from public.{linked_table} linked where linked.id = %s and linked.workspace_id = %s"
            if linked_table == "accounts":
                condition += " and not linked.archived"
                if key == "payment_account_id" or action.resource == "debts":
                    condition += " and linked.type <> 'credit_card'"
            guards.append(condition + ")")
            link_args.extend([values[key], ctx.workspace_id])
    reference_guard = (" and " + " and ".join(guards)) if guards else ""
    if action.type == Op.PAY:
        # MATERIALIZED locks the exact reviewed debt before evaluating the RPC.
        # The RPC and transaction trigger apply the debt's calculation mode.
        row = await db.fetch_one(
            """with reviewed as materialized (
              select id from public.debts where id = %s and workspace_id = %s
              and xmin::text = %s and not archived"""
            + reference_guard
            + """ for update
            ) select public.pay_debt_installment(id, %s, %s, %s) as remaining_cents
              from reviewed""",
            proposal["id"],
            ctx.workspace_id,
            proposal["version"],
            *link_args,
            values["amount_cents"],
            values["account_id"],
            values["paid_at"],
        )
        if row is None:
            _error(
                "A dívida ou a conta mudou depois da proposta. Peça novamente para revisar antes de confirmar."
            )
        return ToolResult(
            "Pagamento registrado. "
            + ("Total das parcelas restantes: "
               if proposal.get("calculation_mode") == "fixed_installments"
               else "Saldo devedor: ")
            + cents_to_brl(row["remaining_cents"])
            + ".",
            result_id=proposal["id"],
        )
    if action.type == Op.CREATE:
        values.update(user_id=ctx.user_id, workspace_id=ctx.workspace_id)
        keys = list(values)
        row = await db.fetch_one(
            f"insert into public.{table} ({', '.join(keys)}) select {', '.join(['%s'] * len(keys))} where true"
            + reference_guard
            + " returning id",
            *values.values(),
            *link_args,
        )
    else:
        # MVCC token freezes every column, not only a timestamp updated by some tables.
        args = [proposal["id"], ctx.workspace_id, proposal["version"]]
        if action.type == Op.DELETE and not values:
            row = await db.fetch_one(
                f"delete from public.{table} where id = %s and workspace_id = %s and xmin::text = %s returning id",
                *args,
            )
        elif not values:
            # Só "vira a conta padrão": não há coluna a mexer nesta tabela, e um
            # `set` vazio é erro de sintaxe. O SELECT existe pelo xmin — a trava de
            # "mudou depois da proposta" vale igual quando a escrita é em outra tabela.
            row = await db.fetch_one(
                f"select id from public.{table} where id = %s and workspace_id = %s and xmin::text = %s",
                *args,
            )
        elif action.resource == "recurring" and action.type == Op.UPDATE and (
            values.keys() & _SERIE_PROPAGA
        ):
            row = await _editar_serie(ctx, proposal, values)
        else:
            if action.resource == "debts" and "installments_paid" in values:
                reference_guard += " and not exists (select 1 from public.transactions payment where payment.debt_id=public.debts.id and payment.workspace_id=public.debts.workspace_id)"
            row = await db.fetch_one(
                f"update public.{table} set "
                + ", ".join(f"{key} = %s" for key in values)
                + " where id = %s and workspace_id = %s and xmin::text = %s"
                + reference_guard
                + " returning id",
                *values.values(),
                *args,
                *link_args,
            )
    if not row:
        raise Level1Error(
            "Esse item mudou depois da proposta. Peça novamente para revisar antes de confirmar."
        )
    if "set_default" in proposal:
        await _definir_conta_padrao(ctx, proposal["id"], proposal["set_default"])
    return ToolResult("Concluído: " + proposal["summary"] + ".", result_id=row["id"])


# O que, mudando na REGRA, tem que alcançar as ocorrências já materializadas.
# `rrule`/`dtstart`/`active` ficam de fora: cadência e âncora não se propagam (remontariam
# o calendário) e pausar não reescreve nada do que já existe.
_SERIE_PROPAGA = {"amount_cents", "category", "description", "account_id"}


async def _editar_serie(ctx: ExecContext, proposal: dict, values: dict):
    """Editar recorrência pelo agente = o mesmo efeito do botão do app.

    O UPDATE genérico mexeria só na regra, e o `finance-scheduler` materializa 90 dias à
    frente com o unique `(recurring_id, occurred_at)` impedindo reescrita: os próximos três
    meses ficariam com o valor velho e o quarto com o novo. `update_recurring_series` é a
    MESMA RPC que a tela chama — repetir a regra aqui criaria a cópia que diverge.

    Só as chaves propagáveis vão no patch; `active`, `rrule` e afins continuam no UPDATE
    normal da mesma chamada, porque a RPC os recusa de propósito.
    """
    import json

    patch = {k: v for k, v in values.items() if k in _SERIE_PROPAGA}
    resto = {k: v for k, v in values.items() if k not in _SERIE_PROPAGA}
    row = await db.fetch_one(
        "select public.update_recurring_series(%s, %s::jsonb, true) as futuras",
        proposal["id"], json.dumps(patch, default=str),
    )
    if row is None:
        raise Level1Error("Essa recorrência mudou depois da proposta. Peça novamente.")
    if resto:
        await db.execute(
            "update public.recurring_transactions set "
            + ", ".join(f"{k} = %s" for k in resto)
            + " where id = %s and workspace_id = %s",
            *resto.values(), proposal["id"], ctx.workspace_id,
        )
    return {"id": proposal["id"]}


async def _definir_conta_padrao(ctx: ExecContext, account_id: str, virar_padrao: bool) -> None:
    """A conta padrão mora em `workspaces`, não na conta — é do espaço, não do dono.

    O trigger `tg_workspaces_default_account` (20260909035000) recusa cartão de
    crédito e conta arquivada; não repetir a checagem aqui seria a segunda cópia
    da mesma regra. Desmarcar só zera se o padrão AINDA for esta conta: senão
    "essa não é mais a padrão" derrubaria a escolha de outra, feita no meio.
    """
    if virar_padrao:
        await db.execute(
            "update public.workspaces set default_account_id = %s where id = %s",
            account_id, ctx.workspace_id,
        )
    else:
        await db.execute(
            "update public.workspaces set default_account_id = null "
            "where id = %s and default_account_id = %s",
            ctx.workspace_id, account_id,
        )


def prompt_catalogue() -> str:
    catalogue = "\n".join(
        f"{key}: campos {entry[3]}; obrigatórios ao criar {', '.join(REQUIRED[key])}."
        for key, entry in CATALOG.items()
    )
    choices = "\n".join(
        f"{resource}.{field}: {', '.join(sorted(values))}"
        for (resource, field), values in ENUMS.items()
    )
    return (
        catalogue
        + "\nValores permitidos:\n"
        + choices
        + "\nFinanciamento/dívida tem dois modos: fixed_installments (padrão) precisa só de installment_cents e installments — o total contratual das parcelas, com juros dentro; amortized precisa de principal_cents, remaining_cents e interest_rate_monthly, e só serve quando o usuário tem esses números do contrato. Nunca converta o total das parcelas em principal nem invente taxa.\nConta padrão (onde cai o lançamento que não cita conta): resource_update, resource=accounts, name=nome da conta, campo is_default=true; para tirar, is_default=false. Cartão de crédito não pode ser conta padrão.\nNota na LIXEIRA: resource_delete em notes manda para a lixeira; restaurar (\"tira da lixeira\", \"recupera a nota\") é resource_update com trashed=false; apagar DE VEZ (\"esvazia\", \"apaga definitivo\") é resource_delete com trashed=true.\nOrçamento mensal existente: target_month=YYYY-MM-01; orçamento padrão: target_month=default.\nPara pagar prestação de dívida existente: resource_pay, resource=debts, name=nome da dívida, campos amount_cents, account_id (nome da conta), paid_at (YYYY-MM-DD). Não editar remaining_cents para registrar pagamento. Ao CRIAR dívida parcelada, installments_paid sai do que o usuário disse, inclusive pela posição: 'estou na 9ª parcela' são 8 pagas, 'tô na terceira' são 2, 'comecei agora' é 0, e um número solto respondendo à pergunta é a quantidade. Deixe vazio só quando a mensagem não disser nada sobre isso — o usuário confirma o cadastro inteiro antes de qualquer gravação, e é ali que ele corrige. Em dívida QUE JÁ EXISTE é o contrário: posição e data não comprovam pagamento; use resource_update com installments_paid e remaining_cents explicitamente informados, e se faltar saldo atual pergunte. Nunca use resource_pay para dar baixa retroativa em várias parcelas ou invente amortização a partir do valor da prestação.\nValor POR EXTENSO é valor: 'trezentos reais' é 30000 centavos, 'mil e quinhentos' é 150000, 'dois mil e quinhentos' é 250000. Áudio transcrito e resposta falada escrevem número assim o tempo todo — deixar o campo vazio porque o número veio em palavras é perder o dado que o usuário acabou de dar."
    )
