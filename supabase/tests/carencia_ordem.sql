set timezone to 'America/Sao_Paulo';
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000cc001';
  w uuid := '00000000-0000-0000-0000-0000000cc002';
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  ant date[]; dep date[]; r1 jsonb; r2 jsonb; ed date;
begin
  insert into auth.users(id,email) values (u,'cc1@example.invalid');
  insert into public.profiles(id) values (u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Ordem');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,
    remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,due_day)
  values (a,w,u,'A','financing','fixed_installments',100000,100000,0,10,0,10000,23),
         (b,w,u,'B','financing','fixed_installments',50000,50000,0,5,0,10000,23);
  perform set_config('request.jwt.claim.sub', u::text, true);

  -- desfazer em ordem (LIFO)
  select array_agg(due_date order by installment_no) into ant from public.debt_schedule(a);
  r1 := public.debt_pause(a, 1, 2, gen_random_uuid());
  r2 := public.debt_pause(a, 4, 1, gen_random_uuid());
  begin perform public.undo_debt_pause((r1->>'pause_id')::uuid, gen_random_uuid()); assert false;
  exception when sqlstate 'P0001' then assert sqlerrm like '%mais recente%', sqlerrm; end;
  assert (select first_due_date from public.debts where id=a) is not null, 'âncora segue';
  perform public.undo_debt_pause((r2->>'pause_id')::uuid, gen_random_uuid());
  perform public.undo_debt_pause((r1->>'pause_id')::uuid, gen_random_uuid());
  assert (select first_due_date from public.debts where id=a) is null, 'âncora volta a null';
  select array_agg(due_date order by installment_no) into dep from public.debt_schedule(a);
  assert dep = ant, 'cronograma depois do desfazer = antes da carência';

  -- âncora não lê a data editada
  select due_date into ed from public.debt_schedule(b) where installment_no = 1;
  insert into public.debt_installment_edits(debt_id,installment_no,due_date)
    values (b,1,private.add_months(ed,4));
  select array_agg(due_date order by installment_no) into ant from public.debt_schedule(b);
  perform public.debt_pause(b, 1, 2, gen_random_uuid());
  select array_agg(due_date order by installment_no) into dep from public.debt_schedule(b);
  assert dep[1] = ant[1], 'a editada mantém a data';
  assert dep[2] = private.day_in_month(private.add_months(ant[2], 2), 23), 'a 2ª anda só 2 meses';
  assert dep[5] = private.day_in_month(private.add_months(ant[5], 2), 23), 'a 5ª anda só 2 meses';
end $$;
rollback;
