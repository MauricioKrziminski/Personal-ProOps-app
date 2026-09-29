-- `20260928237000`: o dia do pagamento nunca passa de hoje.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/pago_nunca_no_futuro.sql

\set ON_ERROR_STOP on
begin;

do $$
declare
  usr uuid := '00000000-0000-0000-0000-00000000f0b1';
  ws uuid; conta uuid; t uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into auth.users (id, email) values (usr, 'teste-pago-futuro@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  insert into public.workspaces (name, owner_id) values ('teste pago futuro', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Conta', 'checking', 100000) returning id into conta;

  -- 1. lançamento FUTURO marcado como pago, sem data: pago hoje (adiantado)
  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, status)
    values (ws, usr, conta, 'expense', 25000, 'Fone', hoje + 87, 'cleared') returning id into t;
  if (select paid_at from public.transactions where id = t) <> hoje then
    raise exception '1. futuro pago sem data deveria ficar pago hoje, ficou %', (select paid_at from public.transactions where id = t);
  end if;

  -- 2. data de pagamento FUTURA informada: vira hoje
  update public.transactions set paid_at = hoje + 64 where id = t;
  if (select paid_at from public.transactions where id = t) <> hoje then
    raise exception '2. pagamento no futuro deveria virar hoje';
  end if;

  -- 3. o passado não mexe: pago ontem continua ontem, e sem data vale o dia do lançamento
  update public.transactions set paid_at = hoje - 1 where id = t;
  if (select paid_at from public.transactions where id = t) <> hoje - 1 then raise exception '3. pagamento de ontem mudou'; end if;
  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, status)
    values (ws, usr, conta, 'expense', 1000, 'Pão', hoje - 5, 'cleared') returning id into t;
  if (select paid_at from public.transactions where id = t) <> hoje - 5 then raise exception '3. sem data, vale o dia do lançamento'; end if;

  -- 5. linha de CARTÃO fica de fora: ali o `paid_at` é a marca da fatura, não dinheiro saindo
  declare cartao uuid; c uuid;
  begin
    insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
      values (ws, usr, 'Cartao', 'credit_card', 3, 10) returning id into cartao;
    insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, status, paid_at)
      values (ws, usr, cartao, 'expense', 5000, 'Compra', hoje + 30, 'cleared', hoje + 40) returning id into c;
    if (select paid_at from public.transactions where id = c) <> hoje + 40 then
      raise exception '5. a linha de cartão não deveria ter a data mexida';
    end if;
  end;

  -- 4. voltar a previsto apaga a data, como antes
  update public.transactions set status = 'pending' where id = t;
  if (select paid_at from public.transactions where id = t) is not null then raise exception '4. previsto não tem data de pagamento'; end if;
end $$;

select 'pago_nunca_no_futuro: ok' as resultado;
rollback;
