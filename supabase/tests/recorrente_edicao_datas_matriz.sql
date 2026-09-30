-- The selected occurrence is later than next_run_at. Scope is decided against
-- its ORIGINAL date, while the requested date may cross a month boundary.
-- finance.md:69-87,104-110: one edits one line; future preserves earlier bills;
-- all corrects historical dates by the new rule while preserving payment status.
-- agent/.venv/bin/python scripts/sql-test.py supabase/tests/recorrente_edicao_datas_matriz.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
create temporary table recurring_edit_dates_context(usr uuid,ws uuid,account_id uuid);
create temporary table recurring_edit_dates_failures(label text,error text);
grant select on recurring_edit_dates_context to authenticated;
grant select,insert on recurring_edit_dates_failures to authenticated;
do $$
declare u uuid:=gen_random_uuid(); w uuid; a uuid;
begin
  perform set_config('request.jwt.claim.sub',u::text,true);
  insert into auth.users(id,email) values(u,'recurring-edit-dates-' || u || '@example.invalid');
  insert into public.profiles(id,timezone) values(u,'America/Sao_Paulo') on conflict(id) do update set timezone=excluded.timezone;
  select id into w from public.workspaces where owner_id=u order by created_at limit 1;
  if w is null then
    insert into public.workspaces(owner_id,name) values(u,'Recurring edit dates') returning id into w;
    insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  end if;
  insert into public.accounts(user_id,workspace_id,name,type,initial_balance_cents)
    values(u,w,'Recurring edit account','checking',100000) returning id into a;
  insert into recurring_edit_dates_context values(u,w,a);
end $$;
set local role authenticated;

do $$
declare
  ctx record;
  scope text;
  variant text;
  label text;
  s uuid;
  paid uuid;
  overdue uuid;
  prior_pending uuid;
  selected uuid;
  later_pending uuid;
  req uuid;
  base date:=date_trunc('month',current_date)::date;
  paid_date date;
  overdue_date date;
  prior_date date;
  selected_date date;
  later_date date;
  requested_date date;
  unmaterialized_date date;
  rule text;
  lp jsonb;
  sp jsonb;
  series_before jsonb;
  untouched_before jsonb;
  prior_before jsonb;
  paid_before jsonb;
  overdue_before jsonb;
  after_series jsonb;
  after_lines jsonb;
  history_before jsonb;
  history_after jsonb;
  historical_date date;
  line_revision bigint;
  series_revision bigint;
  changed bigint;
  retry_changed bigint;
  calendar_moved uuid;
  expected_count integer;
  passed integer:=0;
