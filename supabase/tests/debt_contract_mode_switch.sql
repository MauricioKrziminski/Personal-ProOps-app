-- Synthetic fixtures only. scripts/sql-test.py always rolls the transaction back.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e2a1';
  w uuid := '00000000-0000-0000-0000-00000000e2b1';
  a uuid := gen_random_uuid();
  other_account uuid := gen_random_uuid();
  d uuid;
  declared int;
  recorded int;
  paid int;
  step int;
  origin text;
  target text;
  v bigint;
  req uuid;
  patch jsonb;
  result jsonb;
  before_debt jsonb;
  before_history jsonb;
  before_dates jsonb;
  payment_id uuid;
  remaining bigint;
  payment_no int;
  cases int := 0;
begin
  insert into auth.users(id,email) values(u,'debt-mode-switch@example.invalid');
  insert into public.profiles(id) values(u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values(w,u,'Mode switch rollback');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type)
    values(a,w,u,'Historical account','checking'),(other_account,w,u,'Future account','checking');
  perform set_config('request.jwt.claim.sub',u::text,true);
  foreach origin in array array['fixed_installments','amortized'] loop
    for declared in 0..2 loop
      for recorded in 0..2 loop
        d := gen_random_uuid();
        insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,
          principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,
          installment_cents,account_id,due_day,first_due_date)
        values(d,w,u,'Mode fixture '||d,'financing',origin,60000,10000*(6-declared),
          case when origin='amortized' then 0.01 else 0 end,6,declared,10000,a,4,'2026-01-04');
        perform private.insert_purchase_down_payment('financiamento',d,
          jsonb_build_object('amount_cents',4321,'account_id',a,'occurred_at',current_date-20));
        for step in 1..recorded loop
          perform public.pay_debt_installment(d,10000,a,current_date-10+step);
        end loop;
        paid := declared+recorded;
        select jsonb_agg(to_jsonb(t) order by t.id) into before_history
          from public.transactions t where t.debt_id=d or t.down_payment_debt_id=d;
        select jsonb_agg(to_jsonb(t) order by t.installment_no) into before_dates
          from public.debt_declared_due_dates t where t.debt_id=d;
        for step in 1..2 loop
          target := case when step=1 then
            case when origin='amortized' then 'fixed_installments' else 'amortized' end
            else origin end;
          -- These are the fields sent by camposNoOutroModo/simpleDebtValues/debtTerm.
          -- Fixed ignores contradictory explicit principal/balance and derives both.
          patch := jsonb_build_object('calculation_mode',target,'installments',6,
            'installments_paid',paid,'installment_cents',10000,
            'principal_cents',case when target='fixed_installments' then 99999 else 60000 end,
            'remaining_cents',case when target='fixed_installments' then 99999 else 10000*(6-paid) end,
            'interest_rate_monthly',case when target='amortized' then 0.01 else 0 end,
            'account_id',other_account,'due_day',-1,'first_due_date','2030-01-31');
          select edit_revision into v from public.debts where id=d;
          req := gen_random_uuid();
          result := public.update_debt_contract_scoped(d,paid+1,'future',patch,v,'{}',req);
          assert result->>'recorded_changed'='0';
          assert (select calculation_mode from public.debts where id=d)=target;
          assert (select principal_cents from public.debts where id=d)=60000;
          assert (select remaining_cents from public.debts where id=d)=10000*(6-paid);
          assert (select interest_rate_monthly from public.debts where id=d)=
            case when target='amortized' then 0.01 else 0 end;
          assert (select installment_cents from public.debts where id=d)=10000;
          assert (select installments from public.debts where id=d)=6;
          assert (select installments_paid from public.debts where id=d)=paid;
          assert (select count(*) from public.debt_schedule(d))=6-paid;
          assert (select due_date from public.debt_schedule(d) order by installment_no limit 1)=
            private.day_in_month(private.add_months('2030-01-31',paid),-1);
          assert (select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t
            where t.debt_id=d or t.down_payment_debt_id=d)=before_history,
            'future preserves every field, ID, date, account and link of payments AND entry';
          assert (select jsonb_agg(to_jsonb(t) order by t.installment_no)
            from public.debt_declared_due_dates t where t.debt_id=d) is not distinct from before_dates;
          assert (select count(*) from public.transactions where down_payment_debt_id=d)=1;
          assert (select count(*) from public.debt_declared_estimates where debt_id=d)=declared;
          assert not exists(select 1 from public.debt_declared_estimates where debt_id=d and amount_cents<>10000);
          select to_jsonb(t) into before_debt from public.debts t where id=d;
          assert public.update_debt_contract_scoped(d,paid+1,'future',patch,v,'{}',req)=result;
          assert (select to_jsonb(t) from public.debts t where id=d)=before_debt,
            'retry does not increment revision or mutate the contract';
          begin
            perform public.update_debt_contract_scoped(d,paid+1,'future',patch||'{"due_day":5}',v,'{}',req);
            assert false,'reused request must refuse';
          exception when raise_exception then
            assert sqlerrm='Identificador de requisição reutilizado com dados diferentes';
          end;
          begin
            perform public.update_debt_contract_scoped(d,paid+1,'future',patch,v,'{}',gen_random_uuid());
            assert false,'stale revision must refuse';
          exception when raise_exception then
            assert sqlerrm='A dívida mudou enquanto você editava';
          end;
          -- Guard compatibility: test edits and deletes under BOTH destination modes,
          -- then undo this nested subtransaction so the next switch sees the same history.
          if recorded>0 then
            begin
              select id,debt_payment_no into payment_id,payment_no from public.transactions
                where debt_id=d order by debt_payment_no limit 1;
              select remaining_cents into remaining from public.debts where id=d;
              update public.transactions set amount_cents=amount_cents+50 where id=payment_id;
              assert (select remaining_cents from public.debts where id=d)=
                remaining-case when target='amortized' then 50 else 0 end;
              delete from public.transactions where id=payment_id;
              assert (select installments_paid from public.debts where id=d)=paid-1;
              assert (select count(*) from public.transactions where down_payment_debt_id=d)=1;
              assert not exists(select 1 from public.transactions where debt_id=d and debt_payment_no>paid-1);
              raise exception using errcode='ZX001',message='rollback payment compatibility fixture';
            exception when sqlstate 'ZX001' then null;
            end;
          end if;
          cases := cases+1;
        end loop;
      end loop;
    end loop;
  end loop;
  raise notice 'MS1: % future switches; declared 0/1/2 x recorded 0/1/2 x two origins x roundtrip',cases;

  -- All with declared-only history permits a complete switch. Real payments keep the
  -- existing explicit refusal; a mode-only patch cannot bypass its implicit derivation.
  for declared in 0..2 loop
    d := gen_random_uuid();
    insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,
      principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents)
    values(d,w,u,'All fixture '||d,'financing','fixed_installments',60000,10000*(6-declared),0,6,declared,10000);
    for step in 1..2 loop
      target := case when step=1 then 'amortized' else 'fixed_installments' end;
      select edit_revision into v from public.debts where id=d;
      perform public.update_debt_contract_scoped(d,declared+1,'all',
        jsonb_build_object('calculation_mode',target,'principal_cents',60000,
          'remaining_cents',10000*(6-declared),'interest_rate_monthly',case when step=1 then 0.01 else 0 end,
          'installments',6,'installments_paid',declared,'installment_cents',10000),v,'{}',gen_random_uuid());
      assert (select calculation_mode from public.debts where id=d)=target;
    end loop;
  end loop;
  perform public.pay_debt_installment(d,10000,a,current_date);
  select to_jsonb(t),edit_revision into before_debt,v from public.debts t where id=d;
  foreach patch in array array[
    '{"calculation_mode":"amortized"}'::jsonb,
    '{"calculation_mode":"amortized","principal_cents":60000}'::jsonb,
    '{"remaining_cents":12345}'::jsonb,'{"interest_rate_monthly":0.02}'::jsonb] loop
    begin
      perform public.update_debt_contract_scoped(d,4,'all',patch,v,'{}',gen_random_uuid());
      assert false,'all cannot silently revise principal/balance/interest history';
    exception when raise_exception then
      assert sqlerrm=case when patch ? 'calculation_mode' then
        'Para alterar o modo com pagamentos registrados, aplique às próximas parcelas; Todas exige revisão do histórico'
        else 'Saldo, principal e juros com pagamentos registrados exigem revisão do histórico; não foram alterados' end;
    end;
    assert (select to_jsonb(t) from public.debts t where id=d)=before_debt;
  end loop;
  foreach patch in array array['{"calculation_mode":"other"}'::jsonb,
    '{"calculation_mode":null}'::jsonb,'{"calculation_mode":42}'::jsonb] loop
    begin
      perform public.update_debt_contract_scoped(d,4,'future',patch,v,'{}',gen_random_uuid());
      assert false,'invalid enum must refuse';
    exception when raise_exception then assert sqlerrm='Modo de cálculo inválido'; end;
  end loop;
  begin
    perform public.update_debt_contract_scoped(d,4,'one','{"calculation_mode":"amortized"}',v,'{}',gen_random_uuid());
    assert false,'one cannot switch contract mode';
  exception when raise_exception then assert sqlerrm='Nesta parcela só é possível editar valor e vencimento'; end;
  begin
    perform public.update_debt_contract_scoped(d,4,'future',
      '{"calculation_mode":"amortized","installments_paid":0}',v,'{}',gen_random_uuid());
    assert false,'cannot make a recorded payment future by lowering paid count';
  exception when raise_exception then
    assert sqlerrm='As parcelas já pagas não podem ficar abaixo dos pagamentos registrados';
  end;
  begin
    perform public.update_debt_contract_scoped(d,4,'all','{"account_id":null}',v,'{}',gen_random_uuid());
    assert false,'all still requires exact payment versions';
  exception when raise_exception then assert sqlerrm='Outro pagamento mudou enquanto você editava'; end;
  begin
    perform public.update_debt_contract_scoped(d,4,'future',
      '{"calculation_mode":"amortized","remaining_cents":30000,"interest_rate_monthly":1,"installment_cents":100}',v,'{}',gen_random_uuid());
    assert false,'non-amortizing destination schedule must refuse';
  exception when raise_exception then assert sqlerrm='O valor não mantém o cronograma de parcelas com juros'; end;
  assert (select to_jsonb(t) from public.debts t where id=d)=before_debt;
  raise notice 'MS2: all declared roundtrip, actual-history refusal, enum, one, stale/reused request, schedule atomicity';
