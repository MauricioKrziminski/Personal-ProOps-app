-- F03: selector metadata must not invent available credit from incomplete ledgers.
-- Run through the project's SQL test runner; all fixture writes are rolled back.
-- Independent expectations catch current-invoice-only sums, partial payments counted
-- twice, rolled principal counted twice, null limits changed to zero, and RLS leaks.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000f301';
  w uuid := '00000000-0000-0000-0000-00000000f302';
  foreign_u uuid := '00000000-0000-0000-0000-00000000f303';
  foreign_w uuid := '00000000-0000-0000-0000-00000000f304';
begin
  assert to_regprocedure('public.card_limit_context()') is not null,
    'F03 requires card_limit_context()';
  assert not has_function_privilege('anon', 'public.card_limit_context()', 'EXECUTE'),
    'anonymous clients must not execute financial selector metadata';
  assert has_function_privilege('authenticated', 'public.card_limit_context()', 'EXECUTE'),
    'authenticated clients must be able to query selector metadata';

  insert into auth.users (id, email) values
    (u, 'f03-selector-context@example.invalid'),
    (foreign_u, 'f03-selector-context-foreign@example.invalid');
  insert into public.profiles (id) values (u), (foreign_u) on conflict do nothing;
  insert into public.workspaces (id, owner_id, name) values
    (w, u, 'F03 selector context'),
    (foreign_w, foreign_u, 'F03 foreign selector context');
  insert into public.workspace_members (workspace_id, user_id, role) values
    (w, u, 'owner'), (foreign_w, foreign_u, 'owner');

  insert into public.accounts
    (id, user_id, workspace_id, name, type, initial_balance_cents)
  values ('00000000-0000-0000-0000-00000000f305', u, w,
          'F03 paying account', 'checking', 500000);
  insert into public.accounts
    (id, user_id, workspace_id, name, type, closing_day, due_day, credit_limit_cents)
  values
    ('00000000-0000-0000-0000-00000000f306', u, w,
     'F03 canonical card', 'credit_card', 3, 10, 100000),
    ('00000000-0000-0000-0000-00000000f307', foreign_u, foreign_w,
     'F03 foreign card', 'credit_card', 3, 10, 999999);
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f301', true);
set local role authenticated;

-- Exercise the public INVOKER wrapper with a JWT, not the definer/service path.
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000f301';
  w uuid := '00000000-0000-0000-0000-00000000f302';
  bank uuid := '00000000-0000-0000-0000-00000000f305';
  card uuid := '00000000-0000-0000-0000-00000000f306';
  invoice uuid;
  plan uuid;
  payment uuid;
  rolled jsonb;
  context record;
