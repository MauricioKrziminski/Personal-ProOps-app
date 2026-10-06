-- RLS como segunda camada do agente: sob `authenticated` + claims do dono, o isolamento por workspace
-- vale também para as funções que as tools chamam. Roda no staging, sempre revertido:
--
--     agent/.venv/bin/python scripts/sql-test.py supabase/tests/agente_rls.sql
--
-- (a migration `20261006160000` tem que estar aplicada, ou vir antes deste arquivo no mesmo script)
\set ON_ERROR_STOP on
begin;
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-00000000a1a1';
  u2 uuid := '00000000-0000-0000-0000-00000000a1a2';
  w1 uuid := '00000000-0000-0000-0000-00000000a1b1';
  w2 uuid := '00000000-0000-0000-0000-00000000a1b2';
  n int; c text; papel text;
begin
  insert into auth.users(id,email) values (u1,'rls-a@example.invalid'),(u2,'rls-b@example.invalid')
    on conflict(id) do nothing;
  insert into public.profiles(id) values (u1),(u2) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values (w1,u1,'Rls A'),(w2,u2,'Rls B');
  insert into public.workspace_members(workspace_id,user_id,role) values (w1,u1,'owner'),(w2,u2,'owner');
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,category,occurred_at,source,status) values
    (w1,u1,'expense',100,'dele','x','1990-03-10','app','cleared'),
    (w2,u2,'expense',200,'alheio','x','1990-03-10','app','cleared');
  insert into public.categorization_rules(workspace_id,user_id,pattern,match_type,category,priority) values
    (w1,u1,'rlsregra','contains','minha',1),(w2,u2,'rlsregra','contains','alheia',1);

  -- como o `db.sob_rls` do agente: papel + claims por transação
  perform set_config('request.jwt.claim.sub', u1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select current_user into papel;
  assert papel = 'authenticated', 'papel não virou authenticated';
  assert auth.uid() = u1, 'auth.uid() não é o dono';

  -- dado: só o do próprio workspace
  select count(*) into n from public.transactions where workspace_id = w2;
  assert n = 0, 'authenticated enxerga lançamento de OUTRO workspace';
  select count(*) into n from public.transactions where workspace_id = w1;
  assert n = 1, 'authenticated não enxerga o PRÓPRIO lançamento';
  begin
    insert into public.transactions(workspace_id,user_id,kind,amount_cents,occurred_at,source,status)
      values (w2,u1,'expense',1,'1990-03-10','app','cleared');
    assert false, 'authenticated escreveu em OUTRO workspace';
  exception when insufficient_privilege then null; end;
  update public.transactions set amount_cents = 1 where workspace_id = w2;
  get diagnostics n = row_count;
  assert n = 0, 'authenticated atualizou lançamento de OUTRO workspace';
  delete from public.transactions where workspace_id = w2;
  get diagnostics n = row_count;
  assert n = 0, 'authenticated apagou lançamento de OUTRO workspace';

  -- wrapper que confere a posse: a regra do workspace próprio sim, a do alheio nunca
  select category into c from private.match_rule_subcategory_do_membro(w1, 'rlsregra x');
  assert c = 'minha', 'wrapper não achou a regra do próprio workspace';
  select count(*) into n from private.match_rule_subcategory_do_membro(w2, 'rlsregra x');
  assert n = 0, 'wrapper vazou regra de OUTRO workspace';

  -- a interna aceita qualquer workspace e continua fechada
  assert not has_function_privilege('authenticated', 'public._match_rule(uuid, text)', 'execute'), '_match_rule aberta';
  assert not has_function_privilege('authenticated', 'public._account_balances(uuid)', 'execute'), '_account_balances aberta';
  assert not has_function_privilege('authenticated', 'private.match_rule_subcategory(uuid, text)', 'execute'),
    'match_rule_subcategory aberta';
  assert has_function_privilege('authenticated', 'private.attach_import_rule_purchase(uuid, uuid, uuid)', 'execute'),
    'attach_import_rule_purchase fechada';
  assert not has_function_privilege('anon', 'private.attach_import_rule_purchase(uuid, uuid, uuid)', 'execute'),
    'anon executa attach_import_rule_purchase';
  assert not has_function_privilege('anon', 'private.match_rule_subcategory_do_membro(uuid, text)', 'execute'),
    'anon executa o wrapper';

  -- de volta ao serviço: `reset role` na mesma transação devolve o papel que ignora RLS
  reset role;
  select current_user into papel;
  assert papel = 'postgres', 'reset role não voltou a postgres';
  select count(*) into n from public.transactions where workspace_id = w2;
  assert n = 1, 'postgres deixou de enxergar o workspace alheio';
end $$;
rollback;
