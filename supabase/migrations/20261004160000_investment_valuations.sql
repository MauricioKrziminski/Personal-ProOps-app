-- F13: principal, resultado e reavaliação da posição de investimento.
--
-- A posição continua sendo a conta `type='investment'` (F12). Aqui entram TRÊS coisas novas, e
-- nenhuma delas mexe no caixa: (1) "Atualizar valor" (`investment_valuations`, quanto a posição vale
-- numa data — ganho não realizado, só patrimônio); (2) "Informar aplicado" (abertura: quanto já estava
-- aplicado antes do histórico no app — só o principal); (3) "Rendimento recebido" (uma receita real
-- `kind='income'`, ligada à posição por `investment_movements.kind='income'`, mesmo desfazer do F12).
-- Valor atual = última atualização por `as_of` (nunca a última digitada) + o que entrou/saiu da conta
-- DEPOIS daquela data (estritamente depois: o que cai no mesmo dia já está no valor informado).
-- `private.investment_position_numbers` é a ÚNICA conta, lida por `investment_positions()` e por
-- `private.net_worth_now`. Sem nenhuma atualização, o resultado é indisponível (null) — nunca zero.
-- Teste: `supabase/tests/investment_valuations.sql`.

create table if not exists public.investment_valuations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 position_account_id uuid not null references public.accounts(id) on delete cascade,
 kind text not null check(kind in('valuation','opening')),
 value_cents bigint not null check(value_cents between 0 and 9007199254740991),
 as_of date not null,
 note text check(char_length(note)<=280),
 edit_revision bigint not null default 1,
 created_at timestamptz not null default now(),
 unique(position_account_id,kind,as_of)
);
create unique index if not exists investment_valuations_one_opening on public.investment_valuations(position_account_id) where kind='opening';
create index if not exists investment_valuations_workspace_idx on public.investment_valuations(workspace_id);
create index if not exists investment_valuations_user_idx on public.investment_valuations(user_id);
alter table public.investment_valuations enable row level security;
drop policy if exists investment_valuations_members_read on public.investment_valuations;
create policy investment_valuations_members_read on public.investment_valuations for select to authenticated
 using(workspace_id in(select private.my_workspace_ids()));
revoke all on public.investment_valuations from public,anon,authenticated;
grant select on public.investment_valuations to authenticated;
grant all on public.investment_valuations to service_role;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='investment_valuations') then
  alter publication supabase_realtime add table public.investment_valuations;
 end if;
end $$;

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='asset_valuations') then
  alter publication supabase_realtime add table public.asset_valuations;
 end if;
end $$;

-- `investment_movements.kind` ganha 'income' (a linha liga a receita de rendimento à posição).
alter table public.investment_movements drop constraint if exists investment_movements_kind_check;
alter table public.investment_movements add constraint investment_movements_kind_check
 check(kind in('contribution','redemption','income'));

-- A receita CRIADA por um rendimento só muda/some pelo comando; a transferência de aplicação/resgate
-- continua igual. O mesmo gatilho vale para os dois tipos de linha.
create or replace function private.guard_investment_transfer() returns trigger
language plpgsql security definer set search_path='' as $$
declare mk text;
begin
 if coalesce(current_setting('proops.investment_scope',true),'')='on' or pg_trigger_depth()>1 then
  return case when tg_op='DELETE' then old else new end;end if;
 select m.kind into mk from public.investment_movements m where m.transfer_id=old.id and m.created_transfer;
 if mk is not null
  and (tg_op='DELETE' or (new.kind,new.account_id,new.counterparty_account_id,new.amount_cents,new.occurred_at)
   is distinct from (old.kind,old.account_id,old.counterparty_account_id,old.amount_cents,old.occurred_at)
   or (mk='income' and (new.status,new.paid_at) is distinct from (old.status,old.paid_at)))
 then raise exception using errcode='P0001',message=case when mk='income'
   then 'Este rendimento pertence a um investimento: desfaça pela posição.'
   else 'Esta transferência pertence a uma aplicação ou resgate: edite ou desfaça pela posição.' end;end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists guard_investment_transfer on public.transactions;
create trigger guard_investment_transfer before update or delete on public.transactions
 for each row when (old.kind in('transfer','income')) execute function private.guard_investment_transfer();
revoke execute on function private.guard_investment_transfer() from public,anon,authenticated,service_role;

-- Números da posição, uma conta só para a tela e para o patrimônio.
create or replace function private.investment_position_numbers(ws_ids uuid[])
returns table(account_id uuid,workspace_id uuid,ledger_cents bigint,value_cents bigint,principal_cents bigint,
 result_cents bigint,result_quality text,received_cents bigint,last_valuation_on date,opening_on date)
