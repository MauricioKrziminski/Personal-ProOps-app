set timezone to 'America/Sao_Paulo';
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000cb001';
  w uuid := '00000000-0000-0000-0000-0000000cb002';
  u2 uuid := '00000000-0000-0000-0000-0000000cb003';
  sem uuid := gen_random_uuid(); aberta uuid := gen_random_uuid(); jur uuid := gen_random_uuid();
  prox date := (date_trunc('month', current_date) + interval '1 month')::date + 22;
  antes date[]; depois date[]; prev jsonb; res jsonb; pid uuid; n0 date; c0 bigint;
begin
  insert into auth.users(id,email) values (u,'cb1@example.invalid'),(u2,'cb2@example.invalid');
  insert into public.profiles(id) values (u),(u2) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Correções');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  -- sem âncora, parcela fixa, 1 paga
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,
    remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,due_day)
  values (sem,w,u,'Sem ancora','financing','fixed_installments',50000,40000,0,5,1,10000,23);
  -- com juros, sem número de parcelas
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,
    remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,due_day,first_due_date)
  values (aberta,w,u,'Aberta','financing','amortized',100000,100000,0.02,null,0,5000,23,prox);
  -- com juros, ancorada, 12 parcelas
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,
    remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,due_day,first_due_date)
  values (jur,w,u,'Juros','financing','amortized',1000000,1000000,0.02,12,0,
    private.price_installment(1000000,0.02,12),23,prox);

  -- outro espaço não pausa nem pré-visualiza
  perform set_config('request.jwt.claim.sub', u2::text, true);
  begin perform public.debt_pause(jur,1,1,gen_random_uuid()); assert false;
  exception when sqlstate 'P0001' then assert sqlerrm like '%não encontrada%', sqlerrm; end;
  begin perform public.debt_pause_preview(jur,1,1); assert false;
  exception when sqlstate 'P0001' then assert sqlerrm like '%não encontrada%', sqlerrm; end;
  perform set_config('request.jwt.claim.sub', u::text, true);

  -- C1: sem âncora, a carência termina (a âncora é cravada e o cronograma deixa de depender do hoje)
  select array_agg(due_date order by installment_no) into antes from public.debt_schedule(sem);
  prev := public.debt_pause_preview(sem, 2, 3);
  assert (select first_due_date from public.debts where id=sem) is null, 'prévia não grava a âncora';
  res := public.debt_pause(sem, 2, 3, gen_random_uuid());
  assert res - 'pause_id' = prev, 'prévia = efeito (sem âncora)';
  pid := (res->>'pause_id')::uuid;
  assert (select first_due_date from public.debts where id=sem) is not null, 'âncora cravada';
  select array_agg(due_date order by installment_no) into depois from public.debt_schedule(sem);
  assert depois[1] = private.add_months(antes[1], 3), 'a próxima anda 3 meses uma vez';
  assert depois[2] = private.add_months(antes[2], 3);
  -- a data é função só do cadastro: igual à fórmula ancorada, sem olhar o hoje
  assert depois[1] = private.day_in_month(
    private.add_months((select first_due_date from public.debts where id=sem), 1 + 3), 23), 'fórmula ancorada';
  -- desfazer devolve o null e o cronograma de antes
  perform public.undo_debt_pause(pid, gen_random_uuid());
  assert (select first_due_date from public.debts where id=sem) is null, 'âncora volta a null';

  -- I2: sem nº de parcelas só capitaliza e a parcela fica
  res := public.debt_pause(aberta, 1, 2, gen_random_uuid());
  assert (select installment_cents from public.debts where id=aberta) = 5000, 'parcela intacta';
  assert (select remaining_cents from public.debts where id=aberta) > 100000, 'saldo capitalizado';

  -- prévia = efeito com juros
  prev := public.debt_pause_preview(jur, 1, 2);
  res := public.debt_pause(jur, 1, 2, gen_random_uuid());
  assert res - 'pause_id' = prev, 'prévia = efeito (com juros)';
  pid := (res->>'pause_id')::uuid;

  -- I3: editar depois da carência bloqueia o desfazer
  update public.debts set installment_cents = installment_cents + 1 where id=jur;
  begin perform public.undo_debt_pause(pid, gen_random_uuid()); assert false;
  exception when sqlstate 'P0001' then assert sqlerrm like '%mudou depois da carência%', sqlerrm; end;

  -- validação de entrada
  begin perform public.debt_pause(jur, null, 1, gen_random_uuid()); assert false;
  exception when sqlstate '22023' then assert sqlerrm like '%parcela%', sqlerrm; end;
  begin perform public.debt_pause(sem, 6, 1, gen_random_uuid()); assert false;
  exception when sqlstate '22023' then assert sqlerrm like '%não existe%', sqlerrm; end;
end $$;
rollback;

-- I2 (revisão final): a data de parcela JÁ PAGA também leva o deslocamento da carência
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000cb011';
  w uuid := '00000000-0000-0000-0000-0000000cb012';
  f uuid := gen_random_uuid();
  a date := (date_trunc('month', current_date) - interval '3 month')::date + 22;
begin
  insert into auth.users(id,email) values (u,'cb11@example.invalid');
  insert into public.profiles(id) values (u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Pagas');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,
    remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,due_day,first_due_date)
  values (f,w,u,'Pagas','financing','fixed_installments',100000,80000,0,10,2,10000,23,a);
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform public.debt_pause(f, 3, 3, gen_random_uuid());
  update public.debts set installments_paid = 4, remaining_cents = 60000 where id = f;  -- 3ª e 4ª passam a pagas
  assert private.debt_projected_due_date(f, 4) = private.day_in_month(private.add_months(a, 3 + 3), 23),
    'parcela paga leva o deslocamento da carência';
  assert private.debt_projected_due_date(f, 2) = private.day_in_month(private.add_months(a, 1), 23),
    'parcela antes da carência não anda';
end $$;
rollback;
