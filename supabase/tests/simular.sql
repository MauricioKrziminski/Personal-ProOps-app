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

-- Os casos da revisão da migration (29/09/2026): série muda de verdade, nada vaza nas tabelas
-- que os gatilhos escrevem, falha no meio de um registro, campo desconhecido, fatura que já
-- existia não é marcada como hipótese, leituras do ciclo e teto de registros.
do $$
declare
  usr uuid := '00000000-0000-0000-0000-00000000f1a1';
  conta uuid := (select id from public.accounts where name = 'Conta' and user_id = '00000000-0000-0000-0000-00000000f1a1');
  cartao uuid := (select id from public.accounts where name = 'Cartao' and user_id = '00000000-0000-0000-0000-00000000f1a1');
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  base jsonb;
  s jsonb;
  real_fatura uuid;
  n_fat bigint; n_dec bigint; n_tx bigint;
  compra jsonb;
begin
  base := public.forecast_json(400, '[]'::jsonb);
  select count(*) into n_fat from public.card_invoices;
  select count(*) into n_dec from public.debt_declared_due_dates;
  select count(*) into n_tx from public.transactions;

  -- 5. hipótese que muda a série: a série simulada NÃO é a base, e nada ficou nas tabelas
  compra := jsonb_build_object('tipo', 'lancamento', 'dados', jsonb_build_object('linhas', jsonb_build_array(
    jsonb_build_object('kind', 'expense', 'amount_cents', 12345, 'description', 'Mercado', 'account_id', conta,
      'occurred_at', hoje + 5, 'status', 'pending', 'source', 'app'))));
  s := public.simular(jsonb_build_array(compra), jsonb_build_object('forecast', jsonb_build_object('days', 400, 'drafts', null)));
  if s->'leituras'->'forecast' = base then raise exception '5. a hipótese não mexeu na série'; end if;
  if (select count(*) from public.card_invoices) <> n_fat or (select count(*) from public.debt_declared_due_dates) <> n_dec
     or (select count(*) from public.transactions) <> n_tx then
    raise exception '5. sobrou linha em fatura, datas de dívida ou lançamento';
  end if;

  -- 6. falha no meio: a parcelada no último dia NO CARTÃO levanta depois de gravar; o lançamento
  --    com uma linha boa e uma ruim também. Os dois voltam em erros e a série é a base.
  s := public.simular(jsonb_build_array(
    jsonb_build_object('tipo', 'parcelada', 'dados', jsonb_build_object(
      'p_account_id', cartao, 'p_total_cents', 30000, 'p_installments', 3, 'p_occurred_at', hoje,
      'p_paid_installments', 0, 'p_description', 'X', 'ultimo_dia', true)),
    jsonb_build_object('tipo', 'lancamento', 'dados', jsonb_build_object('linhas', jsonb_build_array(
      jsonb_build_object('kind', 'expense', 'amount_cents', 100, 'description', 'ok', 'account_id', conta, 'occurred_at', hoje + 3, 'status', 'pending', 'source', 'app'),
      jsonb_build_object('kind', 'expense', 'amount_cents', 100, 'description', 'ruim', 'account_id', '00000000-0000-0000-0000-000000000000', 'occurred_at', hoje, 'status', 'cleared', 'source', 'app'))))),
    jsonb_build_object('forecast', jsonb_build_object('days', 400)));
  if jsonb_array_length(s->'erros') <> 2 or jsonb_array_length(s->'criados') <> 0 then
    raise exception '6. esperava 2 erros e nada criado: % / %', s->'erros', s->'criados';
  end if;
  if s->'leituras'->'forecast' is distinct from base then raise exception '6. a falha no meio mexeu na série'; end if;

  -- 7. campo fora da lista vira erro (a simulação não pode divergir do Aplicar em silêncio)
  s := public.simular(jsonb_build_array(jsonb_build_object('tipo', 'lancamento', 'dados', jsonb_build_object('linhas', jsonb_build_array(
    jsonb_build_object('kind', 'expense', 'amount_cents', 100, 'description', 'x', 'account_id', conta, 'occurred_at', hoje, 'source', 'app', 'campo_novo', 1))))),
    '{}'::jsonb);
  if jsonb_array_length(s->'erros') <> 1 or s->'erros'->0->>'mensagem' not like '%campo_novo%' then
    raise exception '7. campo desconhecido deveria virar erro: %', s->'erros';
  end if;
  -- 7b. o erro traz o CÓDIGO: o app só mostra a frase do banco quando ela é nossa (P0001)
  if s->'erros'->0->>'codigo' is null then
    raise exception '7b. o erro deveria trazer o código: %', s->'erros';
  end if;

  -- 8. fatura que JÁ existia não entra em ids (a tela marcaria as compras reais como hipótese)
  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, status)
    values ((select workspace_id from public.accounts where id = cartao), usr, cartao, 'expense', 5000, 'Real', hoje, 'pending')
    returning invoice_id into real_fatura;
  s := public.simular(jsonb_build_array(jsonb_build_object('tipo', 'lancamento', 'dados', jsonb_build_object('linhas', jsonb_build_array(
    jsonb_build_object('kind', 'expense', 'amount_cents', 7000, 'description', 'Hipotetica', 'account_id', cartao, 'occurred_at', hoje, 'status', 'pending', 'source', 'app'))))),
    '{}'::jsonb);
  if (s->'criados'->0->'ids') ? real_fatura::text then raise exception '8. a fatura real foi marcada como hipótese'; end if;
  if not ((s->'criados'->0->'faturas') ? real_fatura::text) then raise exception '8. a fatura real deveria vir em faturas'; end if;

  -- 9. as leituras do mês e do ciclo voltam
  s := public.simular(jsonb_build_array(compra), jsonb_build_object(
    'meses', jsonb_build_object('days', 120, 'drafts', '[]'::jsonb, 'view', 'civil'),
    'ciclo', jsonb_build_object('de', date_trunc('month', hoje)::date, 'ate', date_trunc('month', hoje)::date, 'view', 'civil'),
    'linhas_do_ciclo', jsonb_build_object('mes', date_trunc('month', hoje)::date, 'view', 'civil')));
  if s->'leituras'->'meses' is null or jsonb_array_length(s->'leituras'->'ciclo') <> 1 or s->'leituras'->'linhas_do_ciclo' is null then
    raise exception '9. leituras do mês/ciclo faltando: %', s->'leituras';
  end if;

  -- 10. teto: mais de 30 hipóteses é recusado inteiro
  begin
    perform public.simular((select jsonb_agg(compra) from generate_series(1, 31)), '{}'::jsonb);
    raise exception '10. deveria recusar 31 hipóteses';
  exception when others then
    if sqlerrm not like '%hipóteses demais%' then raise; end if;
  end;
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
