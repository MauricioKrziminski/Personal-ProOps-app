-- F09 preview uses the canonical write, validates commit-time child FKs, then rolls back.
-- Run scripts/sql-test.py <file> --repeatable-read. Dedicated fixtures; never commit.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
create function pg_temp.f09_preview_contents() returns jsonb language plpgsql security definer set search_path='' as $$
declare tab text;rows jsonb;result jsonb:='{}';
begin
  foreach tab in array array['public.subcategories','public.transactions','public.recurring_transactions',
    'public.installment_plans','public.debts','public.card_invoices','public.accounts',
    'public.debt_declared_due_dates','public.debt_declared_estimates','public.debt_installment_edits',
    'private.recurring_history_versions','private.recurring_moved_occurrences','private.payment_write_requests',
    'private.purchase_write_requests','private.recurring_all_edit_requests','private.recurring_future_edit_requests',
    'private.recurring_one_edit_requests','private.debt_contract_edit_requests','private.debt_payment_edit_requests',
    'private.subcategory_write_receipts'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from %s t',tab) into rows;
    result:=result||jsonb_build_object(tab,rows);
  end loop;
  return result;
end $$;
create function pg_temp.f09_preview_without_ids(v jsonb) returns jsonb language plpgsql as $$
declare result jsonb;e record;
begin
  if jsonb_typeof(v)='object' then
    result:='{}';for e in select * from jsonb_each(v) loop
      if e.key not in('id','ref_id','invoice_id') then result:=result||jsonb_build_object(e.key,pg_temp.f09_preview_without_ids(e.value));end if;
    end loop;return result;
  elsif jsonb_typeof(v)='array' then
    select coalesce(jsonb_agg(pg_temp.f09_preview_without_ids(value)),'[]') into result from jsonb_array_elements(v);return result;
  end if;return v;
end $$;
create function pg_temp.f09_preview_reads(days integer) returns jsonb language sql security invoker as $$
  select jsonb_build_object('balances',coalesce((select jsonb_agg(to_jsonb(b) order by b.account_id) from public.account_balances() b),'[]'::jsonb),
    'limits',coalesce((select jsonb_agg(to_jsonb(l) order by l.account_id) from public.card_limit_context() l),'[]'::jsonb),
    'accounts',public.accounts_horizon(days),'cards',public.cards_horizon(days))
$$;
create function pg_temp.f09_preview_check(op text,args jsonb,child uuid) returns void language plpgsql security invoker as $$
declare contents jsonb:=pg_temp.f09_preview_contents();preview jsonb;saved jsonb;parent uuid;
begin
  preview:=public.preview_finance_write(op,args,90);
  assert preview->'before'=pg_temp.f09_preview_reads(90),'preview before differs from canonical reads';
  assert pg_temp.f09_preview_contents()=contents,'preview leaked metadata, money, revision, history, invoice or receipt';
  assert jsonb_array_length(preview->'schedule')=least((preview->>'schedule_total')::int,366),'schedule bound changed';
  begin
    if op='transaction' then
      saved:=public.save_transaction_payment((args->>'p_transaction_id')::uuid,args->'p_input',
        (args->>'p_fee_cents')::bigint,(args->>'p_expected_revision')::bigint,gen_random_uuid());parent:=(saved->>'id')::uuid;
      assert (select subcategory_id is not distinct from child and subcategory_snapshot_set from public.transactions where id=parent),'actual T child differs';
      if saved->>'fee_id' is not null then
        assert (select subcategory_id is null and expense_pattern is null and expense_necessity is null from public.transactions where id=(saved->>'fee_id')::uuid),
          'technical Pix fee inherited main metadata';
      end if;
    elsif op='recurring' then
      saved:=public.create_recurring_payment(args->'p_input',gen_random_uuid());parent:=(saved->>'id')::uuid;
      assert (select subcategory_id is not distinct from child from public.recurring_transactions where id=parent),'actual R child differs';
      assert not exists(select 1 from private.recurring_history_versions where recurring_id=parent and subcategory_id is distinct from child),
        'initial history differs from chosen child';
    else
      saved:=public.create_purchase(args->>'p_tipo',args->'p_dados',args->'p_entrada',gen_random_uuid());parent:=(saved->'ids'->>0)::uuid;
      if args->>'p_tipo'='parcelada' then
        assert (select subcategory_id is not distinct from child from public.installment_plans where id=parent),'actual I child differs';
        assert not exists(select 1 from public.transactions where (installment_plan_id=parent or down_payment_plan_id=parent)
          and (subcategory_id is distinct from child or not subcategory_snapshot_set)),'installment/entry inheritance differs';
      else
        assert (select subcategory_id is not distinct from child and payment_category=args->'p_dados'->>'payment_category'
          from public.debts where id=parent),'actual D category/detail differs';
        assert not exists(select 1 from public.transactions where (debt_id=parent or down_payment_debt_id=parent)
          and (subcategory_id is distinct from child or not subcategory_snapshot_set)),'debt/entry inheritance differs';
      end if;
    end if;
    set constraints public.payment_method_compatibility,public.owned_fee_graph,
      public.transactions_subcategory_scope_fkey,public.recurring_transactions_subcategory_scope_fkey,
      public.installment_plans_subcategory_scope_fkey,public.debts_subcategory_scope_fkey,
      public.debt_installment_subcategory_scope_fkey,private.recurring_history_versions_subcategory_scope_fkey immediate;
    assert pg_temp.f09_preview_without_ids(preview->'after')=pg_temp.f09_preview_without_ids(pg_temp.f09_preview_reads(90)),
      'preview after differs from actual canonical financial write';
    raise exception using errcode='PTF09',message='canonical preview parity rollback';
  exception when sqlstate 'PTF09' then assert sqlerrm='canonical preview parity rollback';end;
  assert pg_temp.f09_preview_contents()=contents,'canonical parity oracle leaked effects';
end $$;
create function pg_temp.f09_preview_reject(op text,args jsonb,expected text,expected_state text default null)
returns void language plpgsql security invoker as $$
declare contents jsonb:=pg_temp.f09_preview_contents();failed boolean:=false;
begin
  begin perform public.preview_finance_write(op,args,90);
  exception when others then
    failed:=true;assert sqlerrm like expected,format('wrong refusal: %s',sqlerrm);
    if expected_state is not null then assert sqlstate=expected_state,format('wrong SQLSTATE: %s',sqlstate);end if;
  end;
  assert failed,'invalid preview returned financial numbers';
  assert pg_temp.f09_preview_contents()=contents,'failed preview leaked effects';
end $$;
do $$
declare u uuid:='00000000-0000-0000-0000-00000000f9e1';v uuid:='00000000-0000-0000-0000-00000000f9e2';
  w uuid:='00000000-0000-0000-0000-00000000f9e3';fw uuid:='00000000-0000-0000-0000-00000000f9e4';
begin
  assert current_setting('transaction_isolation')='repeatable read','run fixture --repeatable-read';
  assert not (select prosecdef from pg_proc where oid='public.preview_finance_write(text,jsonb,integer)'::regprocedure),'preview became definer';
  assert has_function_privilege('authenticated','public.preview_finance_write(text,jsonb,integer)','execute');
  assert not has_function_privilege('anon','public.preview_finance_write(text,jsonb,integer)','execute');
  insert into auth.users(id,email) values(u,'f09-preview@example.invalid'),(v,'f09-preview-foreign@example.invalid');
  insert into public.profiles(id) values(u),(v) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values(w,u,'F09 preview',now()-interval '2 days'),(fw,v,'F09 foreign preview',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(fw,v,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents)
    values('00000000-0000-0000-0000-00000000f9e5',w,u,'F09 preview bank','checking',100000);
  insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents)
    values('00000000-0000-0000-0000-00000000f9e6',w,u,'F09 preview card','credit_card',20,28,100000);
  insert into public.subcategories(id,workspace_id,user_id,parent_category,name) values
    ('00000000-0000-0000-0000-00000000f9e7',w,u,'alimentação','mercado'),
    ('00000000-0000-0000-0000-00000000f9e8',w,u,'alimentação','restaurante'),
    ('00000000-0000-0000-0000-00000000f9e9',fw,v,'alimentação','mercado');
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000f9e1',true);
set local role authenticated;
do $$
declare bank uuid:='00000000-0000-0000-0000-00000000f9e5';card uuid:='00000000-0000-0000-0000-00000000f9e6';
  food uuid:='00000000-0000-0000-0000-00000000f9e7';market uuid:='00000000-0000-0000-0000-00000000f9e8';
  foreign_child uuid:='00000000-0000-0000-0000-00000000f9e9';input jsonb;recurring jsonb;purchase jsonb;debt jsonb;entry jsonb;child_patch jsonb;args jsonb;saved jsonb;tx uuid;revision bigint;
  start date:=current_date+5;
  classes jsonb:='{"expense_pattern":"fixed","expense_pattern_source":"explicit","expense_necessity":"essential","expense_necessity_source":"category_default"}';
begin
  input:=jsonb_build_object('kind','expense','amount_cents',123,'description','F09 preview transaction','category','alimentação',
    'account_id',bank,'occurred_at',current_date,'status','cleared','payment_method','pix')||classes;
  recurring:=jsonb_build_object('kind','expense','amount_cents',123,'description','F09 preview recurring','category','alimentação',
    'account_id',bank,'rrule','FREQ=MONTHLY;BYMONTHDAY='||extract(day from start)::int,
    'next_run_at',start::timestamp at time zone 'America/Sao_Paulo','dtstart',start::timestamp at time zone 'America/Sao_Paulo','payment_method','pix')||classes;
  purchase:=jsonb_build_object('p_account_id',bank,'p_total_cents',1230,'p_installments',3,'p_paid_installments',0,
    'p_occurred_at',start,'p_description','F09 preview installment','p_category','alimentação','p_payment_method','pix')||classes;
  debt:=jsonb_build_object('name','F09 preview debt','kind','financing','calculation_mode','fixed_installments','principal_cents',1230,
    'remaining_cents',1230,'interest_rate_monthly',0,'installments',3,'installments_paid',0,'installment_cents',410,
    'account_id',bank,'due_day',extract(day from start)::int,'first_due_date',start,'payment_category','alimentação','payment_method','pix')||classes;
  entry:=jsonb_build_object('amount_cents',100,'account_id',bank,'occurred_at',current_date,'payment_method','pix');
  -- First explicit child is the old allowlist RED; canonical writer already accepts it.
  foreach child_patch in array array[jsonb_build_object('subcategory_id',food),'{"subcategory_id":null}'::jsonb,'{}'::jsonb] loop
    perform pg_temp.f09_preview_check('transaction',jsonb_build_object('p_input',input||child_patch,'p_fee_cents',0),(child_patch->>'subcategory_id')::uuid);
    perform pg_temp.f09_preview_check('recurring',jsonb_build_object('p_input',recurring||child_patch),(child_patch->>'subcategory_id')::uuid);
    perform pg_temp.f09_preview_check('purchase',jsonb_build_object('p_tipo','parcelada','p_dados',purchase||child_patch,'p_entrada',entry),(child_patch->>'subcategory_id')::uuid);
    perform pg_temp.f09_preview_check('purchase',jsonb_build_object('p_tipo','financiamento','p_dados',debt||child_patch,'p_entrada',entry),(child_patch->>'subcategory_id')::uuid);
  end loop;
  perform pg_temp.f09_preview_check('transaction',jsonb_build_object('p_input',input||jsonb_build_object('account_id',card,'subcategory_id',food),'p_fee_cents',17),food);
  saved:=public.save_transaction_payment(null,input||jsonb_build_object('subcategory_id',food),0,null,gen_random_uuid());
  tx:=(saved->>'id')::uuid;revision:=(saved->>'revision')::bigint;
  args:=jsonb_build_object('p_transaction_id',tx,'p_expected_revision',revision,'p_fee_cents',0);
  perform pg_temp.f09_preview_check('transaction',args||jsonb_build_object('p_input','{"description":"F09 omitted preserved"}'::jsonb),food);
  perform pg_temp.f09_preview_check('transaction',args||jsonb_build_object('p_input','{"subcategory_id":null}'::jsonb),null);
  perform pg_temp.f09_preview_check('transaction',args||jsonb_build_object('p_input',jsonb_build_object('subcategory_id',market)),market);
  perform pg_temp.f09_preview_reject('transaction',args||jsonb_build_object('p_input',jsonb_build_object('category','receitas','subcategory_id',food)),'%Detalhe%');
  perform pg_temp.f09_preview_reject('transaction',jsonb_build_object('p_input',input||jsonb_build_object('subcategory_id',foreign_child),'p_fee_cents',0),'%Detalhe%');
  perform pg_temp.f09_preview_reject('recurring',jsonb_build_object('p_input',recurring||'{"subcategory_id":42}'),'%Detalhe%');
  perform pg_temp.f09_preview_reject('transaction',jsonb_build_object('p_input',input||'{"subcategory_id":"bad"}'),'%Identificador%');
  perform pg_temp.f09_preview_reject('transaction',jsonb_build_object('p_input',input||'{"unknown":1}'),'%Campos%');
  perform pg_temp.f09_preview_reject('recurring',jsonb_build_object('p_input',recurring||'{"workspace_id":"bad"}'),'%Campos%');
  perform pg_temp.f09_preview_reject('purchase',jsonb_build_object('p_tipo','parcelada','p_dados',purchase||'{"payment_category":"other"}'),'%Campos%');
  perform pg_temp.f09_preview_reject('purchase',jsonb_build_object('p_tipo','parcelada','p_dados',purchase,'p_entrada',entry||jsonb_build_object('subcategory_id',food)),'%entrada%');
end $$;
reset role;
-- A real deferred catalog race must fail preview exactly as a commit would. The
-- test-only trigger mutates the catalog after BEFORE validation, inside the undo block.
create function pg_temp.f09_preview_deferred_race() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if coalesce(current_setting('test.f09.preview_race',true),'')='on' then
    update public.subcategories set parent_category='receitas' where id='00000000-0000-0000-0000-00000000f9e7';
  end if;return null;
end $$;
create trigger zz_f09_preview_deferred_race after insert on public.recurring_transactions for each row execute function pg_temp.f09_preview_deferred_race();
set local role authenticated;
do $$
declare args jsonb;
begin
  args:=jsonb_build_object('p_input',jsonb_build_object('kind','expense','amount_cents',123,'description','F09 deferred race',
    'account_id','00000000-0000-0000-0000-00000000f9e5','category','alimentação','subcategory_id','00000000-0000-0000-0000-00000000f9e7',
    'rrule','FREQ=MONTHLY;BYMONTHDAY=15','next_run_at',(current_date+5)::timestamp at time zone 'America/Sao_Paulo'));
  set constraints public.recurring_transactions_subcategory_scope_fkey,private.recurring_history_versions_subcategory_scope_fkey deferred;
  perform set_config('test.f09.preview_race','on',true);
  perform pg_temp.f09_preview_reject('recurring',args,'%subcategory_scope_fkey%','23503');
  perform set_config('test.f09.preview_race','',true);
end $$;
reset role;
rollback;
