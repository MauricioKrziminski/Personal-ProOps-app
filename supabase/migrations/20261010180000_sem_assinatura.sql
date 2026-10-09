-- Fim do plano grátis. `plan = 'free'` continua no banco (check, default e app em campo leem) e passa a
-- significar "SEM assinatura". Entrada = teste de 7 dias da loja (RevenueCat → _apply_entitlement).
--   access = 'subscriber' (plano efetivo <> free) | 'never' (free e nunca teve loja) | 'lapsed' (free e já teve).
-- Quem está em 'never' fica no paywall; 'lapsed' entra só para LER: o gatilho abaixo recusa escrita do app.

-- ── 1. limites: free zera; teste da loja limita a IA a 60 mensagens ───────────────────────────────────
-- Drop da versão de 1 argumento: com o default da nova, as duas coexistiriam e `plan_limits('pro')`
-- viraria chamada ambígua (o agente chama com 1 argumento).
drop function if exists private.plan_limits(text);
create function private.plan_limits(p_plan text, p_trial boolean default false)
returns table(max_members int, max_ai_messages_month int, can_import boolean)
language sql immutable
set search_path = public
as $$
  select l.max_members,
         case when coalesce(p_trial, false) then least(l.max_ai_messages_month, 60)
              else l.max_ai_messages_month end,
         l.can_import
  from (values
    ('free',   1, 0,    false),
    ('pro',    1, 400,  true),
    ('family', 5, 1000, true)
  ) as l(plan, max_members, max_ai_messages_month, can_import)
  where l.plan = coalesce(p_plan, 'free');
$$;
revoke execute on function private.plan_limits(text, boolean) from public, anon;
grant execute on function private.plan_limits(text, boolean) to authenticated, service_role;

-- ── 2. plan_status_for + coluna `access` NO FIM (corpo da 20261006110000) ─────────────────────────────
drop function if exists public.plan_status();
drop function if exists public._plan_status(uuid);
drop function if exists private.plan_status_for(uuid);

create function private.plan_status_for(ws_id uuid)
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
  members int, max_members int,
  ai_messages_month int, ai_messages_whatsapp int, ai_messages_app int,
  max_ai_messages_month int, can_import boolean,
  access text
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
  limites as (
    select * from private.plan_limits((select plan from assinatura), (select is_trial from assinatura))
  ),
  uso as (
    select
      (select count(*)::int from public.workspace_members m
       where m.workspace_id = ws_id) as membros,
      count(e.id)::int as mensagens,
      count(e.id) filter (where e.channel = 'whatsapp')::int as mensagens_whatsapp,
      count(e.id) filter (where e.channel = 'app')::int as mensagens_app
    from public.ai_events e
    where e.workspace_id = ws_id
      and e.kind = 'turn'
      and e.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
  )
  select a.plan,
         case when a.plan = 'free' and a.plan_bruto <> 'free' then 'expired'
              else a.status_bruto end,
         a.current_period_end, a.is_trial, a.provider,
         u.membros, l.max_members,
         u.mensagens, u.mensagens_whatsapp, u.mensagens_app,
         l.max_ai_messages_month, l.can_import,
         case when a.plan <> 'free' then 'subscriber'
              when a.provider is null then 'never'
              else 'lapsed' end
  from assinatura a, limites l, uso u;
$fn$;
revoke execute on function private.plan_status_for(uuid) from public, anon, authenticated;
grant execute on function private.plan_status_for(uuid) to service_role;

create function public._plan_status(ws_id uuid)
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
  members int, max_members int,
  ai_messages_month int, ai_messages_whatsapp int, ai_messages_app int,
  max_ai_messages_month int, can_import boolean,
  access text
)
language sql stable security definer
set search_path = ''
as $fn$
  select * from private.plan_status_for(ws_id);
$fn$;
revoke execute on function public._plan_status(uuid) from public, anon, authenticated;
grant execute on function public._plan_status(uuid) to service_role;

create function public.plan_status()
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
  members int, max_members int,
  ai_messages_month int, ai_messages_whatsapp int, ai_messages_app int,
  max_ai_messages_month int, can_import boolean,
  access text
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

-- ── 3. portão de escrita ──────────────────────────────────────────────────────────────────────────────
-- "Vem do app" = PostgREST, que conecta como `authenticator` (session_user não muda dentro de
-- security definer, então RPCs chamadas pelo app também são barradas — é o desejado). O agente conecta
-- como postgres pelo pooler e os testes SQL também: passam. `proops.forcar_app` só existe para o teste
-- e só pode deixar a regra MAIS rígida.
create function private.requisicao_do_app()
returns boolean
language sql stable
set search_path = ''
as $$
  select session_user = 'authenticator'
      or coalesce(pg_catalog.current_setting('proops.forcar_app', true), '') = 'on';
