-- Nome identifica contratos ativos no workspace; arquivados conservam nome e fatos históricos.
-- Executar RED antes da migration e GREEN depois; runner sempre desfaz fixtures sintéticas.
-- agent/.venv/bin/python scripts/sql-test.py supabase/tests/debt_active_name_unique.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000e1a1',true);
do $$
declare
  u uuid := auth.uid(); other_u uuid := '00000000-0000-0000-0000-00000000e1a2';
  w uuid; other_w uuid; a uuid; ea uuid; other_a uuid; other_d uuid;
begin
  insert into auth.users(id,email) values(u,'debt-active-name@example.invalid'),(other_u,'debt-active-name-foreign@example.invalid')
    on conflict(id) do nothing;
  insert into public.profiles(id) values(u),(other_u) on conflict(id) do nothing;
  w := public.my_default_workspace();
  if w is null then
    insert into public.workspaces(name,owner_id) values('debt active name QA',u) returning id into w;
    insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  end if;
  insert into public.workspaces(name,owner_id) values('debt active name foreign QA',other_u) returning id into other_w;
  insert into public.workspace_members(workspace_id,user_id,role) values(other_w,other_u,'owner');
  insert into public.accounts(workspace_id,user_id,name,type) values(w,u,'Contrato QA','checking') returning id into a;
  insert into public.accounts(workspace_id,user_id,name,type) values(w,u,'Entrada QA','cash') returning id into ea;
  insert into public.accounts(workspace_id,user_id,name,type) values(other_w,other_u,'Foreign QA','cash') returning id into other_a;
  insert into public.debts(workspace_id,user_id,name,principal_cents,remaining_cents,account_id)
    values(other_w,other_u,'CE nome histórico',100000,100000,other_a) returning id into other_d;
  perform set_config('test.dn.workspace',w::text,true);
  perform set_config('test.dn.account',a::text,true);
  perform set_config('test.dn.entry_account',ea::text,true);
  perform set_config('test.dn.foreign_workspace',other_w::text,true);
  perform set_config('test.dn.foreign_debt',other_d::text,true);
end $$;

create function pg_temp.dn_unique_fail(q text) returns void language plpgsql as $$
declare refused boolean := false; violated_constraint text;
begin
  begin execute q;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint<>'debts_workspace_id_name_key' then raise exception 'Unique inesperado: %',violated_constraint; end if;
    refused := true;
  end;
  if not refused then raise exception 'Era para recusar conflito entre contratos ativos: %',q; end if;
end $$;

set local role authenticated;
do $$
declare
  w uuid := current_setting('test.dn.workspace')::uuid;
  a uuid := current_setting('test.dn.account')::uuid;
  ea uuid := current_setting('test.dn.entry_account')::uuid;
  debt_name text := 'CE nome histórico';
  debt_data jsonb; entry_data jsonb; recurring_data jsonb; result jsonb; retry jsonb;
  original_d uuid; original_e uuid; series uuid; new_d uuid; new_e uuid; archived_copy uuid;
  original_entry public.transactions; new_entry public.transactions; archived_original public.debts;
  request_id uuid := gen_random_uuid(); failed_request uuid := gen_random_uuid();
  before_debts int; before_rows int; before_requests int; changed int; refused boolean := false;
