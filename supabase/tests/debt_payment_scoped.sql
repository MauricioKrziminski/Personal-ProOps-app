-- docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/debt_payment_scoped.sql
-- All fixtures and edits roll back.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a7a1';
  w uuid := '00000000-0000-0000-0000-00000000a7b1';
  a uuid := '00000000-0000-0000-0000-00000000a7c1';
  d uuid := '00000000-0000-0000-0000-00000000a7d1';
begin
  insert into auth.users (id, email) values (u, 'debt-scoped@example.invalid');
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Scoped debt test');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (a, w, u, 'Checking', 'checking', 1000000);
  insert into public.debts
    (id, workspace_id, user_id, name, kind, calculation_mode, principal_cents,
     remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents)
    values (d, w, u, 'Carro', 'financing', 'fixed_installments', 60000,
            60000, 0, 6, 0, 10000);
  perform public.pay_debt_installment(d, 10000, a, current_date - 60);
  perform public.pay_debt_installment(d, 10000, a, current_date - 30);
  perform public.pay_debt_installment(d, 10000, a, current_date);
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a1', true);

-- RED: the dedicated atomic RPC does not exist before its migration.
do $$
declare
  anchor uuid;
  d uuid := '00000000-0000-0000-0000-00000000a7d1';
  debt_version bigint;
  anchor_version bigint;
  versions jsonb;
  result jsonb;
begin
  select id, edit_revision into anchor, anchor_version from public.transactions
    where debt_id = d and debt_payment_no = 2;
  select edit_revision into debt_version from public.debts where id = d;
  select jsonb_object_agg(t.id::text, t.edit_revision) into versions
    from public.transactions t where t.id = anchor;
  result := public.update_debt_payment_scoped(
    anchor, 'one', '{"amount_cents":11000,"description":"Carro ajustado"}'::jsonb,
    debt_version, anchor_version, versions, gen_random_uuid());
  assert result->>'recorded_changed' = '1', 'one must report one recorded payment';
  assert (select amount_cents from public.transactions where id = anchor) = 11000;
  assert (select debt_principal_cents from public.transactions where id = anchor) = 10000,
    'one retains the original contractual principal and records the difference as fee';
  assert (select debt_interest_cents from public.transactions where id = anchor) = 1000;
  assert (select amount_cents from public.transactions where debt_id = d and debt_payment_no = 3) = 10000;
  assert (select installment_cents from public.debts where id = d) = 10000;
end $$;

-- A later recorded payment is part of from_here even if its date is earlier than the anchor.
-- A declared-only historical payment has no transaction and appears only in the result summary.
do $$
declare
  d uuid := '00000000-0000-0000-0000-00000000a7d1';
  a uuid := '00000000-0000-0000-0000-00000000a7c1';
  anchor uuid;
  dv bigint;
  av bigint;
  versions jsonb;
  result jsonb;
  l record;
begin
  update public.debts set installments_paid = 4, remaining_cents = 20000 where id = d;
  -- The latest migration allows dates independent of contract payment numbers.
  update public.transactions set occurred_at = current_date - 90
    where debt_id = d and debt_payment_no = 3;
  select id, edit_revision into anchor, av from public.transactions
    where debt_id = d and debt_payment_no = 2;
  select edit_revision into dv from public.debts where id = d;
  select jsonb_object_agg(id::text, edit_revision) into versions from public.transactions
    where debt_id = d and debt_payment_no >= 2;
  result := public.update_debt_payment_scoped(
    anchor, 'from_here',
    '{"amount_cents":11000,"category":"veiculo","description":"Prestação do carro","merchant":"Banco","account_id":"00000000-0000-0000-0000-00000000a7c1"}'::jsonb,
    dv, av, versions, gen_random_uuid());
  assert result->>'recorded_changed' = '2', 'from_here must update anchor and later recorded payment';
  assert result->>'declared_only_estimates_without_ledger' = '1', 'one historical installment is only a display estimate';
  assert result->>'declared_estimates_recalculated' = '1',
    'from_here updates the display estimate after the anchor when the contract amount changes';
  assert result->>'future_installments' = '2', 'two installments remain unpaid';
  assert (select amount_cents from public.transactions where debt_id = d and debt_payment_no = 1) = 10000,
    'earlier recorded cash must stay unchanged';
  assert (select count(*) from public.transactions where debt_id = d and debt_payment_no in (2,3)
          and amount_cents = 11000 and debt_principal_cents = 10000 and debt_interest_cents = 1000
          and description = 'Prestação do carro' and category = 'veiculo' and merchant = 'Banco') = 2,
    'selected recorded cash and metadata must change without rewriting historical principal';
  select installment_cents, remaining_cents, principal_cents, payment_category,
         payment_description, payment_merchant, account_id into l from public.debts where id = d;
  assert l.installment_cents = 11000 and l.remaining_cents = 22000 and l.principal_cents = 66000,
    'the future contract must be coherent with the fixed-installment check';
  assert l.payment_category = 'veiculo' and l.payment_description = 'Prestação do carro'
    and l.payment_merchant = 'Banco' and l.account_id = a,
    'future payment defaults must be stored on the contract';
  perform public.pay_debt_installment(d, 11000, null, current_date + 1);
  assert (select count(*) from public.transactions where debt_id = d and debt_payment_no = 5
          and amount_cents = 11000 and category = 'veiculo' and description = 'Prestação do carro'
          and merchant = 'Banco' and account_id = a) = 1,
    'a newly recorded payment must inherit the updated contract metadata';