begin
  select * into ctx from recurring_edit_dates_context;
  paid_date:=private.add_months(base,-3)+4;
  overdue_date:=private.add_months(base,-1)+4;
  prior_date:=private.add_months(base,1)+4;
  selected_date:=private.add_months(base,2)+4;
  later_date:=private.add_months(base,3)+4;
  historical_date:=private.add_months(base,-2)+4;
  foreach scope in array array['one','future','all'] loop
    foreach variant in array array['earlier-month','same-date','later-month'] loop
      label:=scope || '/' || variant;
      requested_date:=case variant when 'earlier-month' then private.add_months(base,1)+24
        when 'same-date' then selected_date else private.add_months(base,3)+14 end;
      rule:='FREQ=MONTHLY;BYMONTHDAY=' || extract(day from requested_date)::int;
      req:=gen_random_uuid();
      begin
        insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,account_id,rrule,dtstart,next_run_at)
        values(ctx.ws,ctx.usr,'expense',1000,'Before ' || label,ctx.account_id,'FREQ=MONTHLY;BYMONTHDAY=5',
          paid_date::timestamp at time zone 'America/Sao_Paulo',prior_date::timestamp at time zone 'America/Sao_Paulo') returning id into s;
        insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
        values(ctx.ws,ctx.usr,'expense',1000,'Before ' || label,ctx.account_id,paid_date,paid_date,'cleared','recurring',s) returning id into paid;
        insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
        values(ctx.ws,ctx.usr,'expense',1000,'Before ' || label,ctx.account_id,overdue_date,overdue_date,'pending','recurring',s) returning id into overdue;
        insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
        values(ctx.ws,ctx.usr,'expense',1000,'Before ' || label,ctx.account_id,prior_date,prior_date,'pending','recurring',s) returning id into prior_pending;
        insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
        values(ctx.ws,ctx.usr,'expense',1000,'Before ' || label,ctx.account_id,selected_date,selected_date,'pending','recurring',s) returning id into selected;
        insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
        values(ctx.ws,ctx.usr,'expense',1000,'Before ' || label,ctx.account_id,later_date,later_date,'pending','recurring',s) returning id into later_pending;
        select to_jsonb(r),r.edit_revision into series_before,series_revision from public.recurring_transactions r where id=s;
        select edit_revision into line_revision from public.transactions where id=selected;
        select jsonb_agg(to_jsonb(t) order by t.id) into untouched_before from public.transactions t where recurring_id=s and id<>selected;
        select to_jsonb(t) into prior_before from public.transactions t where id=prior_pending;
        select to_jsonb(t) into paid_before from public.transactions t where id=paid;
        select to_jsonb(t) into overdue_before from public.transactions t where id=overdue;
        select to_jsonb(e) into history_before from public.expected_recurring_occurrences(historical_date,historical_date,s) e;
        assert history_before is not null,'fixture has no historical virtual occurrence';
        lp:=jsonb_build_object('amount_cents',1200,'description','After ' || label);
        sp:=jsonb_build_object('rrule',rule,'next_run_at',requested_date::timestamp at time zone 'America/Sao_Paulo');
        if scope='one' then
          lp:=lp || jsonb_build_object('occurred_at',requested_date);
          changed:=public.update_recurring_one(selected,lp,line_revision,req);
        elsif scope='future' then
          changed:=public.update_recurring_future(selected,s,lp,sp,series_revision,req);
        else
          changed:=public.update_recurring_all(s,lp,sp,series_revision,req);
        end if;
        assert changed>0,'edit made no changes';
        if scope in ('one','future') then
          assert paid_before=(select to_jsonb(t) from public.transactions t where id=paid),'paid historical row changed outside scope';
          assert overdue_before=(select to_jsonb(t) from public.transactions t where id=overdue),'overdue historical row changed outside scope';
          assert prior_before=(select to_jsonb(t) from public.transactions t where id=prior_pending),
            'earlier unpaid occurrence changed outside selected anchor';
          assert exists(select 1 from public.transactions where id=selected and recurring_id=s and occurred_at=requested_date
            and due_at=requested_date and amount_cents=1200 and description='After ' || label and status='pending'),
            'requested date did not move selected occurrence with same id';
        end if;
        if scope='one' then
          assert untouched_before=(select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t where recurring_id=s and id<>selected),
            'one changed another recorded occurrence';
          assert (series_before-'edit_revision'-'updated_at')=
            (select to_jsonb(r)-'edit_revision'-'updated_at' from public.recurring_transactions r where id=s),'one changed canonical schedule';
          assert (select count(*) from public.transactions where recurring_id=s)=5,'one deleted another occurrence';
          if requested_date<>selected_date then
            assert exists(select 1 from private.recurring_moved_occurrences where recurring_id=s and original_date=selected_date),
              'one did not skip original selected date';
            assert not exists(select 1 from public.expected_recurring_occurrences(selected_date,selected_date,s)),
              'old selected date returned as virtual occurrence';
          else
            assert not exists(select 1 from private.recurring_moved_occurrences where recurring_id=s),'same-date metadata edit created skip marker';
          end if;
        elsif scope='future' then
          assert history_before=(select to_jsonb(e) from public.expected_recurring_occurrences(historical_date,historical_date,s) e),
            'future changed virtual history before original anchor';
          if requested_date>selected_date then
            assert not exists(select 1 from public.expected_recurring_occurrences(selected_date,requested_date-1,s)),
              'future retained old-rule virtual occurrence after original anchor';
          end if;
          assert exists(select 1 from public.recurring_transactions where id=s and rrule=rule
            and (next_run_at at time zone 'America/Sao_Paulo')::date=requested_date and amount_cents=1200
            and description='After ' || label),'future canonical schedule wrong';
          assert not exists(select 1 from public.transactions where recurring_id=s and occurred_at>=requested_date
            and id<>prior_pending and status='pending' and amount_cents<>1200),'future retained old scoped amount';
        else
          -- All uses the new rule day for historical periods. It preserves proven
          -- cleared/pending status; future rebuilding follows the requested period.
          assert exists(select 1 from public.transactions where id=paid and recurring_id=s and status='cleared'
            and amount_cents=1200 and description='After ' || label
            and occurred_at=private.day_in_month(paid_date,extract(day from requested_date)::int)
            and due_at=occurred_at),'all failed to correct paid history while preserving cleared status';
          assert exists(select 1 from public.transactions where id=overdue and recurring_id=s and status='pending'
            and amount_cents=1200 and description='After ' || label
            and occurred_at=private.day_in_month(overdue_date,extract(day from requested_date)::int)
            and due_at=occurred_at),'all failed to correct overdue historical period';
          calendar_moved:=case variant when 'earlier-month' then prior_pending when 'same-date' then selected else later_pending end;
          expected_count:=case variant when 'earlier-month' then 3 when 'same-date' then 4 else 5 end;
          assert exists(select 1 from public.transactions where id=calendar_moved and recurring_id=s and occurred_at=requested_date
            and due_at=requested_date and amount_cents=1200 and status='pending'),'all did not preserve first rebuilt pending id';
          assert (select count(*) from public.transactions where recurring_id=s)=expected_count,'all rebuilt unexpected periods';
          assert not exists(select 1 from public.transactions where recurring_id=s and
            (amount_cents<>1200 or description<>'After ' || label)),'all left old occurrence metadata';
          assert exists(select 1 from public.recurring_transactions where id=s and rrule=rule and amount_cents=1200),'all canonical rule wrong';
        end if;
        if scope<>'one' then
          unmaterialized_date:=private.day_in_month((date_trunc('month',requested_date)+interval '3 months')::date,
            extract(day from requested_date)::int);
          assert exists(select 1 from public.expected_recurring_occurrences(unmaterialized_date,unmaterialized_date,s)
            where due_date=unmaterialized_date and amount_cents=1200 and description='After ' || label),
            'unmaterialized schedule reverted to old date or amount';
        end if;
        -- A lost response cannot move dates again or bump revisions again.
        select jsonb_agg(to_jsonb(v) order by v.valid_from) into history_after
          from private.recurring_history_versions v where recurring_id=s;
        select to_jsonb(r) into after_series from public.recurring_transactions r where id=s;
        select jsonb_agg(to_jsonb(t) order by t.id) into after_lines from public.transactions t where recurring_id=s;
        if scope='one' then retry_changed:=public.update_recurring_one(selected,lp,line_revision,req);
        elsif scope='future' then retry_changed:=public.update_recurring_future(selected,s,lp,sp,series_revision,req);
        else retry_changed:=public.update_recurring_all(s,lp,sp,series_revision,req); end if;
        assert retry_changed=changed,'retry result changed';
        assert history_after=(select jsonb_agg(to_jsonb(v) order by v.valid_from)
          from private.recurring_history_versions v where recurring_id=s),'retry changed history boundary';
        assert after_series=(select to_jsonb(r) from public.recurring_transactions r where id=s),'retry changed series revision/date';
        assert after_lines=(select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t where recurring_id=s),'retry changed recorded rows';
        passed:=passed+1;
      exception when assert_failure or others then
        insert into recurring_edit_dates_failures values(label,sqlerrm);
      end;
    end loop;
  end loop;
  raise notice 'recurring edit dates matrix: % passed / 9 cases',passed;
