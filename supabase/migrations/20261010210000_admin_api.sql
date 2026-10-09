-- Painel admin v2: auditoria das ações e apagar conta de OUTRO usuário (só o agente chama).
-- 1) public.admin_audit_events: RLS ligada sem policy e sem grant (só o papel do agente lê/escreve).
--    `target_workspace_id` (não `workspace_id`) de propósito: a asserção (e) de sem_assinatura.sql varre `workspace_id`.
--    Sem FK nos alvos: a linha de "account_deleted" tem que sobreviver ao apagar. Payload só com ids.
-- 2) O corpo de delete_my_account (20261010200000) vira private.apagar_conta(p_user); delete_my_account
--    continua auth.uid()-only e só delega.
create table public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  admin_user_id uuid not null,
  action text not null,
  target_user_id uuid,
  target_workspace_id uuid,
  payload jsonb not null default '{}'
);
create index admin_audit_events_created_idx on public.admin_audit_events (created_at desc);
create index admin_audit_events_target_idx on public.admin_audit_events (target_user_id, created_at desc);
alter table public.admin_audit_events enable row level security;
revoke all on public.admin_audit_events from public, anon, authenticated;

create function private.apagar_conta(p_user uuid)
returns void
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := p_user;
  fone text;
  threads text[];
  tabela text;
begin
  if uid is null then return; end if;
  perform pg_catalog.set_config('proops.apagando_conta', 'on', true);

  select p.phone into fone from public.profiles p where p.id = uid;

  -- threads da pessoa (todas as épocas compartilham `thread_id` como prefixo), lidos ANTES da cascata
  select coalesce(pg_catalog.array_agg(s.thread_id), '{}') into threads
  from public.user_sessions s
  where s.user_id = uid
     or (fone is not null and private.canonical_whatsapp_phone(s.phone) = private.canonical_whatsapp_phone(fone));

  foreach tabela in array array['checkpoints', 'checkpoint_blobs', 'checkpoint_writes']
  loop
    if pg_catalog.to_regclass('langgraph.' || tabela) is not null then
      execute pg_catalog.format(
        'delete from langgraph.%I t where t.thread_id = any($1) or exists ('
        'select 1 from pg_catalog.unnest($1) x where pg_catalog.left(t.thread_id, pg_catalog.length(x) + 1) = x || '':'')',
        tabela
      ) using threads;
    end if;
  end loop;

  -- fila e telemetria por telefone/usuário (as de espaços de outros donos não cascateiam)
  delete from public.messages_queue q
   where q.user_id = uid or q.thread_id = any(threads)
      or (fone is not null and private.canonical_whatsapp_phone(q.phone) = private.canonical_whatsapp_phone(fone));
  delete from public.messages_raw m
   where m.user_id = uid
      or (fone is not null and private.canonical_whatsapp_phone(m.phone) = private.canonical_whatsapp_phone(fone));
  delete from public.agent_routing r
   where fone is not null and private.canonical_whatsapp_phone(r.phone) = private.canonical_whatsapp_phone(fone);
  delete from public.ai_events where user_id = uid;
  delete from public.agent_feedback where user_id = uid;
  delete from public.whatsapp_sends where user_id = uid;
  -- sessões (pending/draft/app_chat_messages saem por cascata); cobre a órfã que só tem o telefone
  delete from public.user_sessions s where s.thread_id = any(threads);

  -- auditoria de cobrança fica sem dado pessoal: some o payload, não a linha.
  update public.billing_events b set payload = pg_catalog.jsonb_build_object('anonimizado', true)
   where b.workspace_id in (select w.id from public.workspaces w where w.owner_id = uid)
      or b.payload->>'app_user_id' = uid::text
      or b.payload->>'user_id' = uid::text;

  -- espaços dos quais é DONO: o cascade leva membros, convites e todos os dados.
  delete from public.workspaces where owner_id = uid;

  -- espaços de outros: as tabelas com FK "no action" para profiles passam para o dono do espaço
  -- (o dado é do espaço); as demais (lançamentos dele etc.) saem pelo cascade do profile.
  update public.emergency_reserves t set user_id = w.owner_id from public.workspaces w
    where t.workspace_id = w.id and t.user_id = uid;
  update public.financial_allocations t set user_id = w.owner_id from public.workspaces w
    where t.workspace_id = w.id and t.user_id = uid;
  update public.reserve_month_reviews t set user_id = w.owner_id from public.workspaces w
    where t.workspace_id = w.id and t.user_id = uid;
  update public.goal_plans t set user_id = w.owner_id from public.workspaces w
    where t.workspace_id = w.id and t.user_id = uid;
  update public.goal_plan_items t set user_id = w.owner_id from public.workspaces w
    where t.workspace_id = w.id and t.user_id = uid;
  update public.goal_money_movements t set user_id = w.owner_id from public.workspaces w
    where t.workspace_id = w.id and t.user_id = uid;
  update public.investment_movements t set user_id = w.owner_id from public.workspaces w
    where t.workspace_id = w.id and t.user_id = uid;
  update public.investment_valuations t set user_id = w.owner_id from public.workspaces w
    where t.workspace_id = w.id and t.user_id = uid;

  delete from public.workspace_members where user_id = uid;
  -- profiles, sessões, identidades e o resto cascateiam de auth.users.
  delete from auth.users where id = uid;
end;
$$;
revoke execute on function private.apagar_conta(uuid) from public, anon, authenticated;

create or replace function public.delete_my_account()
returns void
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then return; end if;
  perform private.apagar_conta(uid);
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
