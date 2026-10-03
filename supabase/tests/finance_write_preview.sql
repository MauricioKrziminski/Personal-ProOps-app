-- F04: execute the same write RPC, collect canonical reads, then undo every effect.
-- Run with scripts/sql-test.py <file> --repeatable-read (the runner always rolls back).
\set ON_ERROR_STOP on
begin;
do $$ begin
  assert to_regprocedure('public.preview_finance_write(text,jsonb,integer)') is not null,
    'F04 requires preview_finance_write: the real write must be previewable without persistence';
end $$;

create function pg_temp.f04_contents() returns jsonb language plpgsql security definer
set search_path='' as $$
declare tab text; rows jsonb; result jsonb:='{}';
begin
  foreach tab in array array['public.transactions','public.installment_plans','public.debts',
    'public.recurring_transactions','public.card_invoices','public.accounts',
    'public.debt_declared_due_dates','public.debt_declared_estimates','public.debt_installment_edits',
    'private.recurring_history_versions','private.recurring_moved_occurrences',
    'private.payment_write_requests','private.purchase_write_requests',
    'private.recurring_all_edit_requests','private.recurring_future_edit_requests',
    'private.recurring_one_edit_requests','private.debt_contract_edit_requests','private.debt_payment_edit_requests'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from %s t',tab)
      into rows;
    result:=result||jsonb_build_object(tab,rows);
  end loop;
  return result;
end $$;
-- UUIDs of hypothetical new rows are intentionally different from an actual save.
create function pg_temp.f04_without_ids(v jsonb) returns jsonb language plpgsql as $$
declare result jsonb; e record;
begin
  if jsonb_typeof(v)='object' then
    result:='{}';
    for e in select * from jsonb_each(v) loop
      if e.key not in('id','ref_id','invoice_id') then
        result:=result||jsonb_build_object(e.key,pg_temp.f04_without_ids(e.value));
      end if;
    end loop;
    return result;
  elsif jsonb_typeof(v)='array' then
    select coalesce(jsonb_agg(pg_temp.f04_without_ids(value)),'[]') into result from jsonb_array_elements(v);
    return result;
  end if;
  return v;
end $$;
create function pg_temp.f04_reads(days integer) returns jsonb language sql security invoker as $$
  select jsonb_build_object(
    'balances',coalesce((select jsonb_agg(to_jsonb(b) order by b.account_id) from public.account_balances() b),'[]'::jsonb),
    'limits',coalesce((select jsonb_agg(to_jsonb(l) order by l.account_id) from public.card_limit_context() l),'[]'::jsonb),
    'accounts',public.accounts_horizon(days),'cards',public.cards_horizon(days));
$$;
-- Missing fields differ from four JSON nulls: consumers must see the canonical snapshot.
create function pg_temp.f06_classification(p_row jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_row)
  where key in('expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source');
$$;
create function pg_temp.f04_preview(op text,args jsonb,days integer default 90,classification jsonb default null)
returns jsonb language plpgsql security invoker as $$
declare contents jsonb:=pg_temp.f04_contents(); reads jsonb:=pg_temp.f04_reads(days); preview jsonb; saved jsonb; line jsonb; actual jsonb; parent uuid; expected jsonb;
begin
  preview:=public.preview_finance_write(op,args,days);
  assert preview is not null and preview->'before'=reads,'before snapshot differs from actual canonical reads';
  assert preview->>'as_of'=current_date::text and preview->>'horizon_end'=(current_date+days)::text,
    'preview dates must use server BRT snapshot date';
  assert pg_temp.f04_contents()=contents,'preview left altered rows, revisions, versions, invoice/entry/fee or nonce';
  assert jsonb_array_length(preview->'schedule')=least((preview->>'schedule_total')::int,366),
    'schedule cap and explicit total disagree';
  assert (preview->>'schedule_truncated')::boolean=((preview->>'schedule_total')::int>366),
    'truncation flag is incorrect';
  -- Actual write runs once in its own rollback block. This catches a synthetic
  -- projection that merely agrees with a second invocation of the preview code.
  begin
    if op='transaction' then
      saved:=public.save_transaction_payment((args->>'p_transaction_id')::uuid,args->'p_input',
        (args->>'p_fee_cents')::bigint,(args->>'p_expected_revision')::bigint,gen_random_uuid());
    elsif op='purchase' then
      saved:=public.create_purchase(args->>'p_tipo',args->'p_dados',args->'p_entrada',gen_random_uuid());
    else saved:=public.create_recurring_payment(args->'p_input',gen_random_uuid()); end if;
    set constraints public.payment_method_compatibility,public.owned_fee_graph immediate;
    assert pg_temp.f04_without_ids(preview->'after')=pg_temp.f04_without_ids(pg_temp.f04_reads(days)),
      'preview and actual-save financial projections differ';
    if classification is not null then
      assert jsonb_array_length(preview->'schedule')>0,'classification parity needs a visible occurrence';
      parent:=coalesce((saved->>'id')::uuid,(saved->'ids'->>0)::uuid);
      for line in select value from jsonb_array_elements(preview->'schedule') loop
        actual:=null;
        if line->>'origin'='transaction' then
          select to_jsonb(t) into actual from public.transactions t where
            (op='transaction' and t.id=case when (line->>'is_fee')::boolean then (saved->>'fee_id')::uuid else parent end)
            or (op='purchase' and (t.installment_plan_id=parent and t.installment_no=(line->>'installment_no')::int
              or (line->>'is_entry')::boolean and (t.down_payment_plan_id=parent or t.down_payment_debt_id=parent)))
            or (op='recurring' and t.recurring_id=parent and t.occurred_at=(line->>'occurred_at')::date);
        elsif line->>'origin'='recurring' then
          select to_jsonb(e) into actual from public.ledger_expected_lines_classified(
            (line->>'occurred_at')::date,(line->>'occurred_at')::date,parent) e
          where e.origin='recurring' and e.ref_id=parent;
        else
          -- Both unpaid schedule and declared history of a NEW debt inherit its stored snapshot.
          select to_jsonb(d) into actual from public.debts d where d.id=parent;
        end if;
        assert actual is not null,format('missing actual-save classification oracle: %s',line->>'origin');
        expected:=case when (line->>'is_fee')::boolean then
          '{"expense_pattern":null,"expense_pattern_source":null,"expense_necessity":null,"expense_necessity_source":null}'::jsonb
          else classification end;
        assert pg_temp.f06_classification(actual)=expected,
          format('actual writer classification differs from independently expected snapshot: %s',line->>'origin');
        assert pg_temp.f06_classification(line)=pg_temp.f06_classification(actual),
          format('preview classification differs from actual-save canonical row: %s; preview=%s actual=%s',
            line->>'origin',pg_temp.f06_classification(line),pg_temp.f06_classification(actual));
      end loop;
    end if;
    raise exception using errcode='PTF04',message='actual parity write rollback';
  exception when sqlstate 'PTF04' then null; end;
  assert pg_temp.f04_contents()=contents,'actual parity test leaked its write';
  return preview;
end $$;
create function pg_temp.f04_reject(op text,args jsonb,expected text,days integer default 90)
returns void language plpgsql as $$
declare contents jsonb:=pg_temp.f04_contents(); failed boolean:=false;
begin
  begin
    perform public.preview_finance_write(op,args,days);
  exception when others then
    failed:=true;
    assert sqlerrm like expected,format('wrong refusal: %s; expected %s',sqlerrm,expected);
  end;
  assert failed,'invalid preview returned financial numbers';
  assert pg_temp.f04_contents()=contents,'failed preview leaked a partial write';
end $$;

do $$
declare u uuid:='00000000-0000-0000-0000-00000000f401';
  v uuid:='00000000-0000-0000-0000-00000000f402'; w uuid; fw uuid;
begin
  assert current_setting('transaction_isolation')='repeatable read','run this suite with --repeatable-read';
  assert not has_function_privilege('anon','public.preview_finance_write(text,jsonb,integer)','execute');
  assert has_function_privilege('authenticated','public.preview_finance_write(text,jsonb,integer)','execute');
  assert not (select prosecdef from pg_proc where oid='public.preview_finance_write(text,jsonb,integer)'::regprocedure),
    'preview must preserve RLS through SECURITY INVOKER';
  insert into auth.users(id,email) values(u,'f04-preview@example.invalid'),(v,'f04-preview-foreign@example.invalid');
  insert into public.profiles(id) values(u),(v) on conflict do nothing;
  insert into public.workspaces(owner_id,name,created_at) values(u,'F04 preview',now()-interval '1 day') returning id into w;
  insert into public.workspaces(owner_id,name) values(v,'F04 foreign') returning id into fw;
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(fw,v,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values
    ('00000000-0000-0000-0000-00000000f405',w,u,'F04 bank','checking',100000),
    ('00000000-0000-0000-0000-00000000f406',w,u,'F04 other bank','checking',50000),
    ('00000000-0000-0000-0000-00000000f407',fw,v,'F04 foreign bank','checking',999999);
  insert into public.transactions(id,workspace_id,user_id,kind,amount_cents,account_id,occurred_at,status,source)
    values('00000000-0000-0000-0000-00000000f413',fw,v,'expense',50,
      '00000000-0000-0000-0000-00000000f407',current_date,'cleared','app');
  insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents,payment_account_id,closing_day_inclusive) values
    ('00000000-0000-0000-0000-00000000f408',w,u,'F04 card','credit_card',31,10,100000,'00000000-0000-0000-0000-00000000f405',false),
    ('00000000-0000-0000-0000-00000000f409',w,u,'F04 inclusive','credit_card',31,10,100000,'00000000-0000-0000-0000-00000000f405',true),
    ('00000000-0000-0000-0000-00000000f410',w,u,'F04 no limit','credit_card',20,28,null,'00000000-0000-0000-0000-00000000f405',false),
    ('00000000-0000-0000-0000-00000000f411',w,u,'F04 zero limit','credit_card',20,28,0,'00000000-0000-0000-0000-00000000f405',false),
    ('00000000-0000-0000-0000-00000000f412',w,u,'F04 review','credit_card',20,28,100000,'00000000-0000-0000-0000-00000000f405',false);
  update public.accounts set initial_balance_cents=-1000 where id='00000000-0000-0000-0000-00000000f412';
  perform set_config('test.f04.workspace',w::text,true);
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000f401',true);
set local role authenticated;

-- F06 adds metadata parity to F04's financial/read-only oracle. These literals
-- describe user decisions, not the preview implementation or a second preview.
do $$
declare bank uuid:='00000000-0000-0000-0000-00000000f405';
  card uuid:='00000000-0000-0000-0000-00000000f408';
  snapshot jsonb; expected jsonb; input jsonb; purchase jsonb; debt jsonb; recurring jsonb; args jsonb;
  empty_snapshot jsonb:='{"expense_pattern":null,"expense_pattern_source":null,"expense_necessity":null,"expense_necessity_source":null}';
  saved jsonb; tx uuid; revision bigint; start date:=current_date+5;
begin
  -- The edit oracle needs one saved row, but must not affect F04's fixed balances.
  begin
    input:=jsonb_build_object('kind','expense','amount_cents',1200,'description','F06 preview snapshot',
      'account_id',bank,'occurred_at',start,'status','pending','payment_method','pix');
    purchase:=jsonb_build_object('p_account_id',bank,'p_total_cents',1200,'p_installments',3,
      'p_paid_installments',0,'p_occurred_at',start,'p_description','F06 preview purchase','p_payment_method','pix');
    debt:=jsonb_build_object('name','F06 preview debt','kind','financing','calculation_mode','fixed_installments',
      'principal_cents',1200,'remaining_cents',1200,'interest_rate_monthly',0,'installments',3,
      'installments_paid',0,'installment_cents',400,'account_id',bank,'due_day',extract(day from start)::int,
      'first_due_date',start,'payment_method','pix');
    recurring:=jsonb_build_object('kind','expense','amount_cents',1200,'description','F06 preview recurring',
      'account_id',bank,'rrule','FREQ=MONTHLY;BYMONTHDAY='||extract(day from start)::int,
      'next_run_at',start::timestamp at time zone 'America/Sao_Paulo',
      'dtstart',start::timestamp at time zone 'America/Sao_Paulo','payment_method','pix');
    foreach snapshot in array array[
      empty_snapshot,
      '{"expense_pattern":"fixed","expense_pattern_source":"explicit","expense_necessity":"essential","expense_necessity_source":"category_default"}'::jsonb,
      '{"expense_pattern":"variable","expense_pattern_source":"category_default","expense_necessity":"discretionary","expense_necessity_source":"explicit"}'::jsonb,
      '{"expense_pattern":"variable","expense_pattern_source":"explicit","expense_necessity":"essential","expense_necessity_source":"category_default"}'::jsonb,
      '{"expense_pattern":"fixed","expense_pattern_source":"category_default","expense_necessity":"discretionary","expense_necessity_source":"explicit"}'::jsonb,
      '{"expense_pattern":null,"expense_pattern_source":"explicit","expense_necessity":null,"expense_necessity_source":"explicit"}'::jsonb,
      '{"expense_necessity":"essential","expense_necessity_source":"explicit"}'::jsonb,
      '{"expense_pattern":"variable","expense_pattern_source":"category_default"}'::jsonb
    ] loop
      expected:=empty_snapshot||snapshot;
      perform pg_temp.f04_preview('transaction',jsonb_build_object('p_input',input||snapshot,'p_fee_cents',0),90,expected);
      perform pg_temp.f04_preview('purchase',jsonb_build_object('p_tipo','parcelada','p_dados',purchase||snapshot,
        'p_entrada',jsonb_build_object('amount_cents',100,'account_id',bank,'occurred_at',current_date,'payment_method','pix')),90,expected);
      perform pg_temp.f04_preview('purchase',jsonb_build_object('p_tipo','financiamento','p_dados',debt||snapshot,
        'p_entrada',jsonb_build_object('amount_cents',100,'account_id',bank,'occurred_at',current_date,'payment_method','pix')),90,expected);
      perform pg_temp.f04_preview('recurring',jsonb_build_object('p_input',recurring||snapshot),90,expected);
    end loop;
    snapshot:='{"expense_pattern":"fixed","expense_pattern_source":"explicit","expense_necessity":"essential","expense_necessity_source":"category_default"}';
    -- Declared paid history keeps the same snapshot as the unpaid debt contract.
    perform pg_temp.f04_preview('purchase',jsonb_build_object('p_tipo','financiamento','p_dados',debt||snapshot||
      jsonb_build_object('remaining_cents',800,'installments_paid',1,'first_due_date',current_date-40)),90,snapshot);
    -- Card recurrence uses occurrence date for classification, invoice date for due_at.
    perform pg_temp.f04_preview('recurring',jsonb_build_object('p_input',recurring||snapshot||
      jsonb_build_object('account_id',card,'payment_method','credit')),90,snapshot);
    perform pg_temp.f04_reject('transaction',jsonb_build_object('p_input',input||
      '{"expense_pattern":"sometimes","expense_pattern_source":"explicit"}'::jsonb),'Classificação de gasto inválida');
    perform pg_temp.f04_reject('recurring',jsonb_build_object('p_input',recurring||
      '{"expense_necessity":"essential"}'::jsonb),'Classificação exige valor e origem juntos');
    -- A Pix fee is its own expense; never copy the parent's non-null snapshot.
    perform pg_temp.f04_preview('transaction',jsonb_build_object('p_input',input||snapshot||
      jsonb_build_object('account_id',card),'p_fee_cents',50),90,snapshot);
    saved:=public.save_transaction_payment(null,input||snapshot,0,null,gen_random_uuid());
    tx:=(saved->>'id')::uuid; revision:=(saved->>'revision')::bigint;
    -- Omitted dimensions survive edits; a deliberate clear replaces only one pair.
    args:=jsonb_build_object('p_transaction_id',tx,'p_expected_revision',revision,'p_fee_cents',0);
    perform pg_temp.f04_preview('transaction',args||jsonb_build_object('p_input','{"description":"F06 title only"}'::jsonb),90,snapshot);
    perform pg_temp.f04_preview('transaction',args||jsonb_build_object('p_input',
      '{"expense_pattern":null,"expense_pattern_source":"explicit"}'::jsonb),90,
      snapshot||'{"expense_pattern":null,"expense_pattern_source":"explicit"}'::jsonb);
    perform pg_temp.f04_preview('transaction',args||jsonb_build_object('p_input',empty_snapshot||'{"kind":"income"}'::jsonb),90,empty_snapshot);
    perform pg_temp.f04_preview('recurring',jsonb_build_object('p_input',recurring||empty_snapshot||'{"kind":"income"}'::jsonb),90,empty_snapshot);
    assert (select pg_temp.f06_classification(to_jsonb(t)) from public.transactions t where id=tx)=snapshot,
      'preview metadata edit or income clear persisted';
    raise exception using errcode='PTF06',message='classification fixtures rollback';
  exception when sqlstate 'PTF06' then null; end;
  raise notice 'PASS F06 preview: explicit/default/NULL/single-dimension snapshots; real transaction/purchase/entry/debt/recurring parity; edit omission/clear; income; independent Pix fee; no persistence';
end $$;

do $$
declare bank uuid:='00000000-0000-0000-0000-00000000f405';
  other_bank uuid:='00000000-0000-0000-0000-00000000f406';
  foreign_bank uuid:='00000000-0000-0000-0000-00000000f407';
  card uuid:='00000000-0000-0000-0000-00000000f408'; inclusive uuid:='00000000-0000-0000-0000-00000000f409';
  missing_limit uuid:='00000000-0000-0000-0000-00000000f410'; zero_limit uuid:='00000000-0000-0000-0000-00000000f411';
  review uuid:='00000000-0000-0000-0000-00000000f412';
  input jsonb; args jsonb; p jsonb; row jsonb; limits jsonb; data jsonb; entry jsonb; saved jsonb;
  existing uuid; revision bigint; dt date; cl date; due date; cc uuid; paid int; installments int; expected_amount bigint;
  start date:=current_date+5; stop date; mode text; n int; automatic boolean; canonical_status text;
begin
  input:=jsonb_build_object('kind','expense','amount_cents',12345,'description','F04 Pix',
    'account_id',bank,'occurred_at',current_date,'status','cleared','payment_method','pix');
  args:=jsonb_build_object('p_transaction_id',null,'p_input',input,'p_fee_cents',0,'p_expected_revision',null);
  p:=pg_temp.f04_preview('transaction',args);
  assert (select (b->>'cleared_cents')::bigint from jsonb_array_elements(p->'after'->'balances') b where b->>'account_id'=bank::text)=87655,
    'settled Pix must reduce real current cash by exactly12345';
  assert p->'schedule'->0->>'paid_at'=current_date::text and p->'schedule'->0->>'status'='cleared';
  assert not exists(select 1 from jsonb_array_elements(p->'before'->'balances') b where b->>'account_id'=foreign_bank::text),
    'foreign workspace balances leaked';
  input:=input||jsonb_build_object('status','pending','occurred_at',current_date+5,'due_at',current_date+8);
  p:=pg_temp.f04_preview('transaction',args||jsonb_build_object('p_input',input));
  assert (select (b->>'cleared_cents')::bigint from jsonb_array_elements(p->'after'->'balances') b where b->>'account_id'=bank::text)=100000,
    'pending payment changed real current cash';
  assert (select (b->>'saldo_fim')::bigint from jsonb_array_elements(p->'after'->'accounts') b where b->>'account_id'=bank::text)=87655,
    'pending payment missing from projected account cash';
  assert p->'schedule'->0->>'due_at'=(current_date+8)::text;

  input:=jsonb_build_object('kind','transfer','amount_cents',1111,'description','F04 transfer',
    'account_id',bank,'counterparty_account_id',other_bank,'occurred_at',current_date,'status','cleared','payment_method','pix');
  p:=pg_temp.f04_preview('transaction',args||jsonb_build_object('p_input',input));
  assert (select sum((b->>'cleared_cents')::bigint) from jsonb_array_elements(p->'after'->'balances') b where b->>'type'='checking')=150000,
    'own transfer must be neutral across real cash accounts';
  assert p->'schedule'->0->>'counterparty_account_id'=other_bank::text;

  input:=jsonb_build_object('kind','expense','amount_cents',100001,'description','F04 card Pix',
    'account_id',card,'occurred_at',current_date,'status','pending','payment_method','pix');
  p:=pg_temp.f04_preview('transaction',args||jsonb_build_object('p_input',input,'p_fee_cents',321));
  assert p->>'schedule_total'='2';
  assert (select sum((s->>'amount_cents')::bigint) from jsonb_array_elements(p->'schedule') s)=100322,
    'card Pix fee is missing or counted twice';
  assert (select count(*) from jsonb_array_elements(p->'schedule') s where (s->>'is_fee')::boolean)=1;
  assert (select (b->>'available_limit_cents')::bigint from jsonb_array_elements(p->'after'->'limits') b where b->>'account_id'=card::text)=-322,
    'all owned card fee exposure must reduce available credit including negative';
  assert (select (b->>'cleared_cents')::bigint from jsonb_array_elements(p->'after'->'balances') b where b->>'account_id'=bank::text)=100000,
    'card purchase paid cash before invoice due';
  foreach cc in array array[missing_limit,zero_limit,review] loop
    p:=pg_temp.f04_preview('transaction',args||jsonb_build_object('p_input',input||jsonb_build_object('account_id',cc),'p_fee_cents',0));
    select b into limits from jsonb_array_elements(p->'after'->'limits') b where b->>'account_id'=cc::text;
    if cc=zero_limit then
      assert limits->>'limit_status'='available' and (limits->>'available_limit_cents')::bigint=-100001,'zero limit is not missing';
    else assert limits->'available_limit_cents'='null'::jsonb and limits->>'limit_status'=case when cc=review then 'needs_review' else 'not_set' end,
      'missing/needs-review limit must remain unknown'; end if;
  end loop;

  -- Closing edge and inclusive behavior; explicit independent February leap expectations.
  foreach cc in array array[card,inclusive] loop
    foreach dt in array array[date '2028-01-30',date '2028-01-31',date '2028-02-01',date '2028-02-28',date '2028-02-29',date '2028-03-01'] loop
      cl:=case when dt='2028-01-30' or dt='2028-01-31' and cc=inclusive then date '2028-01-31'
        when dt='2028-01-31' or dt in(date '2028-02-01',date '2028-02-28') or dt='2028-02-29' and cc=inclusive then date '2028-02-29'
        else date '2028-03-31' end;
      due:=(date_trunc('month',cl)+interval '1 month')::date+9;
      p:=pg_temp.f04_preview('transaction',args||jsonb_build_object('p_input',input||jsonb_build_object('account_id',cc,'occurred_at',dt),'p_fee_cents',0));
      row:=p->'schedule'->0;
      assert row->>'invoice_closing_date'=cl::text and row->>'invoice_due_date'=due::text,
        format('wrong invoice on edge %s / %s: %s',dt,cc,row);
    end loop;
  end loop;

  -- A standalone edit must use real optimistic revision and restore the old content.
  saved:=public.save_transaction_payment(null,jsonb_build_object('kind','expense','amount_cents',100,'description','F04 existing',
    'account_id',bank,'occurred_at',current_date,'status','cleared'),0,null,gen_random_uuid());
  existing:=(saved->>'id')::uuid; revision:=(saved->>'revision')::bigint;
  p:=pg_temp.f04_preview('transaction',jsonb_build_object('p_transaction_id',existing,'p_input',jsonb_build_object('amount_cents',200),
    'p_fee_cents',null,'p_expected_revision',revision));
  assert p->'schedule'->0->>'amount_cents'='200';
  assert (select amount_cents from public.transactions where id=existing)=100;
  perform pg_temp.f04_reject('transaction',jsonb_build_object('p_transaction_id',existing,'p_input','{}'::jsonb,'p_expected_revision',revision-1),'%mudou%');
  perform pg_temp.f04_reject('transaction',jsonb_build_object('p_transaction_id','00000000-0000-0000-0000-00000000f413',
    'p_input','{}'::jsonb,'p_expected_revision',0),'%não encontrado%');
  saved:=public.create_purchase('parcelada',jsonb_build_object('p_account_id',bank,'p_total_cents',1000,
    'p_installments',2,'p_occurred_at',current_date+5,'p_description','F04 linked guard'),null,gen_random_uuid());
  select id,edit_revision into existing,revision from public.transactions where installment_plan_id=(saved->'ids'->>0)::uuid order by installment_no limit 1;
  perform pg_temp.f04_reject('transaction',jsonb_build_object('p_transaction_id',existing,'p_input','{}'::jsonb,
    'p_expected_revision',revision),'%alcance da série%');

  -- Full contract even beyond the cash horizon; cents remainder belongs to final installment.
  data:=jsonb_build_object('p_account_id',card,'p_total_cents',10001,'p_installments',3,'p_paid_installments',0,
    'p_occurred_at',date '2028-01-31','p_description','F04 installment','p_payment_method','credit');
  entry:=jsonb_build_object('amount_cents',777,'account_id',other_bank,'occurred_at',current_date,'payment_method','pix');
  p:=pg_temp.f04_preview('purchase',jsonb_build_object('p_tipo','parcelada','p_dados',data,'p_entrada',entry),1);
  assert p->>'schedule_scope'='contract' and p->>'schedule_total'='4';
  assert (select sum((s->>'amount_cents')::bigint) from jsonb_array_elements(p->'schedule') s)=10778;
  assert (select s->>'amount_cents' from jsonb_array_elements(p->'schedule') s where s->>'installment_no'='3')='3335';
  assert (select s->>'occurred_at' from jsonb_array_elements(p->'schedule') s where s->>'installment_no'='2')='2028-02-29';
  assert (select count(*) from jsonb_array_elements(p->'schedule') s where (s->>'is_entry')::boolean and s->>'account_id'=other_bank::text)=1,
    'entry from other bank is not a paid installment or a card expense';
  assert (select (b->>'available_limit_cents')::bigint from jsonb_array_elements(p->'after'->'limits') b where b->>'account_id'=card::text)=89999;
  data:=data||jsonb_build_object('p_account_id',bank,'p_total_cents',10002,'p_occurred_at',date '2024-01-31','p_paid_installments',2,'ultimo_dia',true,'p_payment_method','pix');
  p:=pg_temp.f04_preview('purchase',jsonb_build_object('p_tipo','parcelada','p_dados',data));
  assert (select count(*) from jsonb_array_elements(p->'schedule') s where s->>'status'='cleared')=2;
  assert (select s->>'occurred_at' from jsonb_array_elements(p->'schedule') s where s->>'installment_no'='2')='2024-02-29';
  data:=data||jsonb_build_object('p_total_cents',7200,'p_installments',72,'p_occurred_at',current_date+1,'p_paid_installments',0);
  p:=pg_temp.f04_preview('purchase',jsonb_build_object('p_tipo','parcelada','p_dados',data),1);
  assert p->>'schedule_total'='72' and p->>'schedule_truncated'='false',
    'long installment contract must not disappear outside horizon';

  foreach mode in array array['fixed_installments','amortized'] loop
    data:=jsonb_build_object('name','F04 debt '||mode,'kind','financing','calculation_mode',mode,
      'principal_cents',100000,'remaining_cents',100000,'interest_rate_monthly',0,'installments',5,
      'installments_paid',0,'installment_cents',20000,'account_id',bank,'due_day',31,'first_due_date',date '2028-01-31','payment_method','boleto');
    p:=pg_temp.f04_preview('purchase',jsonb_build_object('p_tipo','financiamento','p_dados',data,'p_entrada',entry),1);
    assert p->>'schedule_total'='6' and p->>'schedule_scope'='contract';
    assert (select sum((s->>'amount_cents')::bigint) from jsonb_array_elements(p->'schedule') s where s->>'origin'='debt_schedule')=100000;
    assert (select s->>'due_at' from jsonb_array_elements(p->'schedule') s where s->>'installment_no'='2')='2028-02-29';
  end loop;
  data:=data||jsonb_build_object('name','F04 paid declared','calculation_mode','fixed_installments','remaining_cents',60000,
    'installments_paid',2,'first_due_date',date '2024-01-31');
  p:=pg_temp.f04_preview('purchase',jsonb_build_object('p_tipo','financiamento','p_dados',data));
  assert (select count(*) from jsonb_array_elements(p->'schedule') s where s->>'origin'='debt_estimate' and s->>'status'='declared')=2,
    'counted paid history must appear without invented payments';
  data:=data||jsonb_build_object('name','F04 long debt','principal_cents',40000,'remaining_cents',40000,
    'installments',400,'installments_paid',0,'installment_cents',100,'first_due_date',current_date+10);
  p:=pg_temp.f04_preview('purchase',jsonb_build_object('p_tipo','financiamento','p_dados',data),1);
  assert p->>'schedule_total'='400' and p->>'schedule_truncated'='true' and jsonb_array_length(p->'schedule')=366,
    'long debt contract must explicitly report bounded schedule';

  -- Existing calendar helpers supply month end, finite end and recurrence card dates.
  start:=date_trunc('month',current_date+interval '1 month')::date;
  start:=private.day_in_month(start,31);
  input:=jsonb_build_object('kind','expense','amount_cents',1299,'description','F04 recurring',
    'account_id',bank,'rrule','FREQ=MONTHLY;BYMONTHDAY=31','next_run_at',start::timestamp at time zone 'America/Sao_Paulo',
    'dtstart',start::timestamp at time zone 'America/Sao_Paulo','payment_method','pix');
  p:=pg_temp.f04_preview('recurring',jsonb_build_object('p_input',input),366);
  assert p->>'schedule_scope'='horizon' and (p->>'schedule_total')::int between 10 and 12;
  for row in select value from jsonb_array_elements(p->'schedule') loop
    assert row->>'origin'='recurring' and row->>'status'='pending' and row->>'amount_cents'='1299';
    dt:=(row->>'due_at')::date;
    assert dt=(date_trunc('month',dt)+interval '1 month - 1 day')::date,'day31 skipped/moved short month';
  end loop;
  stop:=private.day_in_month(private.add_months(start,2),31);
  p:=pg_temp.f04_preview('recurring',jsonb_build_object('p_input',input||jsonb_build_object('end_date',stop)),366);
  assert p->>'schedule_total'='3','finite recurrence end not honored';
  p:=pg_temp.f04_preview('recurring',jsonb_build_object('p_input',input||jsonb_build_object('account_id',inclusive,'payment_method','credit')),366);
  for row in select value from jsonb_array_elements(p->'schedule') loop
    dt:=(row->>'occurred_at')::date;
    assert row->>'invoice_closing_date'=dt::text,'recurring inclusive card dates must use same canonical invoice window';
  end loop;

  -- Today's virtual occurrence must preserve the ledger helper's automatic
  -- confirmation state. It is still an estimate, never a recorded payment.
  foreach automatic in array array[false,true] loop
    input:=jsonb_build_object('kind','expense','amount_cents',1299,'description','F04 today automatic',
      'account_id',bank,'rrule','FREQ=MONTHLY;BYMONTHDAY='||extract(day from current_date)::int,
      'next_run_at',current_date::timestamp at time zone 'America/Sao_Paulo',
      'dtstart',current_date::timestamp at time zone 'America/Sao_Paulo',
      'auto_confirm',automatic,'payment_method','pix');
    begin
      saved:=public.create_recurring_payment(input,gen_random_uuid());
      select e.status into canonical_status from public.ledger_expected_lines(current_date,current_date,(saved->>'id')::uuid) e
        where e.origin='recurring';
      assert canonical_status=case when automatic then 'cleared' else 'pending' end,
        'today canonical recurrence status disagrees with automatic confirmation';
      raise exception using errcode='PTFC4',message='canonical recurring status rollback';
    exception when sqlstate 'PTFC4' then null; end;
    assert not exists(select 1 from public.recurring_transactions where id=(saved->>'id')::uuid),
      'canonical recurrence status oracle leaked its series';
    p:=pg_temp.f04_preview('recurring',jsonb_build_object('p_input',input),1);
    assert p->>'schedule_total'='1' and p->'schedule'->0->>'status'=canonical_status,
      format('virtual recurring status differs from canonical ledger today (auto_confirm=%s): expected %s, got %s',
        automatic,canonical_status,p->'schedule'->0->>'status');
    assert p->'schedule'->0->>'estimated'='true' and p->'schedule'->0->'paid_at'='null'::jsonb,
      'virtual automatic confirmation must not invent a recorded payment';
  end loop;

  perform pg_temp.f04_reject('sql',args,'%Operação%');
  perform pg_temp.f04_reject(null,args,'%Operação%');
  perform pg_temp.f04_reject('transaction',args||'{"p_request_id":"00000000-0000-0000-0000-00000000f499"}','%Argumentos%');
  perform pg_temp.f04_reject('purchase',jsonb_build_object('p_tipo','parcelada','p_dados',data||'{"user_id":"foreign"}'),'%Campos%');
  perform pg_temp.f04_reject('recurring',jsonb_build_object('p_input',input||'{"workspace_id":"foreign"}'),'%Campos%');
  perform pg_temp.f04_reject('transaction',args||jsonb_build_object('p_input',input||'{"workspace_id":"foreign"}'),'%Campos%');
  perform pg_temp.f04_reject('transaction',args||'{"p_transaction_id":"not-uuid"}','%uuid%');
  perform pg_temp.f04_reject('transaction',args||'{"p_transaction_id":true}','%Identificador%');
  perform pg_temp.f04_reject('transaction',args||'{"p_fee_cents":1.5}','%Identificador%');
  perform pg_temp.f04_reject('transaction',args||'{"p_fee_cents":-1}','%Juro%');
  perform pg_temp.f04_reject('transaction','null','%Argumentos%');
  perform pg_temp.f04_reject('transaction','[]','%Argumentos%');
  perform pg_temp.f04_reject('transaction','{"p_input":null}','%Dados%');
  perform pg_temp.f04_reject('transaction',args||jsonb_build_object('p_input',jsonb_build_object('kind','expense','amount_cents',0)),'%centavos%');
  perform pg_temp.f04_reject('transaction',args,'%horizonte%',0);
  perform pg_temp.f04_reject('transaction',args,'%horizonte%',367);
  perform pg_temp.f04_reject('transaction',args,'%horizonte%',null);
  args:=jsonb_build_object('p_input',jsonb_build_object('kind','expense','amount_cents',50,'occurred_at',current_date,'account_id',foreign_bank));
  perform pg_temp.f04_reject('transaction',args,'%');
  args:=jsonb_build_object('p_input',jsonb_build_object('kind','expense','amount_cents',50,'occurred_at',current_date,'account_id',bank));
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.f04_reject('transaction',args,'%Autenticação%');
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000f401',true);
  raise notice 'PASS F04: rollback contents/revisions/versions/nonces; preview-real-write parity; Pix/pending/transfer/fee; invoice edges/leap; entries/full contracts/history/bounds; recurrence; limit quality; auth/RLS/validation';
end $$;
reset role;

-- Test-only trigger injects a genuinely DEFERRED invalid row after the canonical
-- recurring writer starts. Without forced final constraints a false preview succeeds.
create function pg_temp.f04_inject_deferred() returns trigger language plpgsql as $$
begin
  if current_setting('test.f04.inject',true)='payment' then
    update public.transactions set payment_method='credit' where id=current_setting('test.f04.inject_parent')::uuid;
  elsif current_setting('test.f04.inject',true)='fee' then
    update public.transactions set payment_method='boleto' where id=current_setting('test.f04.inject_parent')::uuid;
  end if;
  return null;
end $$;
create trigger zz_f04_test_deferred after insert on public.recurring_transactions
  for each row execute function pg_temp.f04_inject_deferred();
set local role authenticated;
do $$
declare saved jsonb; series_input jsonb; bank uuid:='00000000-0000-0000-0000-00000000f405';
  card uuid:='00000000-0000-0000-0000-00000000f408';
begin
  series_input:=jsonb_build_object('kind','expense','amount_cents',10,'rrule','FREQ=MONTHLY;BYMONTHDAY=8',
    'next_run_at',(current_date+10)::timestamp at time zone 'America/Sao_Paulo','account_id',bank);
  saved:=public.save_transaction_payment(null,jsonb_build_object('kind','expense','amount_cents',50,'account_id',bank,'occurred_at',current_date),0,null,gen_random_uuid());
  set constraints public.payment_method_compatibility,public.owned_fee_graph deferred;
  perform set_config('test.f04.inject_parent',saved->>'id',true);
  perform set_config('test.f04.inject','payment',true);
  perform pg_temp.f04_reject('recurring',jsonb_build_object('p_input',series_input),'%cartão%');
  perform set_config('test.f04.inject','',true);
  saved:=public.save_transaction_payment(null,jsonb_build_object('kind','expense','amount_cents',50,'account_id',card,
    'occurred_at',current_date,'payment_method','pix'),5,null,gen_random_uuid());
  set constraints public.payment_method_compatibility,public.owned_fee_graph deferred;
  perform set_config('test.f04.inject_parent',saved->>'id',true);
  perform set_config('test.f04.inject','fee',true);
  perform pg_temp.f04_reject('recurring',jsonb_build_object('p_input',series_input),'%Juro vinculado%');
  perform set_config('test.f04.inject','',true);
  raise notice 'PASS F04: genuine deferred payment/owned-fee constraints propagate and roll back';
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform public.preview_finance_write('transaction','{"p_input":{}}');
    raise exception 'anon executed preview';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
