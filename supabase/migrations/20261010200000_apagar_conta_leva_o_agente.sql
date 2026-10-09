-- Apagar a conta leva TAMBÉM o histórico do agente (LGPD).
-- O histórico do agente é chaveado por telefone/thread, não só por workspace. O que sobrava hoje:
--   * checkpoints do LangGraph (schema langgraph, por thread_id): nenhuma FK, ficavam para sempre;
--   * messages_queue / messages_raw / agent_routing por telefone (a FK é set null ou não existe);
--   * ai_events, agent_feedback (user_id set null) e whatsapp_sends (sem FK) em espaços de OUTROS donos;
--   * billing_events.payload (evento da loja com app_user_id etc.; workspace_id vira null).
-- Já saíam por cascata: user_sessions (+ pending/draft/app_chat_messages), executed_actions, alerts_sent,
-- e tudo com workspace_id dos espaços do dono.
-- billing_events é auditoria de cobrança: FICA (id, tipo, provedor, resultado, data) sem o payload.
-- Corpo anterior (20261010180000) mantido: guarda, GUC, reatribuição, security definer, search_path, fuso.
create or replace function public.delete_my_account()
returns void
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := (select auth.uid());
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
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