end $$;

-- all changes every real payment, regardless of date or prior scope; a retry with fresh
-- versions changes nothing. Stale versions are rejected before any write.
do $$
declare
  d uuid := '00000000-0000-0000-0000-00000000a7d1';
  anchor uuid;
  dv bigint;
  av bigint;
  versions jsonb;
  result jsonb;
  rejected boolean := false;
  request_id uuid := gen_random_uuid();
begin
  select id, edit_revision into anchor, av from public.transactions
    where debt_id = d and debt_payment_no = 3;
  select edit_revision into dv from public.debts where id = d;
  select jsonb_object_agg(id::text, edit_revision) into versions from public.transactions
    where debt_id = d;
  result := public.update_debt_payment_scoped(anchor, 'all', '{"amount_cents":12000}'::jsonb,
    dv, av, versions, request_id);
  assert result->>'recorded_changed' = '4', 'all must change all four real payments';
  assert result->>'declared_only_estimates_without_ledger' = '1', 'all cannot write a nonexistent historic row';
  assert result->>'declared_estimates_recalculated' = '1',
    'all must report the historical estimate recalculated by the current contract amount';
  assert result->>'future_installments' = '1', 'one future installment remains';
  assert (select count(*) from public.transactions where debt_id = d and amount_cents = 12000) = 4;
  assert (select installment_cents from public.debts where id = d) = 12000;
  assert (select remaining_cents from public.debts where id = d) = 12000;
  assert (select count(*) from public.transactions where debt_id = d and debt_payment_no in (1,2,3)
          and debt_principal_cents = 10000 and debt_interest_cents = 2000) = 3,
    'bulk cash correction must preserve the old paid principal and compute its fee';
  assert (select count(*) from public.transactions where debt_id = d and debt_payment_no = 5
          and debt_principal_cents = 11000 and debt_interest_cents = 1000) = 1,
    'payment recorded under the intermediate contract retains that principal';

  -- Retry the exact lost response with the ORIGINAL stale versions. It returns the stored
  -- response without another ledger or contract update.
  assert public.update_debt_payment_scoped(anchor, 'all', '{"amount_cents":12000}'::jsonb,
    dv, av, versions, request_id) = result,
    'an exact request replay must return the original result';
  assert (select edit_revision from public.transactions where id = anchor) = av + 1,
    'an exact replay must not write again';
  rejected := false;
  begin
    perform public.update_debt_payment_scoped(anchor, 'all', '{"amount_cents":13000}'::jsonb,
      dv, av, versions, request_id);
  exception when others then rejected := true;
  end;
  assert rejected, 'reusing a request key with a different patch must fail';
  rejected := false;

  begin
    perform public.update_debt_payment_scoped(anchor, 'all', '{"amount_cents":13000}'::jsonb,
      dv, av, versions, gen_random_uuid());
  exception when others then
    rejected := true;
  end;
  assert rejected, 'stale debt/payment versions must be rejected';
  assert (select count(*) from public.transactions where debt_id = d and amount_cents = 12000) = 4,
    'stale request must not write any payment';
  assert (select installment_cents from public.debts where id = d) = 12000,
    'stale request must not write the contract';

  select edit_revision into av from public.transactions where id = anchor;
  select edit_revision into dv from public.debts where id = d;
  select jsonb_object_agg(id::text, edit_revision) into versions from public.transactions
    where debt_id = d;
  result := public.update_debt_payment_scoped(anchor, 'all', '{"amount_cents":12000}'::jsonb,
    dv, av, versions, gen_random_uuid());
  assert result->>'recorded_changed' = '0' and result->>'contract_changed' = 'false',
    'same desired values with fresh versions must be idempotent';
end $$;

