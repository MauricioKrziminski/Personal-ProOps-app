-- A conversa que virou registro: a Hoje mostra o texto REAL que a pessoa mandou, preso ao
-- registro que ele criou (spec 2026-09-17, "Conversa organizada").
--
-- `executed_actions` já ligava a fala (`source_message_id`) ao registro (`result_id`), mas não
-- dizia de QUEM era nem o que ela disse. O agente passa a gravar os três na reserva; aqui eles
-- nascem, o histórico é preenchido e duas leituras novas aparecem.
--
-- ⚠️ A tabela continua infra: RLS ligada e SEM policy. O app lê pela porta `agent_activity`,
-- `security definer`, que devolve só o que é do chamador e NUNCA o `payload` da Meta (ele carrega
-- telefone).

alter table public.executed_actions
  add column if not exists user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists origin_text text;

create index if not exists executed_actions_atividade
  on public.executed_actions (user_id, executed_at desc)
  where user_id is not null;

comment on column public.executed_actions.origin_text is
  'A frase que originou a ação (ExecContext.texto): a mensagem do turno, a original numa retomada de SIM, o raw_text num rascunho completado.';

-- ── Retropreenchimento ────────────────────────────────────────────────────────────────────
-- Canal app: `app:<client_message_id>`.
update public.executed_actions ea
set user_id = s.user_id,
    workspace_id = s.workspace_id,
    origin_text = m.content
from public.app_chat_messages m
join public.user_sessions s on s.id = m.session_id
where ea.user_id is null
  and m.role = 'user'
  and s.user_id is not null
  and ea.source_message_id = 'app:' || m.client_message_id::text;

-- Canal WhatsApp: o id da ÚLTIMA mensagem do lote; o texto é o do lote inteiro, na ordem.
-- (No histórico, uma resposta de rascunho aparece com o próprio texto — só as ações novas levam
-- a frase original, que só o agente conhece.)
with texto as (
  select q.wa_message_id,
         string_agg(nullif(btrim(b.payload->'text'->>'body'), ''), E'\n' order by b.created_at) as corpo
  from public.messages_queue q
  join public.messages_queue b
    on (q.batch_id is not null and b.batch_id = q.batch_id) or b.id = q.id
  group by q.wa_message_id
)
update public.executed_actions ea
set user_id = s.user_id,
    workspace_id = s.workspace_id,
    origin_text = t.corpo
from public.messages_queue q
join public.user_sessions s on s.thread_id = q.thread_id and s.channel = 'whatsapp'
left join texto t on t.wa_message_id = q.wa_message_id
where ea.user_id is null
  and s.user_id is not null
  and ea.source_message_id = q.wa_message_id;

-- Sessão sem workspace: o workspace do registro que a ação criou.
update public.executed_actions ea
set workspace_id = coalesce(
  (select workspace_id from public.transactions where id = ea.result_id),
  (select workspace_id from public.installment_plans where id = ea.result_id),
  (select workspace_id from public.recurring_transactions where id = ea.result_id),
  (select workspace_id from public.reminders where id = ea.result_id),
  (select workspace_id from public.notes where id = ea.result_id),
  (select workspace_id from public.accounts where id = ea.result_id),
  (select workspace_id from public.goals where id = ea.result_id),
  (select workspace_id from public.debts where id = ea.result_id)
)
where ea.user_id is not null and ea.workspace_id is null and ea.result_id is not null;

