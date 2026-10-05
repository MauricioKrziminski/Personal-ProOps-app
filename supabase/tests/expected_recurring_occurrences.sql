\set ON_ERROR_STOP on
begin;

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a341';
  outsider uuid := '00000000-0000-0000-0000-00000000a342';
  member_user uuid := '00000000-0000-0000-0000-00000000a343';
  w uuid := '00000000-0000-0000-0000-00000000b341';
  s uuid := '00000000-0000-0000-0000-00000000c341';
  all_s uuid := '00000000-0000-0000-0000-00000000c342';
  future_s uuid := '00000000-0000-0000-0000-00000000c343';
  thirty_s uuid := '00000000-0000-0000-0000-00000000c344';
  last_s uuid := '00000000-0000-0000-0000-00000000c345';
  bi_s uuid := '00000000-0000-0000-0000-00000000c346';
  week_s uuid := '00000000-0000-0000-0000-00000000c347';
  year_s uuid := '00000000-0000-0000-0000-00000000c348';
  same_s uuid := '00000000-0000-0000-0000-00000000c349';
  moved uuid := '00000000-0000-0000-0000-00000000d341';
  all_request uuid := '00000000-0000-0000-0000-00000000e341';
  future_request uuid := '00000000-0000-0000-0000-00000000e342';
  m0 date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  m1 date := (m0 + interval '1 month')::date;
  me0 date := m1 - 1;
  me1 date := (m1 + interval '1 month')::date - 1;
  me3 date := (m0 + interval '4 months')::date - 1;
  expected_dates date[];
  inferred boolean;
  first_id uuid;
  rev bigint;