-- From here preserves a declared-only estimate before the anchor while changing the
-- selected real payment and the future contract.
do $$
declare
  d uuid := '00000000-0000-0000-0000-00000000a7d2';
  w uuid := '00000000-0000-0000-0000-00000000a7b1';
  u uuid := '00000000-0000-0000-0000-00000000a7a1';
  a uuid := '00000000-0000-0000-0000-00000000a7c1';
  anchor uuid;
  av bigint;
  dv bigint;
  versions jsonb;
begin
  insert into public.debts
    (id, workspace_id, user_id, name, kind, calculation_mode, principal_cents,
     remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents)
    values (d, w, u, 'Histórico declarado', 'financing', 'fixed_installments',
            60000, 50000, 0, 6, 1, 10000);
  perform public.pay_debt_installment(d, 10000, a, current_date);
  select id, edit_revision into anchor, av from public.transactions where debt_id = d;
  select edit_revision into dv from public.debts where id = d;
  select jsonb_object_agg(id::text, edit_revision) into versions from public.transactions where debt_id = d;
  perform public.update_debt_payment_scoped(anchor, 'from_here', '{"amount_cents":11000}'::jsonb,
    dv, av, versions, gen_random_uuid());
  assert (select amount_cents from public.debt_declared_estimates where debt_id=d and installment_no=1)=10000;
  assert (select amount_cents from public.transactions where id = anchor) = 11000;
  assert (select installment_cents from public.debts where id = d) = 11000;
end $$;

do $$
begin
  assert has_function_privilege('authenticated',
    'public.update_debt_payment_scoped(uuid,text,jsonb,bigint,bigint,jsonb,uuid)', 'execute'),
    'authenticated must be able to call the RPC';
  assert not has_function_privilege('anon',
    'public.update_debt_payment_scoped(uuid,text,jsonb,bigint,bigint,jsonb,uuid)', 'execute'),
    'anon must not execute the RPC';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a1', true);
do $$
declare
  d uuid := '00000000-0000-0000-0000-00000000a7d1';
  anchor uuid;
  av bigint;
  dv bigint;
  versions jsonb;
  result jsonb;
  rejected boolean := false;
begin
  select id, edit_revision into anchor, av from public.transactions
    where debt_id = d and debt_payment_no = 1;
  select edit_revision into dv from public.debts where id = d;
  select jsonb_object_agg(id::text, edit_revision) into versions from public.transactions where id = anchor;
  result := public.update_debt_payment_scoped(anchor, 'one', '{"merchant":"Loja"}'::jsonb,
    dv, av, versions, gen_random_uuid());
  assert result->>'recorded_changed' = '1', 'authenticated member must edit under RLS';
  assert (select merchant from public.transactions where id = anchor) = 'Loja';
  begin
    perform public.update_debt_payment_scoped(anchor, 'one', '{"occurred_at":"2026-01-01"}'::jsonb,
      dv, av, versions, gen_random_uuid());
  exception when others then rejected := true;
  end;
  assert rejected, 'date propagation must be explicitly rejected';

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7ff', true);
  rejected := false;
  begin
    perform public.update_debt_payment_scoped(anchor, 'one', '{"merchant":"Intruso"}'::jsonb,
      dv, av, versions, gen_random_uuid());
  exception when others then rejected := true;
  end;
  assert rejected, 'nonmember must not see or edit the payment';
end $$;

-- A later row can fail the fixed-payment limit after an earlier row has updated. The whole
-- function call must roll back, including the earlier row and the debt contract.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7a1', true);
do $$
declare
  d uuid := '00000000-0000-0000-0000-00000000a7d6';
  w uuid := '00000000-0000-0000-0000-00000000a7b1';
  u uuid := '00000000-0000-0000-0000-00000000a7a1';
  a uuid := '00000000-0000-0000-0000-00000000a7c1';
  anchor uuid;
  av bigint;
  dv bigint;
  versions jsonb;
  rejected boolean := false;
begin
  insert into public.debts
    (id, workspace_id, user_id, name, kind, calculation_mode, principal_cents,
     remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents)
    values (d, w, u, 'Atomicidade', 'financing', 'fixed_installments',
            66000, 66000, 0, 6, 0, 11000);
  perform public.pay_debt_installment(d, 11000, a, current_date - 30);
  update public.debts set principal_cents = 60000, remaining_cents = 50000,
    installment_cents = 10000 where id = d;
  perform public.pay_debt_installment(d, 10000, a, current_date);
  select id, edit_revision into anchor, av from public.transactions
    where debt_id = d and debt_payment_no = 1;
  select edit_revision into dv from public.debts where id = d;
  select jsonb_object_agg(id::text, edit_revision) into versions from public.transactions where debt_id = d;
  begin
    perform public.update_debt_payment_scoped(anchor, 'all', '{"amount_cents":20500}'::jsonb,
      dv, av, versions, gen_random_uuid());
  exception when others then rejected := true;
  end;
  assert rejected, 'the second payment must reject an amount at least double its 10000 principal';
  assert (select amount_cents from public.transactions where debt_id = d and debt_payment_no = 1) = 11000,
    'the successful first row must roll back when a later row fails';
  assert (select amount_cents from public.transactions where debt_id = d and debt_payment_no = 2) = 10000;
  assert (select installment_cents from public.debts where id = d) = 10000;