-- ── A porta da Conversa ───────────────────────────────────────────────────────────────────
create or replace function public.agent_activity(p_limit int default 6)
returns table (
  source_message_id text,
  executed_at timestamptz,
  channel text,
  input_kind text,
  origin_text text,
  session_id uuid,
  action_index int,
  action_type text,
  result_id uuid,
  record jsonb
)
language sql stable security definer set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with minhas as (
    select ea.*
    from public.executed_actions ea
    where ea.user_id = auth.uid()
      and ea.workspace_id in (select private.my_workspace_ids())
  ),
  falas as (
    select m.source_message_id, max(m.executed_at) as quando
    from minhas m
    group by m.source_message_id
    order by quando desc
    limit greatest(1, least(coalesce(p_limit, 6), 30))
  )
  select
    m.source_message_id,
    m.executed_at,
    case when m.source_message_id like 'app:%' then 'app' else 'whatsapp' end,
    case
      when m.source_message_id like 'app:%' then 'text'
      when exists (
        select 1 from public.messages_queue b
        where b.batch_id = q.batch_id and b.message_type = 'audio'
      ) or q.message_type = 'audio' then 'audio'
      when q.message_type in ('image', 'document') then q.message_type
      when q.message_type in ('interactive', 'button') then 'click'
      else 'text'
    end,
    m.origin_text,
    app.session_id,
    m.action_index,
    m.action_type,
    m.result_id,
    case
      when t.id is not null then jsonb_build_object(
        'kind', 'transaction', 'id', t.id,
        'title', coalesce(nullif(t.description, ''), nullif(t.merchant, ''), t.category, 'Lançamento'),
        'amount_cents', t.amount_cents, 'tx_kind', t.kind, 'category', t.category,
        'occurred_at', t.occurred_at, 'account', a.name)
      when ip.id is not null then jsonb_build_object(
        'kind', 'installment_plan', 'id', ip.id,
        'title', coalesce(nullif(ip.description, ''), nullif(ip.merchant, ''), 'Compra parcelada'),
        'amount_cents', ip.total_cents, 'installments', ip.installments, 'category', ip.category)
      when rt.id is not null then jsonb_build_object(
        'kind', 'recurring', 'id', rt.id,
        'title', coalesce(nullif(rt.description, ''), rt.category, 'Recorrente'),
        'amount_cents', rt.amount_cents, 'tx_kind', rt.kind, 'category', rt.category)
      when r.id is not null then jsonb_build_object(
        'kind', 'reminder', 'id', r.id, 'title', r.title, 'next_run_at', r.next_run_at)
      when n.id is not null then jsonb_build_object(
        'kind', 'note', 'id', n.id,
        'title', left(split_part(btrim(n.content), E'\n', 1), 120))
      when ac.id is not null then jsonb_build_object(
        'kind', 'account', 'id', ac.id, 'title', ac.name, 'account_type', ac.type)
      when g.id is not null then jsonb_build_object(
        'kind', 'goal', 'id', g.id, 'title', g.name, 'amount_cents', g.target_cents)
      when d.id is not null then jsonb_build_object(
        'kind', 'debt', 'id', d.id, 'title', d.name, 'amount_cents', d.remaining_cents)
    end
  from falas f
  join minhas m on m.source_message_id = f.source_message_id
  left join public.messages_queue q on q.wa_message_id = m.source_message_id
  left join lateral (
    select acm.session_id
    from public.app_chat_messages acm
    join public.user_sessions s on s.id = acm.session_id and s.user_id = auth.uid()
    where m.source_message_id like 'app:%'
      and acm.role = 'user'
      and acm.client_message_id::text = substr(m.source_message_id, 5)
    limit 1
  ) app on true
  left join public.transactions t on t.id = m.result_id and t.workspace_id = m.workspace_id
  left join public.accounts a on a.id = t.account_id
  left join public.installment_plans ip on ip.id = m.result_id and ip.workspace_id = m.workspace_id
  left join public.recurring_transactions rt on rt.id = m.result_id and rt.workspace_id = m.workspace_id
  left join public.reminders r on r.id = m.result_id and r.workspace_id = m.workspace_id
  left join public.notes n on n.id = m.result_id and n.workspace_id = m.workspace_id and n.deleted_at is null
  left join public.accounts ac on ac.id = m.result_id and ac.workspace_id = m.workspace_id
  left join public.goals g on g.id = m.result_id and g.workspace_id = m.workspace_id
  left join public.debts d on d.id = m.result_id and d.workspace_id = m.workspace_id
  order by f.quando desc, m.source_message_id, m.action_index;
$$;

revoke execute on function public.agent_activity(int) from public, anon;
grant execute on function public.agent_activity(int) to authenticated;

-- ── A Pista: a MESMA lista que forma o "livre" ────────────────────────────────────────────
-- O `ev` de `spendable_for` vira função, e as duas leituras saem dela: duplicar o CTE seria a
-- segunda cópia da regra, e a Pista contradiria o herói sem erro nenhum.
create or replace function private.spendable_events_for(ws_ids uuid[], p_view text default null)
returns table (day date, in_cents bigint, out_cents bigint, title text, origin text, ref_id uuid)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with b as (
    select c.fim
    from private.cycle_bounds(
           private.cycle_close_day(ws_ids, p_view),
           private.cycle_month_of(private.cycle_close_day(ws_ids, p_view), current_date)) c
  )
  -- `not realizado`: o que já saiu da conta está DENTRO de `caixa`, não à frente dele.
  select e.day, e.in_cents, e.out_cents, e.title, e.origin, e.ref_id
  from b, private.cash_events(ws_ids, current_date, b.fim) e
  where not e.realizado;
$$;
revoke execute on function private.spendable_events_for(uuid[], text) from public, anon;
grant execute on function private.spendable_events_for(uuid[], text) to authenticated, service_role;

-- MESMO cabeçalho da `20260913180000` (invoker, search_path, fuso): cláusula não repetida some.
create or replace function private.spendable_for(ws_ids uuid[], p_view text default null)
returns table (caixa bigint, comprometido_ate_entrada bigint, comprometido_no_ciclo bigint,
               a_receber_no_ciclo bigint, proxima_entrada date)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with ev as (select * from private.spendable_events_for(ws_ids, p_view)),
  entrada as (select min(day) d from ev where in_cents > 0)
  select private.cash_total(ws_ids, current_date),
         -- `<=`: a despesa do dia da entrada conta (ver a `20260913180000`).
         coalesce((select sum(out_cents) from ev
                   where day <= coalesce((select d from entrada), 'infinity'::date)), 0)::bigint,
         coalesce((select sum(out_cents) from ev), 0)::bigint,
         coalesce((select sum(in_cents) from ev), 0)::bigint,
         (select d from entrada);
$$;

create or replace function public.spendable_path(p_view text default null)
returns table (day date, out_cents bigint, title text, origin text, ref_id uuid)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with ev as (
    select * from private.spendable_events_for(array(select private.my_workspace_ids()), p_view)
  ),
  entrada as (select min(day) d from ev where in_cents > 0)
  select ev.day, ev.out_cents, ev.title, ev.origin, ev.ref_id
  from ev
  where ev.out_cents > 0
    and ev.day <= coalesce((select d from entrada), 'infinity'::date)
  order by ev.day, ev.out_cents desc;
$$;
revoke execute on function public.spendable_path(text) from public, anon;
grant execute on function public.spendable_path(text) to authenticated;