begin
  insert into auth.users(id,email) values
    (u,'recurring-history@example.invalid'),
    (outsider,'recurring-history-outsider@example.invalid'),
    (member_user,'recurring-history-member@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values(u),(outsider),(member_user) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values(w,u,'Recurring history');
  insert into public.workspace_members(workspace_id,user_id,role)
    values(w,u,'owner'),(w,member_user,'member');
  insert into public.recurring_transactions
    (id,workspace_id,user_id,kind,amount_cents,description,rrule,dtstart,next_run_at,created_at)
  values(s,w,u,'expense',1000,'Streaming','FREQ=MONTHLY;BYMONTHDAY=3',
    (((m0+2))::text||' 12:00-03')::timestamptz,(((m1+2))::text||' 12:00-03')::timestamptz,(((m0+2))::text||' 09:00-03')::timestamptz);
  insert into public.transactions
    (id,workspace_id,user_id,kind,amount_cents,description,occurred_at,due_at,source,status,recurring_id)
  values(moved,w,u,'expense',1000,'Streaming',(m1+2),(m1+2),
    'recurring','pending',s);
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);

  -- No real historical September row exists. The read model may estimate it,
  -- but must never insert a transaction or describe one as paid.
  select array_agg(due_date order by due_date) into expected_dates
  from public.expected_recurring_occurrences(m0,me1,s);
  assert expected_dates = array[(m0+2)], expected_dates::text;
  assert (select count(*) from public.transactions where recurring_id=s)=1;
  select id into first_id from public.expected_recurring_occurrences(m0,me0,s);
  assert first_id is not null;
  assert first_id=(select id from public.expected_recurring_occurrences(m0,me0,s));

  -- All-scope repair changes virtual old periods to the new rule and visibly
  -- marks a newly inferred first period when the old dtstart was overwritten.
  insert into public.recurring_transactions
    (id,workspace_id,user_id,kind,amount_cents,description,rrule,dtstart,next_run_at,created_at)
  values(all_s,w,u,'expense',1500,'Old all','FREQ=MONTHLY;BYMONTHDAY=3',
    (((m1+2))::text||' 12:00-03')::timestamptz,(((m1+2))::text||' 12:00-03')::timestamptz,(((m0+2))::text||' 09:00-03')::timestamptz);
  insert into public.transactions
    (workspace_id,user_id,kind,amount_cents,description,occurred_at,due_at,source,status,recurring_id)
  values(w,u,'expense',1500,'Old all',(m1+2),(m1+2),'recurring','pending',all_s);
  assert not exists(select 1 from public.expected_recurring_occurrences(m0,me0,all_s));
  perform public.update_recurring_all(all_s,'{"description":"New all"}'::jsonb,
    format('{"rrule":"FREQ=MONTHLY;BYMONTHDAY=1","next_run_at":"%sT12:00:00-03:00"}',m1)::jsonb,
    0,all_request);
  assert (select array_agg(due_date order by due_date)
    from public.expected_recurring_occurrences(m0,me0,all_s))
      = array[m0];
  select inferred_start into inferred
    from public.expected_recurring_occurrences(m0,me0,all_s);
  assert inferred, 'retroactive first period must be disclosed';
  assert (select description from public.expected_recurring_occurrences(m0,me0,all_s))='New all';
  assert (select count(*) from public.transactions where recurring_id=all_s)=1;
  perform public.update_recurring_all(all_s,'{"description":"New all"}'::jsonb,
    format('{"rrule":"FREQ=MONTHLY;BYMONTHDAY=1","next_run_at":"%sT12:00:00-03:00"}',m1)::jsonb,
    0,all_request);
  assert (select count(*) from private.recurring_history_versions where recurring_id=all_s)=1;

  insert into public.recurring_transactions
    (id,workspace_id,user_id,kind,amount_cents,description,rrule,dtstart,next_run_at,created_at)
  values(same_s,w,u,'expense',100,'Same month','FREQ=MONTHLY;BYMONTHDAY=3',
    (((m0+2))::text||' 12:00-03')::timestamptz,(((m1+2))::text||' 12:00-03')::timestamptz,(((m0+2))::text||' 09:00-03')::timestamptz);
  perform public.update_recurring_all(same_s,'{}'::jsonb,
    format('{"rrule":"FREQ=MONTHLY;BYMONTHDAY=1","next_run_at":"%sT12:00:00-03:00"}',m1)::jsonb,
    0,gen_random_uuid());
  assert (select due_date from public.expected_recurring_occurrences(m0,me0,same_s))=m0;
  assert (select inferred_start from public.expected_recurring_occurrences(m0,me0,same_s));

  -- Future-scope edit retains the old schedule and old attributes in September.
  insert into public.recurring_transactions
    (id,workspace_id,user_id,kind,amount_cents,description,rrule,dtstart,next_run_at,created_at)
  values(future_s,w,u,'expense',1700,'Old future','FREQ=MONTHLY;BYMONTHDAY=3',
    (((m0+2))::text||' 12:00-03')::timestamptz,(((m1+2))::text||' 12:00-03')::timestamptz,(((m0+2))::text||' 09:00-03')::timestamptz);
  insert into public.transactions
    (workspace_id,user_id,kind,amount_cents,description,occurred_at,due_at,source,status,recurring_id)
  values(w,u,'expense',1700,'Old future',(m1+2),(m1+2),
    'recurring','pending',future_s);
  perform public.update_recurring_future(null,future_s,'{}'::jsonb,
    format('{"amount_cents":1900,"description":"New future","rrule":"FREQ=MONTHLY;BYMONTHDAY=1","next_run_at":"%sT12:00:00-03:00"}',m1)::jsonb,
    0,future_request);
  assert (select due_date from public.expected_recurring_occurrences(m0,me0,future_s))=(m0+2);
  assert (select amount_cents from public.expected_recurring_occurrences(m0,me0,future_s))=1700;
  assert (select description from public.expected_recurring_occurrences(m0,me0,future_s))='Old future';
  assert not exists(select 1 from public.expected_recurring_occurrences(m1,me1,future_s));
  perform public.update_recurring_future(null,future_s,'{}'::jsonb,
    format('{"amount_cents":1900,"description":"New future","rrule":"FREQ=MONTHLY;BYMONTHDAY=1","next_run_at":"%sT12:00:00-03:00"}',m1)::jsonb,
    0,future_request);
  assert (select count(*) from private.recurring_history_versions where recurring_id=future_s)=2;

  insert into public.recurring_transactions
    (id,workspace_id,user_id,kind,amount_cents,description,rrule,dtstart,next_run_at,end_date)
  values
    (thirty_s,w,u,'expense',100,'Thirty','FREQ=MONTHLY;BYMONTHDAY=30',
      '2027-01-30 12:00-03','2027-01-30 12:00-03',null),
    (last_s,w,u,'expense',100,'Last','FREQ=MONTHLY;BYMONTHDAY=-1',
      '2027-01-31 12:00-03','2027-01-31 12:00-03',null),
    (bi_s,w,u,'expense',100,'Bimonthly','FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=31',
      '2027-01-31 12:00-03','2027-01-31 12:00-03',null),
    (week_s,w,u,'income',100,'Weekly','FREQ=WEEKLY;BYDAY=FR',
      '2027-01-06 12:00-03','2027-01-08 12:00-03','2027-01-15'),
    (year_s,w,u,'expense',100,'Leap','FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
      '2028-02-29 12:00-03','2028-02-29 12:00-03',null);
  assert (select array_agg(due_date order by due_date)
    from public.expected_recurring_occurrences('2027-01-01','2027-02-28',thirty_s))
      =array[date '2027-01-30',date '2027-02-28'];
  assert (select array_agg(due_date order by due_date)
    from public.expected_recurring_occurrences('2027-01-01','2027-02-28',last_s))
      =array[date '2027-01-31',date '2027-02-28'];
  assert (select array_agg(due_date order by due_date)
    from public.expected_recurring_occurrences('2027-01-01','2027-02-28',bi_s))
      =array[date '2027-01-31'];
  assert (select array_agg(due_date order by due_date)
    from public.expected_recurring_occurrences('2027-01-01','2027-01-31',week_s))
      =array[date '2027-01-08',date '2027-01-15'];
  assert (select array_agg(due_date order by due_date)
    from public.expected_recurring_occurrences('2029-02-01','2029-02-28',year_s))
      =array[date '2029-02-28'];
  update public.recurring_transactions set active=false where id=last_s;
  assert not exists(select 1 from public.expected_recurring_occurrences('2027-01-01','2027-02-28',last_s));
  update public.recurring_transactions set materialized_until='2027-01-30 12:00-03'
    where id=thirty_s;
  assert (select array_agg(due_date order by due_date)
    from private.recurring_projection_for(array[w],'2027-01-01','2027-02-28')
    where recurring_id=thirty_s)=array[date '2027-02-28'];
  assert (select array_agg(due_date order by due_date)
    from public.expected_recurring_occurrences('2027-01-01','2027-02-28',thirty_s))
      =array[date '2027-01-30',date '2027-02-28'],
    'historical read must not use materialized_until as evidence of real rows';

  -- A one-scope move vacates the rule's date without creating another virtual row.
  select edit_revision into rev from public.transactions where id=moved;
  perform public.update_recurring_one(moved,format('{"occurred_at":"%s"}',(m1+3))::jsonb,rev,gen_random_uuid());
  assert not exists(select 1 from public.expected_recurring_occurrences(m1,me1,s));

  perform set_config('request.jwt.claim.sub',outsider::text,true);
  assert not exists(select 1 from public.expected_recurring_occurrences(m0,me1,s));
  perform set_config('request.jwt.claim.sub',member_user::text,true);
  assert exists(select 1 from public.expected_recurring_occurrences(m0,me0,s));
  perform set_config('request.jwt.claim.sub',u::text,true);
  begin
    perform 1 from public.expected_recurring_occurrences(m0,me3,s);
    raise exception 'window cap missing';
  exception when others then
    if sqlerrm='window cap missing' then raise; end if;
    assert sqlerrm like '%62%', sqlerrm;
  end;
end $$;

rollback;