end $$;

-- A past requested future schedule must undo metadata already written by the
-- occurrence step, history versions, revisions and request reservation together.
do $$
declare
  ctx record;
  scope text;
  s uuid;
  t uuid;
  req uuid;
  d date:=current_date+40;
  before_series jsonb;
  before_lines jsonb;
  before_history jsonb;
  revision bigint;
  failed boolean;
  error text;
  lp jsonb:='{"amount_cents":1200,"description":"must roll back"}'::jsonb;
  sp jsonb;
begin
  select * into ctx from recurring_edit_dates_context;
  foreach scope in array array['future','all'] loop
    begin
      insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,account_id,rrule,dtstart,next_run_at)
      values(ctx.ws,ctx.usr,'expense',1000,'Past refusal ' || scope,ctx.account_id,
        'FREQ=MONTHLY;BYMONTHDAY=' || extract(day from d)::int,
        d::timestamp at time zone 'America/Sao_Paulo',d::timestamp at time zone 'America/Sao_Paulo') returning id into s;
      insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
      values(ctx.ws,ctx.usr,'expense',1000,'Past refusal ' || scope,ctx.account_id,d,d,'pending','recurring',s) returning id into t;
      select to_jsonb(r),edit_revision into before_series,revision from public.recurring_transactions r where id=s;
      select jsonb_agg(to_jsonb(x) order by x.id) into before_lines from public.transactions x where recurring_id=s;
      select jsonb_agg(to_jsonb(v) order by v.valid_from) into before_history from private.recurring_history_versions v where recurring_id=s;
      req:=gen_random_uuid();
      sp:=jsonb_build_object('rrule','FREQ=MONTHLY;BYMONTHDAY=' || extract(day from current_date-1)::int,
        'next_run_at',(current_date-1)::timestamp at time zone 'America/Sao_Paulo');
      failed:=false;
      begin
        if scope='future' then perform public.update_recurring_future(t,s,lp,sp,revision,req);
        else perform public.update_recurring_all(s,lp,sp,revision,req); end if;
      exception when others then failed:=true; error:=sqlerrm;
      end;
      assert failed and error like '%antes de hoje%','past schedule refusal missing or wrong';
      assert before_series=(select to_jsonb(r) from public.recurring_transactions r where id=s),'past refusal changed source contract/revision';
      assert before_lines=(select jsonb_agg(to_jsonb(x) order by x.id) from public.transactions x where recurring_id=s),'past refusal changed occurrence fields';
      assert before_history=(select jsonb_agg(to_jsonb(v) order by v.valid_from) from private.recurring_history_versions v where recurring_id=s),
        'past refusal changed history versions';
      assert not exists(select 1 from private.recurring_moved_occurrences where recurring_id=s),'past refusal left skip marker';
      assert not exists(select 1 from private.recurring_future_edit_requests where user_id=ctx.usr and request_id=req)
        and not exists(select 1 from private.recurring_all_edit_requests where user_id=ctx.usr and request_id=req),
        'past refusal retained request reservation';
    exception when assert_failure or others then
      insert into recurring_edit_dates_failures values(scope || '/past-atomic-refusal',sqlerrm);
    end;
  end loop;
  raise notice 'recurring edit dates past refusal: % passed / 2 cases',
    2-(select count(*) from recurring_edit_dates_failures where label like '%/past-atomic-refusal');