end $$;

-- Price: editing an OLD payment changes principal and later balance snapshots;
-- all changes real historical cash plus the future installment target.
do $$
declare
  d uuid := '00000000-0000-0000-0000-00000000a7d3';
  w uuid := '00000000-0000-0000-0000-00000000a7b1';
  u uuid := '00000000-0000-0000-0000-00000000a7a1';
  a uuid := '00000000-0000-0000-0000-00000000a7c1';
  anchor uuid;
  dv bigint;
  av bigint;
  versions jsonb;
  balance_before bigint;
begin
  insert into public.debts
    (id, workspace_id, user_id, name, kind, calculation_mode, principal_cents,
     remaining_cents, interest_rate_monthly, installments, installments_paid)
    values (d, w, u, 'Price scoped', 'financing', 'amortized', 100000, 100000, 0.01, 4, 0);
  perform public.pay_debt_installment(d, 26000, a, current_date - 30);
  perform public.pay_debt_installment(d, 26000, a, current_date);
  select id, edit_revision into anchor, av from public.transactions where debt_id = d and debt_payment_no = 1;
  select edit_revision into dv from public.debts where id = d;
  select jsonb_object_agg(id::text, edit_revision) into versions
    from public.transactions where id = anchor;
  select remaining_cents into balance_before from public.debts where id = d;
  perform public.update_debt_payment_scoped(anchor, 'one', '{"amount_cents":26500}'::jsonb,
    dv, av, versions, gen_random_uuid());
  assert (select remaining_cents from public.debts where id = d) = balance_before - 500,
    'the older paid cash correction must change remaining principal';
  assert (select debt_balance_after_cents from public.transactions where debt_id = d and debt_payment_no = 2)
    = balance_before - 500, 'the later ledger balance must follow the older payment';
  assert (select debt_interest_cents from public.transactions where debt_id = d and debt_payment_no = 2) = 750,
    'already charged interest remains a recorded historical fact';

  select edit_revision into av from public.transactions where id = anchor;
  select edit_revision into dv from public.debts where id = d;
  select jsonb_object_agg(id::text, edit_revision) into versions
    from public.transactions where debt_id = d;
  perform public.update_debt_payment_scoped(anchor, 'from_here',
    '{"amount_cents":26800,"description":"Parcela revista","category":"veiculo"}'::jsonb,
    dv, av, versions, gen_random_uuid());
  assert (select count(*) from public.transactions where debt_id = d and description = 'Parcela revista') = 2;
  assert (select payment_description from public.debts where id = d) = 'Parcela revista';
  assert (select installment_cents from public.debts where id = d) = 26800;

  select edit_revision into av from public.transactions where id = anchor;
  select edit_revision into dv from public.debts where id = d;
  select jsonb_object_agg(id::text, edit_revision) into versions
    from public.transactions where debt_id = d;
  perform public.update_debt_payment_scoped(anchor, 'all', '{"amount_cents":27000}'::jsonb,
    dv, av, versions, gen_random_uuid());
  assert (select count(*) from public.transactions where debt_id = d and amount_cents = 27000) = 2;
  assert (select installment_cents from public.debts where id = d) = 27000;
  assert (select principal_cents from public.debts where id = d) = 100000,
    'the original amortized principal must not be replaced by payment times term';
  assert (select count(*) from public.debt_schedule(d)) = 2,
    'the complete future Price schedule must remain payable';

  select edit_revision into av from public.transactions where id = anchor;
  select edit_revision into dv from public.debts where id = d;
  select jsonb_object_agg(id::text, edit_revision) into versions
    from public.transactions where id = anchor;
  perform public.update_debt_payment_scoped(anchor, 'one',
    '{"occurred_at":"2026-09-06"}'::jsonb, dv, av, versions, gen_random_uuid());
  assert (select occurred_at from public.transactions where id = anchor) = '2026-09-06',
    'the paid date can change for one historical payment';
end $$;

rollback;
