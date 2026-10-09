-- Painel admin v2: private.apagar_conta apaga OUTRO usuário pelo id; a auditoria é inacessível ao app.
\set ON_ERROR_STOP on
begin;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000066a1';  -- alvo
  b uuid := '00000000-0000-0000-0000-0000000066b1';  -- fica
  wa uuid; wb uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
   (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm-a@teste.local', '{}', '{}'),
   (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm-b@teste.local', '{}', '{}');
  select id into wa from public.workspaces where owner_id = a;
  select id into wb from public.workspaces where owner_id = b;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at)
    values (wa, a, 'expense', 1000, 'gasto A', current_date), (wb, b, 'expense', 2000, 'gasto B', current_date);
  insert into public.admin_audit_events (admin_user_id, action, target_user_id, target_workspace_id)
    values (b, 'account_deleted', a, wa);

  -- sem sessão nenhuma (papel do agente): apaga o usuário pelo id
  perform set_config('request.jwt.claims', '', true);
  perform private.apagar_conta(a);

  assert not exists (select 1 from auth.users where id = a), 'auth.users do alvo saiu';
  assert not exists (select 1 from public.workspaces where id = wa), 'workspace do alvo saiu';
  assert not exists (select 1 from public.transactions where workspace_id = wa), 'dado do alvo saiu';
  assert exists (select 1 from auth.users where id = b) and exists (select 1 from public.transactions where workspace_id = wb),
    'o outro fica';
  assert exists (select 1 from public.admin_audit_events where target_user_id = a), 'a auditoria sobrevive ao apagar';

  -- o app não alcança nem a auditoria nem a função
  assert not has_table_privilege('authenticated', 'public.admin_audit_events', 'select'), 'authenticated lê a auditoria';
  assert not has_table_privilege('anon', 'public.admin_audit_events', 'select'), 'anon lê a auditoria';
  assert not has_function_privilege('authenticated', 'private.apagar_conta(uuid)', 'execute'), 'authenticated executa apagar_conta';
  assert not has_function_privilege('anon', 'private.apagar_conta(uuid)', 'execute'), 'anon executa apagar_conta';
end $$;

rollback;