language sql stable set search_path to 'public' set timezone to 'America/Sao_Paulo' as $$
 with led as (select c.account_id,c.cents from private.caixa_das_contas(ws_ids,current_date) c where c.account_id is not null)
 select a.id,a.workspace_id,coalesce(led.cents,0)::bigint,
  -- o valor atual nunca fica abaixo de zero (resgate maior que a última atualização)
  greatest(case when lv.as_of is null then coalesce(led.cents,0) else lv.value_cents+dl.d end,0)::bigint,
  (case when op.id is not null then op.value_cents else a.initial_balance_cents end+pr.net)::bigint,
  (case when lv.as_of is null then null else greatest(lv.value_cents+dl.d,0)-(case when op.id is not null then op.value_cents else a.initial_balance_cents end+pr.net) end)::bigint,
  case when lv.as_of is null then 'indisponível' when op.id is not null or a.initial_balance_cents=0 then 'conhecido' else 'estimado' end,
  coalesce(rec.cents,0)::bigint,lv.as_of,op.as_of
 from public.accounts a
 left join led on led.account_id=a.id
 left join lateral (select v.as_of,v.value_cents from public.investment_valuations v
   where v.position_account_id=a.id and v.kind='valuation' order by v.as_of desc limit 1) lv on true
 left join lateral (select v.id,v.as_of,v.value_cents from public.investment_valuations v
   where v.position_account_id=a.id and v.kind='opening' order by v.as_of desc,v.id limit 1) op on true
 cross join lateral (select coalesce(sum(case
    when t.kind='income' and t.account_id=a.id then t.amount_cents
    when t.kind='expense' and t.account_id=a.id then -t.amount_cents
    when t.kind='transfer' and t.account_id=a.id then -t.amount_cents
    when t.kind='transfer' and t.counterparty_account_id=a.id then t.amount_cents
    else 0 end),0) d
   from public.transactions t where lv.as_of is not null and t.status='cleared'
    and (t.account_id=a.id or t.counterparty_account_id=a.id) and t.paid_at>lv.as_of and t.paid_at<=current_date) dl
 cross join lateral (select coalesce(sum(case when t.account_id=a.id then -t.amount_cents else t.amount_cents end),0) net
   from public.transactions t where t.kind='transfer' and t.status='cleared'
    and (t.account_id=a.id or t.counterparty_account_id=a.id) and t.paid_at<=current_date
    and (op.id is null or t.paid_at>op.as_of)) pr
 left join lateral (select sum(t.amount_cents) cents from public.investment_movements m join public.transactions t on t.id=m.transfer_id
   where m.position_account_id=a.id and m.kind='income' and t.status='cleared') rec on true
 where a.type='investment' and not a.archived and a.workspace_id=any(ws_ids);
$$;
revoke execute on function private.investment_position_numbers(uuid[]) from public,anon;
grant execute on function private.investment_position_numbers(uuid[]) to authenticated,service_role;

create or replace function private.investment_value_cents(p text) returns bigint
language plpgsql immutable security invoker set search_path='' as $$
begin
 if p is null or p !~ '^[0-9]{1,16}$' or p::numeric>9007199254740991
 then raise exception using errcode='22023',message='Valor em centavos inteiros entre 0 e 9007199254740991';end if;
 return p::bigint;
end $$;
revoke execute on function private.investment_value_cents(text) from public,anon,authenticated,service_role;
grant execute on function private.investment_value_cents(text) to authenticated;

