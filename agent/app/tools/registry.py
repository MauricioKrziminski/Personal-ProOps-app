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

import psycopg

from app import db
from app.config import get_settings
from app.graph.schemas import (
    READ_ONLY,
    FinanceAction,
    FinanceActionType,
    FinanceQuery,
    FinanceQueryType,
    NotesAction,
    ResourceAction,
    NotesActionType,
)
from app.tools import finance, guards, notes, queries, resolve
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
    FinanceQueryType.QUERY_RECURRING: queries.query_recurring,
    FinanceQueryType.QUERY_DEBTS: queries.query_debts,
    FinanceQueryType.SIMULATE_SCENARIO: queries.simulate_scenario,
    FinanceQueryType.QUERY_CYCLE: queries.query_cycle,
    FinanceQueryType.QUERY_SPENDING_CHANGE: queries.query_spending_change,
}

NOTES_TOOLS = {
    NotesActionType.CREATE_NOTE: notes.create_note,
    NotesActionType.APPEND_NOTE: notes.append_note,
    NotesActionType.QUERY_NOTES: notes.query_notes,
    NotesActionType.DELETE_NOTE: notes.delete_note,
    NotesActionType.CREATE_REMINDER: notes.create_reminder,
    NotesActionType.DELETE_REMINDER: notes.delete_reminder,
    NotesActionType.QUERY_REMINDERS: notes.query_reminders,
}

AJUDA = (
    "🤔 Não entendi essa parte. Tenta algo como: \"gastei 45 no mercado\", "
    "\"recebi 500 de freela\", \"quanto gastei esse mês?\" ou \"anota: ligar pro dentista\"."
)


def _tool(action: FinanceAction | FinanceQuery | NotesAction):
    if isinstance(action, ResourceAction):
        from app.tools.resources import execute as execute_resource
        return execute_resource
    if isinstance(action, FinanceAction):
        return FINANCE_TOOLS.get(action.type)
    if isinstance(action, FinanceQuery):
        return QUERY_TOOLS.get(action.type)
    return NOTES_TOOLS.get(action.type)


def _sem_alvo(alvo: dict, action) -> str:
    """Mensagem para alvo que não resolveu. Nunca executa, nunca reserva vaga.

    ⚠️ **Quando o usuário DISSE um termo, a resposta cita o termo.** "Não achei
    esse item por aqui" é a frase de quem não apontou nada; devolvê-la a quem
    escreveu *"remove o lançamento nuuvem"* não diz o que falhou, e a pessoa
    remanda a mesma frase. A régua é a de `agent.md`: o que ele disse e não bate
    vira pergunta — sobre o que ELE disse.
    """
    if alvo.get("status") == "ambiguous":
        # ⚠️ O `when` entra aqui pelo mesmo motivo que existe em `veredito`: uma
        # série recorrente produz candidatos que só diferem na DATA, e sem ela
        # esta lista sai com nove linhas escritas "gasto de R$ 55,90 em *lazer*
        # (Assinatura de streaming)", letra por letra iguais. Escolher entre
        # opções idênticas não é escolher.
        opcoes = "\n".join(
            f"  • {c['label']}" + (f" — {c['when']}" if c.get("when") else "")
            for c in alvo.get("candidates", [])
        )
        return f"🤔 Achei mais de um:\n{opcoes}\nMe diz qual."
    termo = resolve.termo_de(action)
    if termo:
        return (
            f"🤷 Não achei nada com *{termo}* por aqui. "
            "Confere o nome, ou me diz o valor ou a data?"
        )
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
            return ToolResult(_sem_alvo(alvo, action), read_only=True)
        # `ensure_owned` ANTES de reservar a vaga de idempotência: id de outro
        # workspace não pode nem consumir a vaga. Roda dentro do try de baixo?
        # Não — aqui, para que a recusa seja explícita e não vire "erro ao
        # processar". A linha apagada entre a pergunta e o SIM cai aqui.
        try:
            await ensure_owned(alvo["table"], alvo["candidates"][0]["id"], ctx.workspace_id)
        except Level1Error as err:
            return ToolResult(err.mensagem_usuario, read_only=True)

    # Consulta pode repetir à vontade e roda solta. Escrita é UMA unidade de trabalho:
    # reserva da vaga + tool + carimbo do `result_id` commitam JUNTOS ou voltam juntos.
    # Antes cada comando era a sua transação (pool autocommit): morrer entre a escrita e o
    # carimbo deixava a reserva órfã COM a escrita feita, e o retry tratava a criação como
    # falha. Agora a reserva órfã com escrita não existe — e, por consequência, falha da tool
    # desfaz a própria reserva (sem `release_execution` à mão) junto com escrita parcial.
    # A segunda execução da MESMA chave bloqueia no índice único até a primeira commitar e aí
    # vê a linha já com o `result_id` (`on conflict do nothing` espera a transação concorrente).
    try:
        if somente_leitura:
            return await _ler(ctx, action, tool)
        return await _escrever(ctx, action, tool)
    except _SemEscrita as sem:
        return sem.resultado
    except Level1Error as err:
        # validação determinística: a mensagem já está escrita para o usuário
        log.info("nível 1 barrou %s: %s", action.type, err)
        return ToolResult(err.mensagem_usuario, read_only=True)
    except psycopg.Error as err:
        # Recusa de PROPÓSITO do banco (P0001 de gatilho, 22023/PT422 de regra, PT409 de revisão velha):
        # já vem escrita para a pessoa — "deu erro, tenta de novo" mandaria repetir o que não se resolve
        # repetindo. A transação voltou inteira. Qualquer outro erro do banco é falha de verdade.
        frase = guards.recusa_do_banco(err)
        if frase is None:
            log.exception("ação %s falhou", action.type)
            return ToolResult(
                "❌ Deu erro ao processar uma parte da mensagem. Tenta de novo!", read_only=True
            )
        log.info("o banco recusou %s: %s", action.type, err.diag.message_primary)
        return ToolResult(frase, read_only=True)
    except Exception:  # noqa: BLE001
        log.exception("ação %s falhou", action.type)
        return ToolResult(
            "❌ Deu erro ao processar uma parte da mensagem. Tenta de novo!", read_only=True
        )


