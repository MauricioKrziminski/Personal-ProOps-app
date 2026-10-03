-- F09 financial snapshots and atomic intent. Dedicated fixtures; every effect rolls back.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$
declare
  u uuid:='00000000-0000-0000-0000-00000000f931';
  w uuid:='00000000-0000-0000-0000-00000000f932';
  bank uuid:='00000000-0000-0000-0000-00000000f933';
  card uuid:='00000000-0000-0000-0000-00000000f934';
  food uuid:='00000000-0000-0000-0000-00000000f935';
  market uuid:='00000000-0000-0000-0000-00000000f936';
  salary uuid:='00000000-0000-0000-0000-00000000f937';
  tx uuid;tx2 uuid;series uuid;plan uuid;debt uuid;req uuid;anchor uuid;converted uuid;
  result jsonb;payload jsonb;patch jsonb;before_money jsonb;versions jsonb;destination jsonb;
  rev bigint;parent_rev bigint;n bigint;history_rows text[];
  first_date date:=(date_trunc('month',current_date)+interval '2 months 14 days')::date;
  second_date date:=(date_trunc('month',current_date)+interval '3 months 14 days')::date;
  third_date date:=(date_trunc('month',current_date)+interval '4 months 14 days')::date;
  classes jsonb:='{"expense_pattern":"fixed","expense_pattern_source":"explicit","expense_necessity":"essential","expense_necessity_source":"explicit"}';
