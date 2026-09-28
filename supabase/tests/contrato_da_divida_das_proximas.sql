-- Editar a DÍVIDA (o contrato, não um pagamento) oferece "Das próximas em diante" e "Todas":
-- "Das próximas" muda o contrato em qualquer campo sem reescrever os pagamentos feitos;
-- "Todas" com dia novo leva também os pagamentos registrados ao dia novo, cada um no seu mês.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e4a1';
  w uuid := '00000000-0000-0000-0000-00000000e4b1';
  conta uuid := '00000000-0000-0000-0000-00000000e4c1';
  outra uuid := '00000000-0000-0000-0000-00000000e4c2';
  d uuid := '00000000-0000-0000-0000-00000000e4d1';
  v bigint;
begin
  insert into auth.users(id, email) values (u, 'contrato-proximas@example.invalid') on conflict (id) do nothing;
  insert into public.profiles(id) values (u) on conflict (id) do nothing;
  insert into public.workspaces(id, owner_id, name) values (w, u, 'Contrato das próximas');
  insert into public.workspace_members(workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts(id, workspace_id, user_id, name, type, initial_balance_cents) values
    (conta, w, u, 'Conta', 'checking', 100000), (outra, w, u, 'Outra', 'checking', 100000);
  insert into public.debts(id, workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents,
    due_day, first_due_date, account_id)
  values (d, w, u, 'Carro', 'financing', 'fixed_installments', 60000, 60000, 0, 6, 0, 10000, 10,
    '2026-08-10', conta);
  perform public.pay_debt_installment(d, 10000, conta, '2026-08-10');
  perform public.pay_debt_installment(d, 10000, conta, '2026-09-10');
  perform set_config('request.jwt.claim.sub', u::text, true);

  -- "Das próximas em diante" com nome e conta: o contrato muda, os pagamentos feitos não
  select edit_revision into v from public.debts where id = d;
  perform public.update_debt_contract_scoped(d, 3, 'future',
    jsonb_build_object('name', 'Carro novo', 'account_id', outra), v, '{}'::jsonb, gen_random_uuid());
  assert (select name from public.debts where id = d) = 'Carro novo';
  assert (select account_id from public.debts where id = d) = outra;
  assert not exists (select 1 from public.transactions where debt_id = d
    and (account_id <> conta or description <> 'Parcela Carro')), 'os pagamentos feitos ficam como estavam';

  -- "Todas" com dia novo: os pagamentos registrados vão ao dia 20 do próprio mês
  select edit_revision into v from public.debts where id = d;
  perform public.update_debt_contract_scoped(d, 3, 'all',
    '{"due_day":20}'::jsonb, v, '{}'::jsonb, gen_random_uuid());
  assert (select array_agg(occurred_at order by debt_payment_no) from public.transactions where debt_id = d)
    = array[date '2026-08-20', date '2026-09-20'],
    format('pagamentos: %s', (select array_agg(occurred_at order by debt_payment_no) from public.transactions where debt_id = d));
  assert extract(day from (select min(due_date) from public.debt_schedule(d))) = 20;
end $$;
rollback;
