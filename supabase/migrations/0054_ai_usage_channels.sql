-- Fase 6: a cota continua única por workspace, mas o consumo passa a explicar o canal.
--
-- `ai_events` guardava apenas user_id. Isso era insuficiente em workspace compartilhado: um
-- membro também conserva o workspace próprio, então juntar uso por membership podia cobrar o
-- mesmo evento nos dois espaços. A partir daqui cada chamada congela onde e por qual canal foi
-- feita. Os eventos históricos só podiam ter vindo do WhatsApp; o workspace histórico é o padrão
-- daquele usuário, pois antes desta coluna não existe informação melhor para reconstruí-lo.

alter table public.ai_events
  add column workspace_id uuid references public.workspaces(id) on delete cascade,
  add column channel text;

update public.ai_events e
set channel = 'whatsapp',
    workspace_id = case
      when e.user_id is null then null
      else public._default_workspace(e.user_id)
    end;

do $$
begin
  if exists (
    select 1 from public.ai_events
    where user_id is not null and workspace_id is null
  ) then
    raise exception 'ai_events ativo sem workspace: corrija o vínculo antes de aplicar 0054';
  end if;
end;
$$;

alter table public.ai_events
  alter column channel set not null,
  add constraint ai_events_channel_check check (channel in ('whatsapp', 'app')),
  add constraint ai_events_workspace_required_check
    check (user_id is null or workspace_id is not null);

create index ai_events_workspace_created_idx
  on public.ai_events (workspace_id, created_at desc)
  where workspace_id is not null;

comment on column public.ai_events.workspace_id is
  'Workspace cuja cota consumiu esta chamada; obrigatório enquanto user_id existir.';
comment on column public.ai_events.channel is
  'Origem da chamada de IA: whatsapp ou app. Não separa a cota, apenas explica o consumo.';

-- A forma final destas funções vem da 0036. Elas ganham a divisão por canal e deixam de juntar
-- eventos só por user_id: o workspace_id congelado no evento é a fonte da cota.
drop function if exists private.plan_status_for(uuid);
create function private.plan_status_for(ws_id uuid)
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
  members int, max_members int,
  ai_messages_month int, ai_messages_whatsapp int, ai_messages_app int,
  max_ai_messages_month int, can_import boolean
)
language sql stable
set search_path = ''
as $fn$
  with assinatura as (
    select private.effective_plan(ws_id) as plan,
           coalesce(s.plan, 'free') as plan_bruto,
           coalesce(s.status, 'active') as status_bruto,
           s.current_period_end,
           coalesce(s.is_trial, false) as is_trial,
           s.provider
    from public.workspaces w
    left join public.subscriptions s on s.workspace_id = w.id
    where w.id = ws_id
  ),
  limites as (select * from private.plan_limits((select plan from assinatura))),
  uso as (
    select
      (select count(*)::int from public.workspace_members m
       where m.workspace_id = ws_id) as membros,
      count(e.id)::int as mensagens,
      count(e.id) filter (where e.channel = 'whatsapp')::int as mensagens_whatsapp,
      count(e.id) filter (where e.channel = 'app')::int as mensagens_app
    from public.ai_events e
    where e.workspace_id = ws_id
      and e.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
  )
  select a.plan,
         case when a.plan = 'free' and a.plan_bruto <> 'free' then 'expired'
              else a.status_bruto end,
         a.current_period_end, a.is_trial, a.provider,
         u.membros, l.max_members,
         u.mensagens, u.mensagens_whatsapp, u.mensagens_app,
         l.max_ai_messages_month, l.can_import
  from assinatura a, limites l, uso u;
$fn$;
revoke execute on function private.plan_status_for(uuid) from public, anon, authenticated;
grant execute on function private.plan_status_for(uuid) to service_role;

drop function if exists public._plan_status(uuid);
create function public._plan_status(ws_id uuid)
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
  members int, max_members int,
  ai_messages_month int, ai_messages_whatsapp int, ai_messages_app int,
  max_ai_messages_month int, can_import boolean
)
language sql stable security definer
set search_path = ''
as $fn$
  select * from private.plan_status_for(ws_id);
$fn$;
revoke execute on function public._plan_status(uuid) from public, anon, authenticated;
grant execute on function public._plan_status(uuid) to service_role;

drop function if exists public.plan_status();
create function public.plan_status()
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
  members int, max_members int,
  ai_messages_month int, ai_messages_whatsapp int, ai_messages_app int,
  max_ai_messages_month int, can_import boolean
)
language sql stable security definer
set search_path = ''
as $fn$
  with alvo as (
    select public.my_default_workspace() as workspace_id
  )
  select p.*
  from alvo a
  cross join lateral private.plan_status_for(a.workspace_id) p
  where a.workspace_id is not null
    and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = a.workspace_id
        and m.user_id = (select auth.uid())
    );
$fn$;
revoke execute on function public.plan_status() from public, anon;
grant execute on function public.plan_status() to authenticated, service_role;