end $$;

-- Paid anchors retain their date/status and use the next future calendar. A
-- pending anchor instead scopes by ORIGINAL due date, not transaction date.
do $$
declare
  ctx record;
  variant text;
  s uuid;
  anchor_id uuid;
  prior_id uuid;
  later_id uuid;
  req uuid;
  base date:=date_trunc('month',current_date)::date;
  prior_date date:=private.add_months(base,1)+4;
  selected_due date:=private.add_months(base,2)+4;
  requested date;
  expected_next date;
  anchor_occurred date;
  original_due date;
  prior_before jsonb;
  rev bigint;
  passed integer:=0;
begin
  select * into ctx from recurring_edit_dates_context;
  foreach variant in array array['paid-anchor','original-due-anchor'] loop
    begin
      insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,account_id,rrule,dtstart,next_run_at)
      values(ctx.ws,ctx.usr,'expense',1000,'Before ' || variant,ctx.account_id,'FREQ=MONTHLY;BYMONTHDAY=5',
        (base+4)::timestamp at time zone 'America/Sao_Paulo',prior_date::timestamp at time zone 'America/Sao_Paulo') returning id into s;
      if variant='paid-anchor' then
        anchor_occurred:=current_date;
        original_due:=least(base+4,current_date);
        requested:=current_date;
        expected_next:=private.day_in_month(private.add_months(base,1),extract(day from current_date)::int);
        insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
        values(ctx.ws,ctx.usr,'expense',1000,'Before ' || variant,ctx.account_id,anchor_occurred,original_due,'cleared','recurring',s)
          returning id into anchor_id;
        insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
        values(ctx.ws,ctx.usr,'expense',1000,'Before ' || variant,ctx.account_id,prior_date,prior_date,'pending','recurring',s)
          returning id into prior_id;
      else
        -- Transaction order disagrees with due-date order: the earlier unpaid
        -- bill was entered after the selected bill, but still belongs before it.
        anchor_occurred:=private.add_months(base,1)+14;
        original_due:=selected_due;
        requested:=private.add_months(base,2)+24;
        expected_next:=requested;
        insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
        values(ctx.ws,ctx.usr,'expense',1000,'Before ' || variant,ctx.account_id,anchor_occurred,original_due,'pending','recurring',s)
          returning id into anchor_id;
        insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
        values(ctx.ws,ctx.usr,'expense',1000,'Before ' || variant,ctx.account_id,private.add_months(base,1)+24,prior_date,'pending','recurring',s)
          returning id into prior_id;
        select to_jsonb(t) into prior_before from public.transactions t where id=prior_id;
      end if;
      insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
      values(ctx.ws,ctx.usr,'expense',1000,'Before ' || variant,ctx.account_id,private.add_months(base,3)+4,
        private.add_months(base,3)+4,'pending','recurring',s) returning id into later_id;
      select edit_revision into rev from public.recurring_transactions where id=s;
      req:=gen_random_uuid();
      perform public.update_recurring_future(anchor_id,s,'{"amount_cents":1200,"description":"After anchor"}'::jsonb,
        jsonb_build_object('rrule','FREQ=MONTHLY;BYMONTHDAY=' || extract(day from requested)::int,
          'next_run_at',requested::timestamp at time zone 'America/Sao_Paulo'),rev,req);
      assert exists(select 1 from public.recurring_transactions where id=s
        and (next_run_at at time zone 'America/Sao_Paulo')::date=expected_next),'wrong calendar for anchor state';
      if variant='paid-anchor' then
        assert exists(select 1 from public.transactions where id=anchor_id and occurred_at=anchor_occurred and due_at=original_due
          and status='cleared' and amount_cents=1200),'paid anchor date/status or existing metadata behavior changed';
        assert exists(select 1 from public.transactions where id=prior_id and occurred_at=expected_next and due_at=expected_next
          and status='pending' and amount_cents=1200),'paid anchor did not move next future occurrence';
      else
        assert prior_before=(select to_jsonb(t) from public.transactions t where id=prior_id),
          'original due cutoff changed earlier pending bill entered later';
        assert exists(select 1 from public.transactions where id=anchor_id and occurred_at=requested and due_at=requested
          and status='pending' and amount_cents=1200),'different-date selected occurrence not moved';
      end if;
      assert not exists(select 1 from public.transactions where id=later_id),'scoped later pending occurrence not rebuilt';
      passed:=passed+1;
    exception when assert_failure or others then
      insert into recurring_edit_dates_failures values(variant,sqlerrm);
    end;
  end loop;
  raise notice 'recurring edit dates anchor state: % passed / 2 cases',passed;