begin
  debt_data := jsonb_build_object('name',debt_name,'kind','financing','calculation_mode','fixed_installments',
    'principal_cents',100000,'remaining_cents',100000,'interest_rate_monthly',0,'installments',5,
    'installments_paid',0,'installment_cents',20000,'account_id',a,
    'due_day',extract(day from current_date+10)::int,'first_due_date',current_date+10);
  entry_data := jsonb_build_object('amount_cents',12345,'account_id',ea,'occurred_at',current_date-2);
  result := public.create_purchase('financiamento',debt_data,entry_data,request_id);
  retry := public.create_purchase('financiamento',debt_data,entry_data,request_id);
  if retry<>result then raise exception 'Retry de criação mudou IDs'; end if;
  original_d := (result->'ids'->>0)::uuid; original_e := (result->>'down_payment_id')::uuid;
  select * into strict original_entry from public.transactions where id=original_e;

  recurring_data := jsonb_build_object('kind','expense','amount_cents',20000,'description',debt_name,
    'account_id',a,'rrule','FREQ=MONTHLY','auto_confirm',false,
    'dtstart',(current_date+10)::timestamp at time zone 'America/Sao_Paulo',
    'next_run_at',(current_date+10)::timestamp at time zone 'America/Sao_Paulo');
  result := public.converter_registro(jsonb_build_object('tipo','divida','id',original_d),'desta_em_diante',
    jsonb_build_object('tipo','recorrente','dados',recurring_data));
  series := (result->'ids'->>0)::uuid;
  if not exists(select 1 from public.debts where id=original_d and name=debt_name and archived) then
    raise exception 'Conversão futura não conservou nome/ID do contrato arquivado';
  end if;
  select * into strict archived_original from public.debts where id=original_d;

  -- RED antigo: unique incluía o original arquivado, mesmo com zero contratos ativos homônimos.
  result := public.converter_registro(jsonb_build_object('tipo','serie','id',series),'desta_em_diante',
    jsonb_build_object('tipo','financiamento','dados',debt_data||jsonb_build_object('down_payment',entry_data)));
  new_d := (result->'ids'->>0)::uuid; new_e := (result->>'down_payment_id')::uuid;
  if new_d is null or new_d=original_d or new_e is null or new_e=original_e then
    raise exception 'Conversão reversa não criou identidades distintas';
  end if;
  select * into strict new_entry from public.transactions where id=new_e;
  if not exists(select 1 from public.debts d where d.id=new_d and d.name=debt_name and not d.archived
    and d.installments_paid=0 and d.remaining_cents=100000)
    or (select count(*) from public.transactions where down_payment_debt_id=new_d)<>1
    or new_entry.amount_cents<>12345 or new_entry.occurred_at<>current_date-2
    or new_entry.account_id<>ea or new_entry.debt_id is not null or new_entry.recurring_id is not null then
    raise exception 'Novo financiamento/entrada não conservaram semântica';
  end if;
  if not exists(select 1 from public.transactions where id=original_e and to_jsonb(transactions)=to_jsonb(original_entry))
    or not exists(select 1 from public.debts where id=original_d and to_jsonb(debts)=to_jsonb(archived_original)) then
    raise exception 'Conversão reversa alterou original arquivado/entrada';
  end if;
  retry := public.create_purchase('financiamento',debt_data,entry_data,request_id);
  if (retry->'ids'->>0)::uuid<>original_d or (retry->>'down_payment_id')::uuid<>original_e then
    raise exception 'Retry do contrato agora arquivado não devolveu identidades originais';
  end if;

  -- Mais de um contrato histórico pode compartilhar o nome, mantendo apenas um ativo.
  for changed in 1..2 loop
    insert into public.debts(workspace_id,user_id,name,principal_cents,remaining_cents,archived)
      values(w,auth.uid(),debt_name,100000,100000,true) returning id into archived_copy;
  end loop;
  if (select count(*) from public.debts d where d.workspace_id=w and d.name=debt_name and d.archived)<>3
    or (select count(*) from public.debts d where d.workspace_id=w and d.name=debt_name and not d.archived)<>1 then
    raise exception 'Multiplicidade arquivada/unicidade ativa divergiu';
  end if;

  -- Conflito ativo falha dentro da transação: nenhum contrato, entrada ou pedido parcial.
  select count(*) into before_debts from public.debts;
  select count(*) into before_rows from public.transactions;
  select count(*) into before_requests from private.purchase_write_requests;
  perform pg_temp.dn_unique_fail(format('select public.create_purchase(%L,%L::jsonb,%L::jsonb,%L::uuid)',
    'financiamento',debt_data,entry_data,failed_request));
  if (select count(*) from public.debts)<>before_debts or (select count(*) from public.transactions)<>before_rows
    or (select count(*) from private.purchase_write_requests)<>before_requests then raise exception 'Conflito deixou gravação parcial'; end if;
  perform pg_temp.dn_unique_fail(format('update public.debts set archived=false where id=%L',original_d));
  if not exists(select 1 from public.debts where id=original_d and to_jsonb(debts)=to_jsonb(archived_original)) then
    raise exception 'Desarquivamento recusado alterou histórico';
  end if;

  -- Com o novo arquivado, o original pode voltar a ser o único ativo sem renomear nada.
  update public.debts set archived=true where id=new_d;
  update public.debts set archived=false where id=original_d;
  if not exists(select 1 from public.debts d where d.id=original_d and d.name=debt_name and not d.archived)
    or not exists(select 1 from public.debts d where d.id=new_d and d.name=debt_name and d.archived)
    or not exists(select 1 from public.transactions where id=original_e and to_jsonb(transactions)=to_jsonb(original_entry))
    or not exists(select 1 from public.transactions where id=new_e and to_jsonb(transactions)=to_jsonb(new_entry)) then
    raise exception 'Arquivar/desarquivar alterou nomes ou entradas';
  end if;

  -- O homônimo ativo do outro workspace não conflita e segue inacessível pela RLS.
  if exists(select 1 from public.debts where id=current_setting('test.dn.foreign_debt')::uuid) then
    raise exception 'RLS expôs contrato estrangeiro';
  end if;
  update public.debts set archived=true where id=current_setting('test.dn.foreign_debt')::uuid;
  get diagnostics changed = row_count;
  if changed<>0 then raise exception 'RLS permitiu arquivar contrato estrangeiro'; end if;
  begin
    insert into public.debts(workspace_id,user_id,name,principal_cents,remaining_cents)
      values(current_setting('test.dn.foreign_workspace')::uuid,auth.uid(),'CE tentativa estrangeira',1,1);
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'RLS permitiu inserir em outro workspace'; end if;
  raise notice 'PASS: ativo único por workspace; histórico homônimo intacto; ida/volta+entrada; retry; conflito/unarchive atômicos; RLS';
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.debts where id=current_setting('test.dn.foreign_debt')::uuid
    and name='CE nome histórico' and not archived) then raise exception 'Workspace estrangeiro alterado'; end if;
end $$;
rollback;