begin
  assert not exists (select 1 from public.card_limit_context()
                     where account_id = '00000000-0000-0000-0000-00000000f307'),
    'selector metadata leaked a foreign workspace card';
  assert not exists (select 1 from public.card_limit_context() where account_id = bank),
    'credit metadata must not include money accounts';

  insert into public.transactions
    (user_id, workspace_id, account_id, kind, amount_cents,
     description, occurred_at, source, status)
  values (u, w, card, 'expense', 30000, 'F03 current purchase',
          current_date, 'app', 'cleared')
  returning invoice_id into invoice;
  assert invoice is not null, 'current purchase must have a real invoice';

  -- Entire 60000 purchase is already committed, including both future parcels.
  -- Starting two months ahead keeps the rolled destination separate from them.
  plan := public.create_installment_plan_with_history(
    card, 60000::bigint, 2, (current_date + interval '2 months')::date,
    0, 'F03 future purchase', 'outros', null);
  assert (select count(*) from public.transactions
          where installment_plan_id = plan and occurred_at > current_date
            and status = 'pending') = 2,
    'fixture must contain two genuinely future unpaid parcels';
  assert (select sum(amount_cents) from public.transactions
          where installment_plan_id = plan) = 60000,
    'fixture future purchase must total 60000';

  select * into context from public.card_limit_context() where account_id = card;
  assert found and context.limit_status = 'available'
    and context.credit_limit_cents is not distinct from 100000::bigint
    and context.available_limit_cents is not distinct from 10000::bigint,
    '100000 limit minus current 30000 and future 60000 must leave 10000';

  payment := public.pay_invoice(invoice, bank, current_date, 10000::bigint);
  select * into context from public.card_limit_context() where account_id = card;
  assert found and context.limit_status = 'available'
    and context.available_limit_cents is not distinct from 20000::bigint,
    'partial 10000 must release credit once, without dropping future parcels';
  assert (select paid_cents from public.card_invoices where id = invoice) = 10000,
    'partial payment fixture must record exactly 10000 paid';

  -- The current invoice carries 20000; total card commitment is 80000.
  -- Rolling its remainder plus explicit 400 interest and 200 IOF means 80600
  -- committed. Counting original purchases again would understate the limit.
  rolled := public.roll_invoice(invoice, 400::bigint, 200::bigint);
  assert (rolled->>'principal_cents')::bigint = 20000,
    'only the unpaid current principal must move to the destination invoice';
  assert (rolled->>'juros_cents')::bigint = 400
    and (rolled->>'iof_cents')::bigint = 200,
    'fixture must add exactly 600 of registered charges';
  assert (select status from public.card_invoices where id = invoice) = 'rolled',
    'fixture origin invoice must be rolled';
  select * into context from public.card_limit_context() where account_id = card;
  assert found and context.limit_status = 'available'
    and context.available_limit_cents is not distinct from 19400::bigint,
    'rolled remainder plus 600 charges must leave 19400, without duplicated principal';

  perform public.unroll_invoice(invoice);
  select * into context from public.card_limit_context() where account_id = card;
  assert found and context.limit_status = 'available'
    and context.available_limit_cents is not distinct from 20000::bigint,
    'undoing rollover must restore the partial-payment limit';
  assert not exists (select 1 from public.transactions where rollover_of_invoice_id = invoice),
    'undoing rollover must remove the carried principal';

  delete from public.transactions where id = payment;
  select * into context from public.card_limit_context() where account_id = card;
  assert found and context.limit_status = 'available'
    and context.available_limit_cents is not distinct from 10000::bigint,
    'undoing partial payment must restore all 90000 committed';

  -- Manual settlement ends only that invoice; future parcels remain committed.
  perform public.settle_invoice(invoice, current_date);
  select * into context from public.card_limit_context() where account_id = card;
  assert found and context.limit_status = 'available'
    and context.available_limit_cents is not distinct from 40000::bigint,
    'manual settlement of current 30000 must leave future 60000 committed';
  perform public.unsettle_invoice(invoice);
  select * into context from public.card_limit_context() where account_id = card;
  assert found and context.limit_status = 'available'
    and context.available_limit_cents is not distinct from 10000::bigint,
    'undoing manual settlement must restore current and future commitment';
end $$;

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000f301';
  w uuid := '00000000-0000-0000-0000-00000000f302';
  bank uuid := '00000000-0000-0000-0000-00000000f305';
  card uuid;
  tx uuid;
  context record;
  scenario record;