end $$;

-- A postponement across several months closes a RANGE of old estimates,
-- not just a skip marker at the selected day. The private history writer also
-- refuses an identity without workspace membership before changing anything.
do $$
declare
  ctx record;
  s uuid; prior_id uuid; selected_id uuid; later_id uuid;
  base date:=date_trunc('month',current_date)::date;
  selected_day date:=private.add_months(base,2)+4;
  requested date:=private.add_months(base,5)+14;
  prior_before jsonb; history_before jsonb; after_history jsonb;
  rev bigint; req uuid:=gen_random_uuid(); rejected boolean:=false;
begin
  select * into ctx from recurring_edit_dates_context;
  begin
    insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,account_id,rrule,dtstart,next_run_at)
    values(ctx.ws,ctx.usr,'expense',1000,'Long gap',ctx.account_id,'FREQ=MONTHLY;BYMONTHDAY=5',
      (private.add_months(base,-3)+4)::timestamp at time zone 'America/Sao_Paulo',
      (private.add_months(base,1)+4)::timestamp at time zone 'America/Sao_Paulo') returning id into s;
    insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
    values(ctx.ws,ctx.usr,'expense',1000,'Long gap',ctx.account_id,private.add_months(base,1)+4,private.add_months(base,1)+4,'pending','recurring',s) returning id into prior_id;
    insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
    values(ctx.ws,ctx.usr,'expense',1000,'Long gap',ctx.account_id,selected_day,selected_day,'pending','recurring',s) returning id into selected_id;
    insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
    values(ctx.ws,ctx.usr,'expense',1000,'Long gap',ctx.account_id,private.add_months(base,3)+4,private.add_months(base,3)+4,'pending','recurring',s) returning id into later_id;
    select to_jsonb(t) into prior_before from public.transactions t where id=prior_id;
    select to_jsonb(e) into history_before from public.expected_recurring_occurrences(private.add_months(base,-2)+4,private.add_months(base,-2)+4,s) e;
    select edit_revision into rev from public.recurring_transactions where id=s;
    perform public.update_recurring_future(selected_id,s,'{}',jsonb_build_object('rrule','FREQ=MONTHLY;BYMONTHDAY=15',
      'next_run_at',requested::timestamp at time zone 'America/Sao_Paulo'),rev,req);
    assert prior_before=(select to_jsonb(t) from public.transactions t where id=prior_id),'long gap changed prior pending';
    assert exists(select 1 from public.transactions where id=selected_id and occurred_at=requested and due_at=requested),'long gap lost selected id';
    assert not exists(select 1 from public.transactions where id=later_id),'long gap retained old later row';
    assert not exists(select 1 from public.expected_recurring_occurrences(selected_day,selected_day+61,s)),'long gap revived first old periods';
    assert not exists(select 1 from public.expected_recurring_occurrences(selected_day+62,requested-1,s)),'long gap revived later old periods';
    assert history_before=(select to_jsonb(e) from public.expected_recurring_occurrences(private.add_months(base,-2)+4,private.add_months(base,-2)+4,s) e),'long gap changed prior history';
    assert exists(select 1 from public.expected_recurring_occurrences(private.add_months(requested,1),private.add_months(requested,1),s)),'long gap lost new rule continuity';
    select jsonb_agg(to_jsonb(v) order by valid_from) into after_history from private.recurring_history_versions v where recurring_id=s;
    perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
    begin
      perform private.close_recurring_history_at_scope(s,selected_day);
    exception when others then rejected:=sqlerrm='Recorrência não encontrada';
    end;
    perform set_config('request.jwt.claim.sub',ctx.usr::text,true);
    assert rejected,'history helper accepted another identity';
    assert after_history=(select jsonb_agg(to_jsonb(v) order by valid_from) from private.recurring_history_versions v where recurring_id=s),'history refusal changed versions';
    perform public.update_recurring_future(selected_id,s,'{}',jsonb_build_object('rrule','FREQ=MONTHLY;BYMONTHDAY=15',
      'next_run_at',requested::timestamp at time zone 'America/Sao_Paulo'),rev,req);
    assert after_history=(select jsonb_agg(to_jsonb(v) order by valid_from) from private.recurring_history_versions v where recurring_id=s),'retry changed history gap';
    raise notice 'recurring long gap and history access: 1 case passed';
  exception when assert_failure or others then
    perform set_config('request.jwt.claim.sub',ctx.usr::text,true);
    insert into recurring_edit_dates_failures values('future/multiple-month-gap',sqlerrm);
  end;
end $$;

do $$
declare failures text;
begin
  select string_agg(label || ': ' || error,E'\n' order by label) into failures from recurring_edit_dates_failures;
  if failures is not null then raise exception E'recurring edit dates failures (% / 14):\n%',
    (select count(*) from recurring_edit_dates_failures),failures; end if;
  raise notice 'recurring edit dates: 14 cases passed';
end $$;
rollback;
