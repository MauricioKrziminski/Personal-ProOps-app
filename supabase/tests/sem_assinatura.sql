-- Fim do plano grátis (20261010180000): access, portão de escrita, apagar a conta, convite x max_members.
-- Roda como postgres; `proops.forcar_app` faz o gatilho tratar a sessão como se fosse o PostgREST.

\set ON_ERROR_STOP on
begin;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000055a1';  -- dono, vai apagar a conta
  b uuid := '00000000-0000-0000-0000-0000000055b1';  -- outro usuário (família), A é membro do espaço dele
  c uuid := '00000000-0000-0000-0000-0000000055c1';  -- assinante
  wa uuid; wb uuid; wc uuid; acc uuid; tx uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
   (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-a@teste.local', '{}', '{}'),
   (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-b@teste.local', '{}', '{}'),
   (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-c@teste.local', '{}', '{}');
  select id into wa from public.workspaces where owner_id = a;
  select id into wb from public.workspaces where owner_id = b;
  select id into wc from public.workspaces where owner_id = c;

  -- (a) access: never -> subscriber -> lapsed
  assert (select access from private.plan_status_for(wa)) = 'never', 'recém-criado é never';
  update public.subscriptions set plan = 'family', status = 'active', provider = 'google' where workspace_id in (wb, wc);
  assert (select access from private.plan_status_for(wb)) = 'subscriber', 'family ativo é subscriber';
  update public.subscriptions set plan = 'pro', status = 'canceled', provider = 'google' where workspace_id = wa;
  assert (select access from private.plan_status_for(wa)) = 'lapsed', 'cancelado é lapsed';

  -- (b) portão: sem forçar o app, o postgres escreve (agente/cron)
  insert into public.accounts (workspace_id, user_id, name, type) values (wa, a, 'Conta A', 'checking') returning id into acc;

  perform set_config('proops.forcar_app', 'on', true);
  begin
    insert into public.accounts (workspace_id, user_id, name, type) values (wa, a, 'Outra', 'checking');
    assert false, 'INSERT de free deveria ser recusado';
  exception when sqlstate 'PT402' then null; end;
  begin
    update public.accounts set name = 'Renomeada' where id = acc;
    assert false, 'UPDATE de free deveria ser recusado';
  exception when sqlstate 'PT402' then null; end;
  begin
    delete from public.accounts where id = acc;
    assert false, 'DELETE de free deveria ser recusado';
  exception when sqlstate 'PT402' then null; end;
  -- workspace_id vindo do DEFAULT (my_default_workspace) também passa pelo gatilho
  begin
    insert into public.notes (workspace_id, user_id, content) values (wa, a, 'x');
    assert false, 'notes de free deveria ser recusado';
  exception when sqlstate 'PT402' then null; end;
  assert exists (select 1 from public.accounts where id = acc), 'free ainda lê';
  -- assinante passa
  insert into public.accounts (workspace_id, user_id, name, type) values (wc, c, 'Conta C', 'checking');
  update public.accounts set name = 'C2' where workspace_id = wc;
  -- tabela fora do portão (conta/assinatura) segue escrevendo
  update public.workspaces set name = 'Renomeado' where id = wa;
  perform set_config('proops.forcar_app', 'off', true);
  update public.accounts set name = 'agente escreve' where id = acc;  -- sem forçar: passa

  -- (c) apagar a conta: A é dono de wa e membro de wb (com dado dele lá)
  insert into public.workspace_members (workspace_id, user_id, role) values (wb, a, 'member');
  insert into public.accounts (workspace_id, user_id, name, type) values (wb, a, 'Conta de A em B', 'checking');
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at)
    values (wa, a, 'expense', 1000, 'gasto A', current_date) returning id into tx;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at)
    values (wb, b, 'expense', 2000, 'gasto B', current_date);
  insert into public.emergency_reserves (workspace_id, user_id, base_mode, manual_monthly_cents, target_months)
    values (wb, a, 'manual', 100000, 6);

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('proops.forcar_app', 'on', true);  -- apagar a conta passa mesmo para free vindo do app
  perform public.delete_my_account();
  perform set_config('proops.forcar_app', 'off', true);

  assert not exists (select 1 from auth.users where id = a), 'auth.users de A saiu';
  assert not exists (select 1 from public.profiles where id = a), 'profile de A saiu';
  assert not exists (select 1 from public.workspaces where id = wa), 'workspace de A saiu';
  assert not exists (select 1 from public.transactions where id = tx), 'dado de A saiu';
  assert not exists (select 1 from public.accounts where workspace_id = wb and user_id = a), 'dado de A em B saiu';
  assert not exists (select 1 from public.workspace_members where user_id = a), 'memberships de A saíram';
  assert exists (select 1 from auth.users where id = b) and exists (select 1 from public.workspaces where id = wb),
    'B e o espaço dele ficam';
  assert (select count(*) from public.transactions where workspace_id = wb) = 1, 'gasto de B fica';
  assert (select user_id from public.emergency_reserves where workspace_id = wb) = b, 'reserva do espaço passa ao dono';
  assert exists (select 1 from auth.users where id = c), 'C intocado';
  -- idempotente: sem usuário logado nada acontece
  perform set_config('request.jwt.claims', '', true);
  perform public.delete_my_account();

  -- (d) convite não estoura max_members: pro tem 1 vaga e já tem 1 membro; family tem vaga
  insert into public.workspace_invites (workspace_id, invited_by, phone) values (wc, c, '+5511999990001');
  update public.subscriptions set plan = 'pro' where workspace_id = wc;
  insert into auth.users (id, instance_id, aud, role, email, phone, raw_user_meta_data, raw_app_meta_data)
  values ('00000000-0000-0000-0000-0000000055d1', '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'sa-d@teste.local', '+5511999990001', '{}', '{}');
  assert not exists (select 1 from public.workspace_members
                      where workspace_id = wc and user_id = '00000000-0000-0000-0000-0000000055d1'),
    'pro lotado não aceita convidado';
  assert (select status from public.workspace_invites where workspace_id = wc) = 'pending', 'convite fica pendente';

  insert into public.workspace_invites (workspace_id, invited_by, phone) values (wb, b, '+5511999990002');
  insert into auth.users (id, instance_id, aud, role, email, phone, raw_user_meta_data, raw_app_meta_data)
  values ('00000000-0000-0000-0000-0000000055e1', '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'sa-e@teste.local', '+5511999990002', '{}', '{}');
  assert exists (select 1 from public.workspace_members
                  where workspace_id = wb and user_id = '00000000-0000-0000-0000-0000000055e1'),
    'family com vaga aceita';
  assert (select status from public.workspace_invites where phone = '+5511999990002') = 'accepted';
end $$;

-- (e) tabela nova de dado nasce com o gatilho: toda tabela de public com workspace_id fora da lista de
-- exclusão da migration tem que ter `a0_exige_assinatura`. Sem isto a regra seria vigilância.
do $$
declare faltando text;
begin
  select string_agg(c.table_name, ', ' order by c.table_name) into faltando
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and c.column_name = 'workspace_id' and t.table_type = 'BASE TABLE'
    and c.table_name not in (
      'subscriptions','workspaces','workspace_members','workspace_invites','profiles',
      'ai_events','agent_feedback','alerts_sent','billing_events','user_sessions','messages_queue',
      'messages_raw','pending_actions','draft_actions','executed_actions','agent_routing',
      'app_chat_messages','jobs','transaction_embeddings','net_worth_snapshots')
    and not exists (
      select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = format('public.%I', c.table_name)::regclass
        and g.tgname = 'a0_exige_assinatura' and not g.tgisinternal);
  assert faltando is null,
    'tabela de dado sem o portão a0_exige_assinatura (ou ponha na exclusão, com motivo): ' || faltando;
end $$;

rollback;
