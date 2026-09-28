\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a311';
  other_user uuid := '00000000-0000-0000-0000-00000000a312';
  w uuid := '00000000-0000-0000-0000-00000000b311';
  s uuid := '00000000-0000-0000-0000-00000000c311';
  t uuid := '00000000-0000-0000-0000-00000000d311';
  later_id uuid := '00000000-0000-0000-0000-00000000d312';
  card_id uuid := '00000000-0000-0000-0000-00000000d313';
  card_line_id uuid := '00000000-0000-0000-0000-00000000d314';
  legacy_invoice_id uuid := '00000000-0000-0000-0000-00000000d315';
  req uuid := '00000000-0000-0000-0000-00000000e311';
  start_date date := (date_trunc('month',current_date)+interval '1 month')::date + 3;
  new_date date := private.day_in_month((date_trunc('month',current_date)+interval '1 month')::date,30);
  result1 bigint;
  rev bigint;
  invoice_before uuid;
  invoice_due date;
begin
  insert into auth.users(id,email) values
    (u,'recurring-one@example.invalid'),
    (other_user,'recurring-one-other@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values(u),(other_user) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values(w,u,'Recurring one');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.recurring_transactions
    (id,workspace_id,user_id,kind,amount_cents,description,rrule,dtstart,next_run_at)
  values (s,w,u,'expense',1000,'Antes','FREQ=MONTHLY;BYMONTHDAY=4',start_date,start_date);
  insert into public.transactions
    (id,workspace_id,user_id,kind,amount_cents,description,occurred_at,due_at,source,status,recurring_id)
  values
    (t,w,u,'expense',1000,'Antes',start_date,start_date,'recurring','pending',s),
    (later_id,w,u,'expense',1000,'Antes',private.add_months(start_date,1),
      private.add_months(start_date,1),'recurring','pending',s);
  perform set_config('request.jwt.claim.sub',other_user::text,true);
  perform set_config('role','authenticated',true);
  begin
    perform public.update_recurring_one(t,'{"description":"Invasão"}'::jsonb,0,req);
    raise exception 'Outro usuário não pode editar a ocorrência';
  exception when others then
    if sqlerrm = 'Outro usuário não pode editar a ocorrência' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',u::text,true);
  result1 := public.update_recurring_one(t,
    jsonb_build_object('amount_cents',1200,'occurred_at',new_date),0,req);
  assert result1=1;
  assert (select amount_cents from public.transactions where id=t)=1200;
  assert (select occurred_at from public.transactions where id=t)=new_date;
  assert (select due_at from public.transactions where id=t)=new_date;
  assert (select amount_cents from public.transactions where id=later_id)=1000;
  assert (select amount_cents from public.recurring_transactions where id=s)=1000;
  assert (select edit_revision from public.recurring_transactions where id=s)=1,
    'an occurrence edit invalidates a stale whole-series edit';
  select edit_revision into rev from public.transactions where id=t;
  assert public.update_recurring_one(t,
    jsonb_build_object('amount_cents',1200,'occurred_at',new_date),0,req)=1;
  assert (select edit_revision from public.transactions where id=t)=rev,
    'same request must not update the occurrence again';
  assert (select edit_revision from public.recurring_transactions where id=s)=1,
    'retry does not bump the shared revision';
  begin
    perform public.update_recurring_one(t,'{"description":"Outra"}'::jsonb,0,req);
    raise exception 'Reutilizar chave com outro conteúdo devia falhar';
  exception when others then
    if sqlerrm not like '%reutilizado%' then raise; end if;
  end;
  assert public.update_recurring_one(t,
    jsonb_build_object('amount_cents',1200,'occurred_at',new_date),rev,
    gen_random_uuid())=0, 'same values should not write again';
  assert (select edit_revision from public.transactions where id=t)=rev;
  begin
    perform public.update_recurring_one(t,'{"amount_cents":12.5}'::jsonb,rev,gen_random_uuid());
    raise exception 'fractional cents accepted';
  exception when others then
    if sqlerrm='fractional cents accepted' then raise; end if;
    assert sqlerrm like '%inteiro%', sqlerrm;
  end;
  begin
    perform public.update_recurring_one(t,
      jsonb_build_object('account_id',gen_random_uuid()),rev,gen_random_uuid());
    raise exception 'foreign account accepted';
  exception when others then
    if sqlerrm='foreign account accepted' then raise; end if;
    assert sqlerrm like '%Conta precisa%', sqlerrm;
  end;
  begin
    perform public.update_recurring_one(t,'{"amount_cents":1300}'::jsonb,0,gen_random_uuid());
    raise exception 'stale revision accepted';
  exception when others then
    if sqlerrm='stale revision accepted' then raise; end if;
    assert sqlerrm like '%mudou enquanto%', sqlerrm;
  end;
  assert public.update_recurring_one(t,
    jsonb_build_object('occurred_at',new_date + 1,'due_at',new_date + 5),
    rev,gen_random_uuid())=1;
  assert (select due_at from public.transactions where id=t)=new_date + 5,
    'explicit due date must win over automatic date movement';
  assert (select amount_cents from public.transactions where id=later_id)=1000;

  -- Text must leave an existing card assignment untouched. A paid invoice freezes
  -- monetary and calendar fields, including an occurrence in an otherwise editable series.
  insert into public.accounts
    (id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents)
  values (card_id,w,u,'Card for one scope','credit_card',15,25,100000);
  insert into public.transactions
    (id,workspace_id,user_id,kind,amount_cents,description,account_id,
     occurred_at,source,status,recurring_id)
  values (card_line_id,w,u,'expense',1000,'Card before',card_id,
          start_date,'recurring','pending',s);
  select invoice_id,due_at into invoice_before,invoice_due
    from public.transactions where id=card_line_id;
  assert invoice_before is not null;
  -- Simulate a recorded legacy invoice whose assignment differs from the card's
  -- current window. Merely mentioning account_id/occurred_at would move this line.
  insert into public.card_invoices
    (id,workspace_id,user_id,account_id,reference_month,closing_date,due_date,status)
  values (legacy_invoice_id,w,u,card_id,
    (date_trunc('month',start_date)+interval '2 months')::date,
    (date_trunc('month',start_date)+interval '2 months 14 days')::date,
    (date_trunc('month',start_date)+interval '2 months 24 days')::date,'paid');
  update public.transactions set invoice_id=legacy_invoice_id where id=card_line_id;
  assert (select invoice_id from public.transactions where id=card_line_id)=legacy_invoice_id;
  select edit_revision into rev from public.transactions where id=card_line_id;
  assert public.update_recurring_one(card_line_id,
    '{"description":"Card after"}'::jsonb,rev,gen_random_uuid())=1;
  assert (select invoice_id from public.transactions where id=card_line_id)=legacy_invoice_id;
  assert (select due_at from public.transactions where id=card_line_id)=invoice_due;
  select edit_revision into rev from public.transactions where id=card_line_id;
  begin
    perform public.update_recurring_one(card_line_id,
      '{"amount_cents":1200}'::jsonb,rev,gen_random_uuid());
    raise exception 'protected invoice amount accepted';
  exception when others then
    if sqlerrm='protected invoice amount accepted' then raise; end if;
    assert sqlerrm like '%fatura paga%', sqlerrm;
  end;
end $$;
rollback;