end $$;

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e2a1';
  w uuid := '00000000-0000-0000-0000-00000000e2b1';
  d uuid := gen_random_uuid();
  c uuid;
  a uuid;
  entry uuid;
  inv uuid;
  next_inv uuid;
  v bigint;
  before_entry jsonb;
  before_invoice jsonb;
  invoice_state text;
  scope text;
begin
  select id into a from public.accounts where workspace_id=w and name='Historical account';
  insert into public.debts(id,workspace_id,user_id,name,calculation_mode,
    principal_cents,remaining_cents,installment_cents,installments)
    values(d,w,u,'Destination math','fixed_installments',60000,60000,10000,6);
  select edit_revision into v from public.debts where id=d;
  perform public.update_debt_contract_scoped(d,1,'future',
    '{"calculation_mode":"amortized","principal_cents":65555,"remaining_cents":23456,"installment_cents":null,"interest_rate_monthly":0.02,"installments":5}',
    v,'{}',gen_random_uuid());
  assert (select principal_cents from public.debts where id=d)=65555;
  assert (select remaining_cents from public.debts where id=d)=23456;
  assert (select installment_cents from public.debts where id=d) is null;
  assert (select count(*) from public.debt_schedule(d))=5;
  assert (select payment_cents from public.debt_schedule(d) order by installment_no limit 1)=
    private.price_installment(23456,0.02,5);
  select edit_revision into v from public.debts where id=d;
  begin
    perform public.update_debt_contract_scoped(d,1,'future',
      '{"calculation_mode":"fixed_installments","installment_cents":5432,"installments":7,"interest_rate_monthly":0.02}',
      v,'{}',gen_random_uuid());
    assert false,'fixed must not silently accept an explicit nonzero rate';
  exception when check_violation then null; end;
  perform public.update_debt_contract_scoped(d,1,'future',
    '{"calculation_mode":"fixed_installments","installment_cents":5432,"installments":7}',v,'{}',gen_random_uuid());
  assert (select principal_cents from public.debts where id=d)=5432*7;
  assert (select remaining_cents from public.debts where id=d)=5432*7;
  assert (select interest_rate_monthly from public.debts where id=d)=0;

  -- Entry is a cash fact, not an amortization payment. Even an invoice already paid,
  -- rolled or partially paid remains entirely unchanged during a contract-only edit.
  foreach invoice_state in array array['paid','rolled','partial'] loop
    c := gen_random_uuid(); d := gen_random_uuid();
    insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents,payment_account_id)
      values(c,w,u,'Card '||c,'credit_card',5,12,500000,a);
    insert into public.debts(id,workspace_id,user_id,name,calculation_mode,
      principal_cents,remaining_cents,installment_cents,installments)
      values(d,w,u,'Invoice mode '||d,'fixed_installments',40000,40000,10000,4);
    entry := private.insert_purchase_down_payment('financiamento',d,
      jsonb_build_object('amount_cents',4321,'account_id',c,'occurred_at',current_date-20));
    select invoice_id into strict inv from public.transactions where id=entry;
    next_inv := null;
    if invoice_state='rolled' then
      insert into public.card_invoices(workspace_id,user_id,account_id,reference_month,closing_date,due_date)
        select workspace_id,user_id,account_id,(reference_month+interval '1 month')::date,
          (closing_date+interval '1 month')::date,(due_date+interval '1 month')::date
          from public.card_invoices where id=inv returning id into next_inv;
    end if;
    update public.card_invoices set status=case when invoice_state='partial' then 'open' else invoice_state end,
      paid_cents=case when invoice_state='partial' then 1 else 0 end,rolled_into_invoice_id=next_inv where id=inv;
    select to_jsonb(t) into before_entry from public.transactions t where id=entry;
    select to_jsonb(i) into before_invoice from public.card_invoices i where id=inv;
    foreach scope in array array['future','all'] loop
      select edit_revision into v from public.debts where id=d;
      perform public.update_debt_contract_scoped(d,1,scope,
        jsonb_build_object('calculation_mode',case when scope='future' then 'amortized' else 'fixed_installments' end),
        v,'{}',gen_random_uuid());
      assert (select to_jsonb(t) from public.transactions t where id=entry)=before_entry;
      assert (select to_jsonb(i) from public.card_invoices i where id=inv)=before_invoice;
    end loop;
  end loop;
  raise notice 'MS4: destination-specific amounts and Price null installment; entry invoice paid/rolled/partial immutable';
