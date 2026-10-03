-- F06 canonical writers: atomic snapshots, per-dimension scopes, CAS and replays.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$
declare
  u uuid:='00000000-0000-0000-0000-00000000f611';
  w uuid:='00000000-0000-0000-0000-00000000f612';
  bank uuid:='00000000-0000-0000-0000-00000000f613';
  card uuid:='00000000-0000-0000-0000-00000000f614';
  tx uuid;tx2 uuid;series uuid;plan uuid;debt uuid;req uuid;
  result jsonb;payload jsonb;patch jsonb;c jsonb;rev bigint;parent_rev bigint;n bigint;versions jsonb;history_locations text[];
  start_date date:=current_date+45;
  fixed_essential jsonb:='{"expense_pattern":"fixed","expense_pattern_source":"explicit","expense_necessity":"essential","expense_necessity_source":"category_default"}';
  unknown_pattern jsonb:='{"expense_pattern":null,"expense_pattern_source":"explicit"}';
begin
  insert into auth.users(id,email) values(u,'classification-writes@example.invalid');
  insert into public.profiles(id) values(u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values(w,u,'F06 writer QA',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type) values(bank,w,u,'F06 writer bank','checking');
  insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents)
    values(card,w,u,'F06 writer card','credit_card',20,28,100000);
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  payload:=jsonb_build_object('kind','expense','amount_cents',125,'description','F06 canonical',
    'account_id',bank,'occurred_at',current_date,'payment_method','boleto')||fixed_essential;
  req:=gen_random_uuid();result:=public.save_transaction_payment(null,payload,0,null,req);tx:=(result->>'id')::uuid;
  assert (select expense_pattern='fixed' and expense_necessity='essential' from public.transactions where id=tx),
    'canonical transaction writer lost class snapshot';
  select count(*) into n from public.transactions;
  assert public.save_transaction_payment(null,payload,0,null,req)=result;
  assert (select count(*) from public.transactions)=n,'replay duplicated classified transaction';
  begin
    perform public.save_transaction_payment(null,payload||unknown_pattern,0,null,req);
    raise exception 'different classification replay accepted';
  exception when others then
    if sqlerrm='different classification replay accepted' then raise;end if;
    assert sqlerrm like '%dados diferentes%',sqlerrm;
  end;
  rev:=(result->>'revision')::bigint;
  result:=public.save_transaction_payment(tx,unknown_pattern,0,rev,gen_random_uuid());
  assert (select expense_pattern is null and expense_pattern_source='explicit' and expense_necessity='essential'
    from public.transactions where id=tx),'transaction dimension patch erased another dimension';
  begin
    perform public.save_transaction_payment(tx,fixed_essential,0,rev,gen_random_uuid());
    raise exception 'stale classified transaction accepted';
  exception when others then
    if sqlerrm='stale classified transaction accepted' then raise;end if;
    assert sqlerrm like '%mudou enquanto%',sqlerrm;
  end;
  result:=public.save_transaction_payment(null,payload||jsonb_build_object('account_id',card,'payment_method','pix'),25,null,gen_random_uuid());
  assert (select expense_pattern is null and expense_pattern_source is null and expense_necessity is null
    from public.transactions where id=(result->>'fee_id')::uuid),'Pix fee inherited purchase classification';

  payload:=jsonb_build_object('kind','expense','amount_cents',300,'description','F06 series',
    'account_id',bank,'rrule','FREQ=MONTHLY;BYMONTHDAY=15','next_run_at',start_date,
    'dtstart',current_date-60,'end_date',null,'auto_confirm',false,'payment_method','boleto')||fixed_essential;
  result:=public.create_recurring_payment(payload,gen_random_uuid());series:=(result->>'id')::uuid;
  assert private.recurring_expense_classification_at(series,current_date-1)->>'expense_pattern'='fixed';
  insert into public.transactions(user_id,kind,amount_cents,description,account_id,occurred_at,recurring_id,status)
    values(u,'expense',300,'F06 one',bank,start_date,series,'pending') returning id into tx;
  select edit_revision into rev from public.transactions where id=tx;
  select edit_revision into parent_rev from public.recurring_transactions where id=series;
  select array_agg(ctid::text order by valid_from) into history_locations
    from private.recurring_history_versions where recurring_id=series;
  req:=gen_random_uuid();perform public.update_recurring_one(tx,unknown_pattern,rev,req);
  perform public.update_recurring_one(tx,unknown_pattern,rev,req);
  assert (select expense_pattern is null and expense_pattern_source='explicit' and expense_necessity='essential'
    from public.transactions where id=tx);
  assert (select expense_pattern='fixed' from public.recurring_transactions where id=series),'one changed recurrence contract';
  -- Tuple locations are inspected only by this rollback test, never used as app identifiers.
  -- One occurrence must not rewrite the rule's historical rows just to advance its revision.
  assert (select array_agg(ctid::text order by valid_from) from private.recurring_history_versions where recurring_id=series)=history_locations,
    'class-only occurrence edit unnecessarily rewrote recurring history';
  assert (select edit_revision from public.recurring_transactions where id=series)>parent_rev,
    'class-only occurrence edit did not invalidate recurrence editor';
  begin
    perform public.update_recurring_all(series,'{}',unknown_pattern,parent_rev,gen_random_uuid());
    raise exception 'stale recurrence overwrote class override';
  exception when others then
    if sqlerrm='stale recurrence overwrote class override' then raise;end if;
    assert sqlerrm like '%mudou enquanto%',sqlerrm;
  end;
  select edit_revision into parent_rev from public.recurring_transactions where id=series;
  patch:='{"expense_necessity":"discretionary","expense_necessity_source":"explicit"}';
  perform public.update_recurring_future(tx,series,patch,patch,parent_rev,gen_random_uuid());
  assert (select expense_pattern is null and expense_pattern_source='explicit' and expense_necessity='discretionary'
    from public.transactions where id=tx),'future necessity override erased line pattern';
  assert private.recurring_expense_classification_at(series,current_date-1)->>'expense_necessity'='essential';
  assert private.recurring_expense_classification_at(series,start_date)->>'expense_necessity'='discretionary';
  select edit_revision into parent_rev from public.recurring_transactions where id=series;
  perform public.update_recurring_all(series,'{}','{"description":"F06 title only"}',parent_rev,gen_random_uuid());
  assert private.recurring_expense_classification_at(series,current_date-1)->>'expense_necessity'='essential';
  assert private.recurring_expense_classification_at(series,start_date)->>'expense_necessity'='discretionary';

  payload:=jsonb_build_object('p_account_id',bank,'p_total_cents',901,'p_installments',3,
    'p_paid_installments',0,'p_occurred_at',start_date,'p_description','F06 purchase',
    'p_payment_method','boleto','down_payment',jsonb_build_object('amount_cents',200,
      'account_id',bank,'occurred_at',current_date,'payment_method','pix'))||fixed_essential;
  result:=public.create_purchase('parcelada',payload,null,gen_random_uuid());plan:=(result->'ids'->>0)::uuid;
  assert (select expense_pattern='fixed' and expense_necessity='essential' from public.installment_plans where id=plan);
  assert (select count(*) from public.transactions where installment_plan_id=plan and expense_pattern='fixed')=3;
  assert (select expense_pattern='fixed' and expense_necessity='essential' from public.transactions where down_payment_plan_id=plan),
    'entry did not receive purchase classification snapshot';
  select id,edit_revision into tx,rev from public.transactions where installment_plan_id=plan and installment_no=2;
  select edit_revision into parent_rev from public.installment_plans where id=plan;
  req:=gen_random_uuid();perform public.update_installment_scope_checked(tx,'one',unknown_pattern,parent_rev,rev,req,false);
  perform public.update_installment_scope_checked(tx,'one',unknown_pattern,parent_rev,rev,req,false);
  assert (select expense_pattern is null and expense_pattern_source='explicit' and expense_necessity='essential'
    from public.transactions where id=tx);
  assert (select expense_pattern='fixed' from public.installment_plans where id=plan);
  assert (select edit_revision from public.installment_plans where id=plan)>parent_rev;
  begin
    perform public.update_installment_scope_checked(tx,'all',fixed_essential,parent_rev,rev,gen_random_uuid(),false);
    raise exception 'stale plan overwrote class override';
  exception when others then
    if sqlerrm='stale plan overwrote class override' then raise;end if;
    assert sqlerrm like '%mudou enquanto%',sqlerrm;
  end;
  select edit_revision into parent_rev from public.installment_plans where id=plan;
  payload:=jsonb_build_object('p_plan_id',plan,'p_total_cents',901,'p_installments',3,'p_first_occurred_at',start_date,
    'p_description','F06 rebuilt title','p_account_id',bank,'p_expected_revision',parent_rev,'p_request_id',gen_random_uuid());
  perform public.update_installment_plan_payment(payload);
  assert (select expense_pattern is null and expense_pattern_source='explicit' and expense_necessity='essential'
    from public.transactions where installment_plan_id=plan and installment_no=2),
    'purchase financial rebuild lost numbered metadata override';
  assert (select sum(amount_cents) from public.transactions where installment_plan_id=plan)=901;

  payload:=jsonb_build_object('name','F06 finance','kind','loan','principal_cents',600,'remaining_cents',600,
    'account_id',bank,'installments',3,'installments_paid',0,'installment_cents',200,
    'first_due_date',start_date,'due_day',extract(day from start_date),'interest_rate_monthly',0,
    'calculation_mode','fixed_installments','payment_method','boleto')||fixed_essential;
  result:=public.create_purchase('financiamento',payload,null,gen_random_uuid());debt:=(result->'ids'->>0)::uuid;
  assert (select expense_pattern='fixed' and expense_necessity='essential' from public.debts where id=debt);
  select edit_revision into parent_rev from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,1,'one',unknown_pattern,parent_rev,'{}',gen_random_uuid());
  assert private.debt_expense_classification_at(debt,1)->'expense_pattern'='null'::jsonb;
  assert private.debt_expense_classification_at(debt,2)->>'expense_pattern'='fixed';
  select edit_revision into parent_rev from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,1,'future',patch,parent_rev,'{}',gen_random_uuid());
  assert private.debt_expense_classification_at(debt,1)->'expense_pattern'='null'::jsonb,
    'necessity propagation deleted numbered pattern override';
  assert private.debt_expense_classification_at(debt,2)->>'expense_necessity'='discretionary';
  select edit_revision into parent_rev from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,1,'future','{"name":"F06 finance title"}',parent_rev,'{}',gen_random_uuid());
  assert private.debt_expense_classification_at(debt,1)->'expense_pattern'='null'::jsonb,
    'legacy financial edit deleted classification exception';
  assert private.debt_expense_classification_at(debt,1)->>'expense_necessity'='discretionary';
  -- Removing the last metadata-only flag must delete the exception atomically, without
  -- violating the incumbent row check in an intermediate UPDATE.
  select edit_revision into parent_rev from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,1,'all',unknown_pattern,parent_rev,'{}',gen_random_uuid());
  assert not exists(select 1 from public.debt_installment_edits where debt_id=debt and expense_pattern_set);
  select edit_revision into parent_rev from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,1,'one','{"payment_method":"pix"}',parent_rev,'{}',gen_random_uuid());
  select edit_revision into parent_rev from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,1,'all','{"payment_method":"boleto"}',parent_rev,'{}',gen_random_uuid());
  assert not exists(select 1 from public.debt_installment_edits where debt_id=debt and payment_method_set);

  payload:=payload||jsonb_build_object('name','F06 past metadata');
  result:=public.create_purchase('financiamento',payload,null,gen_random_uuid());debt:=(result->'ids'->>0)::uuid;
  select edit_revision into parent_rev from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,1,'one',unknown_pattern,parent_rev,'{}',gen_random_uuid());
  perform public.pay_debt_installment(debt,200,bank,current_date);
  select edit_revision into parent_rev from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,2,'future','{"payment_method":"pix"}',parent_rev,'{}',gen_random_uuid());
  assert private.debt_payment_method_at(debt,1)='boleto','payment default change skipped freeze on class-only past row';
  assert private.debt_payment_method_at(debt,2)='pix';
  assert private.debt_expense_classification_at(debt,1)->'expense_pattern'='null'::jsonb;
  select id,edit_revision into tx,rev from public.transactions where debt_id=debt and debt_payment_no=1;
  select edit_revision into parent_rev from public.debts where id=debt;
  versions:=jsonb_build_object(tx::text,rev);req:=gen_random_uuid();
  result:=public.update_debt_payment_scoped(tx,'one',patch,parent_rev,rev,versions,req);
  assert public.update_debt_payment_scoped(tx,'one',patch,parent_rev,rev,versions,req)=result;
  assert (select expense_pattern is null and expense_pattern_source='explicit' and expense_necessity='discretionary'
    from public.transactions where id=tx),'paid one dimension edit changed unrelated snapshot';
  assert (select expense_necessity='essential' from public.debts where id=debt),'paid one changed future contract';
  begin
    perform public.update_debt_payment_scoped(tx,'one',fixed_essential,parent_rev,rev,versions,gen_random_uuid());
    raise exception 'stale debt payment class accepted';
  exception when others then
    if sqlerrm='stale debt payment class accepted' then raise;end if;
    assert sqlerrm like '%mudou enquanto%',sqlerrm;
  end;
  -- Legacy conversion adopts proven source metadata when the destination omits a dimension.
  payload:=jsonb_build_object('kind','expense','amount_cents',1200,'description','F06 convert',
    'account_id',bank,'occurred_at',current_date,'payment_method','boleto')||fixed_essential;
  result:=public.save_transaction_payment(null,payload,0,null,gen_random_uuid());tx:=(result->>'id')::uuid;
  payload:=jsonb_build_object('p_account_id',bank,'p_total_cents',1200,'p_installments',3,
    'p_paid_installments',0,'p_occurred_at',current_date,'p_description','F06 converted');
  result:=public.converter_registro(jsonb_build_object('tipo','transacao','id',tx),'converter',
    jsonb_build_object('tipo','parcelada','dados',payload),gen_random_uuid());plan:=(result->'ids'->>0)::uuid;
  assert (select expense_pattern='fixed' and expense_necessity='essential' from public.installment_plans where id=plan),
    'conversion omitted source classification snapshot';
  assert (select count(*) from public.transactions where installment_plan_id=plan and expense_pattern='fixed')=3;
  assert (select installment_plan_id=plan from public.transactions where id=tx),'conversion lost adopted source ID';
  payload:=jsonb_build_object('kind','expense','amount_cents',350,'description','F06 kind conversion',
    'account_id',bank,'occurred_at',current_date,'payment_method','boleto')||fixed_essential;
  result:=public.save_transaction_payment(null,payload,0,null,gen_random_uuid());tx:=(result->>'id')::uuid;
  payload:=jsonb_build_object('kind','income','amount_cents',350,'description','F06 income series',
    'account_id',bank,'rrule','FREQ=MONTHLY;BYMONTHDAY=15','next_run_at',start_date,
    'dtstart',start_date,'end_date',null,'auto_confirm',false);
  result:=public.converter_registro(jsonb_build_object('tipo','transacao','id',tx),'converter',
    jsonb_build_object('tipo','recorrente','dados',payload),gen_random_uuid());
  assert (select kind='income' and expense_pattern is null and expense_pattern_source is null
    and expense_necessity is null and expense_necessity_source is null from public.recurring_transactions
    where id=(result->'ids'->>0)::uuid),'income recurrence inherited source expense metadata';
  assert (select kind='income' and expense_pattern is null and expense_pattern_source is null
    and expense_necessity is null and expense_necessity_source is null from public.transactions where id=tx);
  -- New expected-line reader uses the same historical proof as materialization.
  select * into c from (select to_jsonb(l) c from public.ledger_expected_lines_classified(
    current_date-60,current_date-1,series) l limit 1) x;
  assert c->>'expense_pattern'='fixed' and c->>'expense_necessity'='essential',
    'expected consumption lost dated classification';
  raise notice 'F06 writers: canonical creation, scopes, replay, CAS, conversion and neutral money passed';
end $$;
rollback;