-- Desfazer/editar do F12 passam a conhecer o rendimento: a receita não é transferência, e desfazer
-- apaga a receita junto (senão sobraria uma receita órfã, já sem a guarda).
create or replace function private.investment_command(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='America/Sao_Paulo' as $$
declare uid uuid:=auth.uid();prev_scope text;op text;ws uuid;pid uuid;m public.investment_movements%rowtype;pos public.accounts%rowtype;o public.accounts%rowtype;
 intent jsonb;sealed private.investment_write_receipts%rowtype;cached jsonb;result jsonb;keys text[];
 ref uuid;amt bigint;day date;other uuid;t public.transactions%rowtype;tid uuid;mid uuid;note text;rev bigint:=1;created boolean:=false;kind text;
 bal bigint;from_day date;st text;
begin
 if uid is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 if p_request_id is null then raise exception using errcode='22023',message='Identificador da tentativa obrigatório';end if;
 if p_input is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception using errcode='22023',message='Movimentação inválida';end if;
 op:=p_input->>'op';
 keys:=case op
  when 'contribute' then array['op','position_account_id','from_account_id','amount_cents','occurred_on','note']
  when 'redeem' then array['op','position_account_id','to_account_id','amount_cents','occurred_on','note']
  when 'link' then array['op','transfer_id']
  when 'edit' then array['op','movement_id','amount_cents','occurred_on','expected_revision']
  when 'undo' then array['op','movement_id','expected_revision']
  else null end;
 if keys is null or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(keys)) then
  raise exception using errcode='22023',message='Movimentação inválida';end if;
 intent:=jsonb_build_object('operation','investment','input',p_input);
 -- Objeto de outro espaço dá o mesmo erro de "não é seu": não revela existência.
 if op in('edit','undo') then
  ref:=private.goal_money_uuid(p_input->>'movement_id','Movimentação inválida');
  select workspace_id,position_account_id into ws,pid from public.investment_movements where id=ref;
  if ws is null and op='undo' then
   select * into sealed from private.investment_write_receipts where user_id=uid and request_id=p_request_id;
   if sealed.request_id is not null and sealed.payload is not distinct from intent
    and exists(select 1 from public.workspace_members where workspace_id=sealed.workspace_id and user_id=uid)
   then return sealed.result;end if;
  end if;
 elsif op='link' then
  select workspace_id,case when exists(select 1 from public.accounts a where a.id=x.account_id and a.type='investment') then x.account_id else x.counterparty_account_id end
   into ws,pid from public.transactions x where x.id=private.goal_money_uuid(p_input->>'transfer_id','Transferência inválida');
 else
  select workspace_id,id into ws,pid from public.accounts where id=private.goal_money_uuid(p_input->>'position_account_id','Posição inválida');
 end if;
 if ws is null or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=uid)
 then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 perform pg_advisory_xact_lock(hashtextextended('investment-request:'||uid::text||':'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('investment:'||ws::text,0));
 perform 1 from public.workspace_members where workspace_id=ws and user_id=uid for share;
 if not found then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 select * into sealed from private.investment_write_receipts where user_id=uid and request_id=p_request_id;
 if sealed.request_id is not null then
  if sealed.workspace_id<>ws or sealed.payload is distinct from intent then
   raise exception using errcode='22023',message='Identificador reutilizado com dados diferentes';end if;
  return sealed.result;
 end if;
 cached:=private.reserve_payment_request(p_request_id,intent);
 if cached is not null then raise exception using errcode='42501',message='Recibo não confirmado pelo comando de investimento';end if;
 select * into pos from public.accounts where id=pid and workspace_id=ws for no key update;
 if op='link' and pos.id is not null and pos.type<>'investment' then
  if exists(select 1 from public.transactions x join public.accounts z on z.id in(x.account_id,x.counterparty_account_id)
   where x.id=(p_input->>'transfer_id')::uuid and z.type='credit_card')
  then raise exception using errcode='22023',message='Cartão de crédito não aplica nem recebe resgate';end if;
  raise exception using errcode='22023',message='A transferência precisa ter uma conta de investimento numa ponta';
 end if;
 if pos.id is null or pos.type<>'investment' then raise exception using errcode='22023',message='A posição precisa ser uma conta de investimento';end if;
 note:=nullif(trim(coalesce(p_input->>'note','')),'');

 if op in('edit','undo') then
  select * into m from public.investment_movements where id=ref and position_account_id=pos.id for update;
  if m.id is null then raise exception using errcode='22023',message='Essa movimentação não existe mais';end if;
  if jsonb_typeof(p_input->'expected_revision') is distinct from 'number' then raise exception using errcode='22023',message='Revisão inválida';end if;
  if (p_input->>'expected_revision')::numeric<>m.edit_revision
  then raise exception using errcode='PT409',message='A movimentação mudou. Abra de novo';end if;
  select * into t from public.transactions where id=m.transfer_id and workspace_id=ws for update;
  if t.id is not null and not((t.kind='transfer' and pos.id in(t.account_id,t.counterparty_account_id)) or (t.kind='income' and m.kind='income')) then t.id:=null;end if;
  mid:=m.id;tid:=m.transfer_id;rev:=m.edit_revision;
  if op='undo' then
   delete from public.investment_movements where id=m.id;
   if m.created_transfer and t.id is not null then
    prev_scope:=current_setting('proops.investment_scope',true);
    perform set_config('proops.investment_scope','on',true);
    delete from public.transactions where id=t.id;
    perform set_config('proops.investment_scope',coalesce(prev_scope,''),true);
    if m.kind='contribution' or (m.kind='income' and t.account_id=pos.id) then perform private.investment_capacity(pos.id,t.occurred_at,'undo');end if;
   end if;
   mid:=null;tid:=null;
  else
   if m.kind='income' then raise exception using errcode='P0001',message='Para corrigir um rendimento, desfaça e lance de novo.';end if;
   if t.id is null then raise exception using errcode='22023',message='Essa movimentação ficou sem lançamento';end if;
   if not m.created_transfer then raise exception using errcode='22023',message='Movimentação vinculada: o valor e a data são do lançamento. Edite o lançamento.';end if;
   amt:=private.goal_money_amount(p_input->>'amount_cents');
   day:=private.goal_money_day(p_input->>'occurred_on');
   from_day:=least(t.occurred_at,day);
   -- o status só muda quando a data cruza hoje
   st:=case when day>current_date and t.occurred_at<=current_date then 'pending'
    when day<=current_date and t.occurred_at>current_date then 'cleared' else t.status end;
   prev_scope:=current_setting('proops.investment_scope',true);
   perform set_config('proops.investment_scope','on',true);
   update public.transactions set amount_cents=amt,occurred_at=day,status=st,paid_at=case when st='cleared' then day end where id=t.id;
   perform set_config('proops.investment_scope',coalesce(prev_scope,''),true);
   update public.investment_movements set edit_revision=edit_revision+1 where id=m.id returning edit_revision into rev;
   perform private.investment_capacity(pos.id,from_day,case when m.kind='redemption' then 'redeem' else 'edit' end);
  end if;
 else
  if pos.archived then raise exception using errcode='22023',message='A posição está arquivada';end if;
  if op='link' then
   select * into t from public.transactions where id=(p_input->>'transfer_id')::uuid and workspace_id=ws for update;
   if t.id is null or t.kind<>'transfer' or t.pays_invoice_id is not null or pos.id not in(t.account_id,t.counterparty_account_id) then raise exception using errcode='22023',message='Transferência não encontrada';end if;
   if t.status<>'cleared' then raise exception using errcode='22023',message='A transferência ainda não aconteceu; vincule depois de confirmada';end if;
   if exists(select 1 from public.goal_money_movements where transfer_id=t.id) or exists(select 1 from public.investment_movements where transfer_id=t.id)
   then raise exception using errcode='23505',message='Essa transferência já está vinculada a um movimento';end if;
   kind:=case when t.account_id=pos.id then 'redemption' else 'contribution' end;
   other:=case when kind='redemption' then t.counterparty_account_id else t.account_id end;
   if t.account_id=pos.id and t.counterparty_account_id=pos.id then raise exception using errcode='22023',message='Origem e destino precisam ser contas diferentes';end if;
   tid:=t.id;
  else
   amt:=private.goal_money_amount(p_input->>'amount_cents');
   day:=private.goal_money_day(p_input->>'occurred_on');
   kind:=case op when 'contribute' then 'contribution' else 'redemption' end;
   other:=private.goal_money_uuid(p_input->>case op when 'contribute' then 'from_account_id' else 'to_account_id' end,'Conta inválida');
   if other=pos.id then raise exception using errcode='22023',message='Origem e destino precisam ser contas diferentes';end if;
  end if;
  select * into o from public.accounts where id=other and workspace_id=ws;
  if o.id is null then raise exception using errcode='42501',message='Conta não encontrada';end if;
  if o.archived then raise exception using errcode='22023',message='A conta está arquivada';end if;
  if o.type='credit_card' then raise exception using errcode='22023',message='Cartão de crédito não aplica nem recebe resgate';end if;
  if o.type='investment' then raise exception using errcode='22023',message='A outra ponta precisa ser uma conta que não seja de investimento';end if;
  if op<>'link' then
   insert into public.transactions(user_id,workspace_id,kind,amount_cents,description,account_id,counterparty_account_id,occurred_at,source,status,auto_confirm)
   values(uid,ws,'transfer',amt,coalesce(note,case kind when 'contribution' then 'Aplicação em ' else 'Resgate de ' end||pos.name),
    case when kind='contribution' then o.id else pos.id end,case when kind='contribution' then pos.id else o.id end,
    day,'app',case when day>current_date then 'pending' else 'cleared' end,day>current_date)
   returning id into tid;
   created:=true;
   if kind='redemption' then perform private.investment_capacity(pos.id,day,'redeem');end if;
  end if;
  insert into public.investment_movements(workspace_id,user_id,position_account_id,kind,transfer_id,created_transfer)
   values(ws,uid,pos.id,kind,tid,created) returning id,edit_revision into mid,rev;
 end if;
 select coalesce(c.cents,0) into bal from private.caixa_das_contas(array[ws],current_date) c where c.account_id=pos.id;
 result:=jsonb_build_object('movement_id',mid,'transfer_id',tid,'position_balance_cents',coalesce(bal,0)::text,'revision',rev);
 insert into private.investment_write_receipts(user_id,request_id,workspace_id,payload,result) values(uid,p_request_id,ws,intent,result);
 perform private.finish_payment_request(p_request_id,result);
 return result;
end $$;

revoke execute on function private.investment_command(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.investment_command(jsonb,uuid) to authenticated;

-- Atualizar valor | abertura | rendimento recebido | corrigir ou apagar uma atualização.
create or replace function private.investment_value_command(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='America/Sao_Paulo' as $$
declare uid uuid:=auth.uid();op text;ws uuid;pid uuid;pos public.accounts%rowtype;o public.accounts%rowtype;
 v public.investment_valuations%rowtype;ref uuid;intent jsonb;sealed private.investment_write_receipts%rowtype;cached jsonb;result jsonb;keys text[];
 val bigint;amt bigint;day date;other uuid;tid uuid;mid uuid;vid uuid;note text;rev bigint:=1;dup date;curval bigint;
begin
 if uid is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 if p_request_id is null then raise exception using errcode='22023',message='Identificador da tentativa obrigatório';end if;
 if p_input is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception using errcode='22023',message='Atualização inválida';end if;
 op:=p_input->>'op';
 keys:=case op
  when 'valuation' then array['op','position_account_id','value_cents','as_of','note']
  when 'opening' then array['op','position_account_id','value_cents','as_of']
  when 'income' then array['op','position_account_id','to_account_id','amount_cents','occurred_on','note']
  when 'edit' then array['op','valuation_id','value_cents','as_of','expected_revision']
  when 'delete' then array['op','valuation_id','expected_revision']
  else null end;
 if keys is null or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(keys)) then
  raise exception using errcode='22023',message='Atualização inválida';end if;
 intent:=jsonb_build_object('operation','investment_value','input',p_input);
 if op in('edit','delete') then
  ref:=private.goal_money_uuid(p_input->>'valuation_id','Atualização inválida');
  select workspace_id,position_account_id into ws,pid from public.investment_valuations where id=ref;
  if ws is null and op='delete' then
   select * into sealed from private.investment_write_receipts where user_id=uid and request_id=p_request_id;
   if sealed.request_id is not null and sealed.payload is not distinct from intent
    and exists(select 1 from public.workspace_members where workspace_id=sealed.workspace_id and user_id=uid)
   then return sealed.result;end if;
  end if;
 else
  select workspace_id,id into ws,pid from public.accounts where id=private.goal_money_uuid(p_input->>'position_account_id','Posição inválida');
 end if;
 if ws is null or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=uid)
 then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 perform pg_advisory_xact_lock(hashtextextended('investment-request:'||uid::text||':'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('investment:'||ws::text,0));
 perform 1 from public.workspace_members where workspace_id=ws and user_id=uid for share;
 if not found then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 select * into sealed from private.investment_write_receipts where user_id=uid and request_id=p_request_id;
 if sealed.request_id is not null then
  if sealed.workspace_id<>ws or sealed.payload is distinct from intent then
   raise exception using errcode='22023',message='Identificador reutilizado com dados diferentes';end if;
  return sealed.result;
 end if;
 cached:=private.reserve_payment_request(p_request_id,intent);
 if cached is not null then raise exception using errcode='42501',message='Recibo não confirmado pelo comando de investimento';end if;
 select * into pos from public.accounts where id=pid and workspace_id=ws for no key update;
 if pos.id is null or pos.type<>'investment' then raise exception using errcode='22023',message='A posição precisa ser uma conta de investimento';end if;
 note:=nullif(trim(coalesce(p_input->>'note','')),'');
 if char_length(coalesce(note,''))>280 then raise exception using errcode='P0001',message='A nota passa de 280 caracteres';end if;

 if op in('edit','delete') then
  select * into v from public.investment_valuations where id=ref and position_account_id=pos.id for update;
  if v.id is null then raise exception using errcode='P0001',message='Essa atualização não existe mais';end if;
  if jsonb_typeof(p_input->'expected_revision') is distinct from 'number' then raise exception using errcode='22023',message='Revisão inválida';end if;
  if (p_input->>'expected_revision')::numeric<>v.edit_revision
  then raise exception using errcode='PT409',message='A atualização mudou. Abra de novo';end if;
  vid:=v.id;rev:=v.edit_revision;
  if op='delete' then
   delete from public.investment_valuations where id=v.id;
   vid:=null;
  else
   val:=private.investment_value_cents(p_input->>'value_cents');
   day:=private.goal_money_day(p_input->>'as_of');
   if day>current_date then raise exception using errcode='P0001',message='A data não pode ser futura';end if;
   if exists(select 1 from public.investment_valuations x where x.position_account_id=pos.id and x.kind=v.kind and x.as_of=day and x.id<>v.id) then
    raise exception using errcode='P0001',message='Já existe uma atualização em '||to_char(day,'DD/MM')||': edite a de '||to_char(day,'DD/MM')||'.';end if;
   update public.investment_valuations set value_cents=val,as_of=day,edit_revision=edit_revision+1 where id=v.id returning edit_revision into rev;
  end if;
 else
  if pos.archived then raise exception using errcode='P0001',message='A posição está arquivada';end if;
  if op in('valuation','opening') then
   val:=private.investment_value_cents(p_input->>'value_cents');
   day:=private.goal_money_day(p_input->>'as_of');
   if day>current_date then raise exception using errcode='P0001',message='A data não pode ser futura';end if;
   if op='valuation' then
    select x.as_of into dup from public.investment_valuations x where x.position_account_id=pos.id and x.kind='valuation' and x.as_of=day;
    if found then raise exception using errcode='P0001',message='Já existe uma atualização em '||to_char(day,'DD/MM')||': edite a de '||to_char(day,'DD/MM')||'.';end if;
    insert into public.investment_valuations(workspace_id,user_id,position_account_id,kind,value_cents,as_of,note)
     values(ws,uid,pos.id,'valuation',val,day,note) returning id,edit_revision into vid,rev;
   else
    -- abertura única por posição: a nova substitui (a tela confirma)
    select x.id into vid from public.investment_valuations x where x.position_account_id=pos.id and x.kind='opening' for update;
    if vid is null then
     insert into public.investment_valuations(workspace_id,user_id,position_account_id,kind,value_cents,as_of)
      values(ws,uid,pos.id,'opening',val,day) returning id,edit_revision into vid,rev;
    else
     update public.investment_valuations set value_cents=val,as_of=day,edit_revision=edit_revision+1 where id=vid returning edit_revision into rev;
    end if;
   end if;
  else
   amt:=private.goal_money_amount(p_input->>'amount_cents');
   day:=private.goal_money_day(p_input->>'occurred_on');
   if day>current_date then raise exception using errcode='P0001',message='A data não pode ser futura';end if;
   other:=private.goal_money_uuid(p_input->>'to_account_id','Conta inválida');
   if other=pos.id then o:=pos;
   else
    select * into o from public.accounts where id=other and workspace_id=ws;
    if o.id is null then raise exception using errcode='42501',message='Conta não encontrada';end if;
    if o.type='investment' then raise exception using errcode='P0001',message='O rendimento cai na posição ou numa conta que não seja de investimento';end if;
   end if;
   if o.archived then raise exception using errcode='P0001',message='A conta está arquivada';end if;
   if o.type='credit_card' then raise exception using errcode='P0001',message='Cartão de crédito não recebe rendimento';end if;
   insert into public.transactions(user_id,workspace_id,kind,amount_cents,description,category,account_id,occurred_at,source,status,auto_confirm)
    values(uid,ws,'income',amt,coalesce(note,'Rendimento de '||pos.name),'rendimentos',o.id,day,'app','cleared',false)
    returning id into tid;
   insert into public.investment_movements(workspace_id,user_id,position_account_id,kind,transfer_id,created_transfer)
    values(ws,uid,pos.id,'income',tid,true) returning id,edit_revision into mid,rev;
  end if;
 end if;
 select n.value_cents into curval from private.investment_position_numbers(array[ws]) n where n.account_id=pos.id;
 result:=jsonb_build_object('valuation_id',vid,'movement_id',mid,'transaction_id',tid,'position_value_cents',coalesce(curval,0)::text,'revision',rev);
 insert into private.investment_write_receipts(user_id,request_id,workspace_id,payload,result) values(uid,p_request_id,ws,intent,result);
 perform private.finish_payment_request(p_request_id,result);
 return result;
end $$;
create or replace function public.investment_value_command(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.investment_value_command(p_input,p_request_id);$$;
revoke execute on function private.investment_value_command(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.investment_value_command(jsonb,uuid) to authenticated;
revoke execute on function public.investment_value_command(jsonb,uuid) from public,anon;
grant execute on function public.investment_value_command(jsonb,uuid) to authenticated;

-- Posições: o que já existia vem primeiro (mesma ordem); os números novos entram no FIM.
-- `net_contributed_cents` e `movements_count` contam só aplicação e resgate: rendimento não é aporte.
create or replace function public.investment_positions() returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 return coalesce((with nm as (select n.*
    from (select distinct a.workspace_id from public.accounts a where a.type='investment' and not a.archived) w,
    lateral private.investment_position_numbers(array[w.workspace_id]) n)
  select jsonb_agg(jsonb_build_object('account_id',a.id,'workspace_id',a.workspace_id,'name',a.name,'type','investment',
   'type_label','Conta de investimento','balance_cents',coalesce(nm.ledger_cents,0)::text,
   'net_contributed_cents',coalesce((select sum(case when m.kind='contribution' then t.amount_cents else -t.amount_cents end)
     from public.investment_movements m join public.transactions t on t.id=m.transfer_id
     where m.position_account_id=a.id and m.kind in('contribution','redemption') and t.status='cleared'),0)::text,
   'movements_count',(select count(*) from public.investment_movements m where m.position_account_id=a.id and m.kind in('contribution','redemption') and m.transfer_id is not null),
   'value_cents',coalesce(nm.value_cents,0)::text,'principal_cents',coalesce(nm.principal_cents,0)::text,
   'result_cents',nm.result_cents::text,'result_quality',coalesce(nm.result_quality,'indisponível'),
   'received_cents',coalesce(nm.received_cents,0)::text,'last_valuation_on',nm.last_valuation_on,'opening_on',nm.opening_on)
   order by a.name,a.id)
  from public.accounts a left join nm on nm.account_id=a.id
  where a.type='investment' and not a.archived),'[]'::jsonb);
end $$;

-- Histórico: movimentos, rendimentos e atualizações de valor (`nature`), pela DATA, depois criação e id.
create or replace function public.investment_movements_page(p_position_account_id uuid,p_limit integer default 20,
 p_before_on date default null,p_before_created timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
declare a public.accounts%rowtype;movs jsonb;more boolean;nxt jsonb;lim integer:=least(greatest(coalesce(p_limit,20),1),100);
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 select * into a from public.accounts where id=p_position_account_id;
 if a.id is null or a.type<>'investment' then raise exception using errcode='42501',message='Posição não encontrada';end if;
 with base as (select m.id,m.kind,case when m.kind='income' then 'income' else 'movement' end as nature,t.amount_cents as t_amount,t.status as t_status,
    t.description as t_desc,coalesce(t.occurred_at,(m.created_at at time zone 'America/Sao_Paulo')::date) as k_on,m.created_at,
    case when m.kind='contribution' then t.account_id when m.kind='redemption' then t.counterparty_account_id
     when t.account_id<>a.id then t.account_id end as cp_id,
    m.transfer_id,m.created_transfer,m.edit_revision as rev
   from public.investment_movements m left join public.transactions t on t.id=m.transfer_id
   where m.position_account_id=a.id
   union all
   select v.id,v.kind,v.kind,v.value_cents,null::text,v.note,v.as_of,v.created_at,null::uuid,null::uuid,false,v.edit_revision
   from public.investment_valuations v where v.position_account_id=a.id),
 page as (select b.*,row_number() over(order by b.k_on desc,b.created_at desc,b.id desc) as rn from base b
  where p_before_id is null or (b.k_on,b.created_at,b.id)<(p_before_on,p_before_created,p_before_id)
  order by b.k_on desc,b.created_at desc,b.id desc limit lim+1)
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'nature',p.nature,'amount_cents',p.t_amount::text,'occurred_on',p.k_on,'status',p.t_status,
   'counterparty_account_id',p.cp_id,'counterparty_name',b.name,'transfer_id',p.transfer_id,'created_transfer',p.created_transfer,
   'revision',p.rev,'created_at',p.created_at,'description',p.t_desc,
   'deleted',p.nature in('movement','income') and p.transfer_id is null)
   order by p.k_on desc,p.created_at desc,p.id desc) filter(where p.rn<=lim),'[]'::jsonb),
  coalesce(bool_or(p.rn>lim),false),
  (select jsonb_build_object('on',q.k_on,'created',q.created_at,'id',q.id) from page q where q.rn=lim)
 into movs,more,nxt
 from page p left join public.accounts b on b.id=p.cp_id;
 return jsonb_build_object('position_account_id',a.id,'movements',movs,'has_more',more,'next_before',case when more then nxt end);
end $$;

-- Patrimônio: a conta de investimento sai de "Dinheiro em conta" e entra em Investimentos pelo VALOR
-- ATUAL. `cash_total` não muda (ganho não realizado nunca entra no caixa): o líquido só anda pelo
-- resultado não realizado. Mesma assinatura e colunas; `set timezone` entra no cabeçalho.
CREATE OR REPLACE FUNCTION private.net_worth_now(ws_id uuid)
 RETURNS TABLE(cash_cents bigint, investments_cents bigint, other_assets_cents bigint, liabilities_cents bigint, net_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET timezone TO 'America/Sao_Paulo'
AS $function$
  with posicoes as (
    select (select coalesce(sum(c.cents), 0) from private.caixa_das_contas(array[ws_id]) c
             join public.accounts x on x.id = c.account_id where x.type = 'investment')::bigint as ledger,
           (select coalesce(sum(n.value_cents), 0) from private.investment_position_numbers(array[ws_id]) n)::bigint as valor
  ),
  dinheiro as (select (private.cash_total(array[ws_id]) - (select ledger from posicoes))::bigint as cents),
  investimentos as (
    select (coalesce(sum(current_value_cents), 0) + (select valor from posicoes))::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class in ('investment','crypto','equity')
  ),
  outros as (
    select coalesce(sum(current_value_cents), 0)::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class not in ('investment','crypto','equity')
  ),
  passivos as (
    select (
      coalesce((select sum(current_value_cents) from public.assets
                where workspace_id = ws_id and not archived and is_liability), 0)
      + coalesce((select sum(remaining_cents) from public.debts
                  where workspace_id = ws_id and not archived), 0)
      + coalesce((select sum(private.invoice_open_cents(ci.id)) from public.card_invoices ci
                  where ci.workspace_id = ws_id and ci.status not in ('paid','rolled')), 0)
    )::bigint as cents
  )
  select d.cents, i.cents, o.cents, p.cents,
         (d.cents + i.cents + o.cents - p.cents)::bigint
  from dinheiro d, investimentos i, outros o, passivos p;
$function$;

-- Bens: a marcação de `as_of` MAIS RECENTE manda no valor atual; reavaliar o passado não o muda.
create or replace function public.update_asset_value(
  p_asset_id uuid,
  p_value_cents bigint,
  p_as_of date default current_date
)
returns bigint
language plpgsql security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  ativo record;
  atual bigint;
begin
  p_as_of := least(coalesce(p_as_of, current_date), current_date);
  select a.* into ativo from public.assets a where a.id = p_asset_id for update;
  if ativo.id is null then
    raise exception 'ativo % nao encontrado', p_asset_id;
  end if;

  insert into public.asset_valuations (workspace_id, asset_id, value_cents, as_of)
  values (ativo.workspace_id, p_asset_id, p_value_cents, p_as_of)
  on conflict (asset_id, as_of) do update set value_cents = excluded.value_cents;

  select v.value_cents into atual from public.asset_valuations v
   where v.asset_id = p_asset_id order by v.as_of desc, v.created_at desc limit 1;
  update public.assets set current_value_cents = atual where id = p_asset_id;
  return atual;
end;
$$;

create or replace function public.delete_asset_valuation(p_valuation_id uuid) returns bigint
language plpgsql security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  marca public.asset_valuations%rowtype;
  atual bigint;
begin
  select * into marca from public.asset_valuations where id = p_valuation_id;
  if marca.id is null then
    raise exception using errcode = 'P0001', message = 'Essa marcação não existe mais';
  end if;
  perform 1 from public.assets where id = marca.asset_id for update;
  select * into marca from public.asset_valuations where id = p_valuation_id;
  if marca.id is null then
    raise exception using errcode = 'P0001', message = 'Essa marcação não existe mais';
  end if;
  if (select count(*) from public.asset_valuations where asset_id = marca.asset_id) <= 1 then
    raise exception using errcode = 'P0001', message = 'Esta é a única marcação do bem: informe outro valor antes de apagar.';
  end if;
  delete from public.asset_valuations where id = marca.id;
  select v.value_cents into atual from public.asset_valuations v
   where v.asset_id = marca.asset_id order by v.as_of desc, v.created_at desc limit 1;
  update public.assets set current_value_cents = atual where id = marca.asset_id;
  return atual;
end;
$$;

revoke execute on function public.investment_positions(),public.investment_movements_page(uuid,integer,date,timestamptz,uuid),
 public.update_asset_value(uuid,bigint,date),public.delete_asset_valuation(uuid) from public,anon;
grant execute on function public.investment_positions(),public.investment_movements_page(uuid,integer,date,timestamptz,uuid),
 public.update_asset_value(uuid,bigint,date),public.delete_asset_valuation(uuid) to authenticated;
