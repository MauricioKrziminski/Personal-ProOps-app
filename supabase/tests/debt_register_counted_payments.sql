-- `20261005191000`: parcela paga só contada vira lançamento pago, sem mexer no saldo da dívida.
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/debt_register_counted_payments.sql </dev/null
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  ws uuid; u uuid; conta uuid; d1 uuid; l record; venc date := current_date - 12;
  saldo_conta_antes bigint; n int; antes record;
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
end $$;

rollback;
