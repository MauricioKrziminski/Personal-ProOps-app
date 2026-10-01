-- Retry after success/lost response must replay the result, including a deleted origin.
-- Before the overload exists, the test invokes the legacy endpoint to demonstrate RED
-- (same intent creates two destinations); afterwards every call uses the four-arg RPC.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e5a1';
  w uuid := '00000000-0000-0000-0000-00000000e5b1';
  other_u uuid := '00000000-0000-0000-0000-00000000e5a2';
  other_w uuid := '00000000-0000-0000-0000-00000000e5b2';
begin
  insert into auth.users(id,email) values(u,'conversion-request@example.invalid'),(other_u,'conversion-request-foreign@example.invalid');
  insert into public.profiles(id) values(u),(other_u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values
    (w,u,'Conversion request QA',now()-interval '2 days'),(other_w,other_u,'Foreign conversion QA',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(other_w,other_u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type) values
    ('00000000-0000-0000-0000-00000000e5c1',w,u,'Conversion QA cash','checking'),
    ('00000000-0000-0000-0000-00000000e5c2',other_w,other_u,'Foreign conversion cash','checking');
  insert into public.debts(id,workspace_id,user_id,name,principal_cents,remaining_cents)
    values('00000000-0000-0000-0000-00000000e5d2',other_w,other_u,'Foreign conversion debt',100000,100000);
end $$;
create function pg_temp.convert_request(o jsonb,s text,d jsonb,r uuid) returns jsonb
language plpgsql as $$ begin
  if to_regprocedure('public.converter_registro(jsonb,text,jsonb,uuid)') is null then
    return public.converter_registro(o,s,d);
  end if;
  return public.converter_registro(o,s,d,r);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000e5a1',true);
do $$
declare
  u uuid := auth.uid();
  w uuid := '00000000-0000-0000-0000-00000000e5b1';
  a uuid := '00000000-0000-0000-0000-00000000e5c1';
  d uuid;
  req uuid;
  entry uuid;
  scope text;
  destination_type text;
  origin jsonb;
  destination jsonb;
  first_result jsonb;
  second_result jsonb;
  before_history jsonb;
  rows_after jsonb;
  cache_after int;
  cases int := 0;
begin
  foreach scope in array array['desta_em_diante','manter','todas'] loop
    foreach destination_type in array array['recorrente','financiamento','parcelada','lancamento'] loop
      d := gen_random_uuid(); req := gen_random_uuid();
      insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,
        principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,
        installment_cents,account_id,due_day,first_due_date)
        values(d,w,u,'CR source '||d,'financing','fixed_installments',40000,40000,0,4,0,10000,a,4,current_date+10);
      entry := private.insert_purchase_down_payment('financiamento',d,
        jsonb_build_object('amount_cents',20000,'account_id',a,'occurred_at',current_date-10));
      perform public.pay_debt_installment(d,10000,a,current_date-3);
      perform public.pay_debt_installment(d,10000,a,current_date-2);
      select jsonb_agg(to_jsonb(t) order by t.id) into before_history from public.transactions t
        where debt_id=d or down_payment_debt_id=d;
      origin := jsonb_build_object('tipo','divida','id',d);
      if destination_type='recorrente' then
        destination := jsonb_build_object('tipo','recorrente','dados',jsonb_build_object(
          'kind','expense','description','CR recurring '||req,'amount_cents',30000,'account_id',a,
          'rrule','FREQ=MONTHLY;BYMONTHDAY=4','next_run_at',(current_date+30)::text||'T12:00:00-03:00'));
      elsif destination_type='financiamento' then
        destination := jsonb_build_object('tipo','financiamento','dados',jsonb_build_object(
          'name','CR financing '||req,'kind','financing','calculation_mode','fixed_installments',
          'principal_cents',90000,'remaining_cents',90000,'interest_rate_monthly',0,
          'installments',3,'installments_paid',0,'installment_cents',30000,'account_id',a,
          'due_day',4,'first_due_date',current_date+30,
          'down_payment',jsonb_build_object('amount_cents',5000,'account_id',a,'occurred_at',current_date-1)));
      elsif destination_type='parcelada' then
        destination := jsonb_build_object('tipo','parcelada','dados',jsonb_build_object(
          'p_account_id',a,'p_total_cents',90000,'p_installments',3,'p_paid_installments',0,
          'p_occurred_at',current_date+30,'p_description','CR purchase '||req,
          'down_payment',jsonb_build_object('amount_cents',5000,'account_id',a,'occurred_at',current_date-1)));
      else
        destination := jsonb_build_object('tipo','lancamento','dados',jsonb_build_object('linhas',jsonb_build_array(
          jsonb_build_object('kind','expense','amount_cents',30000,'account_id',a,
            'occurred_at',current_date,'status','cleared','source','app','description','CR cash '||req))));
      end if;
      first_result := pg_temp.convert_request(origin,scope,destination,req);
      if cases=0 then
        perform set_config('test.cr.request',req::text,true);
        perform set_config('test.cr.origin',origin::text,true);
        perform set_config('test.cr.destination',destination::text,true);
        perform set_config('test.cr.result',first_result::text,true);
      end if;
      select jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t where workspace_id=w),
        'debts',(select jsonb_agg(to_jsonb(t) order by t.id) from public.debts t where workspace_id=w),
        'plans',(select jsonb_agg(to_jsonb(t) order by t.id) from public.installment_plans t where workspace_id=w),
        'series',(select jsonb_agg(to_jsonb(t) order by t.id) from public.recurring_transactions t where workspace_id=w)) into rows_after;
      select count(*) into cache_after from private.purchase_write_requests where user_id=u;
      second_result := pg_temp.convert_request(origin,scope,destination,req);
      assert second_result=first_result,format('same request duplicated %s destination with scope %s',destination_type,scope);
      assert rows_after=jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t where workspace_id=w),
        'debts',(select jsonb_agg(to_jsonb(t) order by t.id) from public.debts t where workspace_id=w),
        'plans',(select jsonb_agg(to_jsonb(t) order by t.id) from public.installment_plans t where workspace_id=w),
        'series',(select jsonb_agg(to_jsonb(t) order by t.id) from public.recurring_transactions t where workspace_id=w));
      assert (select count(*) from private.purchase_write_requests where user_id=u)=cache_after;
      assert (select count(*) from private.purchase_write_requests where user_id=u and request_id=req and result=first_result)=1;
      if scope='todas' then
        assert not exists(select 1 from public.debts where id=d);
        assert not exists(select 1 from public.transactions where debt_id=d or down_payment_debt_id=d);
      else
        assert (select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t
          where debt_id=d or down_payment_debt_id=d)=before_history;
        assert (select archived from public.debts where id=d)=(scope='desta_em_diante');
      end if;
      if destination_type in ('financiamento','parcelada') then
        assert (select count(*) from public.transactions where
          down_payment_debt_id=(first_result->'ids'->>0)::uuid or down_payment_plan_id=(first_result->'ids'->>0)::uuid)=1;
      end if;
      -- Payload validation precedes origin lookup, even after All deleted that origin.
      begin
        perform pg_temp.convert_request(origin,scope,destination||'{"extra":"different"}',req);
        assert false,'same ID with changed payload must refuse';
      exception when raise_exception then assert sqlerrm='Esta tentativa já foi usada com dados diferentes'; end;
      begin
        perform pg_temp.convert_request(origin,'converter',destination,req);
        assert false,'same ID with changed scope must refuse before core validation';
      exception when raise_exception then assert sqlerrm='Esta tentativa já foi usada com dados diferentes'; end;
      begin
        perform pg_temp.convert_request(jsonb_set(origin,'{id}',to_jsonb(gen_random_uuid()::text)),scope,destination,req);
        assert false,'same ID with changed origin must refuse before origin lookup';
      exception when raise_exception then assert sqlerrm='Esta tentativa já foi usada com dados diferentes'; end;
      if destination_type in ('financiamento','parcelada') then
        begin
          perform pg_temp.convert_request(origin,scope,
            jsonb_set(destination,'{dados,down_payment,amount_cents}','5001'),req);
          assert false,'same ID with changed entry must refuse';
        exception when raise_exception then assert sqlerrm='Esta tentativa já foi usada com dados diferentes'; end;
      end if;
      cases := cases+1;
    end loop;
  end loop;
  raise notice 'CR1: % retry cases, debt+entry+two payments x future/keep/all x four destinations; identical result/rows/cache',cases;
