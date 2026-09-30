-- Conversion dates belong to the DESTINATION. The source cutoff belongs to the
-- original series/occurrence, including paid history and overdue open bills.
-- Runs authenticated RPCs against isolated fixtures; every write is rolled back.
-- agent/.venv/bin/python scripts/sql-test.py supabase/tests/converter_recorrente_datas.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

create temporary table conversion_dates_context (usr uuid, ws uuid, account_id uuid);
grant select on conversion_dates_context to authenticated;
create temporary table conversion_dates_failures (label text, error text);
grant select,insert on conversion_dates_failures to authenticated;
do $$
declare
  u uuid := gen_random_uuid();
  w uuid;
  a uuid;
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  insert into auth.users(id,email) values(u,'conversion-dates-' || u || '@example.invalid');
  insert into public.profiles(id,timezone) values(u,'America/Sao_Paulo') on conflict(id) do update
    set timezone=excluded.timezone;
  select id into w from public.workspaces where owner_id=u order by created_at limit 1;
  if w is null then
    insert into public.workspaces(owner_id,name) values(u,'Conversion dates regression') returning id into w;
    insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  end if;
  insert into public.accounts(user_id,workspace_id,name,type,initial_balance_cents)
    values(u,w,'Conversion dates account','checking',100000) returning id into a;
  insert into conversion_dates_context values(u,w,a);
end $$;
set local role authenticated;

do $$
declare
  ctx record;
  source_kind text;
  scope text;
  target_kind text;
  date_case text;
  label text;
  source_name text;
  target_name text;
  source_id uuid;
  occurrence_id uuid;
  paid_id uuid;
  overdue_id uuid;
  later_id uuid;
  last_id uuid;
  target_id uuid;
  source_date date := current_date + 40;
  target_date date;
  paid_date date := current_date - 60;
  overdue_date date := current_date - 7;
  later_date date;
  last_date date;
  unmaterialized_date date;
  target_next date;
  source_rule text;
  origin jsonb;
  destination jsonb;
  result jsonb;
  source_before jsonb;
  lines_before jsonb;
  source_count integer;
  passed integer := 0;
  failures text[] := '{}';
