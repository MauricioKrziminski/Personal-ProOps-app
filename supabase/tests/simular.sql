-- `public.simular` (20260929120000): cria de verdade, lê, desfaz.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/simular.sql

\set ON_ERROR_STOP on
begin;

do $$
declare
  usr uuid := '00000000-0000-0000-0000-00000000f1a1';
  ws uuid;
begin
  insert into auth.users (id, email) values (usr, 'teste-simular@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  -- O espaço PADRÃO do usuário (o que `my_default_workspace()` devolve — criar o perfil já cria
  -- um): é nele que `simular` grava, como o app, que nunca manda `workspace_id`.
  select id into ws from public.workspaces where owner_id = usr order by created_at limit 1;
  if ws is null then
    insert into public.workspaces (name, owner_id) values ('teste simular', usr) returning id into ws;
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  end if;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Conta', 'checking', 1000000);
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, payment_account_id)
    values (ws, usr, 'Cartao', 'credit_card', 3, 10,
            (select id from public.accounts where workspace_id = ws and type = 'checking'));
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f1a1', true);
set local role authenticated;

do $$
declare
  conta uuid := (select id from public.accounts where name = 'Conta' and user_id = '00000000-0000-0000-0000-00000000f1a1');
  cartao uuid := (select id from public.accounts where name = 'Cartao' and user_id = '00000000-0000-0000-0000-00000000f1a1');
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  registros jsonb;
  r jsonb;
  simulado jsonb;
  real jsonb;
  antes bigint;
  depois bigint;
begin
  registros := jsonb_build_array(
    jsonb_build_object('tipo', 'parcelada', 'dados', jsonb_build_object(
      'p_account_id', cartao, 'p_total_cents', 300000, 'p_installments', 10, 'p_occurred_at', hoje,
      'p_paid_installments', 0, 'p_description', 'Notebook', 'p_category', 'eletrônicos', 'p_merchant', null,
      'ultimo_dia', false)),
    jsonb_build_object('tipo', 'recorrente', 'dados', jsonb_build_object(
      'kind', 'expense', 'amount_cents', 5000, 'description', 'Academia', 'merchant', null, 'category', 'saúde',
      'account_id', conta, 'rrule', 'FREQ=WEEKLY;BYDAY=MO', 'next_run_at', (hoje + 1)::timestamptz,
      'dtstart', (hoje + 1)::timestamptz, 'end_date', null, 'auto_confirm', false)),
    jsonb_build_object('tipo', 'financiamento', 'dados', jsonb_build_object(
      'name', 'Carro', 'kind', 'financing', 'calculation_mode', 'fixed_installments',
      'principal_cents', 4800000, 'remaining_cents', 3600000, 'interest_rate_monthly', 0,
      'installments', 48, 'installments_paid', 12, 'installment_cents', 100000,
      'account_id', conta, 'due_day', 10)),
    -- 3. inválido: conta que não existe
    jsonb_build_object('tipo', 'lancamento', 'dados', jsonb_build_object('linhas', jsonb_build_array(
      jsonb_build_object('kind', 'expense', 'amount_cents', 100, 'description', 'X',
        'account_id', '00000000-0000-0000-0000-000000000000', 'occurred_at', hoje, 'status', 'cleared', 'source', 'app'))))
  );

  select count(*) into antes from public.transactions;
  simulado := public.simular(registros, jsonb_build_object('forecast', jsonb_build_object('days', 400, 'drafts', '[]'::jsonb)));
  select count(*) into depois from public.transactions;

  -- 1. banco intacto
  if depois <> antes then raise exception '1. simular deixou % transações', depois - antes; end if;
  if exists (select 1 from public.installment_plans where description = 'Notebook')
     or exists (select 1 from public.recurring_transactions where description = 'Academia')
     or exists (select 1 from public.debts where name = 'Carro') then
    raise exception '1. simular deixou registro';
  end if;

  -- 2. o inválido volta em erros, e só ele
  if jsonb_array_length(simulado->'erros') <> 1 or (simulado->'erros'->0->>'indice')::int <> 3 then
    raise exception '2. erros deveria ter só o índice 3: %', simulado->'erros';
  end if;
  if jsonb_array_length(simulado->'criados') <> 3 then raise exception '2. criados deveria ter 3'; end if;

  -- 3. a série simulada é a mesma de criar de verdade (criando os 3 válidos numa subtransação)
  begin
    for r in select value from jsonb_array_elements(registros) with ordinality as e(value, n) where n <= 3 loop
      perform private.criar_registro_da_hipotese(r->>'tipo', r->'dados');
    end loop;
    real := public.forecast_json(400, '[]'::jsonb);
    raise exception using errcode = 'PSIM1', message = 'desfaz o real do teste';
  exception when sqlstate 'PSIM1' then null;
  end;
  if simulado->'leituras'->'forecast' is distinct from real then
    raise exception '3. a série simulada difere da real';
  end if;
end $$;

reset role;
do $$
begin
  if has_function_privilege('anon', 'public.simular(jsonb, jsonb)', 'execute') then
    raise exception '4. anon executa simular';
  end if;
end $$;

select 'simular: ok' as resultado;
rollback;
