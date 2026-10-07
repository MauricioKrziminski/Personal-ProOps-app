set timezone to 'America/Sao_Paulo';
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000ca001';
  w uuid := '00000000-0000-0000-0000-0000000ca002';
  fixa uuid := gen_random_uuid();
  juros uuid := gen_random_uuid();
  prox date := (date_trunc('month', current_date) + interval '1 month')::date + 22; -- dia 23 do mês que vem
  antes date[]; depois date[];
  sem uuid := gen_random_uuid(); pag uuid; d0 date; d1 date;
  prev jsonb; res jsonb; pid uuid; saldo0 bigint; parcela0 bigint; esperado bigint;
begin
  insert into auth.users(id,email) values (u,'carencia@example.invalid');
  insert into public.profiles(id) values (u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Carência');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  -- parcela fixa: 10 parcelas de 100,00, 2 pagas, a 3ª vence no dia 23 do mês que vem
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,
    remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,due_day,first_due_date)
  values (fixa,w,u,'Fixa','financing','fixed_installments',100000,80000,0,10,2,10000,23,
    (prox - interval '2 month')::date);
  -- com juros: 2% a.m., saldo 10.000,00, 12 restantes, a próxima no dia 23 do mês que vem
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,
    remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,due_day,first_due_date)
  values (juros,w,u,'Juros','financing','amortized',1000000,1000000,0.02,12,0,
    private.price_installment(1000000,0.02,12),23,prox);
  perform set_config('request.jwt.claim.sub', u::text, true);

  -- 1) parcela fixa: anda 3 meses, valor e total iguais
  select array_agg(due_date order by installment_no) into antes from public.debt_schedule(fixa);
  prev := public.debt_pause_preview(fixa, 3, 3);
  res := public.debt_pause(fixa, 3, 3, gen_random_uuid());
  assert res - 'pause_id' = prev, 'escrita = prévia (fora o id)';
  select array_agg(due_date order by installment_no) into depois from public.debt_schedule(fixa);
  assert depois[1] = private.add_months(antes[1], 3), 'a 3ª anda 3 meses';
  assert array_length(depois,1) = array_length(antes,1), 'mesmo número de parcelas';
  assert (select sum(payment_cents) from public.debt_schedule(fixa)) = 80000, 'total igual';
  assert (prev->>'with_interest')::boolean = false;

  -- 1b) pagar a próxima depois da carência (caminho normal) funciona e conta a parcela
  insert into public.accounts(workspace_id,user_id,name,type,initial_balance_cents) values (w,u,'Pag','checking',0) returning id into pag;
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,status,debt_id)
    values (w,u,'expense',10000,'parcela',pag,current_date,'cleared',fixa);
  assert (select installments_paid from public.debts where id=fixa) = 3, 'pagamento depois da carência conta a parcela';

  -- 1c) sem âncora (first_due_date null): a carência também desloca
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,
    remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,due_day)
  values (sem,w,u,'Sem ancora','financing','fixed_installments',50000,50000,0,5,0,10000,23);
  select min(due_date) into d0 from public.debt_schedule(sem);
  perform public.debt_pause(sem, 1, 2, gen_random_uuid());
  select min(due_date) into d1 from public.debt_schedule(sem);
  assert d1 = private.day_in_month(private.add_months(d0, 2), 23), 'sem âncora: a 1ª anda 2 meses';

  -- 2) com juros: saldo capitaliza mês a mês (ceil), parcela pela Price com as mesmas 12
  select remaining_cents, installment_cents into saldo0, parcela0 from public.debts where id=juros;
  esperado := saldo0;
  for i in 1..2 loop esperado := esperado + ceil(esperado::numeric * 0.02)::bigint; end loop;
  res := public.debt_pause(juros, 1, 2, gen_random_uuid());
  pid := (res->>'pause_id')::uuid;
  assert (select remaining_cents from public.debts where id=juros) = esperado, 'saldo capitalizado';
  assert (select installment_cents from public.debts where id=juros) = private.price_installment(esperado,0.02,12),
    'parcela recalculada com as mesmas 12';
  assert (select min(due_date) from public.debt_schedule(juros)) = private.add_months(prox, 2), 'próxima anda 2 meses';

  -- 3) desfazer volta EXATAMENTE
  perform public.undo_debt_pause(pid, gen_random_uuid());
  assert (select remaining_cents from public.debts where id=juros) = saldo0, 'saldo volta';
  assert (select installment_cents from public.debts where id=juros) = parcela0, 'parcela volta';
  assert (select min(due_date) from public.debt_schedule(juros)) = prox, 'data volta';
  assert not exists(select 1 from public.debt_pauses where id=pid), 'carência some';

  -- 4) recusas com a frase
  begin perform public.debt_pause(fixa, 2, 1, gen_random_uuid()); assert false;
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%já paga%', sqlerrm; end;          -- começa numa parcela paga
  -- uma segunda carência, de parcela posterior, é aceita e os deslocamentos somam (4 meses na 4ª)
  select min(due_date) into d0 from public.debt_schedule(fixa);
  perform public.debt_pause(fixa, 4, 1, gen_random_uuid());
  select min(due_date) into d1 from public.debt_schedule(fixa);
  assert d1 = private.add_months(d0, 1), 'a segunda carência soma 1 mês';
  assert private.debt_pause_shift(fixa, 4) = 4, 'deslocamentos somam (3 + 1)';
  begin perform public.debt_pause(juros, 3, 1, gen_random_uuid()); assert false;
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%próxima parcela%', sqlerrm; end;  -- com juros só a partir da próxima

  -- 5) desfazer recusado depois de um pagamento
  res := public.debt_pause(juros, 1, 1, gen_random_uuid());
  pid := (res->>'pause_id')::uuid;
  update public.debts set installments_paid = installments_paid + 1 where id = juros; -- simula um pagamento
  begin perform public.undo_debt_pause(pid, gen_random_uuid()); assert false;
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%pagamento%', sqlerrm; end;

  -- 6) a projeção e o "O que vence" leem a data nova (mesmo cronograma)
  assert not exists(select 1 from public._upcoming_bills(u, 120) where kind='debt' and ref_id=fixa and due_date = antes[1]),
    'upcoming não mostra mais a data antiga';

  -- 7) fuso e definer
  assert exists(select 1 from pg_proc where proname='debt_pause' and pronamespace='private'::regnamespace
    and prosecdef and 'TimeZone=America/Sao_Paulo' = any(proconfig)), 'cabeçalho';
end $$;
rollback;