begin
  select * into ctx from conversion_dates_context;
  source_rule := 'FREQ=MONTHLY;BYMONTHDAY=' || extract(day from source_date)::int;
  later_date := private.day_in_month((date_trunc('month',source_date)+interval '1 month')::date,
    extract(day from source_date)::int);
  last_date := private.day_in_month((date_trunc('month',source_date)+interval '2 months')::date,
    extract(day from source_date)::int);
  unmaterialized_date := private.day_in_month((date_trunc('month',source_date)+interval '3 months')::date,
    extract(day from source_date)::int);

  foreach source_kind in array array['serie','transacao'] loop
    foreach scope in array array['so_esta','desta_em_diante','todas','manter'] loop
      if source_kind='serie' and scope='so_esta' then continue; end if;
      foreach target_kind in array array['lancamento','recorrente','financiamento'] loop
        foreach date_case in array array['original','anterior','posterior','22-12-2026'] loop
          label := source_kind || '/' || scope || '/' || target_kind || '/' || date_case;
          source_name := 'source ' || label;
          target_name := 'target ' || label;
          target_date := case date_case when 'original' then source_date
            when 'anterior' then source_date - 15 when 'posterior' then source_date + 75
            else date '2026-12-22' end;
          begin
            insert into public.recurring_transactions
              (workspace_id,user_id,kind,amount_cents,description,account_id,rrule,dtstart,next_run_at,auto_confirm)
            values(ctx.ws,ctx.usr,'expense',900,source_name,ctx.account_id,source_rule,
              paid_date::timestamp at time zone 'America/Sao_Paulo',
              source_date::timestamp at time zone 'America/Sao_Paulo',false) returning id into source_id;
            insert into public.transactions
              (workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
            values(ctx.ws,ctx.usr,'expense',900,source_name,ctx.account_id,paid_date,paid_date,'cleared','recurring',source_id)
              returning id into paid_id;
            insert into public.transactions
              (workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
            values(ctx.ws,ctx.usr,'expense',900,source_name,ctx.account_id,overdue_date,overdue_date,'pending','recurring',source_id)
              returning id into overdue_id;
            insert into public.transactions
              (workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
            values(ctx.ws,ctx.usr,'expense',900,source_name,ctx.account_id,source_date,source_date,'pending','recurring',source_id)
              returning id into occurrence_id;
            insert into public.transactions
              (workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
            values(ctx.ws,ctx.usr,'expense',900,source_name,ctx.account_id,later_date,later_date,'pending','recurring',source_id)
              returning id into later_id;
            insert into public.transactions
              (workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
            values(ctx.ws,ctx.usr,'expense',900,source_name,ctx.account_id,last_date,last_date,'pending','recurring',source_id)
              returning id into last_id;
            select to_jsonb(r) into source_before from public.recurring_transactions r where id=source_id;
            select jsonb_agg(to_jsonb(t) order by t.id) into lines_before
              from public.transactions t where recurring_id=source_id;
            origin := jsonb_build_object('tipo',source_kind,'id',case when source_kind='serie' then source_id else occurrence_id end);
            destination := case target_kind
              when 'lancamento' then jsonb_build_object('linhas',jsonb_build_array(jsonb_build_object(
                'kind','expense','amount_cents',800,'description',target_name,'account_id',ctx.account_id,
                'occurred_at',target_date,'due_at',target_date,'status','pending','source','app','auto_confirm',false)))
              when 'recorrente' then jsonb_build_object('kind','expense','amount_cents',800,'description',target_name,
                'account_id',ctx.account_id,'rrule','FREQ=MONTHLY;BYMONTHDAY=' || extract(day from target_date)::int,
                'dtstart',target_date::timestamp at time zone 'America/Sao_Paulo',
                'next_run_at',target_date::timestamp at time zone 'America/Sao_Paulo','auto_confirm',false)
              else jsonb_build_object('name',target_name,'kind','financing','calculation_mode','fixed_installments',
                'principal_cents',2400,'remaining_cents',2400,'interest_rate_monthly',0,'installments',3,
                'installments_paid',0,'installment_cents',800,'account_id',ctx.account_id,
                'due_day',extract(day from target_date)::int,'first_due_date',target_date)
              end;
            result := public.converter_registro(origin,scope,jsonb_build_object('tipo',target_kind,'dados',destination));
            assert jsonb_array_length(result->'ids')>=1, 'destination ids absent';
            target_id := (result->'ids'->>0)::uuid;

            select count(*) into source_count from public.transactions where recurring_id=source_id;
            if scope='todas' then
              assert source_count=0, 'all left source occurrences';
              assert not exists(select 1 from public.recurring_transactions where id=source_id), 'all left source series';
              assert not exists(select 1 from public.transactions where id=any(array[paid_id,overdue_id,occurrence_id,later_id,last_id])),
                'all retained original paid or pending ids';
            else
              assert exists(select 1 from public.recurring_transactions where id=source_id), 'source historical series disappeared';
              assert exists(select 1 from public.transactions where id=paid_id and recurring_id=source_id
                and occurred_at=paid_date and due_at=paid_date and status='cleared' and amount_cents=900), 'paid history changed';
              assert exists(select 1 from public.transactions where id=overdue_id and recurring_id=source_id
                and occurred_at=overdue_date and due_at=overdue_date and status='pending' and amount_cents=900), 'overdue bill changed';
              if scope='desta_em_diante' then
                assert source_count=2, 'future retained source pending occurrences';
                assert (select end_date from public.recurring_transactions where id=source_id)=source_date-1,
                  'source cutoff followed destination date';
                assert not exists(select 1 from public.expected_recurring_occurrences(source_date,source_date+61,source_id)),
                  'future source still projected';
                assert not exists(select 1 from public.expected_recurring_occurrences(unmaterialized_date,unmaterialized_date,source_id)),
                  'source reappeared beyond materialized occurrences';
              elsif scope='so_esta' then
                assert source_count=4, 'one changed another source occurrence';
                assert exists(select 1 from public.transactions where id=later_id and recurring_id=source_id and occurred_at=later_date),
                  'one moved later source occurrence';
                assert exists(select 1 from private.recurring_moved_occurrences where recurring_id=source_id and original_date=source_date),
                  'one did not skip original source date';
                assert not exists(select 1 from public.expected_recurring_occurrences(source_date,source_date,source_id)),
                  'converted occurrence was projected again';
                assert exists(select 1 from public.expected_recurring_occurrences(unmaterialized_date,unmaterialized_date,source_id)),
                  'one stopped remaining source schedule';
                assert (select end_date from public.recurring_transactions where id=source_id) is null, 'one ended source';
              else
                assert source_count=5, 'keep changed source count';
                assert source_before=(select to_jsonb(r) from public.recurring_transactions r where id=source_id), 'keep changed source contract';
                assert lines_before=(select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t where recurring_id=source_id),
                  'keep changed source history';
              end if;
            end if;

            if target_kind='lancamento' then
              assert exists(select 1 from public.transactions where id=target_id and recurring_id is null and debt_id is null
                and installment_plan_id is null and description=target_name and amount_cents=800
                and occurred_at=target_date and due_at=target_date and status='pending'), 'one-time destination wrong';
              assert (select count(*) from public.transactions where description=target_name)=1, 'one-time destination duplicated';
              if scope='so_esta' then assert target_id=occurrence_id, 'one changed adopted id'; end if;
            elsif target_kind='recorrente' then
              assert exists(select 1 from public.recurring_transactions where id=target_id and description=target_name
                and amount_cents=800 and (dtstart at time zone 'America/Sao_Paulo')::date=target_date
                and (next_run_at at time zone 'America/Sao_Paulo')::date=target_date), 'recurring destination wrong';
              assert (select count(*) from public.recurring_transactions where description=target_name)=1, 'recurring destination duplicated';
              if scope='so_esta' then
                assert exists(select 1 from public.transactions where id=occurrence_id and recurring_id=target_id
                  and occurred_at=target_date and due_at=target_date and amount_cents=800), 'adopted recurring destination dates wrong';
                assert not exists(select 1 from public.expected_recurring_occurrences(target_date,target_date,target_id)),
                  'adopted recurring occurrence duplicated in read model';
              else
                assert exists(select 1 from public.expected_recurring_occurrences(target_date,target_date,target_id)
                  where due_date=target_date and amount_cents=800), 'recurring first destination absent from read model';
              end if;
              target_next := private.day_in_month((date_trunc('month',target_date)+interval '1 month')::date,
                extract(day from target_date)::int);
              assert exists(select 1 from public.expected_recurring_occurrences(target_next,target_next,target_id)),
                'recurring destination did not continue';
            else
              assert exists(select 1 from public.debts where id=target_id and name=target_name and first_due_date=target_date
                and due_day=extract(day from target_date)::int and installments_paid=0 and remaining_cents=2400
                and installment_cents=800 and not archived), 'financing destination wrong';
              assert (select count(*) from public.debts where name=target_name)=1, 'financing destination duplicated';
              assert not exists(select 1 from public.transactions where debt_id=target_id), 'pending occurrence became paid debt history';
              if scope='so_esta' then assert not exists(select 1 from public.transactions where id=occurrence_id),
                'pending converted financing occurrence survived as payment'; end if;
            end if;
            passed := passed+1;
          exception when assert_failure or others then
            failures := array_append(failures,label || ': ' || sqlerrm);
          end;
        end loop;
      end loop;
    end loop;
  end loop;
  raise notice 'conversion dates matrix: % passed / 84 cases',passed;
  insert into conversion_dates_failures select 'matrix',unnest(failures);
end $$;

-- A refusal in DESTINATION creation must roll back prior source edits/deletions,
-- including the one-scope skip marker and historical version trigger writes.
do $$
declare
  ctx record;
  scope text;
  s uuid;
  t uuid;
  d date := current_date+40;
  before_series jsonb;
  before_lines jsonb;
  before_versions jsonb;
  before_skips jsonb;
  failed boolean;
  message text;
begin
  select * into ctx from conversion_dates_context;
  foreach scope in array array['so_esta','desta_em_diante','todas','manter'] loop
    begin
    insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,account_id,rrule,dtstart,next_run_at)
    values(ctx.ws,ctx.usr,'expense',900,'rollback ' || scope,ctx.account_id,
      'FREQ=MONTHLY;BYMONTHDAY=' || extract(day from d)::int,
      (d-90)::timestamp at time zone 'America/Sao_Paulo',d::timestamp at time zone 'America/Sao_Paulo') returning id into s;
    insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
    values(ctx.ws,ctx.usr,'expense',900,'rollback ' || scope,ctx.account_id,d,d,'pending','recurring',s) returning id into t;
    select to_jsonb(r) into before_series from public.recurring_transactions r where id=s;
    select jsonb_agg(to_jsonb(x) order by x.id) into before_lines from public.transactions x where recurring_id=s;
    select jsonb_agg(to_jsonb(v) order by v.valid_from) into before_versions from private.recurring_history_versions v where recurring_id=s;
    select jsonb_agg(to_jsonb(m) order by m.original_date) into before_skips from private.recurring_moved_occurrences m where recurring_id=s;
    failed := false;
    begin
      perform public.converter_registro(jsonb_build_object('tipo','transacao','id',t),scope,
        jsonb_build_object('tipo','lancamento','dados',jsonb_build_object('linhas',jsonb_build_array(jsonb_build_object(
          'kind','expense','amount_cents',0,'description','invalid destination','account_id',ctx.account_id,
          'occurred_at',d+75,'due_at',d+75,'status','pending','source','app')))));
    exception when others then failed:=true; message:=sqlerrm;
    end;
    assert failed, 'invalid destination accepted';
    assert message not like '%Alcance%' and message not like '%Só um lançamento%', 'refused before attempting destination';
    assert before_series=(select to_jsonb(r) from public.recurring_transactions r where id=s), 'rollback left altered source series';
    assert before_lines=(select jsonb_agg(to_jsonb(x) order by x.id) from public.transactions x where recurring_id=s),
      'rollback left altered source lines';
    assert before_versions=(select jsonb_agg(to_jsonb(v) order by v.valid_from) from private.recurring_history_versions v where recurring_id=s),
      'rollback left altered source history versions';
    assert before_skips is not distinct from
      (select jsonb_agg(to_jsonb(m) order by m.original_date) from private.recurring_moved_occurrences m where recurring_id=s),
      'rollback left original skip marker';
    assert not exists(select 1 from public.transactions where description='invalid destination'), 'rollback left destination';
    exception when assert_failure or others then
      insert into conversion_dates_failures values('rollback/' || scope,sqlerrm);
    end;
  end loop;
  raise notice 'conversion dates rollback: % passed / 4 cases',
    4-(select count(*) from conversion_dates_failures where label like 'rollback/%');
end $$;

-- An actual non-card occurrence can have an original transaction date different
-- from its due date. The cutoff follows DUE, never the edited destination date.
do $$
declare
  ctx record;
  s uuid;
  t uuid;
  before_cutoff uuid;
  d date := current_date+40;
  result jsonb;
begin
  select * into ctx from conversion_dates_context;
  insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,account_id,rrule,dtstart,next_run_at)
  values(ctx.ws,ctx.usr,'expense',900,'different due cutoff',ctx.account_id,
    'FREQ=MONTHLY;BYMONTHDAY=' || extract(day from d)::int,
    (d-90)::timestamp at time zone 'America/Sao_Paulo',d::timestamp at time zone 'America/Sao_Paulo') returning id into s;
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
  values(ctx.ws,ctx.usr,'expense',900,'different due anchor',ctx.account_id,d-10,d,'pending','recurring',s) returning id into t;
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
  values(ctx.ws,ctx.usr,'expense',900,'before due cutoff',ctx.account_id,d+1,d-1,'pending','recurring',s) returning id into before_cutoff;
  result := public.converter_registro(jsonb_build_object('tipo','transacao','id',t),'desta_em_diante',
    jsonb_build_object('tipo','lancamento','dados',jsonb_build_object('linhas',jsonb_build_array(jsonb_build_object(
      'kind','expense','amount_cents',800,'description','different due destination','account_id',ctx.account_id,
      'occurred_at',d+75,'due_at',d+75,'status','pending','source','app')))));
  assert (select end_date from public.recurring_transactions where id=s)=d-1, 'cutoff used occurred date';
  assert not exists(select 1 from public.transactions where id=t), 'anchor due at cutoff survived';
  assert exists(select 1 from public.transactions where id=before_cutoff and recurring_id=s and due_at=d-1),
    'pending due before original cutoff was deleted by transaction date';
  assert exists(select 1 from public.transactions where id=(result->'ids'->>0)::uuid and occurred_at=d+75 and recurring_id is null),
    'different due destination wrong';
  raise notice 'conversion dates distinct occurred/due: 1 case passed';
exception when assert_failure or others then
  insert into conversion_dates_failures values('distinct occurred/due',sqlerrm);
end $$;

-- Paid one-scope conversions preserve proven payment history. A pending target
-- must not create a payment; the complementary cleared fixture must count one.
do $$
declare
  ctx record;
  target_kind text;
  s uuid;
  t uuid;
  untouched uuid;
  target_id uuid;
  d date := current_date-10;
  next_date date := current_date+40;
  payload jsonb;
  result jsonb;
begin
  select * into ctx from conversion_dates_context;
  foreach target_kind in array array['lancamento','recorrente','financiamento'] loop
    begin
      insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,account_id,rrule,dtstart,next_run_at)
      values(ctx.ws,ctx.usr,'expense',800,'paid source ' || target_kind,ctx.account_id,
        'FREQ=MONTHLY;BYMONTHDAY=' || extract(day from d)::int,
        d::timestamp at time zone 'America/Sao_Paulo',next_date::timestamp at time zone 'America/Sao_Paulo') returning id into s;
      insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
      values(ctx.ws,ctx.usr,'expense',800,'paid source ' || target_kind,ctx.account_id,d,d,'cleared','recurring',s) returning id into t;
      insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
      values(ctx.ws,ctx.usr,'expense',800,'paid untouched ' || target_kind,ctx.account_id,next_date,next_date,'pending','recurring',s)
        returning id into untouched;
      payload := case target_kind when 'lancamento' then jsonb_build_object('linhas',jsonb_build_array(jsonb_build_object(
        'kind','expense','amount_cents',800,'description','paid target ' || target_kind,'account_id',ctx.account_id,
        'occurred_at',d,'due_at',d,'status','cleared','source','app')))
      when 'recorrente' then jsonb_build_object('kind','expense','amount_cents',800,'description','paid target ' || target_kind,
        'account_id',ctx.account_id,'rrule','FREQ=MONTHLY;BYMONTHDAY=' || extract(day from d)::int,
        'dtstart',d::timestamp at time zone 'America/Sao_Paulo','next_run_at',d::timestamp at time zone 'America/Sao_Paulo')
      else jsonb_build_object('name','paid target ' || target_kind,'kind','financing','calculation_mode','fixed_installments',
        'principal_cents',2400,'remaining_cents',2400,'interest_rate_monthly',0,'installments',3,'installments_paid',0,
        'installment_cents',800,'account_id',ctx.account_id,'due_day',extract(day from d)::int,'first_due_date',d) end;
      result := public.converter_registro(jsonb_build_object('tipo','transacao','id',t),'so_esta',
        jsonb_build_object('tipo',target_kind,'dados',payload));
      target_id := (result->'ids'->>0)::uuid;
      assert exists(select 1 from public.transactions where id=untouched and recurring_id=s and status='pending'
        and occurred_at=next_date and amount_cents=800), 'paid conversion changed other occurrence';
      assert exists(select 1 from private.recurring_moved_occurrences where recurring_id=s and original_date=d), 'paid original date not skipped';
      assert exists(select 1 from public.transactions where id=t and status='cleared' and occurred_at=d and amount_cents=800
        and recurring_id is distinct from s), 'proven payment identity or date changed';
      if target_kind='financiamento' then
        assert exists(select 1 from public.transactions where id=t and debt_id=target_id and recurring_id is null and debt_payment_no=1),
          'paid conversion not adopted as first debt payment';
        assert exists(select 1 from public.debts where id=target_id and installments_paid=1 and remaining_cents=1600),
          'paid conversion not counted in debt balance';
      elsif target_kind='recorrente' then
        assert exists(select 1 from public.transactions where id=t and recurring_id=target_id), 'paid target not adopted in new series';
      else
        assert target_id=t and (select recurring_id from public.transactions where id=t) is null, 'paid one-time target changed identity';
      end if;
    exception when assert_failure or others then
      insert into conversion_dates_failures values('paid one/' || target_kind,sqlerrm);
    end;
  end loop;
  raise notice 'conversion dates paid history: % passed / 3 cases',
    3-(select count(*) from conversion_dates_failures where label like 'paid one/%');
end $$;

do $$
declare failures text;
begin
  select string_agg(label || ': ' || error,E'\n' order by label,error) into failures from conversion_dates_failures;
  if failures is not null then
    raise exception E'conversion recurrence dates failures (% / 92):\n%',
      (select count(*) from conversion_dates_failures),failures;
  end if;
  raise notice 'conversion recurrence dates: 92 cases passed';
end $$;

rollback;