end $$;

do $$
declare
  u uuid := auth.uid();
  w uuid := '00000000-0000-0000-0000-00000000e5b1';
  a uuid := '00000000-0000-0000-0000-00000000e5c1';
  req uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  origin jsonb;
  destination jsonb;
  made jsonb;
  cache_before int;
  rows_before int;
begin
  insert into public.debts(id,workspace_id,user_id,name,principal_cents,remaining_cents)
    values(d,w,u,'CR failure source',100000,100000);
  origin := jsonb_build_object('tipo','divida','id',d);
  destination := jsonb_build_object('tipo','financiamento','dados',jsonb_build_object(
    'name','CR retry corrected','kind','financing','calculation_mode','fixed_installments',
    'principal_cents',90000,'remaining_cents',90000,'interest_rate_monthly',0,
    'installments',3,'installments_paid',0,'installment_cents',30000,'account_id',a,
    'due_day',4,'first_due_date',current_date+30,
    'down_payment',jsonb_build_object('amount_cents',5000,'account_id',a,'occurred_at',current_date+1)));
  select count(*) into cache_before from private.purchase_write_requests where user_id=u;
  select count(*) into rows_before from public.debts where workspace_id=w;
  begin
    perform pg_temp.convert_request(origin,'todas',destination,req);
    assert false,'failed entry must roll back destination and request';
  exception when raise_exception then assert sqlerrm='Entrada exige valor positivo e data já ocorrida'; end;
  assert (select count(*) from private.purchase_write_requests where user_id=u)=cache_before;
  assert not exists(select 1 from private.purchase_write_requests where user_id=u and request_id=req);
  assert (select count(*) from public.debts where workspace_id=w)=rows_before;
  assert exists(select 1 from public.debts where id=d);
  destination := jsonb_set(destination,'{dados,down_payment,occurred_at}',to_jsonb(current_date::text));
  made := pg_temp.convert_request(origin,'todas',destination,req);
  assert pg_temp.convert_request(origin,'todas',destination,req)=made;
  begin
    perform pg_temp.convert_request(origin,'todas',destination,null);
    assert false,'new signature requires UUID';
  exception when raise_exception then assert sqlerrm='Identificador da requisição obrigatório'; end;
  -- Cross-operation collision with a successful create_purchase request is refused.
  req := gen_random_uuid();
  perform public.create_purchase('financiamento',((destination->'dados')-'down_payment')||'{"name":"CR cross-operation"}'::jsonb,null,req);
  begin
    perform pg_temp.convert_request(origin,'todas',destination,req);
    assert false,'create request ID cannot be reused for conversion';
  exception when raise_exception then assert sqlerrm='Esta tentativa já foi usada com dados diferentes'; end;
  req := current_setting('test.cr.request')::uuid;
  begin
    perform public.create_purchase('financiamento',((destination->'dados')-'down_payment')||'{"name":"CR reverse cross-operation"}'::jsonb,null,req);
    assert false,'conversion request ID cannot be reused by create_purchase';
  exception when raise_exception then assert sqlerrm='Esta tentativa já foi usada com dados diferentes'; end;
  raise notice 'CR2: failed core rolls back cache/destination/origin, corrected same-ID retry works; null/cross-operation refused';
