"""Acesso ao Postgres do Supabase: pool, fila e estado da conversa.

Duas pools de propósito:
  - `pool`        -> schema public (fila, sessões, dados do produto)
  - `graph_pool`  -> search_path=langgraph, só para o checkpointer do LangGraph

Separar é o que garante que `checkpointer.setup()` crie as tabelas de checkpoint
no schema isolado, e não em `public` (onde o PostgREST as exporia com a anon key).
"""

from __future__ import annotations

import logging
from typing import Any, Literal
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


async def _isolar_checkpointer(conn: Any) -> None:
    """Põe a conexão do checkpointer no schema `langgraph`, por `SET`.

    NÃO dá para fazer isso pelo conninfo: o pooler do Supabase **ignora em
    silêncio** o `options=-csearch_path%3Dlanggraph` — a conexão sobe normal e o
    search_path continua `"$user", public, extensions`. Medido em 31/08/2026,
    e o efeito foi o `checkpointer.setup()` criar `checkpoints`,
    `checkpoint_writes` e `checkpoint_blobs` em **public**, onde o PostgREST as
    serve com a ANON KEY — e elas guardam o conteúdo das conversas (valores,
    contas, notas). Exatamente o que a 0040 existe para evitar.

    O `SET` roda na conexão já estabelecida, então não depende de o pooler
    repassar parâmetro de startup nenhum.
    """
    await conn.execute("set search_path to langgraph")


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
        settings.database_url,
        min_size=1,
        max_size=2,
        kwargs=_kwargs(),
        configure=_isolar_checkpointer,
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


async def open_pending(session_id: UUID) -> dict[str, Any] | None:
    """Pela SESSÃO, não pelo telefone: a conversa do app não tem número."""
    return await fetch_one(
        """
        select * from public.pending_actions
        where session_id = %s and status = 'awaiting' and expires_at > now()
        order by created_at desc limit 1
        """,
        session_id,
    )


async def create_pending(
    *,
    session_id: UUID,
    thread_id: str,
    phone: str | None,
    user_id: UUID,
    workspace_id: UUID,
    action: dict[str, Any],
    summary: str,
) -> dict[str, Any] | None:
    settings = get_settings()
    return await fetch_one(
        """
        insert into public.pending_actions
          (session_id, thread_id, phone, user_id, workspace_id, action, summary, expires_at)
        values (%s, %s, %s, %s, %s, %s, %s, now() + make_interval(mins => %s))
        on conflict do nothing
        returning *
        """,
        session_id,
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


async def reserve_execution(source_message_id: str, action_index: int, action_type: str) -> bool:
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
          (source_message_id, action_index, action_type)
        values (%s, %s, %s)
        on conflict (source_message_id, action_index) do nothing
        returning source_message_id
        """,
        source_message_id,
        action_index,
        action_type,
    )
    return row is not None


async def confirm_execution(
    source_message_id: str, action_index: int, result_id: UUID | None
) -> None:
    """Carimba o id criado na reserva (auditoria e desfazer)."""
    if result_id is None:
        return
    await execute(
        """
        update public.executed_actions set result_id = %s
        where source_message_id = %s and action_index = %s
        """,
        result_id,
        source_message_id,
        action_index,
    )


async def release_execution(source_message_id: str, action_index: int) -> None:
    """Devolve a vaga quando a execução falhou sem escrever nada.

    Sem isso, um erro transitório (banco fora por um segundo) queimaria a ação
    para sempre: o retry veria a reserva e pularia.
    """
    await execute(
        """
        delete from public.executed_actions
        where source_message_id = %s and action_index = %s and result_id is null
        """,
        source_message_id,
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
    workspace_id: UUID,
    channel: Literal["whatsapp", "app"],
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
              (user_id, workspace_id, channel, model, confidence, result,
               created_transaction_ids)
            values (%s, %s, %s, %s, %s, %s, %s)
            """,
            user_id,
            workspace_id,
            channel,
            model,
            confidence,
            Jsonb(result),
            created_transaction_ids or [],
        )
    except Exception:  # noqa: BLE001
        log.exception("ai_events não gravado — a cota do mês vai contar a menos")


