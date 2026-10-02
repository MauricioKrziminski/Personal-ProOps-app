-- F01: metadata round trip, compatibility, neutral accounting and atomic fee ownership.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$ begin
  assert exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='transactions' and column_name='payment_method'),
    'F01 payment_method metadata is missing';
end $$;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000f101';
  w uuid := '00000000-0000-0000-0000-00000000f102';
  bank uuid := '00000000-0000-0000-0000-00000000f103';
  card uuid := '00000000-0000-0000-0000-00000000f104';
  wallet uuid := '00000000-0000-0000-0000-00000000f105';
  batch uuid; item uuid; other_ws uuid; foreign_account uuid;
  debt uuid; versions jsonb; debt_result jsonb;
  tx uuid; tx2 uuid; fee uuid; req uuid; revision bigint; parent_revision bigint; plan uuid; series uuid;
  first_date date:=current_date+30; start_date date;
  payload jsonb; result jsonb; replay jsonb; method text; before_count bigint;
begin
  insert into auth.users(id,email) values(u,'payment-methods@example.invalid');
  insert into public.profiles(id) values(u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values(w,u,'F01 payment methods QA',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type) values
    (bank,w,u,'F01 bank','checking'),(wallet,w,u,'F01 wallet','cash');
  insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents)
    values(card,w,u,'F01 card','credit_card',20,28,100000);
  -- Import staging insertion belongs to the service; approval runs as the app user below.
  insert into public.import_batches(user_id,workspace_id,source,account_id) values(u,w,'csv',bank) returning id into batch;
  insert into public.import_items(batch_id,workspace_id,kind,amount_cents,occurred_at,description,suggested_account_id,dedupe_hash,payment_method)
    values(batch,w,'expense',77,current_date,'F01 import Pix',bank,'f01-method-import','pix') returning id into item;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  -- Old clients can omit the field; adding metadata must not change the money.
  insert into public.transactions(user_id,kind,amount_cents,description,account_id,occurred_at)
    values(u,'expense',85,'Legacy',bank,current_date) returning id into tx;
  assert (select payment_method is null from public.transactions where id=tx);
  foreach method in array array['pix','credit','debit','cash','bank_transfer','boleto'] loop
    payload := jsonb_build_object('kind','expense','amount_cents',1000,'description',method,
      'account_id',case when method='credit' then card when method='cash' then wallet else bank end,
      'occurred_at',current_date,'payment_method',method);
    result := public.save_transaction_payment(null,payload,0,null,gen_random_uuid());
    assert (select payment_method from public.transactions where id=(result->>'id')::uuid)=method;
    assert (select amount_cents from public.transactions where id=(result->>'id')::uuid)=1000;
  end loop;
  update public.transactions set payment_method='pix' where id=tx;
  select edit_revision into revision from public.transactions where id=tx;
  result := public.save_transaction_payment(tx,'{"description":"Legacy edited"}',null,revision,gen_random_uuid());
  assert (select payment_method from public.transactions where id=tx)='pix','omission clears known method';
  select edit_revision into revision from public.transactions where id=tx;
  perform public.save_transaction_payment(tx,'{"payment_method":null}',null,revision,gen_random_uuid());
  assert (select payment_method is null from public.transactions where id=tx),'explicit null does not clear';
  -- Each Pix fee belongs to one purchase, even on the same card/date.
  payload := jsonb_build_object('kind','expense','amount_cents',1000,'description','Pix one',
    'account_id',card,'occurred_at',current_date,'payment_method','pix');
  req:=gen_random_uuid();
  result:=public.save_transaction_payment(null,payload,25,null,req);
  tx:=(result->>'id')::uuid; fee:=(result->>'fee_id')::uuid;
  select count(*) into before_count from public.transactions;
  replay:=public.save_transaction_payment(null,payload,25,null,req);
  assert replay=result and (select count(*) from public.transactions)=before_count,'retry duplicates purchase or fee';
  begin
    perform public.save_transaction_payment(null,payload,26,null,req);
    raise exception 'different payload accepted';
  exception when others then
    if sqlerrm='different payload accepted' then raise; end if;
    assert sqlerrm like '%dados diferentes%',sqlerrm;
  end;
  result:=public.save_transaction_payment(null,payload||'{"description":"Pix two"}',40,null,gen_random_uuid());
  tx2:=(result->>'id')::uuid;
  assert (select pix_fee_for_transaction_id from public.transactions where id=fee)=tx;
  assert (select count(*) from public.transactions where pix_fee_for_transaction_id in(tx,tx2))=2;
  select edit_revision into revision from public.transactions where id=tx;
  perform public.save_transaction_payment(tx,'{"amount_cents":1200}',30,revision,gen_random_uuid());
  assert (select amount_cents from public.transactions where id=fee)=30;
  assert (select amount_cents from public.transactions where pix_fee_for_transaction_id=tx2)=40;
  select edit_revision into revision from public.transactions where id=tx;
  begin
    perform public.save_transaction_payment(tx,jsonb_build_object('payment_method','debit','account_id',card),35,revision,gen_random_uuid());
    raise exception 'incompatible debit accepted';
  exception when others then
    if sqlerrm='incompatible debit accepted' then raise; end if;
  end;
  assert (select amount_cents from public.transactions where id=fee)=30,'failed edit partially saved fee';
  assert (select payment_method from public.transactions where id=tx)='pix';
  -- Clearing/removing the fee does not touch another purchase.
  perform public.save_transaction_payment(tx,'{}',0,revision,gen_random_uuid());
  assert not exists(select 1 from public.transactions where id=fee);
  assert (select count(*) from public.transactions where pix_fee_for_transaction_id=tx2)=1;
  -- Canonical creation, independently funded entry, final-cent split, and structural replay.
  payload:=jsonb_build_object('p_account_id',card,'p_total_cents',1001,'p_installments',3,
    'p_paid_installments',0,'p_occurred_at',first_date,'p_description','F01 purchase',
    'p_payment_method','credit','down_payment',jsonb_build_object('amount_cents',200,
      'account_id',bank,'occurred_at',current_date,'payment_method','pix'));
  result:=public.create_purchase('parcelada',payload,null,gen_random_uuid());
  plan:=(result->'ids'->>0)::uuid;
  assert (select payment_method from public.installment_plans where id=plan)='credit','canonical purchase lost method';
  assert (select count(*) from public.transactions where installment_plan_id=plan and payment_method='credit')=3;
  assert (select sum(amount_cents) from public.transactions where installment_plan_id=plan)=1001;
  assert (select payment_method from public.transactions where down_payment_plan_id=plan)='pix','entry inherited financed method';
  select edit_revision into revision from public.installment_plans where id=plan;
  payload:=jsonb_build_object('p_plan_id',plan,'p_total_cents',1001,'p_installments',3,
    'p_first_occurred_at',first_date,'p_description','F01 purchase edited','p_account_id',card,
    'p_payment_method','pix','p_expected_revision',revision,'p_request_id',gen_random_uuid());
  perform public.update_installment_plan_payment(payload);
  perform public.update_installment_plan_payment(payload);
  assert (select payment_method from public.installment_plans where id=plan)='pix';
  assert (select count(*) from public.transactions where installment_plan_id=plan and payment_method='pix')=3;
  select id into tx from public.transactions where installment_plan_id=plan and installment_no=2;
  select edit_revision into parent_revision from public.installment_plans where id=plan;
  perform public.update_installment_scope(tx,'one','{"payment_method":"credit"}');
  assert (select edit_revision from public.installment_plans where id=plan)>parent_revision,'one method edit did not invalidate plan editor';
  begin
    perform public.update_installment_plan_payment(payload||jsonb_build_object('p_expected_revision',parent_revision,'p_request_id',gen_random_uuid()));
    raise exception 'stale plan overwrote occurrence method';
  exception when others then
    if sqlerrm='stale plan overwrote occurrence method' then raise; end if;
    assert sqlerrm like '%mudou enquanto%',sqlerrm;
  end;
  assert (select payment_method from public.transactions where id=tx)='credit';
  assert (select payment_method from public.installment_plans where id=plan)='pix','one changed contract default';
  perform public.update_installment_scope(tx,'future','{"payment_method":null}');
  assert (select count(*) from public.transactions where installment_plan_id=plan and installment_no>=2 and payment_method is null)=2;
  assert (select payment_method from public.transactions where installment_plan_id=plan and installment_no=1)='pix';
  -- Recurrence request replay and all/one/future metadata use the real existing scopes.
  start_date:=(date_trunc('month',current_date)+interval '2 months')::date+3;
  payload:=jsonb_build_object('kind','expense','amount_cents',1000,'description','F01 recurrence',
    'account_id',bank,'rrule','FREQ=MONTHLY;BYMONTHDAY=4','next_run_at',start_date,
    'dtstart',start_date,'end_date',null,'auto_confirm',false,'payment_method','boleto');
  req:=gen_random_uuid(); result:=public.create_recurring_payment(payload,req);
  replay:=public.create_recurring_payment(payload,req); assert replay=result,'recurring retry duplicated';
  series:=(result->>'id')::uuid;
  assert (select payment_method from public.recurring_transactions where id=series)='boleto';
  assert (select payment_method from public.ledger_expected_lines_payment(start_date,start_date,series))='boleto';
  tx:=public.materialize_recurring_occurrence(series,start_date);
  assert (select payment_method from public.transactions where id=tx)='boleto';
  select edit_revision into revision from public.transactions where id=tx;
  select edit_revision into parent_revision from public.recurring_transactions where id=series;
  perform public.update_recurring_one(tx,'{"payment_method":"pix"}',revision,gen_random_uuid());
  assert (select edit_revision from public.recurring_transactions where id=series)>parent_revision,'one method edit did not invalidate series editor';
  begin
    perform public.update_recurring_all(series,'{}','{"payment_method":"boleto"}',parent_revision,gen_random_uuid());
    raise exception 'stale all overwrote occurrence method';
  exception when others then
    if sqlerrm='stale all overwrote occurrence method' then raise; end if;
    assert sqlerrm like '%mudou enquanto%',sqlerrm;
  end;
  assert (select payment_method from public.transactions where id=tx)='pix';
  assert (select payment_method from public.recurring_transactions where id=series)='boleto';
  select edit_revision into revision from public.recurring_transactions where id=series;
  perform public.update_recurring_all(series,'{}','{"payment_method":"bank_transfer"}',revision,gen_random_uuid());
  assert (select payment_method from public.recurring_transactions where id=series)='bank_transfer';
  assert (select payment_method from public.transactions where id=tx)='bank_transfer';
  select edit_revision into revision from public.recurring_transactions where id=series;
  req:=gen_random_uuid();
  perform public.update_recurring_future(tx,series,'{"payment_method":null}','{"payment_method":null}',revision,req);
  perform public.update_recurring_future(tx,series,'{"payment_method":null}','{"payment_method":null}',revision,req);
  assert (select payment_method is null from public.transactions where id=tx);
  assert (select payment_method is null from public.recurring_transactions where id=series);
  -- Method-only history edits split the version without rewriting its calendar or past.
  payload:=jsonb_build_object('kind','expense','amount_cents',900,'description','F01 versioned',
    'account_id',bank,'rrule','FREQ=MONTHLY;BYMONTHDAY=4','next_run_at',start_date,
    'dtstart',current_date-40,'end_date',null,'auto_confirm',false,'payment_method','boleto');
  result:=public.create_recurring_payment(payload,gen_random_uuid()); series:=(result->>'id')::uuid;
  update public.recurring_transactions set payment_method='pix' where id=series;
  assert private.payment_method_at(series,current_date-1)='boleto','method edit rewrote history';
  assert private.payment_method_at(series,current_date+1)='pix','current method version missing';
  assert (select count(distinct rrule) from private.recurring_history_versions where recurring_id=series)=1;
  -- Rebuilding financial history without method must retain its separate temporal map.
  select edit_revision into revision from public.recurring_transactions where id=series;
  perform public.update_recurring_all(series,'{}','{"description":"F01 renamed","amount_cents":950}',revision,gen_random_uuid());
  assert private.payment_method_at(series,current_date-1)='boleto','all title/amount omission erased old method';
  assert private.payment_method_at(series,current_date+1)='pix','all title/amount omission erased current method';
  select edit_revision into revision from public.recurring_transactions where id=series;
  perform public.update_recurring_all(series,'{}',jsonb_build_object('rrule','FREQ=MONTHLY;BYMONTHDAY=6',
    'next_run_at',private.day_in_month(start_date,6)),revision,gen_random_uuid());
  assert private.payment_method_at(series,current_date-1)='boleto','all calendar omission erased old method';
  assert private.payment_method_at(series,current_date+1)='pix','all calendar omission erased current method';
  select min(due_date) into start_date from public.ledger_expected_lines_payment(current_date-40,current_date-1,series);
  assert start_date is not null,'past projection fixture must contain an occurrence';
  assert (select payment_method from public.ledger_expected_lines_payment(start_date,start_date,series))='boleto','real past projection lost method';
  update public.recurring_transactions set description='F01 raw renamed',amount_cents=960 where id=series;
  assert private.payment_method_at(series,current_date-1)='boleto','raw update omission erased old method';
  assert private.payment_method_at(series,current_date+1)='pix','raw update omission erased current method';
  -- Conversion adopts the source id and preserves old-client omitted metadata.
  result:=public.save_transaction_payment(null,jsonb_build_object('kind','expense','amount_cents',1200,
    'description','F01 convert','account_id',bank,'occurred_at',current_date,'payment_method','boleto'),0,null,gen_random_uuid());
  tx:=(result->>'id')::uuid;
  payload:=jsonb_build_object('p_account_id',bank,'p_total_cents',1200,'p_installments',3,
    'p_paid_installments',0,'p_occurred_at',current_date,'p_description','F01 converted');
  result:=public.converter_registro(jsonb_build_object('tipo','transacao','id',tx),'converter',
    jsonb_build_object('tipo','parcelada','dados',payload),gen_random_uuid());
  plan:=(result->'ids'->>0)::uuid;
  assert (select installment_plan_id from public.transactions where id=tx)=plan;
  assert (select payment_method from public.installment_plans where id=plan)='boleto';
  -- Simulation accepts exactly the canonical methods while leaving no rows behind.
  select count(*) into before_count from public.transactions;
  result:=public.simular(jsonb_build_array(jsonb_build_object('tipo','parcelada','dados',payload||'{"p_payment_method":"boleto"}')), '{}'::jsonb);
  assert jsonb_array_length(result->'erros')=0,result::text;
  assert (select count(*) from public.transactions)=before_count,'simulation left persisted rows';
  -- Explicitly owned fee in the canonical simulated/converted shape.
  payload:=jsonb_build_object('linhas',jsonb_build_array(jsonb_build_object('kind','expense','amount_cents',2000,
    'description','F01 canonical Pix','account_id',card,'occurred_at',current_date,'status','cleared','payment_method','pix')),'fee_cents',75);
  result:=private.criar_registro_da_hipotese('lancamento',payload);
  tx:=(result->'ids'->>0)::uuid;
  assert (select count(*) from public.transactions where pix_fee_for_transaction_id=tx and amount_cents=75)=1,'canonical fee has no owner';
  -- A linked fee edited/deleted outside the compound form invalidates its parent editor.
  payload:=jsonb_build_object('kind','expense','amount_cents',300,'description','F01 fee revisions',
    'account_id',card,'occurred_at',current_date,'payment_method','pix');
  req:=gen_random_uuid(); result:=public.save_transaction_payment(null,payload,5,null,req);
  tx:=(result->>'id')::uuid; fee:=(result->>'fee_id')::uuid; revision:=(result->>'revision')::bigint;
  assert (select edit_revision from public.transactions where id=tx)=revision,'save returned pre-fee revision';
  update public.transactions set amount_cents=6 where id=fee;
  assert (select edit_revision from public.transactions where id=tx)>revision,'raw fee update did not invalidate parent';
  begin
    perform public.save_transaction_payment(tx,'{}',5,revision,gen_random_uuid());
    raise exception 'stale parent overwrote externally edited fee';
  exception when others then
    if sqlerrm='stale parent overwrote externally edited fee' then raise; end if;
    assert sqlerrm like '%mudou enquanto%',sqlerrm;
  end;
  assert public.save_transaction_payment(null,payload,5,null,req)=result,'confirmed replay changed after fee edit';
  assert (select amount_cents from public.transactions where id=fee)=6;
  select edit_revision into revision from public.transactions where id=tx;
  delete from public.transactions where id=fee;
  assert (select edit_revision from public.transactions where id=tx)>revision,'raw fee deletion did not invalidate parent';
  begin
    perform public.save_transaction_payment(tx,'{}',5,revision,gen_random_uuid());
    raise exception 'stale parent recreated externally deleted fee';
  exception when others then
    if sqlerrm='stale parent recreated externally deleted fee' then raise; end if;
    assert sqlerrm like '%mudou enquanto%',sqlerrm;
  end;
  assert public.save_transaction_payment(null,payload,5,null,req)=result;
  assert not exists(select 1 from public.transactions where pix_fee_for_transaction_id=tx),'replay recreated deleted fee';
  select edit_revision into revision from public.transactions where id=tx;
  result:=public.save_transaction_payment(tx,'{}',9,revision,gen_random_uuid());
  assert (select edit_revision from public.transactions where id=tx)=(result->>'revision')::bigint;
  delete from public.transactions where id=tx;
  assert not exists(select 1 from public.transactions where pix_fee_for_transaction_id=tx),'parent cascade left fee';
  -- Card income continues using existing accounting; method must not turn it into expense.
  result:=public.save_transaction_payment(null,jsonb_build_object('kind','income','amount_cents',50,
    'description','F01 refund','account_id',card,'occurred_at',current_date,'payment_method','credit'),0,null,gen_random_uuid());
  assert (select kind from public.transactions where id=(result->>'id')::uuid)='income';
  assert (select invoice_id is not null from public.transactions where id=(result->>'id')::uuid);
  -- Debt method edits retain cash arithmetic and respect numbered one/future/all scopes.
  insert into public.debts(user_id,name,kind,principal_cents,remaining_cents,interest_rate_monthly,
    installments,installments_paid,installment_cents,calculation_mode,account_id,due_day,first_due_date,payment_method)
    values(u,'F01 debt','loan',3000,3000,0,3,0,1000,'fixed_installments',bank,10,current_date+10,'boleto') returning id into debt;
  select edit_revision into revision from public.debts where id=debt;
  req:=gen_random_uuid();
  debt_result:=public.update_debt_contract_scoped(debt,1,'one','{"payment_method":"pix"}',revision,'{}',req);
  assert public.update_debt_contract_scoped(debt,1,'one','{"payment_method":"pix"}',revision,'{}',req)=debt_result;
  begin
    perform public.update_debt_contract_scoped(debt,1,'one','{"due_date":"2026-12-10"}',revision,'{}',req);
    raise exception 'omitting method reused a committed request';
  exception when others then
    if sqlerrm='omitting method reused a committed request' then raise; end if;
    assert sqlerrm like '%dados diferentes%',sqlerrm;
  end;
  assert (select payment_method from public.ledger_expected_lines_payment(current_date,current_date+60) where origin='debt_schedule' and ref_id=debt and installment_no=1)='pix';
  assert (select payment_method from public.debts where id=debt)='boleto';
  perform public.pay_debt_installment(debt,1000,bank,current_date);
  select id into tx from public.transactions where debt_id=debt and debt_payment_no=1;
  assert (select payment_method from public.transactions where id=tx)='pix';
  assert (select remaining_cents from public.debts where id=debt)=2000;
  select edit_revision into revision from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,2,'future','{"payment_method":"debit"}',revision,'{}',gen_random_uuid());
  assert (select payment_method from public.transactions where id=tx)='pix';
  assert (select payment_method from public.debts where id=debt)='debit';
  select edit_revision into revision from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,2,'one','{"payment_method":null}',revision,'{}',gen_random_uuid());
  assert (select payment_method is null from public.ledger_expected_lines_payment(current_date,current_date+60) where origin='debt_schedule' and ref_id=debt and installment_no=2);
  -- An omitted method during a money edit must preserve that explicit unknown override.
  select edit_revision into revision from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,2,'future','{"installment_cents":1000}',revision,'{}',gen_random_uuid());
  assert private.debt_payment_method_at(debt,2) is null;
  select jsonb_object_agg(id::text,edit_revision) into versions from public.transactions where debt_id=debt;
  select edit_revision into revision from public.debts where id=debt;
  select edit_revision into before_count from public.transactions where id=tx;
  req:=gen_random_uuid();
  debt_result:=public.update_debt_payment_scoped(tx,'all','{"payment_method":null}',revision,before_count,versions,req);
  assert public.update_debt_payment_scoped(tx,'all','{"payment_method":null}',revision,before_count,versions,req)=debt_result;
  assert (select payment_method is null from public.transactions where id=tx);
  assert (select payment_method is null from public.debts where id=debt);
  assert (select remaining_cents from public.debts where id=debt)=2000;
  -- Import known metadata travels through the real approval RPC; unknown never erases it.
  perform public.approve_import_items(array[item]);
  select transaction_id into tx from public.import_items where id=item;
  assert (select payment_method from public.transactions where id=tx)='pix';
  update public.import_items set payment_method=null where id=item;
  assert (select payment_method from public.transactions where id=tx)='pix';
  assert (select dedupe_hash from public.import_items where id=item)='f01-method-import';
  -- Explicit own-transfer metadata never changes the existing neutral transfer kind.
  result:=public.save_transaction_payment(null,jsonb_build_object('kind','transfer','amount_cents',50,
    'description','F01 transfer','account_id',card,'counterparty_account_id',bank,'occurred_at',current_date,'payment_method','pix'),0,null,gen_random_uuid());
  assert (select kind from public.transactions where id=(result->>'id')::uuid)='transfer';
  assert (select payment_method from public.transactions where id=(result->>'id')::uuid)='pix';
  -- Even a workspace member cannot use an account from another workspace as the source.
  insert into public.workspaces(owner_id,name) values(u,'F01 other workspace') returning id into other_ws;
  insert into public.workspace_members(workspace_id,user_id,role) values(other_ws,u,'owner') on conflict do nothing;
  insert into public.accounts(user_id,workspace_id,name,type) values(u,other_ws,'F01 other bank','checking') returning id into foreign_account;
  begin
    perform public.save_transaction_payment(null,jsonb_build_object('kind','expense','amount_cents',50,
      'description','F01 forbidden origin','account_id',foreign_account,'occurred_at',current_date,'payment_method','pix'),0,null,gen_random_uuid());
    raise exception 'cross workspace source accepted';
  exception when others then
    if sqlerrm='cross workspace source accepted' then raise; end if;
    assert sqlerrm like '%workspace%',sqlerrm;
  end;
  -- Deferred compatibility sees final rows, including direct legacy-client writes.
  begin
    insert into public.transactions(user_id,kind,amount_cents,description,account_id,occurred_at,payment_method)
      values(u,'expense',10,'F01 incompatible',bank,current_date,'credit');
    set constraints all immediate;
    raise exception 'raw incompatible method accepted';
  exception when others then
    if sqlerrm='raw incompatible method accepted' then raise; end if;
    assert sqlerrm like '%cartão%',sqlerrm;
  end;
  set constraints all immediate;
end $$;
rollback;
