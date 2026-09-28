\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  ws uuid;
  u uuid;
  d uuid;
  vence date := current_date + 20;
begin
  select workspace_id, user_id into ws, u from public.workspace_members limit 1;
  if ws is null then raise exception 'sem workspace local'; end if;
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode,
    principal_cents, remaining_cents, interest_rate_monthly, installments,
    installments_paid, installment_cents, due_day, first_due_date,
    payment_description, payment_category, payment_merchant)
  values (ws, u, 'Teste projeção de dívida', 'financing', 'fixed_installments',
    10000, 10000, 0, 1, 0, 10000, extract(day from vence)::int, vence,
    'Prestação revisada', 'veiculo', 'Banco teste')
  returning id into d;

  if not exists (select 1 from private.month_lines_for(array[ws], vence, 'civil')
    where origin = 'debt_schedule' and ref_id = d
      and title = 'Prestação revisada' and category = 'veiculo') then
    raise exception 'a linha do mês não refletiu descrição e categoria do contrato';
  end if;
  if not exists (select 1 from private.cash_events(array[ws], current_date, vence + 2)
    where origin = 'debt_schedule' and ref_id = d and title = 'Prestação revisada') then
    raise exception 'o fluxo de caixa não refletiu a descrição do contrato';
  end if;
  if not exists (select 1 from public._upcoming_bills(u, 60)
    where kind = 'debt' and ref_id = d and title = 'Prestação revisada') then
    raise exception 'as contas a vencer não refletiram a descrição do contrato';
  end if;
end $$;

rollback;