end $$;

do $$
declare
  u uuid := auth.uid();
  w uuid := '00000000-0000-0000-0000-00000000e5b1';
  a uuid := '00000000-0000-0000-0000-00000000e5c1';
  p uuid;
  e uuid;
  req uuid;
  scope text;
  made jsonb;
  entry_before jsonb;
  origin jsonb;
  destination jsonb;
begin
  foreach scope in array array['desta_em_diante','todas'] loop
    req := gen_random_uuid();
    made := public.create_purchase('parcelada',jsonb_build_object('p_account_id',a,
      'p_total_cents',90000,'p_installments',3,'p_paid_installments',0,
      'p_occurred_at',current_date+10,'p_description','CR dissolving plan '||req),
      jsonb_build_object('amount_cents',5000,'account_id',a,'occurred_at',current_date-10),gen_random_uuid());
    p := (made->'ids'->>0)::uuid; e := (made->>'down_payment_id')::uuid;
    select to_jsonb(t) into entry_before from public.transactions t where id=e;
    origin := jsonb_build_object('tipo','plano','id',p);
    destination := jsonb_build_object('tipo','recorrente','dados',jsonb_build_object(
      'kind','expense','description','CR from plan '||req,'amount_cents',30000,'account_id',a,
      'rrule','FREQ=MONTHLY;BYMONTHDAY=4','next_run_at',(current_date+30)::text||'T12:00:00-03:00'));
    made := pg_temp.convert_request(origin,scope,destination,req);
    assert not exists(select 1 from public.installment_plans where id=p);
    assert pg_temp.convert_request(origin,scope,destination,req)=made;
    assert (select count(*) from public.recurring_transactions where id=(made->'ids'->>0)::uuid)=1;
    if scope='todas' then
      assert not exists(select 1 from public.transactions where id=e);
    else
      assert exists(select 1 from public.transactions t where id=e and down_payment_plan_id is null
        and (to_jsonb(t)-'down_payment_plan_id'-'edit_revision'-'updated_at')=
          (entry_before-'down_payment_plan_id'-'edit_revision'-'updated_at'));
    end if;
  end loop;
  raise notice 'CR4: deleted/dissolved plan origin replays same result; All deletes entry, future preserves same historical row';
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000e5a2',true);
do $$
declare
  req uuid := current_setting('test.cr.request')::uuid;
  origin jsonb := current_setting('test.cr.origin')::jsonb;
  destination jsonb := current_setting('test.cr.destination')::jsonb;
  made jsonb;