# ---------------------------------------------------------------------------
# rascunhos (extração incompleta esperando o dado que falta)
# ---------------------------------------------------------------------------
# Tabela SEPARADA de `pending_actions` de propósito: lá o índice único
# "uma pergunta aberta por thread" faria um rascunho bloquear toda confirmação
# real — o oposto da troca livre de contexto que ele existe para permitir.


async def save_draft(
    *,
    session_id: UUID,
    thread_id: str,
    phone: str | None,
    user_id: UUID,
    workspace_id: UUID,
    action: dict,
    raw_text: str,
    missing: str,
    slot: str = "amount",
) -> str:
    """Grava (ou substitui) o rascunho da conversa e devolve o id dele.

    Substitui em vez de acumular: dois rascunhos abertos tornariam "foi 5000"
    ambíguo, pelo mesmo motivo que duas perguntas abertas tornariam "sim".

    O id sai daqui porque é ele que vai dentro do payload do botão da lista de
    cartões (`ds:<id>:c:<account_id>`) — sem ele, um clique de ontem escolheria
    o cartão da compra de hoje.
    """
    linha = await fetch_one(
        """
        insert into public.draft_actions
          (session_id, thread_id, phone, user_id, workspace_id, action, raw_text, missing, slot)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (session_id) do update
          set action = excluded.action,
              raw_text = excluded.raw_text,
              missing = excluded.missing,
              slot = excluded.slot,
              expires_at = now() + interval '24 hours',
              created_at = now()
        returning id
        """,
        session_id, thread_id, phone, user_id, workspace_id,
        Jsonb(action), raw_text, missing, slot,
    )
    return str(linha["id"])


async def open_draft(session_id: UUID) -> dict[str, Any] | None:
    """Busca pela SESSÃO, não por thread: o thread efetivo carrega o epoch, que
    gira em 6h de silêncio — e o rascunho vive 24h. Buscar por thread perderia
    de vista o rascunho da própria pessoa depois de uma noite. Era por telefone
    até a 0055; a sessão é a mesma chave estável e existe também no app."""
    return await fetch_one(
        """
        select * from public.draft_actions
        where session_id = %s and expires_at > now()
        """,
        session_id,
    )


async def delete_draft(session_id: UUID) -> None:
    await execute("delete from public.draft_actions where session_id = %s", session_id)


async def expire_drafts() -> None:
    await execute("select public.expire_draft_actions()")


# Ciclo assumido quando o cartão nasce pelo WhatsApp. NÃO é enfeite: o trigger
# `set_invoice` (0013) só associa fatura quando `closing_day` e `due_day` existem
# — com os dois nulos a compra ficaria fora de QUALQUER fatura, em silêncio, que
# é exatamente o estado que a regra "cartão obrigatório em parcelado" existe para
# impedir. A suposição é dita ao usuário na confirmação, porque mudar os dias
# depois NÃO reprocessa lançamento já gravado.
CARTAO_FECHAMENTO_PADRAO = 1
CARTAO_VENCIMENTO_PADRAO = 10


async def create_credit_card(*, workspace_id, user_id, name: str) -> dict[str, Any] | None:
    """Cartão novo, criado no meio da conversa. Devolve a linha (id + name)."""
    return await fetch_one(
        """
        insert into public.accounts
          (workspace_id, user_id, name, type, closing_day, due_day)
        values (%s, %s, %s, 'credit_card', %s, %s)
        returning id, name, type
        """,
        workspace_id, user_id, name,
        CARTAO_FECHAMENTO_PADRAO, CARTAO_VENCIMENTO_PADRAO,
    )