begin
  insert into public.accounts
    (user_id, workspace_id, name, type, closing_day, due_day, credit_limit_cents)
  values (u, w, 'F03 missing limit', 'credit_card', 3, 10, null)
  returning id into card;
  select * into context from public.card_limit_context() where account_id = card;
  assert found and context.limit_status = 'not_set'
    and context.credit_limit_cents is null and context.available_limit_cents is null,
    'missing limit must remain null and explicitly not_set';
  -- No configured limit takes precedence over any review condition.
  update public.accounts set initial_balance_cents = -1000 where id = card;
  select * into context from public.card_limit_context() where account_id = card;
  assert found and context.limit_status = 'not_set'
    and context.available_limit_cents is null,
    'missing limit plus legacy seed must not become zero or a numeric limit';

  insert into public.accounts
    (user_id, workspace_id, name, type, closing_day, due_day, credit_limit_cents)
  values (u, w, 'F03 zero limit', 'credit_card', 3, 10, 0)
  returning id into card;
  select * into context from public.card_limit_context() where account_id = card;
  assert found and context.limit_status = 'available'
    and context.credit_limit_cents is not distinct from 0::bigint
    and context.available_limit_cents is not distinct from 0::bigint,
    'a configured zero limit must be available with a real zero';
  insert into public.transactions
    (user_id, workspace_id, account_id, kind, amount_cents, description, occurred_at, status)
  values (u, w, card, 'expense', 1, 'F03 one cent beyond limit', current_date, 'cleared');
  select * into context from public.card_limit_context() where account_id = card;
  assert found and context.limit_status = 'available'
    and context.available_limit_cents is not distinct from (-1)::bigint,
    'an insufficient zero limit must preserve the negative cent, not clamp it';

  for scenario in select * from (values
    ('negative seed', -1000::bigint, false, null::text, 'cleared'),
    ('positive seed', 1000::bigint, false, null::text, 'cleared'),
    ('orphan expense', 0::bigint, true, 'expense', 'pending'),
    ('orphan transfer', 0::bigint, true, 'transfer', 'cleared'),
    ('confirmed income', 0::bigint, false, 'income', 'cleared'),
    ('pending income', 0::bigint, false, 'income', 'pending'),
    ('incoming transfer', 0::bigint, false, 'incoming', 'cleared'),
    ('pending incoming transfer', 0::bigint, false, 'incoming', 'pending')
  ) cases(label, seed, missing_days, kind, status) loop
    -- Direct writes represent permitted historical/API states, not F02 creation.
    insert into public.accounts
      (user_id, workspace_id, name, type, initial_balance_cents,
       closing_day, due_day, credit_limit_cents)
    values (u, w, 'F03 review ' || scenario.label, 'credit_card', scenario.seed,
            case when scenario.missing_days then null else 3 end,
            case when scenario.missing_days then null else 10 end, 100000)
    returning id into card;
    if scenario.kind = 'incoming' then
      insert into public.transactions
        (user_id, workspace_id, account_id, counterparty_account_id, kind,
         amount_cents, description, occurred_at, status)
      values (u, w, bank, card, 'transfer', 5000,
              'F03 unlinked card credit', current_date, scenario.status)
      returning id into tx;
      assert (select pays_invoice_id is null from public.transactions where id = tx),
        'incoming credit fixture must not be a linked invoice payment';
    elsif scenario.kind is not null then
      insert into public.transactions
        (user_id, workspace_id, account_id, counterparty_account_id, kind,
         amount_cents, description, occurred_at, status)
      values (u, w, card, case when scenario.kind = 'transfer' then bank end,
              scenario.kind, 5000, 'F03 review line ' || scenario.label,
              current_date, scenario.status)
      returning id into tx;
      if scenario.missing_days then
        assert (select invoice_id is null from public.transactions where id = tx),
          'missing card days must actually create an orphan debit';
      end if;
    end if;
    select * into context from public.card_limit_context() where account_id = card;
    assert found and context.limit_status = 'needs_review'
      and context.credit_limit_cents is not distinct from 100000::bigint
      and context.available_limit_cents is null,
      format('legacy scenario %s must suppress the numeric limit', scenario.label);
  end loop;
end $$;

-- Switching the JWT must switch the visible resource set, including metadata.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f303', true);
do $$
begin
  assert (select count(*) from public.card_limit_context()) = 1,
    'foreign owner must see only their single fixture card';
  assert exists (select 1 from public.card_limit_context()
                 where account_id = '00000000-0000-0000-0000-00000000f307'
                   and limit_status = 'available' and available_limit_cents = 999999),
    'foreign owner must receive their own card metadata';
end $$;

select 'account_picker_context: ok' as resultado;
rollback;