begin
  begin
    perform pg_temp.convert_request(origin,'todas',destination,req);
    assert false,'other user cannot retrieve original user result or access origin';
  exception when raise_exception then assert sqlerrm='Essa dívida não existe mais.'; end;
  assert not exists(select 1 from private.purchase_write_requests where request_id=req);
  origin := '{"tipo":"divida","id":"00000000-0000-0000-0000-00000000e5d2"}';
  destination := jsonb_build_object('tipo','lancamento','dados',jsonb_build_object('linhas',jsonb_build_array(
    jsonb_build_object('kind','expense','amount_cents',1234,'account_id','00000000-0000-0000-0000-00000000e5c2',
      'occurred_at',current_date,'status','cleared','source','app','description','Foreign own conversion'))));
  made := pg_temp.convert_request(origin,'todas',destination,req);
  assert made<>current_setting('test.cr.result')::jsonb;
  assert pg_temp.convert_request(origin,'todas',destination,req)=made;
  assert (select count(*) from private.purchase_write_requests where request_id=req)=1;
  raise notice 'CR3: request keys isolated per user/workspace; foreign cache/origin hidden; same UUID valid for own independent request';
end $$;
reset role;
do $$ begin
  assert (select count(*) from private.purchase_write_requests where request_id=current_setting('test.cr.request')::uuid)=2;
  assert not has_function_privilege('anon','public.converter_registro(jsonb,text,jsonb,uuid)','execute');
  assert not (select prosecdef from pg_proc where oid='public.converter_registro(jsonb,text,jsonb,uuid)'::regprocedure);
  assert (select pronargdefaults from pg_proc where oid='public.converter_registro(jsonb,text,jsonb,uuid)'::regprocedure)=0;
end $$;
rollback;
