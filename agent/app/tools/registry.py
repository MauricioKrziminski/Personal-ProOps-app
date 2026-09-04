"""Dispatcher determinístico: ActionType -> função Python.

O modelo NÃO escolhe função. Ele produz um objeto validado e este mapa —
fechado, escrito à mão — decide o que roda. Um tipo desconhecido cai no default
e vira mensagem de ajuda; ele não tem como chegar a lugar nenhum do banco.

Aqui também mora a idempotência: (source_message_id, action_index) em
executed_actions. É o que impede que reprocessar uma mensagem (timeout,
redeploy, retry do Cloud Tasks) transforme um gasto de R$45 em dois.
"""

from __future__ import annotations

import logging

from app import db
from app.graph.schemas import (
    READ_ONLY,
    FinanceAction,
    FinanceActionType,
    FinanceQuery,
    FinanceQueryType,
    NotesAction,
    NotesActionType,
)
from app.tools import finance, notes, queries, resolve
from app.tools.base import ExecContext, ToolResult, ensure_owned
from app.tools.guards import Level1Error

log = logging.getLogger(__name__)

FINANCE_TOOLS = {
    FinanceActionType.CREATE_EXPENSE: finance.create_transaction,
    FinanceActionType.CREATE_INCOME: finance.create_transaction,
    FinanceActionType.CREATE_TRANSFER: finance.create_transfer,
    FinanceActionType.CREATE_INSTALLMENT_PURCHASE: finance.create_installment_purchase,
    FinanceActionType.PAY_INVOICE: finance.pay_invoice,
    FinanceActionType.MARK_PAID: finance.mark_paid,
    FinanceActionType.SET_RULE: finance.set_rule,
    FinanceActionType.UPDATE_TRANSACTION: finance.update_transaction,
    FinanceActionType.DELETE_TRANSACTION: finance.delete_transaction,
    FinanceActionType.UNDO_LAST: finance.undo_last,
    FinanceActionType.CREATE_GOAL: finance.create_goal,
    FinanceActionType.GOAL_DEPOSIT: finance.goal_deposit,
    FinanceActionType.UPDATE_ASSET_VALUE: finance.update_asset_value,
}

QUERY_TOOLS = {
    FinanceQueryType.QUERY_BALANCE: queries.query_balance,
    FinanceQueryType.QUERY_TRANSACTIONS: queries.query_transactions,
    FinanceQueryType.QUERY_BUDGETS: queries.query_budgets,
    FinanceQueryType.QUERY_GOALS: queries.query_goals,
    FinanceQueryType.QUERY_INVOICE: queries.query_invoice,
    FinanceQueryType.QUERY_FORECAST: queries.query_forecast,
    FinanceQueryType.QUERY_NET_WORTH: queries.query_net_worth,
    FinanceQueryType.SIMULATE_PURCHASE: queries.simulate_purchase,
}

NOTES_TOOLS = {
    NotesActionType.CREATE_NOTE: notes.create_note,
    NotesActionType.APPEND_NOTE: notes.append_note,
    NotesActionType.QUERY_NOTES: notes.query_notes,
    NotesActionType.DELETE_NOTE: notes.delete_note,
    NotesActionType.CREATE_REMINDER: notes.create_reminder,
    NotesActionType.DELETE_REMINDER: notes.delete_reminder,
}

AJUDA = (
    "🤔 Não entendi essa parte. Tenta algo como: \"gastei 45 no mercado\", "
    "\"recebi 500 de freela\", \"quanto gastei esse mês?\" ou \"anota: ligar pro dentista\"."
)


def _tool(action: FinanceAction | FinanceQuery | NotesAction):
    if isinstance(action, FinanceAction):
        return FINANCE_TOOLS.get(action.type)
    if isinstance(action, FinanceQuery):
        return QUERY_TOOLS.get(action.type)
    return NOTES_TOOLS.get(action.type)


def _sem_alvo(alvo: dict) -> str:
    """Mensagem para alvo que não resolveu. Nunca executa, nunca reserva vaga."""
    if alvo.get("status") == "ambiguous":
        opcoes = "\n".join(f"  • {c['label']}" for c in alvo.get("candidates", []))
        return f"🤔 Achei mais de um:\n{opcoes}\nMe diz qual."
    return "🤷 Não achei esse item por aqui. Me diz o valor ou a data?"


async def execute(ctx: ExecContext, action: FinanceAction | FinanceQuery | NotesAction) -> ToolResult:
    """Executa UMA ação. Nunca levanta: a linha de erro é a resposta.

    Falha isolada não derruba as outras ações do mesmo lote — "mercado 45 e uber
    30" com erro no primeiro ainda registra o segundo.
    """
    tool = _tool(action)
    if tool is None:
        return ToolResult(AJUDA, read_only=True)

    somente_leitura = action.type in READ_ONLY

    # ---------------------------------------------------------------------
    # Alvo não resolvido NUNCA executa. Ponto de imposição único: seis tools
    # checando isso cada uma do seu jeito é como uma delas esquece.
    # ---------------------------------------------------------------------
    if action.type in resolve.TARGETS:
        alvo = ctx.target or {}
        if alvo.get("status") != "found" or not alvo.get("candidates"):
            return ToolResult(_sem_alvo(alvo), read_only=True)
        # `ensure_owned` ANTES de reservar a vaga de idempotência: id de outro
        # workspace não pode nem consumir a vaga. Roda dentro do try de baixo?
        # Não — aqui, para que a recusa seja explícita e não vire "erro ao
        # processar". A linha apagada entre a pergunta e o SIM cai aqui.
        try:
            await ensure_owned(alvo["table"], alvo["candidates"][0]["id"], ctx.workspace_id)
        except Level1Error as err:
            return ToolResult(err.mensagem_usuario, read_only=True)

    # Consulta pode repetir à vontade; escrita RESERVA a vaga antes de rodar.
    if not somente_leitura:
        if not await db.reserve_execution(ctx.source_message_id, ctx.action_index, action.type.value):
            log.info(
                "ação %s já executada (%s#%s) — pulando",
                action.type, ctx.source_message_id, ctx.action_index,
            )
            return ToolResult("", read_only=True)

    try:
        resultado = await tool(ctx, action)
    except Level1Error as err:
        # validação determinística: a mensagem já está escrita para o usuário
        log.info("nível 1 barrou %s: %s", action.type, err)
        if not somente_leitura:
            await db.release_execution(ctx.source_message_id, ctx.action_index)
        return ToolResult(err.mensagem_usuario, read_only=True)
    except Exception:  # noqa: BLE001
        log.exception("ação %s falhou", action.type)
        if not somente_leitura:
            await db.release_execution(ctx.source_message_id, ctx.action_index)
        return ToolResult(
            "❌ Deu erro ao processar uma parte da mensagem. Tenta de novo!", read_only=True
        )

    if not somente_leitura:
        if resultado.read_only:
            # a tool não escreveu nada (não achou, empate, pediu detalhe):
            # devolve a vaga para o usuário poder tentar de novo
            await db.release_execution(ctx.source_message_id, ctx.action_index)
        else:
            await db.confirm_execution(ctx.source_message_id, ctx.action_index, resultado.result_id)
            if resultado.result_id:
                ctx.created.append(str(resultado.result_id))

    return resultado
