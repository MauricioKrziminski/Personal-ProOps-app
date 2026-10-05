-- `20261005191000`: parcela paga só contada vira lançamento pago, sem mexer no saldo da dívida.
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/debt_register_counted_payments.sql </dev/null
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  ws uuid; u uuid; conta uuid; d1 uuid; l record; venc date := current_date - 12;
  saldo_conta_antes bigint; n int; antes record; d2 uuid; d3 uuid; ts timestamptz;
begin
  select w.id, m.user_id into ws, u
  from public.workspaces w join public.workspace_members m on m.workspace_id = w.id
  order by w.created_at limit 1;
  select id into conta from public.accounts
  where workspace_id = ws and type <> 'credit_card' and not archived limit 1;
  if ws is null or conta is null then raise exception 'sem workspace/conta para testar'; end if;

  -- carro: 48 x 148500, 8 pagas, a 8ª venceu há 12 dias
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents,
    due_day, first_due_date, account_id)
  values (ws, u, 'teste contada', 'financing', 'fixed_installments', 48*148500, 40*148500, 0, 48, 8,
    148500, extract(day from venc)::int, private.add_months(venc, -7), conta)
  returning id into d1;
  select installments_paid, remaining_cents into antes from public.debts where id = d1;
  select cleared_cents into saldo_conta_antes from public._account_balances(u) where account_id = conta;

  n := public.register_counted_debt_payments(d1, conta, array[8]);
  if n <> 1 then raise exception '1: registrou % parcelas', n; end if;
  select * into l from public.debts where id = d1;
  if l.installments_paid <> antes.installments_paid or l.remaining_cents <> antes.remaining_cents then
    raise exception '2: a dívida andou: % pagas, saldo %', l.installments_paid, l.remaining_cents;
  end if;
  select * into l from public.transactions where debt_id = d1;
  if l.debt_payment_no <> 8 or l.status <> 'cleared' or l.account_id <> conta or l.amount_cents <> 148500
     or l.occurred_at <> venc or l.debt_balance_after_cents <> 40*148500 then
    raise exception '3: lançamento % % % % %', l.debt_payment_no, l.status, l.amount_cents, l.occurred_at, l.debt_balance_after_cents;
  end if;
  if (select cleared_cents from public._account_balances(u) where account_id = conta)
     <> saldo_conta_antes - 148500 then
    raise exception '4: o saldo da conta não caiu uma vez';
  end if;
  -- aparece no ciclo/mês como realizado
  if not exists (select 1 from private.month_lines_for(array[ws], venc, 'civil')
                 where ref_id = (select id from public.transactions where debt_id = d1) and settled) then
    raise exception '5: não aparece como paga no mês';
  end if;

  -- idempotência: repetir não duplica
  n := public.register_counted_debt_payments(d1, conta, array[8]);
  if n <> 0 or (select count(*) from public.transactions where debt_id = d1) <> 1 then
    raise exception '6: duplicou (n=%)', n;
  end if;
  select * into l from public.debts where id = d1;
  if l.installments_paid <> 8 or l.remaining_cents <> 40*148500 then raise exception '7: dívida andou no repeat'; end if;

  -- parcela fora das pagas é recusada
  begin
    perform public.register_counted_debt_payments(d1, conta, array[9]);
    raise exception '8: aceitou parcela não paga';
  exception when others then
    if sqlerrm like '8:%' then raise; end if;
  end;

  -- k < pagas: a 8ª com 9 pagas; dívida e saldo intactos
  update public.debts set installments_paid = 9, remaining_cents = 39*148500 where id = d1;
  delete from public.transactions where debt_id = d1;
  update public.debts set installments_paid = 9, remaining_cents = 39*148500 where id = d1;
  n := public.register_counted_debt_payments(d1, conta, array[8]);
  select * into l from public.debts where id = d1;
  if n <> 1 or l.installments_paid <> 9 or l.remaining_cents <> 39*148500 then raise exception '9: k<pagas'; end if;
  -- vários números com repetição e NULL: 7 e 8 (8 já existe), uma vez cada
  n := public.register_counted_debt_payments(d1, conta, array[7,8,8,null]::int[]);
  if n <> 1 or (select count(*) from public.transactions where debt_id = d1) <> 2 then raise exception '10: repetição/NULL (n=%)', n; end if;
  if (select count(*) from public.transactions where debt_id = d1 and debt_payment_no in (7,8)) <> 2 then raise exception '10b'; end if;
  -- sem nada novo a dívida não é tocada (updated_at)
  select updated_at into ts from public.debts where id = d1;
  perform public.register_counted_debt_payments(d1, conta, array[7,8]);
  if (select updated_at from public.debts where id = d1) is distinct from ts then raise exception '11: tocou a dívida sem registrar nada'; end if;

  -- modo com juros, sem âncora e arquivada são recusados com frase
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, due_day, first_due_date)
  values (ws, u, 'teste contada juros', 'financing', 'amortized', 120000, 100000, 0.01, 12, 2, 5, current_date - 40)
  returning id into d2;
  begin perform public.register_counted_debt_payments(d2, conta, array[1]); raise exception 'x12';
  exception when others then if sqlerrm = 'x12' then raise exception '12: aceitou juros'; end if; end;
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents, due_day)
  values (ws, u, 'teste contada sem ancora', 'financing', 'fixed_installments', 120000, 100000, 0, 12, 2, 10000, 5)
  returning id into d3;
  begin perform public.register_counted_debt_payments(d3, conta, array[1]); raise exception 'x13';
  exception when others then
    if sqlerrm = 'x13' then raise exception '13: aceitou sem âncora'; end if;
    if sqlerrm not like 'Só financiamento com data%' then raise exception '13: frase %', sqlerrm; end if; end;
  update public.debts set archived = true where id = d1;
  begin perform public.register_counted_debt_payments(d1, conta, array[6]); raise exception 'x14';
  exception when others then if sqlerrm = 'x14' then raise exception '14: aceitou arquivada'; end if; end;
  update public.debts set archived = false where id = d1;

  -- estimativa declarada da parcela vale como valor lançado (lida antes do recuo)
  -- (ver 15: a parcela fixa só aceita o valor do contrato; o gatilho recusa outro, e a RPC propaga)

  -- estranho (outro espaço) chamando como authenticated: a dívida nem aparece
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin perform public.register_counted_debt_payments(d1, conta, array[6]); execute 'reset role'; raise exception 'x16';
  exception when others then execute 'reset role'; if sqlerrm = 'x16' then raise exception '16: estranho registrou'; end if; end;
  if exists (select 1 from public.transactions where debt_id = d1 and debt_payment_no = 6) then raise exception '16b'; end if;
end $$;

rollback;
