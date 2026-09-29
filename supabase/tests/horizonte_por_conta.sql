-- O horizonte por conta e por cartão (20260929150000): o "antes" das portas públicas e o "depois"
-- das leituras `contas`/`cartoes` do `simular`.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/horizonte_por_conta.sql

\set ON_ERROR_STOP on
begin;

do $$
declare
  usr uuid := '00000000-0000-0000-0000-00000000f1c1';
  ws uuid;
  a uuid; c uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into auth.users (id, email) values (usr, 'teste-horizonte@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  select id into ws from public.workspaces where owner_id = usr order by created_at limit 1;
  if ws is null then
    insert into public.workspaces (name, owner_id) values ('teste horizonte', usr) returning id into ws;
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  end if;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'A', 'checking', 100000) returning id into a;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents, payment_account_id)
    values (ws, usr, 'C', 'credit_card', 3, 10, 500000, a) returning id into c;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
    values (ws, usr, 'D', 'credit_card', 3, 10);
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status)
    values (ws, usr, 'expense', 30000, 'compra C', c, hoje, 'pending');
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status)
    values (ws, usr, 'expense', 5000, 'gasto A', a, hoje + 5, 'pending');
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f1c1', true);
set local role authenticated;

do $$
declare
  k jsonb; c jsonb; s jsonb;
  conta uuid := (select id from public.accounts where name = 'A' and workspace_id = any(array(select private.my_workspace_ids())));
  cartao uuid := (select id from public.accounts where name = 'C' and workspace_id = any(array(select private.my_workspace_ids())));
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  c := public.accounts_horizon(90);
  -- 1. a soma dos saldos no fim é a projeção no fim
  if (select sum((x->>'saldo_fim')::bigint) from jsonb_array_elements(c) x)
     <> (select balance_cents from public.cash_flow_forecast(90) order by day desc limit 1) then
    raise exception '1. a soma dos saldos no fim difere da projeção: %', c;
  end if;
  -- 1b. a conta A: hoje 100000, gasto de 5000 e a fatura de 30000 → fim 65000, nunca negativa
  if (select (x->>'saldo_fim')::bigint from jsonb_array_elements(c) x where x->>'account_id' = conta::text) <> 65000
     or (select x->>'negativa_em' from jsonb_array_elements(c) x where x->>'account_id' = conta::text) is not null then
    raise exception '1b. conta A errada: %', c;
  end if;
  -- 2. fica negativa: um gasto maior que o saldo da conta A
  s := public.simular(jsonb_build_array(jsonb_build_object('tipo', 'lancamento', 'dados', jsonb_build_object('linhas', jsonb_build_array(
         jsonb_build_object('kind', 'expense', 'amount_cents', 500000, 'description', 'Hipótese', 'account_id', conta,
                            'occurred_at', hoje + 10, 'status', 'pending', 'source', 'app'))))),
       jsonb_build_object('contas', jsonb_build_object('days', 90)));
  if (select x->>'negativa_em' from jsonb_array_elements(s->'leituras'->'contas') x where x->>'account_id' = conta::text)
     is distinct from (hoje + 10)::text then
    raise exception '2. a conta A deveria ficar negativa em %: %', hoje + 10, s;
  end if;
  -- 3. cartão: a compra entra na fatura e baixa o limite livre
  k := public.cards_horizon(90);
  s := public.simular(jsonb_build_array(jsonb_build_object('tipo', 'lancamento', 'dados', jsonb_build_object('linhas', jsonb_build_array(
         jsonb_build_object('kind', 'expense', 'amount_cents', 60000, 'description', 'Hipótese', 'account_id', cartao,
                            'occurred_at', hoje, 'status', 'pending', 'source', 'app'))))),
       jsonb_build_object('cartoes', jsonb_build_object('days', 90)));
  if ((select (x->>'livre')::bigint from jsonb_array_elements(k) x where x->>'account_id' = cartao::text)
      - (select (x->>'livre')::bigint from jsonb_array_elements(s->'leituras'->'cartoes') x where x->>'account_id' = cartao::text)) <> 60000 then
    raise exception '3. o limite livre deveria cair 600,00: antes % depois %', k, s->'leituras'->'cartoes';
  end if;
  if (select sum((f->>'total')::bigint) from jsonb_array_elements(s->'leituras'->'cartoes') x, jsonb_array_elements(x->'faturas') f
      where x->>'account_id' = cartao::text) <> 90000 then
    raise exception '3b. as faturas de C deveriam somar 900,00: %', s->'leituras'->'cartoes';
  end if;
  -- 4. cartão sem limite: limite e livre nulos
  if (select x->'limite' from jsonb_array_elements(k) x where x->>'nome' = 'D') <> 'null'::jsonb
     or (select x->'livre' from jsonb_array_elements(k) x where x->>'nome' = 'D') <> 'null'::jsonb then
    raise exception '4. cartão sem limite deveria vir com limite e livre nulos: %', k;
  end if;
  -- 5. livre = o do card_summary quando há limite
  if (select (x->>'livre')::bigint from jsonb_array_elements(k) x where x->>'account_id' = cartao::text)
     <> (select available_limit_cents from public.card_summary() where account_id = cartao) then
    raise exception '5. livre difere do card_summary';
  end if;
  -- 6. banco intacto depois do simular
  if exists (select 1 from public.transactions where description = 'Hipótese') then raise exception '6. sobrou registro'; end if;
end $$;

select 'horizonte_por_conta: ok' as resultado;
rollback;