begin
  insert into auth.users(id,email) values(u,'subcategory-financial-metadata@example.invalid');
  insert into public.profiles(id) values(u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values(w,u,'F09 financial metadata QA',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type) values(bank,w,u,'F09 metadata bank','checking');
  insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents)
    values(card,w,u,'F09 metadata card','credit_card',20,28,100000);
  insert into public.subcategories(id,workspace_id,user_id,parent_category,name)
    values(food,w,u,'alimentação','restaurante'),(market,w,u,'alimentação','mercado'),(salary,w,u,'receitas','salário');
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);

  -- Closed JSON types reject arrays, numbers and malformed UUIDs without a write.
  foreach payload in array array['{"subcategory_id":1}'::jsonb,'{"subcategory_id":[]}'::jsonb,'{"subcategory_id":"bad"}'::jsonb] loop
    begin
      perform private.subcategory_patch(payload);raise exception 'invalid child accepted';
    exception when others then if sqlerrm='invalid child accepted' then raise;end if;end;
  end loop;
  payload:=jsonb_build_object('kind','expense','amount_cents',125,'category','alimentação','description','F09 canonical',
    'account_id',bank,'occurred_at',current_date,'payment_method','boleto','subcategory_id',food)||classes;
  req:=gen_random_uuid();result:=public.save_transaction_payment(null,payload,0,null,req);tx:=(result->>'id')::uuid;
  assert (select subcategory_id=food and subcategory_snapshot_set and expense_pattern='fixed' from public.transactions where id=tx);
  select count(*) into n from public.transactions;
  assert public.save_transaction_payment(null,payload,0,null,req)=result;
  assert (select count(*) from public.transactions)=n,'replay duplicated money';
  begin
    perform public.save_transaction_payment(null,payload||'{"subcategory_id":null}'::jsonb,0,null,req);
    raise exception 'different child receipt accepted';
  exception when others then
    if sqlerrm='different child receipt accepted' then raise;end if;
    assert sqlerrm like '%dados diferentes%',sqlerrm;
  end;
  select to_jsonb(t) into before_money from public.transactions t where id=tx;
  select edit_revision into rev from public.transactions where id=tx;
  req:=gen_random_uuid();
  begin
    perform public.save_transaction_payment(tx,jsonb_build_object('category','receitas','subcategory_id',food,'amount_cents',999),0,rev,req);
    raise exception 'same UUID and incompatible final parent accepted';
  exception when others then if sqlerrm='same UUID and incompatible final parent accepted' then raise;end if;end;
  assert (select to_jsonb(t) from public.transactions t where id=tx)=before_money,'invalid detail mutated financial row';
  assert not exists(select 1 from private.payment_write_requests where request_id=req),'failed intent left receipt';
  result:=public.save_transaction_payment(tx,'{"subcategory_id":null}',0,rev,gen_random_uuid());
  assert (select subcategory_id is null and subcategory_snapshot_set and expense_pattern='fixed' from public.transactions where id=tx),
    'explicit child null erased F06 or became inheritance';
  result:=public.save_transaction_payment(tx,jsonb_build_object('subcategory_id',food),0,(result->>'revision')::bigint,gen_random_uuid());
  result:=public.save_transaction_payment(tx,'{"category":"receitas"}',0,(result->>'revision')::bigint,gen_random_uuid());
  assert (select subcategory_id is null and amount_cents=125 from public.transactions where id=tx),'legacy parent edit preserved incompatible child';
  payload:=jsonb_build_object('kind','income','amount_cents',800,'category','receitas','subcategory_id',salary,
    'account_id',bank,'occurred_at',current_date,'description','F09 income');
  result:=public.save_transaction_payment(null,payload,0,null,gen_random_uuid());
  assert (select subcategory_id=salary and expense_pattern is null from public.transactions where id=(result->>'id')::uuid),'income detail incorrectly treated as F06 spending';
  payload:=jsonb_build_object('kind','expense','amount_cents',200,'category','alimentação','subcategory_id',food,
    'account_id',card,'occurred_at',current_date,'payment_method','pix','description','F09 Pix');
  result:=public.save_transaction_payment(null,payload,15,null,gen_random_uuid());
  assert (select subcategory_id is null from public.transactions where id=(result->>'fee_id')::uuid),'technical Pix fee inherited child';

  -- Creation records the initial anchor, and one/future/all operate on the existing selectors.
  payload:=jsonb_build_object('kind','expense','amount_cents',300,'description','F09 temporal',
    'account_id',bank,'category','alimentação','subcategory_id',food,'rrule','FREQ=MONTHLY;BYMONTHDAY=15',
    'next_run_at',first_date,'dtstart',current_date-60,'auto_confirm',false,'payment_method','boleto')||classes;
  result:=public.create_recurring_payment(payload,gen_random_uuid());series:=(result->>'id')::uuid;
  assert private.recurring_subcategory_at(series,current_date-1)=food,'initial history lost chosen child';
  tx:=public.materialize_recurring_occurrence(series,first_date);
  tx2:=public.materialize_recurring_occurrence(series,second_date);
  assert (select subcategory_id=food and subcategory_snapshot_set from public.transactions where id=tx),'materialization omitted child';
  assert public.materialize_recurring_occurrence(series,first_date)=tx,'materialization replay changed identity';
  select edit_revision into rev from public.transactions where id=tx;
  select edit_revision into parent_rev from public.recurring_transactions where id=series;
  select array_agg(ctid::text order by valid_from) into history_rows from private.recurring_history_versions where recurring_id=series;
  req:=gen_random_uuid();perform public.update_recurring_one(tx,'{"subcategory_id":null}',rev,req);
  perform public.update_recurring_one(tx,'{"subcategory_id":null}',rev,req);
  assert (select subcategory_id is null and expense_pattern='fixed' from public.transactions where id=tx);
  assert private.recurring_subcategory_at(series,first_date)=food,'one changed dated parent';
  assert (select edit_revision from public.recurring_transactions where id=series)>parent_rev,'child-only occurrence failed parent CAS invalidation';
  assert (select array_agg(ctid::text order by valid_from) from private.recurring_history_versions where recurring_id=series)=history_rows,
    'one unnecessarily rebuilt history';
  select edit_revision into parent_rev from public.recurring_transactions where id=series;
  patch:=jsonb_build_object('subcategory_id',market);
  perform public.update_recurring_future(tx2,series,'{}',patch,parent_rev,gen_random_uuid());
  assert private.recurring_subcategory_at(series,first_date)=food;
  assert private.recurring_subcategory_at(series,second_date)=market;
  assert (select subcategory_id is null from public.transactions where id=tx),'future rewrote earlier explicit null';
  update public.recurring_transactions set description='F09 calendar reconstruction' where id=series;
  assert private.recurring_subcategory_at(series,first_date)=food and private.recurring_subcategory_at(series,second_date)=market,
    'calendar edit flattened child timeline';
  select edit_revision into parent_rev from public.recurring_transactions where id=series;
  perform public.update_recurring_all(series,'{}',jsonb_build_object('subcategory_id',food),parent_rev,gen_random_uuid());
  assert (select count(*) from public.transactions where recurring_id=series and subcategory_id=food)=2;
  select edit_revision into parent_rev from public.recurring_transactions where id=series;
  perform public.update_recurring_future(tx2,series,'{}','{"subcategory_id":null}',parent_rev,gen_random_uuid());
  assert private.recurring_subcategory_at(series,first_date)=food and private.recurring_subcategory_at(series,second_date) is null;
  anchor:=public.materialize_recurring_occurrence(series,third_date);
  assert (select subcategory_id is null and subcategory_snapshot_set from public.transactions where id=anchor),'future explicit null inherited parent';

  -- A copied legacy false/null version is still unknown even when today's template
  -- has a child. Copy/restore/split must retain the marker, rather than re-inherit it.
  result:=public.create_recurring_payment(payload||jsonb_build_object('description','F09 legacy unknown'),gen_random_uuid());
  anchor:=(result->>'id')::uuid;
  perform set_config('role','none',true);
  update private.recurring_history_versions set subcategory_id=null,subcategory_snapshot_set=false where recurring_id=anchor;
  select jsonb_agg(to_jsonb(v) order by valid_from) into before_money from private.recurring_history_versions v where recurring_id=anchor;
  perform private.restore_recurring_metadata_history(anchor,before_money);
  assert not exists(select 1 from private.recurring_history_versions where recurring_id=anchor and (subcategory_id is not null or subcategory_snapshot_set)),
    'restore re-inherited today''s detail over legacy unknown snapshot';
  perform set_config('role','authenticated',true);
  perform private.payment_history_scope(anchor,'pix',first_date,false);
  perform private.expense_classification_history_scope(anchor,'{"expense_necessity":"discretionary","expense_necessity_source":"explicit"}',second_date,false);
  assert not exists(select 1 from private.recurring_history_versions where recurring_id=anchor and (subcategory_id is not null or subcategory_snapshot_set)),
    'metadata interval split changed the legacy child marker';
  update public.recurring_transactions set description='F09 legacy calendar rebuild' where id=anchor;
  assert not exists(select 1 from private.recurring_history_versions where recurring_id=anchor and (subcategory_id is not null or subcategory_snapshot_set)),
    'calendar edit re-inherited detail over legacy unknown';
  -- SQL scheduler/agent uses the trusted session without a JWT. Clearing an incompatible
  -- template child must still track history; authenticated without a UID is refused.
  perform set_config('role','none',true);perform set_config('request.jwt.claim.sub','',true);
  update public.recurring_transactions set category='receitas' where id=anchor;
  assert (select subcategory_id is null from public.recurring_transactions where id=anchor);
  perform set_config('role','authenticated',true);
  begin
    perform private.subcategory_history_scope(anchor,'{"subcategory_id":null}',current_date,false);
    raise exception 'authenticated caller without UID bypassed history membership';
  exception when others then
    if sqlerrm='authenticated caller without UID bypassed history membership' then raise;end if;
    assert sqlerrm like '%não autorizada%',sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub',u::text,true);

  -- FUTURE's financial context applies line first, then the series patch. Its
  -- explicit child must be checked against that final series parent before the core.
  result:=public.create_recurring_payment(payload||jsonb_build_object('description','F09 mixed final parent'),gen_random_uuid());
  anchor:=(result->>'id')::uuid;
  insert into public.transactions(user_id,kind,amount_cents,description,account_id,occurred_at,category,recurring_id,status)
    values(u,'expense',300,'F09 paid before mixed edit',bank,current_date-1,'alimentação',anchor,'cleared') returning id into tx;
  tx2:=public.materialize_recurring_occurrence(anchor,second_date);
  select edit_revision into parent_rev from public.recurring_transactions where id=anchor;
  perform public.update_recurring_future(tx2,anchor,'{"category":"alimentação"}',
    jsonb_build_object('category','receitas','subcategory_id',salary),parent_rev,gen_random_uuid());
  assert (select category='receitas' and subcategory_id=salary from public.recurring_transactions where id=anchor);
  assert (select category='receitas' and subcategory_id=salary from public.transactions where id=tx2);
  assert (select category='alimentação' and subcategory_id=food and status='cleared' from public.transactions where id=tx),
    'mixed future edit rewrote paid parent/detail';
  assert private.recurring_subcategory_at(anchor,first_date)=food and private.recurring_subcategory_at(anchor,second_date)=salary,
    'mixed future parent edit violated dated child scope';

  -- Legacy omitted child follows the same selected boundary; incompatible detail
  -- clears only there. A future income transition clears only future F06 snapshots.
  result:=public.create_recurring_payment(payload||jsonb_build_object('description','F09 omitted future child'),gen_random_uuid());
  anchor:=(result->>'id')::uuid;
  insert into public.transactions(user_id,kind,amount_cents,description,account_id,occurred_at,category,recurring_id,status)
    values(u,'expense',300,'F09 paid before omitted edit',bank,current_date-1,'alimentação',anchor,'cleared') returning id into tx;
  tx2:=public.materialize_recurring_occurrence(anchor,second_date);
  select edit_revision into parent_rev from public.recurring_transactions where id=anchor;
  perform public.update_recurring_future(tx2,anchor,'{}','{"category":"receitas"}',parent_rev,gen_random_uuid());
  assert (select category='receitas' and subcategory_id is null from public.recurring_transactions where id=anchor);
  assert (select category='receitas' and subcategory_id is null from public.transactions where id=tx2);
  assert private.recurring_subcategory_at(anchor,first_date)=food and private.recurring_subcategory_at(anchor,second_date) is null,
    'omitted future child cleared before selected parent boundary';
  assert (select category='alimentação' and subcategory_id=food and expense_pattern='fixed' and status='cleared'
    from public.transactions where id=tx),'legacy future parent edit rewrote paid snapshots';
  select edit_revision into parent_rev from public.recurring_transactions where id=anchor;
  perform public.update_recurring_future(tx2,anchor,'{}',jsonb_build_object('kind','income','subcategory_id',salary),parent_rev,gen_random_uuid());
  assert private.recurring_expense_classification_at(anchor,first_date)->>'expense_pattern'='fixed',
    'future income transition cleared F06 before selected boundary';
  assert private.recurring_expense_classification_at(anchor,second_date)->>'expense_pattern' is null;
  assert (select kind='income' and subcategory_id=salary and expense_pattern is null from public.transactions where id=tx2);
  assert private.recurring_subcategory_at(anchor,first_date)=food and private.recurring_subcategory_at(anchor,second_date)=salary;
  assert nullif(current_setting('proops.subcategory_financial_boundary_'||replace(anchor::text,'-',''),true),'') is null,
    'future boundary leaked after command';
  assert coalesce(current_setting('proops.subcategory_scope_adapter',true),'')<>'on'
    and coalesce(current_setting('proops.classification_scope_adapter',true),'')<>'on','scope adapter leaked after command';

  -- Numbered installment snapshots survive a financial rebuild.
  payload:=jsonb_build_object('p_account_id',bank,'p_total_cents',901,'p_installments',3,'p_paid_installments',0,
    'p_occurred_at',first_date,'p_description','F09 plan','p_category','alimentação','subcategory_id',food,'p_payment_method','boleto')||classes;
  result:=public.create_purchase('parcelada',payload,null,gen_random_uuid());plan:=(result->'ids'->>0)::uuid;
  assert (select subcategory_id=food from public.installment_plans where id=plan);
  assert (select count(*) from public.transactions where installment_plan_id=plan and subcategory_id=food)=3;
  select id,edit_revision into tx,rev from public.transactions where installment_plan_id=plan and installment_no=2;
  select edit_revision into parent_rev from public.installment_plans where id=plan;
  perform public.update_installment_scope_checked(tx,'one','{"subcategory_id":null}',parent_rev,rev,gen_random_uuid(),false);
  select edit_revision into parent_rev from public.installment_plans where id=plan;
  payload:=jsonb_build_object('p_plan_id',plan,'p_total_cents',901,'p_installments',3,'p_first_occurred_at',first_date,
    'p_description','F09 rebuilt title','p_category','alimentação','p_account_id',bank,'p_expected_revision',parent_rev,'p_request_id',gen_random_uuid());
  perform public.update_installment_plan_payment(payload);
  assert (select subcategory_id is null and subcategory_snapshot_set and expense_pattern='fixed'
    from public.transactions where installment_plan_id=plan and installment_no=2),'rebuild lost numbered null override';
  assert (select sum(amount_cents) from public.transactions where installment_plan_id=plan)=901,'metadata changed money';

  -- Debt E distinguishes null override from default, preserves it through financial cores.
  payload:=jsonb_build_object('name','F09 finance','kind','loan','principal_cents',600,'remaining_cents',600,
    'account_id',bank,'installments',3,'installments_paid',0,'installment_cents',200,'first_due_date',first_date,
    'due_day',15,'interest_rate_monthly',0,'calculation_mode','fixed_installments','payment_method','boleto',
    'payment_category','alimentação','subcategory_id',food)||classes;
  result:=public.create_purchase('financiamento',payload,null,gen_random_uuid());debt:=(result->'ids'->>0)::uuid;
  select edit_revision into parent_rev from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,1,'one','{"subcategory_id":null}',parent_rev,'{}',gen_random_uuid());
  assert (select subcategory_set and subcategory_id is null from public.debt_installment_edits where debt_id=debt and installment_no=1);
  assert private.debt_subcategory_at(debt,1) is null and private.debt_subcategory_at(debt,2)=food;
  select edit_revision into parent_rev from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,1,'future','{"installment_cents":201}',parent_rev,'{}',gen_random_uuid());
  assert private.debt_subcategory_at(debt,1) is null,'financial debt edit deleted child-only explicit null';
  perform public.pay_debt_installment(debt,201,bank,current_date);
  select id,edit_revision into tx,rev from public.transactions where debt_id=debt and debt_payment_no=1;
  assert (select subcategory_id is null and subcategory_snapshot_set from public.transactions where id=tx),'payment inherited over E explicit null';
  select edit_revision into parent_rev from public.debts where id=debt;
  versions:=jsonb_build_object(tx::text,rev);patch:=jsonb_build_object('subcategory_id',market);req:=gen_random_uuid();
  result:=public.update_debt_payment_scoped(tx,'one',patch,parent_rev,rev,versions,req);
  assert public.update_debt_payment_scoped(tx,'one',patch,parent_rev,rev,versions,req)=result;
  assert (select subcategory_id=market from public.transactions where id=tx);
  assert private.debt_subcategory_at(debt,2)=food,'one rewrote future debt default';
  select edit_revision into parent_rev from public.debts where id=debt;
  perform public.update_debt_contract_scoped(debt,2,'future','{"subcategory_id":null}',parent_rev,'{}',gen_random_uuid());
  assert private.debt_subcategory_at(debt,1) is null and private.debt_subcategory_at(debt,2) is null;

  -- Raw legacy parent change freezes E's effective parent while clearing the debt default.
  update public.debts set payment_category='receitas' where id=debt;
  assert (select category_set and category='alimentação' and subcategory_set
    from public.debt_installment_edits where debt_id=debt and installment_no=1),
    'raw debt parent change left exception keys without a dated parent';
  assert (select subcategory_id is null from public.debts where id=debt);

  -- Adoption/conversion preserves identity and source metadata; different parent clears inheritance.
  payload:=jsonb_build_object('kind','expense','amount_cents',300,'category','alimentação','subcategory_id',food,
    'description','F09 converter','account_id',bank,'occurred_at',current_date,'status','cleared');
  result:=public.save_transaction_payment(null,payload,0,null,gen_random_uuid());tx:=(result->>'id')::uuid;
  req:=gen_random_uuid();destination:=jsonb_build_object('tipo','parcelada','dados',jsonb_build_object(
    'p_account_id',bank,'p_total_cents',900,'p_installments',3,'p_paid_installments',1,'p_occurred_at',current_date,
    'p_description','F09 converted','p_category','alimentação'));
  result:=public.converter_registro(jsonb_build_object('tipo','transacao','id',tx),'converter',destination,req);
  assert public.converter_registro(jsonb_build_object('tipo','transacao','id',tx),'converter',destination,req)=result;
  converted:=(result->'ids'->>0)::uuid;
  assert (select subcategory_id=food from public.installment_plans where id=converted),'conversion lost source child';
  assert (select subcategory_id=food and installment_plan_id=converted from public.transactions where id=tx),'adopted source lost child/identity';
  -- A financing conversion preserves the adopted paid row's old category while its
  -- new template has another parent. Inherited detail must follow each actual parent.
  result:=public.save_transaction_payment(null,payload,0,null,gen_random_uuid());tx:=(result->>'id')::uuid;
  destination:=jsonb_build_object('tipo','financiamento','dados',jsonb_build_object(
    'name','F09 converted debt','kind','loan','calculation_mode','fixed_installments','principal_cents',900,
    'remaining_cents',900,'interest_rate_monthly',0,'installments',3,'installments_paid',0,'installment_cents',300,
    'account_id',bank,'due_day',15,'first_due_date',first_date,'payment_category','receitas'));
  result:=public.converter_registro(jsonb_build_object('tipo','transacao','id',tx),'converter',destination,gen_random_uuid());
  debt:=(result->'ids'->>0)::uuid;
  assert (select subcategory_id is null and payment_category='receitas' from public.debts where id=debt);
  assert (select subcategory_id=food and category='alimentação' and debt_id=debt from public.transactions where id=tx),
    'conversion cleared compatible adopted paid snapshot';
  -- Replaying the same full intent must not repeat either financial conversion or metadata.
  assert (select count(*) from public.installment_plans where id=converted)=1;
end $$;
set constraints all immediate;
rollback;
