-- Independent cash/date expectations: no expected value is calculated by invoice_window.
-- Run via scripts/sql-test.py with the pending migrations, always rolled back.
\set ON_ERROR_STOP on
begin;

do $$
declare u uuid:='00000000-0000-0000-0000-00000000f501'; w uuid; bank uuid; second_bank uuid;
  card uuid; on_edge uuid; inclusive uuid; after_edge uuid; no_payer uuid; missing uuid; income_card uuid; rolled_card uuid;
  first_series uuid; rolled_series uuid; series_id uuid; invoice uuid; target record; tx uuid; p jsonb;
  base date:=(date_trunc('month',current_date)+interval '1 month')::date;
  next_base date:=(date_trunc('month',current_date)+interval '2 months')::date;
  row record; count_rows int; before_cash bigint; after_cash bigint; ws_ids uuid[];
begin
  insert into auth.users(id,email) values(u,'projected-card-cash@example.invalid');
  insert into public.profiles(id) values(u) on conflict(id) do nothing;
  insert into public.workspaces(owner_id,name) values(u,'Projected card cash') returning id into w;
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.accounts(workspace_id,user_id,name,type,initial_balance_cents)
    values(w,u,'Payer','checking',100000) returning id into bank;
  insert into public.accounts(workspace_id,user_id,name,type,initial_balance_cents)
    values(w,u,'Second bank','savings',0) returning id into second_bank;
  insert into public.accounts(workspace_id,user_id,name,type,closing_day,due_day,payment_account_id)
    values(w,u,'Before closing','credit_card',15,20,bank) returning id into card;
  insert into public.accounts(workspace_id,user_id,name,type,closing_day,due_day,payment_account_id)
    values(w,u,'On closing','credit_card',15,20,bank) returning id into on_edge;
  insert into public.accounts(workspace_id,user_id,name,type,closing_day,due_day,payment_account_id,closing_day_inclusive)
    values(w,u,'Inclusive closing','credit_card',15,20,bank,true) returning id into inclusive;
  insert into public.accounts(workspace_id,user_id,name,type,closing_day,due_day,payment_account_id)
    values(w,u,'After closing','credit_card',15,20,bank) returning id into after_edge;
  insert into public.accounts(workspace_id,user_id,name,type,closing_day,due_day)
    values(w,u,'No payer','credit_card',15,20) returning id into no_payer;
  insert into public.accounts(workspace_id,user_id,name,type,payment_account_id)
    values(w,u,'Missing calendar','credit_card',bank) returning id into missing;
  insert into public.accounts(workspace_id,user_id,name,type,closing_day,due_day,payment_account_id)
    values(w,u,'Legacy income','credit_card',15,20,bank) returning id into income_card;
  insert into public.accounts(workspace_id,user_id,name,type,closing_day,due_day,payment_account_id)
    values(w,u,'Rolled card','credit_card',15,20,bank) returning id into rolled_card;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  ws_ids:=array[w];

  insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,
    account_id,rrule,next_run_at,dtstart,end_date)
    values(w,u,'expense',1001,'Before closing',card,'FREQ=MONTHLY;BYMONTHDAY=14',
      (base+13)::timestamp at time zone 'America/Sao_Paulo',
      (base+13)::timestamp at time zone 'America/Sao_Paulo',base+13) returning id into first_series;
  -- FIRST RED is a financial behavior assertion against the old canonical reader.
  assert (select count(*) from private.eventos_de_caixa(ws_ids,base+19) e
    where e.account_id=bank and e.day=base+19 and e.out_cents=1001)=1,
    'card recurrence must debit its BANK payer exactly once on day20, never card on day14';
  assert not exists(select 1 from private.eventos_de_caixa(ws_ids,base+18) e where e.out_cents=1001),
    'posting inside horizon must not debit cash when invoice due is outside';
  select * into target from private.invoice_target_for(card,base+13);
  assert target.invoice_id is null and target.reference_month=base
    and target.closing_date=base+14 and target.due_date=base+19 and target.invoice_status is null,
    'absent invoice must retain computed canonical dates without inventing persisted ids/status';

  for row in select * from (values
    (on_edge,15,1002,next_base+14,next_base+19),
    (inclusive,15,1003,base+14,base+19),
    (after_edge,16,1004,next_base+14,next_base+19),
    (no_payer,14,1005,base+14,base+19)
  ) as cases(account_id,day_no,cents,closing_date,due_date) loop
    insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,
      account_id,rrule,next_run_at,dtstart,end_date)
      values(w,u,'expense',row.cents,'Closing edge',row.account_id,
        'FREQ=MONTHLY;BYMONTHDAY='||row.day_no,
        (base+row.day_no-1)::timestamp at time zone 'America/Sao_Paulo',
        (base+row.day_no-1)::timestamp at time zone 'America/Sao_Paulo',base+row.day_no-1);
    select * into target from private.invoice_target_for(row.account_id,base+row.day_no-1);
    assert target.closing_date=row.closing_date and target.due_date=row.due_date,'closing edge dates changed';
    assert (select count(*) from private.eventos_de_caixa(ws_ids,next_base+19) e
      where e.account_id is not distinct from case when row.account_id=no_payer then null::uuid else bank end
        and e.day=row.due_date and e.out_cents=row.cents)=1,'wrong payer or duplicate edge event';
  end loop;
  insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,
    account_id,rrule,next_run_at,dtstart,end_date) values
    (w,u,'expense',1006,'Missing calendar',missing,'FREQ=MONTHLY;BYMONTHDAY=14',
      (base+13)::timestamp at time zone 'America/Sao_Paulo',(base+13)::timestamp at time zone 'America/Sao_Paulo',base+13),
    (w,u,'income',2001,'Legacy card income',income_card,'FREQ=MONTHLY;BYMONTHDAY=14',
      (base+13)::timestamp at time zone 'America/Sao_Paulo',(base+13)::timestamp at time zone 'America/Sao_Paulo',base+13),
    (w,u,'income',2002,'Bank income',bank,'FREQ=MONTHLY;BYMONTHDAY=6',
      (base+5)::timestamp at time zone 'America/Sao_Paulo',(base+5)::timestamp at time zone 'America/Sao_Paulo',base+5),
    (w,u,'expense',1007,'Bank expense',bank,'FREQ=MONTHLY;BYMONTHDAY=7',
      (base+6)::timestamp at time zone 'America/Sao_Paulo',(base+6)::timestamp at time zone 'America/Sao_Paulo',base+6),
    (w,u,'expense',1008,'No account expense',null,'FREQ=MONTHLY;BYMONTHDAY=8',
      (base+7)::timestamp at time zone 'America/Sao_Paulo',(base+7)::timestamp at time zone 'America/Sao_Paulo',base+7);
  assert not exists(select 1 from private.invoice_target_for(missing,base+13)), 'missing calendar cannot produce a fake invoice date';
  assert not exists(select 1 from private.eventos_de_caixa(ws_ids,next_base+19) e where e.out_cents=1006 or e.in_cents=2001),
    'missing calendar/card income must never become invented bank cash';
  assert exists(select 1 from private.eventos_de_caixa(ws_ids,base+19) e where e.account_id=bank and e.day=base+5 and e.in_cents=2002);
  assert exists(select 1 from private.eventos_de_caixa(ws_ids,base+19) e where e.account_id=bank and e.day=base+6 and e.out_cents=1007);
  assert exists(select 1 from private.eventos_de_caixa(ws_ids,base+19) e where e.account_id is null and e.day=base+7 and e.out_cents=1008);
  assert not exists(select 1 from private.eventos_de_caixa(ws_ids,next_base+19) e
    join public.accounts a on a.id=e.account_id where a.type='credit_card'), 'virtual card balance is not bank cash';
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,
    counterparty_account_id,occurred_at,status) values(w,u,'transfer',5000,'Pending transfer',bank,second_bank,base+8,'pending');
  assert (select count(*) from private.eventos_de_caixa(ws_ids,base+19) e where e.in_cents=5000 or e.out_cents=5000)=2;
  assert (select sum(e.in_cents-e.out_cents) from private.eventos_de_caixa(ws_ids,base+19) e
    where e.in_cents=5000 or e.out_cents=5000)=0,'bank transfer must remain neutral';

  tx:=public.materialize_recurring_occurrence(first_series,base+13);
  select t.invoice_id into invoice from public.transactions t where t.id=tx;
  select * into target from private.invoice_target_for(card,base+13);
  assert invoice=target.invoice_id and (select t.due_at from public.transactions t where t.id=tx)=base+19,
    'real trigger must select the same invoice, including a freshly created invoice';
  assert not exists(select 1 from public.ledger_expected_lines(base+13,base+13,first_series) e where e.origin='recurring');
  assert (select count(*) from private.eventos_de_caixa(ws_ids,base+19) e where e.out_cents=1001)=1,
    'materialized transaction and virtual recurrence must never duplicate cash';

  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,status)
    values(w,u,'expense',9001,'Rolled source',rolled_card,base+9,'pending') returning invoice_id into invoice;
  perform public.roll_invoice(invoice,0,0);
  insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,
    account_id,rrule,next_run_at,dtstart,end_date)
    values(w,u,'expense',1009,'Rolled recurring',rolled_card,'FREQ=MONTHLY;BYMONTHDAY=11',
      (base+10)::timestamp at time zone 'America/Sao_Paulo',
      (base+10)::timestamp at time zone 'America/Sao_Paulo',base+10) returning id into rolled_series;
  select * into target from private.invoice_target_for(rolled_card,base+10);
  assert target.invoice_id<>(invoice) and target.closing_date=next_base+14 and target.due_date=next_base+19,
    'rolled source must resolve the actual later target invoice';
  assert (select count(*) from private.eventos_de_caixa(ws_ids,next_base+19) e
    where e.account_id=bank and e.day=next_base+19 and e.out_cents=1009)=1;
  select sum(e.out_cents) into before_cash from private.eventos_de_caixa(ws_ids,next_base+19) e;
  tx:=public.materialize_recurring_occurrence(rolled_series,base+10);
  assert (select t.invoice_id from public.transactions t where t.id=tx)=target.invoice_id
    and (select t.due_at from public.transactions t where t.id=tx)=next_base+19,
    'projected target must match ACTUAL materialization trigger following rolled chain';
  select sum(e.out_cents) into after_cash from private.eventos_de_caixa(ws_ids,next_base+19) e;
  assert after_cash=before_cash,'materializing rolled charge must conserve projected cash';

  -- Shared event source feeds both public projections and privileged uid readers.
  assert (select balance_cents from public.cash_flow_forecast((next_base+19)-current_date) order by day desc limit 1)
    =(select sum((a->>'saldo_fim')::bigint) from jsonb_array_elements(public.accounts_horizon((next_base+19)-current_date)) a);
  select balance_cents into before_cash from public.cash_flow_forecast((next_base+19)-current_date) order by day desc limit 1;
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claim.sub','',true);
  assert (select balance_cents from public._cash_flow_forecast(u,(next_base+19)-current_date) order by day desc limit 1)
    =before_cash, 'invoker helper must work for uid definer reads WITHOUT auth.uid()';
  assert not has_function_privilege('anon','private.invoice_target_for(uuid,date)','execute');
  assert has_function_privilege('authenticated','private.invoice_target_for(uuid,date)','execute');
  assert has_function_privilege('service_role','private.invoice_target_for(uuid,date)','execute');
  assert not (select prosecdef from pg_proc where oid='private.invoice_target_for(uuid,date)'::regprocedure);
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000f599',true);
  perform set_config('role','authenticated',true);
  assert not exists(select 1 from private.invoice_target_for(card,base+13)), 'helper must preserve RLS for foreign account';
  raise notice 'PASS projected_card_cash: independent closing edges/payer/due horizon/rolled target/materialization/no duplication/bank-null-transfer/card income/missing calendar/uid/RLS';
end $$;
reset role;
rollback;