async def accounts(workspace_id, *, only_cards: bool = False) -> list[dict[str, Any]]:
    """Contas ativas do workspace: `id`, `name`, `type`.

    Fonte ÚNICA para casar conta por nome. Antes eram três consultas com três
    matchers diferentes (a validação do rascunho, o `resolve_account` da
    execução e o filtro de fatura), e elas podiam discordar sobre qual conta o
    usuário quis dizer.

    Devolve as linhas, não só os nomes: a Lista Interativa precisa do `id` e a
    gravação precisa do nome CANÔNICO — escrever o que o usuário digitou é como
    o `ilike` de baixo deixava de achar a conta que a validação tinha aprovado.
    """
    # o filtro vai como PARÂMETRO, não interpolado: SQL montada com f-string é
    # como injeção entra, mesmo quando hoje a variável é um bool nosso
    return await fetch(
        """
        select id, name, type, closing_day, due_day, credit_limit_cents from public.accounts
        where workspace_id = %s and archived = false
          and (%s = false or type = 'credit_card')
        order by name
        """,
        workspace_id,
        only_cards,
    )


# ---------------------------------------------------------------------------
# conversas do app (aba Agente)
# ---------------------------------------------------------------------------
# Tudo aqui roda em UMA transação com `select ... for update` na sessão. O
# WhatsApp serializa a conversa pelo claim da fila; aqui não há fila, e dois
# turnos simultâneos correriam em cima do mesmo checkpoint.
#
# ⚠️ `user_id` NUNCA vem do corpo HTTP — ele sai do `sub` do JWT e entra em toda
# cláusula `where`. O serviço conecta com papel que ignora RLS: o filtro é a
# única proteção que existe. Foi assim que a `import-statement` antiga deixou
# qualquer autenticado importar para o workspace de outro.


async def chat_profile(user_id: UUID) -> dict[str, Any] | None:
    """Workspace padrão e fuso do dono da conversa, direto do banco."""
    return await fetch_one(
        """
        select p.id, p.timezone, public._default_workspace(p.id) as workspace_id
        from public.profiles p
        where p.id = %s
        """,
        user_id,
    )


