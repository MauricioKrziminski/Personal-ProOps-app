-- Contrato + entrada: fatos de caixa separados, atomicos e idempotentes.
-- agent/.venv/bin/python scripts/sql-test.py supabase/tests/down_payment.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$ begin
  if to_regprocedure('public.create_purchase(text,jsonb,jsonb,uuid)') is null then
    raise exception 'RED: create_purchase ainda nao existe';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d0a1', true);
do $$
declare
  u uuid := auth.uid(); v uuid := '00000000-0000-0000-0000-00000000d0a2';
  w uuid; w2 uuid; a uuid; c uuid; a2 uuid; foreign_parent uuid;
begin
  insert into auth.users(id,email) values (u,'down-payment-1@example.invalid'),(v,'down-payment-2@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values (u),(v) on conflict(id) do nothing;
  select public.my_default_workspace() into w;
  if w is null then
    insert into public.workspaces(name,owner_id) values ('down-payment',u) returning id into w;
    insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  end if;
  insert into public.workspaces(name,owner_id) values ('foreign down-payment',v) returning id into w2;
  insert into public.workspace_members(workspace_id,user_id,role) values(w2,v,'owner');
  insert into public.accounts(workspace_id,user_id,name,type) values(w,u,'cash','cash') returning id into a;
  insert into public.accounts(workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents,payment_account_id)
    values(w,u,'card','credit_card',5,12,500000,a) returning id into c;
  insert into public.accounts(workspace_id,user_id,name,type) values(w2,v,'foreign','checking') returning id into a2;
  insert into public.debts(workspace_id,user_id,name,principal_cents,remaining_cents,account_id)
    values(w2,v,'foreign',100000,100000,a2) returning id into foreign_parent;
  perform set_config('test.dp.workspace',w::text,true);
  perform set_config('test.dp.account',a::text,true);
  perform set_config('test.dp.card',c::text,true);
  perform set_config('test.dp.foreign_account',a2::text,true);
  perform set_config('test.dp.foreign_parent',foreign_parent::text,true);
end $$;

create function pg_temp.must_fail(q text) returns void language plpgsql as $$
declare failed boolean := false;
begin
  begin execute q; exception when others then failed := true; end;
  if not failed then raise exception 'Era para recusar: %',q; end if;
end $$;
set local role authenticated;
do $$
declare
  a uuid := current_setting('test.dp.account')::uuid;
  c uuid := current_setting('test.dp.card')::uuid;
  w uuid := current_setting('test.dp.workspace')::uuid;
  a2 uuid := current_setting('test.dp.foreign_account')::uuid;
  foreign_parent uuid := current_setting('test.dp.foreign_parent')::uuid;
  data jsonb; entry jsonb; result jsonb; again jsonb; hypothetical jsonb;
  p uuid; d uuid; e uuid; inv uuid; card_entry uuid; active_account uuid; archived_account uuid; empty_plan uuid;
  source_tx uuid; req uuid := gen_random_uuid(); attach_req uuid := gen_random_uuid();
  n int; n_rows int; n_requests int; n_invoices int; mode text; debt_json jsonb; amt jsonb;
begin
  data := jsonb_build_object('p_account_id',a,'p_total_cents',100000,'p_installments',5,
    'p_paid_installments',0,'p_occurred_at',current_date+10,'p_description','Compra',
    'p_category','casa','p_merchant','Loja');
  entry := jsonb_build_object('amount_cents',20000,'account_id',a,'occurred_at',current_date);
  result := public.create_purchase('parcelada',data||jsonb_build_object('down_payment',entry),null,req);
  p := (result->'ids'->>0)::uuid;
  e := (result->>'down_payment_id')::uuid;
  if e is null or (result->'ids'->>-1)::uuid <> e then raise exception 'parent/entrada fora de ordem: %',result; end if;
  if (select sum(amount_cents) from public.transactions where installment_plan_id=p or down_payment_plan_id=p) <> 120000
    or (select count(*) from public.transactions where installment_plan_id=p) <> 5
    or (select count(*) from public.transactions where installment_plan_id=p and status='cleared') <> 0 then
    raise exception 'Entrada + 5 parcelas nao soma 120000 ou conta entrada como parcela';
  end if;
  if not exists(select 1 from public.transactions where id=e and kind='expense' and status='cleared'
    and description='Entrada · Compra' and category='casa' and merchant='Loja'
    and occurred_at=current_date and installment_plan_id is null and debt_id is null and recurring_id is null) then
    raise exception 'Metadados/vinculos da entrada divergiram';
  end if;
  again := public.create_purchase('parcelada',data,entry,req);
  if again <> result then raise exception 'Retry mudou ids'; end if;
  perform pg_temp.must_fail(format('select public.create_purchase(%L,%L::jsonb,%L::jsonb,%L::uuid)',
    'parcelada',data,entry||'{"amount_cents":21000}',req));

  -- Edicao normal altera caixa, preserva contrato; nao pode virar parcela nem se reassociar.
  update public.transactions set amount_cents=21000,occurred_at=current_date-1 where id=e;
  if (select total_cents from public.installment_plans where id=p) <> 100000 then raise exception 'Editar entrada alterou contrato'; end if;
  perform pg_temp.must_fail(format('update public.transactions set down_payment_plan_id=null where id=%L',e));
  perform pg_temp.must_fail(format('update public.transactions set installment_plan_id=%L, installment_no=1 where id=%L',p,e));
  perform pg_temp.must_fail(format('update public.transactions set account_id=%L where id=%L',a2,e));
  perform pg_temp.must_fail(format('update public.transactions set status=''pending'' where id=%L',e));
  perform pg_temp.must_fail(format('update public.transactions set occurred_at=current_date+1 where id=%L',e));
  perform pg_temp.must_fail(format('select public.converter_registro(%L::jsonb,%L,%L::jsonb)',
    jsonb_build_object('tipo','transacao','id',e),'manter',jsonb_build_object('tipo','parcelada','dados',data)));
  delete from public.transactions where id=e;
  if (select count(*) from public.transactions where installment_plan_id=p) <> 5 then raise exception 'Apagar entrada alterou parcelas'; end if;
  e := public.add_purchase_down_payment('parcelada',p,entry,attach_req);
  if public.add_purchase_down_payment('parcelada',p,entry,attach_req) <> e then raise exception 'Retry anexar mudou id'; end if;
  perform pg_temp.must_fail(format('select public.add_purchase_down_payment(%L,%L,%L::jsonb,%L)',
    'parcelada',p,entry||'{"amount_cents":1}',attach_req));
  perform pg_temp.must_fail(format('select public.add_purchase_down_payment(%L,%L,%L::jsonb,%L)',
    'parcelada',p,entry,gen_random_uuid()));
  delete from public.installment_plans where id=p;
  if exists(select 1 from public.transactions where id=e) then raise exception 'Cascade plano nao apagou entrada'; end if;

  -- Fixa e amortizada: entrada nunca altera principal, saldo ou contagem paga.
  foreach mode in array array['fixed_installments','amortized'] loop
    debt_json := jsonb_build_object('name','Divida '||mode,'kind','financing','calculation_mode',mode,
      'principal_cents',100000,'remaining_cents',100000,'interest_rate_monthly',0,
      'installments',5,'installments_paid',0,'installment_cents',20000,'account_id',a,
      'due_day',extract(day from current_date+10)::int,'first_due_date',current_date+10);
    result := public.create_purchase('financiamento',debt_json,entry,gen_random_uuid());
    d := (result->'ids'->>0)::uuid; e := (result->>'down_payment_id')::uuid;
    if not exists(select 1 from public.debts where id=d and installments_paid=0 and principal_cents=100000 and remaining_cents=100000)
      or (select count(*) from private.debt_schedule_for(d)) <> 5 then raise exception 'Entrada alterou divida %',mode; end if;
    delete from public.transactions where id=e;
    if (select remaining_cents from public.debts where id=d) <> 100000 then raise exception 'Excluir entrada alterou saldo'; end if;
    e := public.add_purchase_down_payment('financiamento',d,entry,gen_random_uuid());
    delete from public.debts where id=d;
    if exists(select 1 from public.transactions where id=e) then raise exception 'Cascade divida nao apagou entrada'; end if;
  end loop;

  -- Invalido falha atomico: nem parent, parcela, fatura ou chave de retry sobrevive.
  foreach amt in array array['0'::jsonb,'-1'::jsonb,'1.5'::jsonb,'null'::jsonb,'"20"'::jsonb] loop
    select count(*) into n from public.installment_plans;
    select count(*) into n_rows from public.transactions;
    select count(*) into n_requests from private.purchase_write_requests;
    select count(*) into n_invoices from public.card_invoices;
    perform pg_temp.must_fail(format('select public.create_purchase(%L,%L::jsonb,%L::jsonb,%L)',
      'parcelada',data,entry||jsonb_build_object('amount_cents',amt),gen_random_uuid()));
    if (select count(*) from public.installment_plans) <> n then raise exception 'Falha deixou parent parcial'; end if;
    if (select count(*) from public.transactions) <> n_rows
      or (select count(*) from private.purchase_write_requests) <> n_requests
      or (select count(*) from public.card_invoices) <> n_invoices then raise exception 'Falha deixou linhas/chave/fatura parcial'; end if;
  end loop;
  perform pg_temp.must_fail(format('select public.create_purchase(%L,%L::jsonb,%L::jsonb,%L)',
    'parcelada',data,entry||jsonb_build_object('occurred_at',current_date+1),gen_random_uuid()));
  perform pg_temp.must_fail(format('select public.create_purchase(%L,%L::jsonb,%L::jsonb,%L)',
    'parcelada',data,entry||jsonb_build_object('account_id',a2),gen_random_uuid()));
  perform pg_temp.must_fail(format('select public.add_purchase_down_payment(%L,%L,%L::jsonb,%L)',
    'financiamento',foreign_parent,entry,gen_random_uuid()));

  result := public.create_purchase('parcelada',data,entry||jsonb_build_object('account_id',c),gen_random_uuid());
  e := (result->>'down_payment_id')::uuid; p := (result->'ids'->>0)::uuid;
  card_entry := e;
  if not exists(select 1 from public.transactions where id=e and invoice_id is not null and account_id=c and status='cleared')
    or (select count(*) from public.transactions where installment_plan_id=p and invoice_id is not null) <> 0 then
    raise exception 'Conta/cartao independentes ou fatura da entrada falhou';
  end if;
  update public.transactions set amount_cents=23000,description='Entrada corrigida',account_id=c,occurred_at=current_date-1 where id=e;
  if not exists(select 1 from public.transactions where id=e and amount_cents=23000 and invoice_id is not null)
    then raise exception 'Editar entrada cartao aberto falhou'; end if;
  select invoice_id into inv from public.transactions where id=e;
  perform public.settle_invoice(inv,current_date);
  if (select status from public.card_invoices where id=inv)<>'paid' then raise exception 'Nao quitou fatura da entrada'; end if;
  perform public.unsettle_invoice(inv);
  if not exists(select 1 from public.transactions where id=e and status='pending' and paid_at is null and down_payment_plan_id=p)
    or (select count(*) from public.transactions where installment_plan_id=p)<>5
    or (select total_cents from public.installment_plans where id=p)<>100000 then
    raise exception 'Desfazer fatura bloqueou entrada ou alterou contrato';
  end if;
  update public.transactions set amount_cents=22000 where id=e;
  if (select amount_cents from public.transactions where id=e)<>22000 then raise exception 'Entrada cartao pending nao edita'; end if;
  perform pg_temp.must_fail(format('insert into public.transactions(workspace_id,user_id,kind,amount_cents,account_id,occurred_at,status,source,down_payment_plan_id) values(%L,auth.uid(),''income'',1,%L,current_date,''cleared'',''app'',%L)',w,a,p));
  perform pg_temp.must_fail(format('insert into public.transactions(workspace_id,user_id,kind,amount_cents,account_id,occurred_at,status,source,down_payment_debt_id) values(%L,auth.uid(),''expense'',1,%L,current_date,''cleared'',''app'',%L)',w,a,foreign_parent));

  -- Sem entrada: mesmo fim do mes, historico pago e regras do cartao.
  result := public.create_purchase('parcelada',data||jsonb_build_object('ultimo_dia',true,'p_paid_installments',1,'p_occurred_at',current_date-60),null,gen_random_uuid());
  p := (result->'ids'->>0)::uuid;
  if (select count(*) from public.transactions where installment_plan_id=p and status='cleared') <> 1
    or exists(select 1 from public.transactions where installment_plan_id=p and occurred_at<>(date_trunc('month',occurred_at)+interval '1 month - 1 day')::date)
    or result->>'down_payment_id' is not null then raise exception 'Sem entrada mudou historico/fim do mes'; end if;
  result := public.create_purchase('parcelada',data||jsonb_build_object('p_account_id',c),null,gen_random_uuid());
  p := (result->'ids'->>0)::uuid;
  if (select count(*) from public.transactions where installment_plan_id=p and invoice_id is not null) <> 5 then raise exception 'Sem entrada mudou cartao'; end if;

  -- Simular desfaz escrita e inclui a entrada. Converter avulso→parcelada usa outro nucleo.
  hypothetical := public.simular(jsonb_build_array(jsonb_build_object('tipo','parcelada','dados',data||jsonb_build_object('down_payment',entry))), '{}'::jsonb);
  if jsonb_array_length(hypothetical->'erros') <> 0 or jsonb_array_length(hypothetical->'criados'->0->'ids') <> 7 then raise exception 'Simular entrada divergiu: %',hypothetical; end if;
  if exists(select 1 from public.installment_plans where id=(hypothetical->'criados'->0->'ids'->>0)::uuid) then raise exception 'Simular gravou'; end if;
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,account_id,occurred_at,status,source)
    values(w,auth.uid(),'expense',20000,a,current_date,'cleared','app') returning id into source_tx;
  result := public.converter_registro(jsonb_build_object('tipo','transacao','id',source_tx),'converter',
    jsonb_build_object('tipo','parcelada','dados',data||jsonb_build_object('down_payment',entry)));
  p := (result->'ids'->>0)::uuid;
  if not exists(select 1 from public.transactions where down_payment_plan_id=p)
    or jsonb_array_length(result->'ids') <> 7 then raise exception 'Converter nao incluiu entrada: %',result; end if;
  perform set_config('test.dp.plan',p::text,true);

  -- Conta arquivada conserva o historico; gravar/mover uma nova entrada exige conta ativa.
  select id into e from public.transactions where down_payment_plan_id=p;
  insert into public.accounts(workspace_id,user_id,name,type)
    values(w,auth.uid(),'Ativa para regressao','checking') returning id into active_account;
  insert into public.accounts(workspace_id,user_id,name,type,archived)
    values(w,auth.uid(),'Outra arquivada','cash',true) returning id into archived_account;
  update public.accounts set archived=true where id in(a,c);
  update public.transactions set amount_cents=25000,description='Entrada historica corrigida' where id=e;
  if not exists(select 1 from public.transactions where id=e and amount_cents=25000 and account_id=a
    and description='Entrada historica corrigida' and down_payment_plan_id=p) then
    raise exception 'Arquivar conta bloqueou editar entrada historica'; end if;
  perform pg_temp.must_fail(format('update public.transactions set account_id=%L where id=%L',archived_account,e));
  select count(*) into n from public.installment_plans;
  perform pg_temp.must_fail(format('select public.create_purchase(%L,%L::jsonb,%L::jsonb,%L)',
    'parcelada',data||jsonb_build_object('p_account_id',active_account),entry,gen_random_uuid()));
  if (select count(*) from public.installment_plans)<>n then raise exception 'Entrada em conta arquivada deixou parent parcial'; end if;
  result := public.create_purchase('parcelada',data||jsonb_build_object('p_account_id',active_account),null,gen_random_uuid());
  empty_plan := (result->'ids'->>0)::uuid;
  perform pg_temp.must_fail(format('insert into public.transactions(workspace_id,user_id,kind,amount_cents,account_id,occurred_at,status,source,down_payment_plan_id) values(%L,auth.uid(),''expense'',1,%L,current_date,''cleared'',''app'',%L)',w,a,empty_plan));
  update public.transactions set amount_cents=24000,description='Entrada cartao arquivado' where id=card_entry;
  perform public.settle_invoice(inv,current_date);
  perform public.unsettle_invoice(inv);
  if not exists(select 1 from public.transactions where id=card_entry and amount_cents=24000 and status='pending' and account_id=c)
    or (select total_cents from public.installment_plans where id=p)<>100000 then
    raise exception 'Cartao arquivado bloqueou editar/quitar/desfazer entrada ou alterou contrato'; end if;
  raise notice 'PASS: entrada, atomica, retry, guards, RLS, cascade, cartao, sem entrada, simular/converter';
end $$;
reset role;
-- Escritor privilegiado tambem precisa obedecer integridade; RLS nao mascara esta prova.
do $$
declare w uuid:=current_setting('test.dp.workspace')::uuid;
  a uuid:=current_setting('test.dp.account')::uuid;
  a2 uuid:=current_setting('test.dp.foreign_account')::uuid;
  d uuid:=current_setting('test.dp.foreign_parent')::uuid;
  p uuid:=current_setting('test.dp.plan')::uuid;
begin
  perform pg_temp.must_fail(format('insert into public.transactions(workspace_id,user_id,kind,amount_cents,account_id,occurred_at,status,source,down_payment_debt_id) values(%L,auth.uid(),''expense'',1,%L,current_date,''cleared'',''app'',%L)',w,a,d));
  perform pg_temp.must_fail(format('update public.installment_plans set workspace_id=(select workspace_id from public.accounts where id=%L) where id=%L',a2,p));
  perform pg_temp.must_fail(format('update public.accounts set workspace_id=(select workspace_id from public.accounts where id=%L) where id=%L',a2,a));
end $$;
rollback;