$$;
revoke execute on function private.requisicao_do_app() from public, anon, authenticated;

-- security definer: o gatilho roda como o papel do app e `effective_plan` lê subscriptions (RLS).
create function private.tg_exige_assinatura()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  if private.requisicao_do_app()
     and coalesce(pg_catalog.current_setting('proops.apagando_conta', true), '') <> 'on' then
    -- ponytail: uma consulta por linha; se import em lote pesar, cachear por statement.
    foreach ws in array case tg_op
        when 'INSERT' then array[new.workspace_id]
        when 'DELETE' then array[old.workspace_id]
        else array[new.workspace_id, old.workspace_id] end
    loop
      if ws is not null and private.effective_plan(ws) = 'free' then
        raise exception using errcode = 'PT402',
          message = 'Sem assinatura ativa: seus dados continuam aqui para consulta. Assine para voltar a lançar.';
      end if;
    end loop;
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;
revoke execute on function private.tg_exige_assinatura() from public, anon, authenticated;

-- Entram: toda tabela de public com workspace_id que guarda dado DA PESSOA (o que ela lança, cadastra
-- ou configura no app). Ficam de fora, de propósito:
--   subscriptions, workspaces, workspace_members, workspace_invites, profiles (conta/assinatura: precisam
--     escrever para assinar, convidar e apagar a conta);
--   ai_events, agent_feedback, alerts_sent, billing_events, user_sessions, messages_queue, messages_raw,
--     pending_actions, draft_actions, executed_actions, agent_routing, app_chat_messages, jobs,
--     transaction_embeddings, net_worth_snapshots (fila, infra e telemetria: quem escreve é o agente/cron);
--   debt_installment_edits, debt_declared_due_dates, debt_declared_estimates (sem workspace_id; só se
--     alcançam pela dívida, que está barrada).
do $$
declare t text;
begin
  foreach t in array array[
    'account_aliases','accounts','asset_valuations','assets','bill_reminders',
    'budget_plan_applications','budget_plan_lines','budget_plans','budgets','card_invoices','categories',
    'categorization_rules','debt_pauses','debts','emergency_reserves','financial_allocations',
    'goal_contributions','goal_milestones','goal_money_movements','goal_plan_items','goal_plans','goals',
    'import_batches','import_items','installment_plans','investment_movements','investment_valuations',
    'note_folders','notes','recurring_transactions','reminders','reserve_month_reviews','subcategories',
    'transaction_templates','transactions'
  ] loop
    execute format('drop trigger if exists a0_exige_assinatura on public.%I', t);
    execute format(
      'create trigger a0_exige_assinatura before insert or update or delete on public.%I
         for each row execute function private.tg_exige_assinatura()', t);
  end loop;
end $$;

-- ── 4. apagar a própria conta ─────────────────────────────────────────────────────────────────────────
-- Quem não assina precisa conseguir sair (loja e LGPD). Storage: o bucket `receipts` guarda objetos sob
-- `<workspace_id>/…` e o Supabase não deixa apagar storage.objects por SQL — o app/agente os remove antes.
create function public.delete_my_account()
returns void
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then return; end if;
  perform pg_catalog.set_config('proops.apagando_conta', 'on', true);

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

-- ── 5. handle_new_user: convite pendente respeita max_members (corpo da 0051 + conferência) ───────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ws_id uuid;
  telefone text;
  convite record;
  limites record;
begin
  telefone := new.phone;

  insert into public.profiles (id, phone, display_name)
  values (new.id, telefone, nullif(btrim(new.raw_user_meta_data->>'display_name'), ''))
  on conflict (id) do nothing;

  select w.id into ws_id from public.workspaces w where w.owner_id = new.id
  order by w.created_at limit 1;

  if ws_id is null then
    insert into public.workspaces (name, owner_id) values ('Pessoal', new.id)
    returning id into ws_id;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.subscriptions (workspace_id)
  values (ws_id)
  on conflict (workspace_id) do nothing;

  -- mesma conferência de accept_pending_invites: espaço cheio deixa o convite pendente.
  for convite in
    select * from public.workspace_invites
    where phone = telefone and status = 'pending'
  loop
    select * into limites from private.plan_status_for(convite.workspace_id);
    if limites.members >= limites.max_members then
      continue;
    end if;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (convite.workspace_id, new.id, convite.role)
    on conflict (workspace_id, user_id) do nothing;

    update public.workspace_invites
    set status = 'accepted', accepted_at = now()
    where id = convite.id;
  end loop;

  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
