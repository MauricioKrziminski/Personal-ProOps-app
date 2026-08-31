"""Acesso ao Postgres do Supabase: pool, fila e estado da conversa.

Duas pools de propósito:
  - `pool`        -> schema public (fila, sessões, dados do produto)
  - `graph_pool`  -> search_path=langgraph, só para o checkpointer do LangGraph

Separar é o que garante que `checkpointer.setup()` crie as tabelas de checkpoint
no schema isolado, e não em `public` (onde o PostgREST as exporia com a anon key).
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.config import get_settings

log = logging.getLogger(__name__)

_pool: AsyncConnectionPool | None = None
_graphlog = logging.getLogger(__name__)

_pool: AsyncConnectionPool | None = None


def _kwargs() -> dict[str, Any]:
    settings = get_settings()
    kw: dict[str, Any] = {"row_factory": dict_row, "autocommit": True}
    # Atrás do transaction pooler do Supabase (6543) prepared statements quebram.
    # Vazio = session pooler/conexão direta, onde eles funcionam e são mais rápidos.
    if settings.db_prepare_threshold != "":
        kw["prepare_threshold"] = int(settings.db_prepare_threshold)
    return kw


async def open_pools() -> None:
    global _pool, _graph_pool
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError(
            "DATABASE_URL ausente. Use o SESSION pooler do Supabase (porta 5432): "
            "postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres"
        )
    _pool = AsyncConnectionPool(
        settings.database_url,
        min_size=settings.db_pool_min,
        max_size=settings.db_pool_max,
        kwargs=_kwargs(),
        open=False,
    )
    _graph_pool = AsyncConnectionPool(
        settings.checkpointer_url,
        min_size=1,
        max_size=2,
        kwargs=_kwargs(),
        open=False,
    )
    await _pool.open()
    await _graph_pool.open()


async def close_pools() -> None:
    for p in (_pool, _graph_pool):
        if p is not None:
            await p.close()


def pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError("pool não aberto — falta o lifespan do FastAPI")
    return _pool


def graph_pool() -> AsyncConnectionPool:
    if _graph_pool is None:
        raise RuntimeError("graph_pool não aberto — falta o lifespan do FastAPI")
    return _graph_pool


async def fetch(sql: str, *args: Any) -> list[dict[str, Any]]:
    async with pool().connection() as conn:
        cur = await conn.execute(sql, args)
        return await cur.fetchall()


async def fetch_one(sql: str, *args: Any) -> dict[str, Any] | None:
    rows = await fetch(sql, *args)
    return rows[0] if rows else None


async def execute(sql: str, *args: Any) -> int:
    async with pool().connection() as conn:
        cur = await conn.execute(sql, args)
        return cur.rowcount


# ---------------------------------------------------------------------------
# sessões
# ---------------------------------------------------------------------------


async def ensure_session(phone: str, thread_id: str) -> dict[str, Any]:
    """Cria/atualiza a sessão do telefone e devolve a linha.

    A resolução de usuário/workspace acontece aqui (uma vez por conversa) e fica
    guardada: o grafo não deve gastar uma ida ao banco por mensagem para
    descobrir de quem é o telefone.
    """
    settings = get_settings()
    # Árbitro no PHONE, não no thread_id. A tabela tem duas restrições únicas e o
    # ON CONFLICT só trata a que for nomeada — conflitar pela outra vira 23505 cru.
    # Com árbitro em `phone`, trocar o THREAD_SALT reescreve o thread_id em vez de
    # quebrar toda mensagem de usuário existente. (Análise completa na 0040.)
    #
    # `as s` para o CASE poder ler o valor ANTERIOR sem ambiguidade: dentro do DO
    # UPDATE, `s.x` é a linha que já existe e `excluded.x` é a proposta.
    #
    # A rotação de sessão acontece AQUI, no mesmo UPDATE. Num segundo passo era
    # código morto: o primeiro update já teria gravado now().
    row = await fetch_one(
        """
        insert into public.user_sessions as s (thread_id, phone, last_message_at)
        values (%s, %s, now())
        on conflict (phone) do update
          set last_message_at = now(),
              thread_id = excluded.thread_id,
              session_epoch = case
                when s.last_message_at < now() - make_interval(hours => %s)
                 and not exists (
                   select 1 from public.pending_actions p
                   where p.phone = s.phone and p.status = 'awaiting'
                 )
                then s.session_epoch + 1
                else s.session_epoch
              end
        returning *
        """,
        thread_id,
        phone,
        settings.session_idle_hours,
    )
    assert row is not None
    if row["user_id"] is None:
        row = await _attach_profile(row)
    return row


async def _attach_profile(session: dict[str, Any]) -> dict[str, Any]:
    """Liga a sessão ao profile pelo telefone (com e sem o 9º dígito)."""
    from app.domain.phone import candidates

    profile = await fetch_one(
        "select id, timezone from public.profiles where phone = any(%s) limit 1",
        candidates(session["phone"]),
    )
    if not profile:
        return session

    workspace = await fetch_one(
        "select public._default_workspace(%s) as id", profile["id"]
    )
    updated = await fetch_one(
        """
        update public.user_sessions
        set user_id = %s, workspace_id = %s, timezone = %s
        where phone = %s
        returning *
        """,
        profile["id"],
        workspace["id"] if workspace else None,
        profile["timezone"],
        session["phone"],
    )
    return updated or session


async def set_debounce_task(thread_id: str, task_name: str | None) -> None:
    await execute(
        "update public.user_sessions set debounce_task_name = %s where thread_id = %s",
        task_name,
        thread_id,
    )


# ---------------------------------------------------------------------------
# fila
# ---------------------------------------------------------------------------


async def enqueue(
    *,
    wa_message_id: str,
    thread_id: str,
    phone: str,
    message_type: str | None,
    payload: dict[str, Any],
) -> bool:
    """Grava a mensagem. False = duplicata da Meta (idempotência de entrada).

    Um insert só: no fluxo Deno isto eram dois inserts sem transação, e a falha
    do segundo apagava a mensagem do mundo (o retry da Meta batia no dedupe do
    primeiro e era descartado).
    """
    row = await fetch_one(
        """
        insert into public.messages_queue
          (wa_message_id, thread_id, phone, message_type, payload)
        values (%s, %s, %s, %s, %s)
        on conflict (wa_message_id) do nothing
        returning id
        """,
        wa_message_id,
        thread_id,
        phone,
        message_type,
        Jsonb(payload),
    )
    return row is not None


async def claim_batch(thread_id: str) -> list[dict[str, Any]]:
    """Reivindica TODAS as pendentes da thread como um lote (o debounce em ação).

    Vazio significa "outro worker está com esta conversa" ou "não há nada" — nos
    dois casos o certo é sair sem fazer nada.
    """
    return await fetch(
        "select * from public.claim_thread_batch(%s)", thread_id
    )


async def mark_done(ids: list[UUID]) -> None:
    await execute(
        """
        update public.messages_queue
        set status = 'done', processed_at = now()
        where id = any(%s)
        """,
        ids,
    )


async def mark_retry(ids: list[UUID], error: str) -> list[dict[str, Any]]:
    """Devolve à fila com retry_count++. Na 3ª tentativa vira 'failed'.

    O erro fica truncado: last_error é para debugar, não para guardar stack trace
    inteiro de um erro que se repete mil vezes.
    """
    return await fetch(
        """
        update public.messages_queue
        set retry_count = retry_count + 1,
            last_error = left(%s, 2000),
            status = case when retry_count + 1 >= 3 then 'failed' else 'pending' end,
            claimed_at = null
        where id = any(%s)
        returning id, status, retry_count
        """,
        error,
        ids,
    )


# ---------------------------------------------------------------------------
# confirmações pendentes (HITL)
# ---------------------------------------------------------------------------


async def expire_pending(thread_id: str | None = None) -> int:
    row = await fetch_one("select public.expire_pending_actions(%s) as n", thread_id)
    return row["n"] if row else 0


async def open_pending(phone: str) -> dict[str, Any] | None:
    return await fetch_one(
        """
        select * from public.pending_actions
        where phone = %s and status = 'awaiting' and expires_at > now()
        order by created_at desc limit 1
        """,
        phone,
    )


async def create_pending(
    *,
    thread_id: str,
    phone: str,
    user_id: UUID,
    workspace_id: UUID,
    action: dict[str, Any],
    summary: str,
) -> dict[str, Any] | None:
    settings = get_settings()
    return await fetch_one(
        """
        insert into public.pending_actions
          (thread_id, phone, user_id, workspace_id, action, summary, expires_at)
        values (%s, %s, %s, %s, %s, %s, now() + make_interval(mins => %s))
        on conflict do nothing
        returning *
        """,
        thread_id,
        phone,
        user_id,
        workspace_id,
        Jsonb(action),
        summary,
        settings.pending_ttl_minutes,
    )


async def resolve_pending(pending_id: UUID, status: str) -> None:
    await execute(
        """
        update public.pending_actions
        set status = %s, resolved_at = now()
        where id = %s and status = 'awaiting'
        """,
        status,
        pending_id,
    )


# ---------------------------------------------------------------------------
# idempotência de execução
# ---------------------------------------------------------------------------


async def reserve_execution(wa_message_id: str, action_index: int, action_type: str) -> bool:
    """Reserva a vaga ANTES de executar. False = já foi feita (ou está sendo).

    A ordem importa e é a correção do bug do fluxo antigo: lá as ações rodavam e
    SÓ DEPOIS o job era marcado done, então morrer no meio duplicava lançamento
    no retry. Reservando antes, a pior consequência de uma morte no meio é a ação
    NÃO acontecer — e o usuário reenvia. Para dinheiro, perder um registro que
    ele pode remandar é melhor que gravar dois que ele não pediu.
    """
    row = await fetch_one(
        """
        insert into public.executed_actions
          (wa_message_id, action_index, action_type)
        values (%s, %s, %s)
        on conflict (wa_message_id, action_index) do nothing
        returning wa_message_id
        """,
        wa_message_id,
        action_index,
        action_type,
    )
    return row is not None


async def confirm_execution(
    wa_message_id: str, action_index: int, result_id: UUID | None
) -> None:
    """Carimba o id criado na reserva (auditoria e desfazer)."""
    if result_id is None:
        return
    await execute(
        """
        update public.executed_actions set result_id = %s
        where wa_message_id = %s and action_index = %s
        """,
        result_id,
        wa_message_id,
        action_index,
    )


async def release_execution(wa_message_id: str, action_index: int) -> None:
    """Devolve a vaga quando a execução falhou sem escrever nada.

    Sem isso, um erro transitório (banco fora por um segundo) queimaria a ação
    para sempre: o retry veria a reserva e pularia.
    """
    await execute(
        """
        delete from public.executed_actions
        where wa_message_id = %s and action_index = %s and result_id is null
        """,
        wa_message_id,
        action_index,
    )


# ---------------------------------------------------------------------------
# cota e auditoria da IA
# ---------------------------------------------------------------------------
# `ai_events` não é enfeite: `private.plan_status_for` CONTA as linhas dela para
# saber quantas mensagens de IA o workspace gastou no mês. Não gravar aqui
# derruba o paywall em silêncio — o consumo fica sempre em zero.


async def ai_events_last_hour(user_id: UUID) -> int:
    row = await fetch_one(
        """
        select count(*)::int as n from public.ai_events
        where user_id = %s and created_at >= now() - interval '1 hour'
        """,
        user_id,
    )
    return row["n"] if row else 0


async def plan_status(workspace_id: UUID) -> dict[str, Any] | None:
    return await fetch_one("select * from public._plan_status(%s)", workspace_id)


async def record_ai_event(
    *,
    user_id: UUID,
    model: str,
    confidence: float | None,
    result: dict[str, Any],
    created_transaction_ids: list[str] | None = None,
) -> None:
    """Auditoria do parse. Best-effort: falhar aqui não pode desfazer o que já foi
    gravado — mas é logado, porque silêncio aqui vira cobrança errada no fim do mês."""
    try:
        await execute(
            """
            insert into public.ai_events
              (user_id, model, confidence, result, created_transaction_ids)
            values (%s, %s, %s, %s, %s)
            """,
            user_id,
            model,
            confidence,
            Jsonb(result),
            created_transaction_ids or [],
        )
    except Exception:  # noqa: BLE001
        log.exception("ai_events não gravado — a cota do mês vai contar a menos")