end $$;

-- Execute the RPC as authenticated, not the test runner owner: foreign workspace remains hidden.
do $$
declare u uuid := '00000000-0000-0000-0000-00000000e2a2';
  w uuid := '00000000-0000-0000-0000-00000000e2b2';
begin
  insert into auth.users(id,email) values(u,'debt-mode-foreign@example.invalid');
  insert into public.profiles(id) values(u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values(w,u,'Foreign mode fixture');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.debts(id,workspace_id,user_id,name,calculation_mode,
    principal_cents,remaining_cents,installment_cents,installments)
    values('00000000-0000-0000-0000-00000000e2d2',w,u,'Foreign','fixed_installments',40000,40000,10000,4);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000e2a1',true);
do $$ begin
  perform public.update_debt_contract_scoped(d.id,d.installments_paid+1,'future',
    '{"calculation_mode":"amortized"}',d.edit_revision,'{}',gen_random_uuid())
    from public.debts d where d.workspace_id='00000000-0000-0000-0000-00000000e2b1'
      and d.name='Destination math';
  assert (select calculation_mode from public.debts where name='Destination math')='amortized';
  begin
    perform public.update_debt_contract_scoped('00000000-0000-0000-0000-00000000e2d2',1,'future',
      '{"calculation_mode":"amortized"}',1,'{}',gen_random_uuid());
    assert false,'foreign workspace must refuse';
  exception when raise_exception then assert sqlerrm='Dívida ativa não encontrada'; end;
  raise notice 'MS3: authenticated RLS forbids another workspace';
end $$;
reset role;
rollback;