async def create_chat_session(
    *,
    user_id: UUID,
    workspace_id: UUID,
    title: str,
    first_client_message_id: UUID,
    thread_id: str,
    timezone_: str,
) -> tuple[dict[str, Any], bool]:
    """A sessão, e se ela nasceu agora.

    `on conflict (user_id, first_client_message_id)` é o que faz um retry do app
    devolver a MESMA conversa em vez de abrir uma segunda com a mesma mensagem
    dentro. O `do update` sem efeito existe só para o `returning` trazer a linha
    quando ela já existia.
    """
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            insert into public.user_sessions
              (thread_id, channel, user_id, workspace_id, title,
               first_client_message_id, timezone, last_message_at)
            values (%s, 'app', %s, %s, %s, %s, %s, now())
            on conflict (user_id, first_client_message_id)
              do update set last_message_at = public.user_sessions.last_message_at
            returning *, (xmax = 0) as criada
            """,
            (thread_id, user_id, workspace_id, title, first_client_message_id, timezone_),
        )
        linha = (await cur.fetchall())[0]
    criada = bool(linha.pop("criada"))
    return linha, criada


async def chat_session(session_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    return await fetch_one(
        """
        select * from public.user_sessions
        where id = %s and user_id = %s and channel = 'app' and deleting_at is null
        """,
        session_id,
        user_id,
    )


async def chat_sessions(
    user_id: UUID, *, cursor: tuple[Any, UUID] | None = None, limit: int = 20
) -> list[dict[str, Any]]:
    """Página da lista de conversas, mais recente primeiro.

    Ordena por `(last_message_at, id)` e não só pela data: duas conversas criadas
    no mesmo instante embaralhariam entre páginas e uma delas sumiria da lista.
    """
    if cursor:
        return await fetch(
            """
            select * from public.user_sessions
            where user_id = %s and channel = 'app' and deleting_at is null
              and (last_message_at, id) < (%s, %s)
            order by last_message_at desc, id desc
            limit %s
            """,
            user_id, cursor[0], cursor[1], limit,
        )
    return await fetch(
        """
        select * from public.user_sessions
        where user_id = %s and channel = 'app' and deleting_at is null
        order by last_message_at desc, id desc
        limit %s
        """,
        user_id, limit,
    )


async def rename_chat_session(
    session_id: UUID, user_id: UUID, title: str
) -> dict[str, Any] | None:
    return await fetch_one(
        """
        update public.user_sessions set title = %s
        where id = %s and user_id = %s and channel = 'app' and deleting_at is null
        returning *
        """,
        title, session_id, user_id,
    )


async def chat_messages(
    session_id: UUID, user_id: UUID, *, before: int | None = None, limit: int = 40
) -> list[dict[str, Any]]:
    """Página do histórico, em ordem CRONOLÓGICA.

    A paginação anda para trás (`sequence < before`) porque é assim que se lê um
    chat, mas a lista volta na ordem em que foi escrita — inverter na tela seria
    a mesma regra escrita duas vezes.
    """
    return await fetch(
        """
        select m.* from public.app_chat_messages m
        join public.user_sessions s on s.id = m.session_id
        where m.session_id = %s and s.user_id = %s and s.channel = 'app'
          and s.deleting_at is null
          and (%s::bigint is null or m.sequence < %s)
        order by m.sequence desc
        limit %s
        """,
        session_id, user_id, before, before, limit,
    )


async def chat_prompt_history(session_id: UUID, limit: int = 40) -> list[dict[str, Any]]:
    """Só o que COMPLETOU, e só desta conversa.

    Turno em `processing` ou `failed` não tem resposta: levá-lo ao prompt
    ensinaria o modelo a responder a uma pergunta que ninguém respondeu.
    """
    linhas = await fetch(
        """
        select role, content from public.app_chat_messages
        where session_id = %s and status = 'completed'
        order by sequence desc
        limit %s
        """,
        session_id, limit,
    )
    return [{"role": l["role"], "content": l["content"]} for l in reversed(linhas)]


async def claim_chat_turn(
    *, session_id: UUID, user_id: UUID, client_message_id: UUID, content: str
) -> dict[str, Any]:
    """Reserva o turno e devolve o que fazer com ele.

    Uma transação, um `for update` na sessão. `kind` sai como:
      - `completed`  : este UUID já rodou; devolve o que ficou gravado
      - `processing` : este UUID está rodando agora (lease vivo)
      - `run`        : reservado, pode executar
    e `busy`/`missing` para os dois jeitos de não poder.
    """
    settings = get_settings()
    async with pool().connection() as conn:
        async with conn.transaction():
            # O lease é comparado DENTRO do banco. Trazer `lease_expires_at` e
            # comparar em Python misturaria dois relógios: a janela passaria a
            # variar com o drift entre container e Postgres, e o erro apareceria
            # como conversa presa, sem nada no log.
            cur = await conn.execute(
                """
                select *,
                       (lease_expires_at is not null and lease_expires_at > now())
                         as lease_vivo
                from public.user_sessions
                where id = %s and user_id = %s and channel = 'app' and deleting_at is null
                for update
                """,
                (session_id, user_id),
            )
            linhas = await cur.fetchall()
            if not linhas:
                return {"kind": "missing"}
            sessao = linhas[0]
            vivo = bool(sessao.pop("lease_vivo"))

            cur = await conn.execute(
                """
                select * from public.app_chat_messages
                where session_id = %s and client_message_id = %s
                """,
                (session_id, client_message_id),
            )
            anteriores = await cur.fetchall()
            anterior = anteriores[0] if anteriores else None

            # Outro turno com a conversa: recusa. O MESMO turno reentrando não é
            # concorrência, é retry — e retry é o caso normal em rede de celular.
            if vivo and (anterior is None or sessao["lease_message_id"] != anterior["id"]):
                return {"kind": "busy"}

            if anterior and anterior["status"] == "completed":
                cur = await conn.execute(
                    """
                    select * from public.app_chat_messages
                    where session_id = %s and in_reply_to = %s
                    """,
                    (session_id, anterior["id"]),
                )
                respostas = await cur.fetchall()
                return {
                    "kind": "completed",
                    "session": sessao,
                    "user_message": anterior,
                    "assistant_message": respostas[0] if respostas else None,
                }

            if anterior and anterior["status"] == "processing" and vivo:
                return {"kind": "processing", "session": sessao, "user_message": anterior}

            if anterior:
                cur = await conn.execute(
                    """
                    update public.app_chat_messages
                    set status = 'processing', error_code = null
                    where id = %s
                    returning *
                    """,
                    (anterior["id"],),
                )
            else:
                cur = await conn.execute(
                    """
                    insert into public.app_chat_messages
                      (session_id, client_message_id, role, content, status)
                    values (%s, %s, 'user', %s, 'processing')
                    returning *
                    """,
                    (session_id, client_message_id, content),
                )
            mensagem = (await cur.fetchall())[0]

            cur = await conn.execute(
                """
                update public.user_sessions
                set lease_message_id = %s,
                    lease_expires_at = now() + make_interval(secs => %s)
                where id = %s
                returning *
                """,
                (mensagem["id"], settings.app_turn_lease_seconds, session_id),
            )
            sessao = (await cur.fetchall())[0]
            return {
                "kind": "run",
                "session": sessao,
                "user_message": mensagem,
                "retry": bool(anterior),
            }


async def finish_chat_turn(
    *,
    session_id: UUID,
    user_message_id: UUID,
    content: str,
    ui_payload: dict | None,
) -> dict[str, Any]:
    """Grava a resposta, fecha o turno do usuário e SÓ ENTÃO solta o lease.

    Nessa ordem porque soltar antes abriria a janela em que outro turno entra e
    grava a resposta dele em cima de uma conversa que ainda não terminou.
    """
    async with pool().connection() as conn:
        async with conn.transaction():
            cur = await conn.execute(
                """
                insert into public.app_chat_messages
                  (session_id, role, content, ui_payload, in_reply_to, status, completed_at)
                values (%s, 'assistant', %s, %s, %s, 'completed', now())
                returning *
                """,
                (session_id, content, Jsonb(ui_payload) if ui_payload else None,
                 user_message_id),
            )
            resposta = (await cur.fetchall())[0]
            await conn.execute(
                """
                update public.app_chat_messages
                set status = 'completed', error_code = null, completed_at = now()
                where id = %s
                """,
                (user_message_id,),
            )
            await conn.execute(
                """
                update public.user_sessions
                set last_message_at = now(), lease_message_id = null,
                    lease_expires_at = null
                where id = %s
                """,
                (session_id,),
            )
    return resposta


async def fail_chat_turn(
    *, session_id: UUID, user_message_id: UUID, error_code: str
) -> None:
    """Marca a falha e solta o lease.

    `error_code` é um código curto da nossa lista, nunca a exceção: a mensagem do
    Postgres carrega SQL e às vezes a URL do banco, e ela apareceria na tela.
    """
    async with pool().connection() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                update public.app_chat_messages
                set status = 'failed', error_code = %s
                where id = %s
                """,
                (error_code, user_message_id),
            )
            await conn.execute(
                """
                update public.user_sessions
                set lease_message_id = null, lease_expires_at = null
                where id = %s
                """,
                (session_id,),
            )


async def mark_chat_deleting(session_id: UUID, user_id: UUID) -> dict[str, Any] | None:
    """Esconde a conversa da lista e recusa se houver turno rodando.

    Dois passos (esconder, depois apagar) porque entre eles há uma chamada ao
    checkpointer que pode falhar: com `deleting_at`, a conversa já sumiu da tela
    do usuário e uma retentativa da exclusão continua encontrando a linha.
    """
    async with pool().connection() as conn:
        async with conn.transaction():
            cur = await conn.execute(
                """
                select id,
                       (lease_expires_at is not null and lease_expires_at > now())
                         as lease_vivo
                from public.user_sessions
                where id = %s and user_id = %s and channel = 'app' and deleting_at is null
                for update
                """,
                (session_id, user_id),
            )
            linhas = await cur.fetchall()
            if not linhas:
                return None
            if linhas[0]["lease_vivo"]:
                return {"busy": True}
            cur = await conn.execute(
                "update public.user_sessions set deleting_at = now() where id = %s returning *",
                (session_id,),
            )
            return (await cur.fetchall())[0]


async def drop_chat_session(session_id: UUID) -> None:
    """Mensagens, pendências e rascunhos saem por cascade da FK."""
    await execute("delete from public.user_sessions where id = %s", session_id)
