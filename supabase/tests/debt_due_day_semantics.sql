\set ON_ERROR_STOP on
begin;

do $$
begin
  if private.day_in_month(date '2027-02-01', 30) <> date '2027-02-28'
    or private.day_in_month(date '2028-02-01', 30) <> date '2028-02-29'
    or private.day_in_month(date '2027-03-01', 30) <> date '2027-03-30'
    or private.day_in_month(date '2027-03-01', -1) <> date '2027-03-31'
    or private.day_in_month(date '2028-02-01', -1) <> date '2028-02-29'
    or private.day_in_month(date '2027-02-01', 31) <> date '2027-02-28'
    or private.day_in_month(date '2027-03-01', 31) <> date '2027-03-31'
  then raise exception 'dia fixo 30/31 e último dia não seguem meses curtos';
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.debts'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%-1%'
  ) then raise exception 'contrato da dívida ainda não aceita último dia explícito';
  end if;
end $$;

do $$
declare
  ws uuid;
  u uuid;
  d30 uuid;
  dlast uuid;
  dias30 date[];
  diaslast date[];
begin
  select workspace_id, user_id into ws, u from public.workspace_members limit 1;
  if ws is null then raise exception 'sem workspace local para verificar cronograma'; end if;
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode,
    principal_cents, remaining_cents, installments, installments_paid, installment_cents,
    interest_rate_monthly, due_day, first_due_date)
  values (ws, u, 'teste dia 30 fixo', 'financing', 'fixed_installments',
    30000, 30000, 3, 0, 10000, 0, 30, date '2027-01-30')
  returning id into d30;
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode,
    principal_cents, remaining_cents, installments, installments_paid, installment_cents,
    interest_rate_monthly, due_day, first_due_date)
  values (ws, u, 'teste último dia explícito', 'financing', 'fixed_installments',
    30000, 30000, 3, 0, 10000, 0, -1, date '2027-01-31')
  returning id into dlast;
  select array_agg(due_date order by installment_no) into dias30 from private.debt_schedule_for(d30);
  select array_agg(due_date order by installment_no) into diaslast from private.debt_schedule_for(dlast);
  if dias30 <> array[date '2027-01-30', date '2027-02-28', date '2027-03-30']
    or diaslast <> array[date '2027-01-31', date '2027-02-28', date '2027-03-31']
  then raise exception 'cronograma incorreto: dia 30 %, último dia %', dias30, diaslast;
  end if;
end $$;

rollback;