class _SemEscrita(Exception):
    """A tool não escreveu nada: desfaz a unidade (a vaga volta) e devolve o resultado dela."""

    def __init__(self, resultado: ToolResult) -> None:
        self.resultado = resultado


async def _ler(ctx: ExecContext, action, tool) -> ToolResult:
    """Consulta: solta como sempre; com `AGENTE_RLS`, numa unidade só de leitura sob `authenticated`."""
    if not get_settings().agente_rls:
        return await tool(ctx, action)
    async with db.unidade_de_trabalho():
        async with db.sob_rls(ctx.user_id):
            return await tool(ctx, action)


async def _escrever(ctx: ExecContext, action, tool) -> ToolResult:
    async with db.unidade_de_trabalho():
        if not await db.reserve_execution(
            ctx.source_message_id,
            ctx.action_index,
            action.type.value,
            user_id=ctx.user_id,
            workspace_id=ctx.workspace_id,
            origin_text=ctx.texto,
        ):
            log.info(
                "ação %s já executada (%s#%s) — pulando",
                action.type, ctx.source_message_id, ctx.action_index,
            )
            # Só conta como "já escreveu" com `result_id` carimbado. Como a reserva e o carimbo
            # agora commitam juntos, reserva sem ele é de ação que não devolve id (apagar,
            # corrigir) ou de outra execução ainda em curso (que a unidade dela segura).
            # (Toda tool `create_*` devolve `result_id` quando escreve.)
            escrito = await db.execution_result_id(ctx.source_message_id, ctx.action_index)
            return ToolResult("", read_only=True, ja_executada=escrito is not None)
        if get_settings().agente_rls:
            # reserva e carimbo são tabela interna do agente (postgres); só a TOOL vai sob RLS
            async with db.sob_rls(ctx.user_id):
                resultado = await tool(ctx, action)
        else:
            resultado = await tool(ctx, action)
        if resultado.read_only:
            # a tool não escreveu nada (não achou, empate, pediu detalhe): desfaz a unidade,
            # o que devolve a vaga para a pessoa poder tentar de novo
            raise _SemEscrita(resultado)
        await db.confirm_execution(ctx.source_message_id, ctx.action_index, resultado.result_id)
    # só depois do COMMIT: dentro de uma unidade externa (o par) quem decide é ela
    if resultado.result_id:
        ctx.created.append(str(resultado.result_id))
    return resultado
