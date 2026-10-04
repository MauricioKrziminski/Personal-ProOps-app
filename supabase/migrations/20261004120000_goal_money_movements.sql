-- F11: guardar numa meta diz ONDE está o dinheiro (separar na conta, transferir, vincular).
--
-- Cada movimentação é um aporte no ledger da meta (`goal_contributions`) + a separação por
-- (meta, conta) em `financial_allocations` (F07) + opcionalmente UMA transferência real. Separar
-- nunca toca `transactions` (não é consumo nem renda); a transferência já é neutra.
-- Tudo passa por `goal_money_command` (idempotente por request id, recibo selado, advisory lock
-- do workspace). Teste: `supabase/tests/goal_money_movements.sql`.

create table public.goal_money_movements (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 goal_id uuid not null references public.goals(id) on delete cascade,
 kind text not null check(kind in('allocate','transfer_in','link_in','release','transfer_out')),
 account_id uuid references public.accounts(id) on delete set null,
 from_account_id uuid references public.accounts(id) on delete set null,
 amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),
 occurred_on date not null,
 contribution_id uuid unique references public.goal_contributions(id) on delete cascade,
 transfer_id uuid unique references public.transactions(id) on delete set null,
 created_transfer boolean not null default false,
 edit_revision bigint not null default 1,
 created_at timestamptz not null default now()
);
create index goal_money_movements_workspace_idx on public.goal_money_movements(workspace_id);
create index goal_money_movements_goal_idx on public.goal_money_movements(goal_id,created_at desc);
create index goal_money_movements_user_idx on public.goal_money_movements(user_id);
create index goal_money_movements_account_idx on public.goal_money_movements(account_id) where account_id is not null;
create index goal_money_movements_from_account_idx on public.goal_money_movements(from_account_id) where from_account_id is not null;
alter table public.goal_money_movements enable row level security;
create policy goal_money_members_read on public.goal_money_movements for select to authenticated
 using(workspace_id in(select private.my_workspace_ids()));
revoke all on public.goal_money_movements from public,anon,authenticated;
grant select on public.goal_money_movements to authenticated;
grant all on public.goal_money_movements to service_role;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='goal_money_movements') then
  alter publication supabase_realtime add table public.goal_money_movements;
 end if;
end $$;

-- Só o comando confere e sela o resultado (recibo genérico é gravável pelo chamador).
create table private.goal_money_write_receipts (
 user_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
create index goal_money_write_receipts_workspace_idx on private.goal_money_write_receipts(workspace_id);
alter table private.goal_money_write_receipts enable row level security;
revoke all on private.goal_money_write_receipts from public,anon,authenticated,service_role;

create function private.goal_money_amount(p text) returns bigint
language plpgsql immutable security invoker set search_path='' as $$
begin
 if p is null or p !~ '^[0-9]{1,16}$' or p::numeric not between 1 and 9007199254740991
 then raise exception using errcode='22023',message='Valor em centavos inteiros entre 1 e 9007199254740991';end if;
 return p::bigint;
end $$;

create function private.goal_money_day(p text) returns date
language plpgsql immutable security invoker set search_path='' as $$
declare d date;
begin
 if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='Data inválida';end if;
 begin d:=p::date;exception when others then raise exception using errcode='22023',message='Data inválida';end;
 if d<date '2000-01-01' then raise exception using errcode='22023',message='Data inválida';end if;
 return d;
end $$;

create function private.goal_money_uuid(p text,p_msg text) returns uuid
language plpgsql immutable security invoker set search_path='' as $$
begin
 if p is null or p !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode='22023',message=p_msg;end if;
 return p::uuid;
end $$;

-- Soma das separações da conta (reserva F07 + metas ativas) mais o que entra não passa do caixa de hoje.
create function private.goal_money_capacity(ws uuid,p_account uuid,amt bigint) returns void
language plpgsql security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
declare cash numeric;used numeric;
begin
 select coalesce(c.cents,0) into cash from private.caixa_das_contas(array[ws],current_date) c where c.account_id=p_account;
 select coalesce(sum(f.amount_cents),0) into used from public.financial_allocations f where f.workspace_id=ws and f.account_id=p_account
  and (f.purpose='reserve' or exists(select 1 from public.goals h where h.id=f.goal_id and not h.archived));
 if used+amt>coalesce(cash,0) then
  raise exception using errcode='PT422',message='SALDO_INSUFICIENTE: livre '||greatest(coalesce(cash,0)-used,0)::text||' centavos';end if;
end $$;

-- Aporte de movimentação só muda pelo comando. Apagar a META continua cascateando: sem a meta
-- (já apagada na mesma instrução) o aporte pode sair. `restrict` na FK impediria isso.
create function private.guard_goal_money_contribution() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('proops.goal_money_scope',true),'')<>'on'
  and exists(select 1 from public.goal_money_movements m where m.contribution_id=old.id)
  and exists(select 1 from public.goals g where g.id=old.goal_id)
 then raise exception using errcode='22023',message='Esse aporte pertence a uma movimentação de dinheiro: desfaça a movimentação.';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger guard_goal_money_contribution before update or delete on public.goal_contributions
 for each row execute function private.guard_goal_money_contribution();

create function private.goal_money_account(ws uuid,p_id uuid,p_no_card boolean,p_allow_archived boolean) returns public.accounts
language plpgsql security invoker set search_path='' as $$
declare a public.accounts%rowtype;
begin
 select * into a from public.accounts where id=p_id and workspace_id=ws;
 if a.id is null then raise exception using errcode='42501',message='Conta não encontrada';end if;
 if a.archived and not p_allow_archived then raise exception using errcode='22023',message='A conta está arquivada';end if;
 if p_no_card and a.type='credit_card' then raise exception using errcode='22023',message='Cartão de crédito não guarda dinheiro de meta';end if;
 return a;
end $$;

-- Soma da linha (meta, conta): chega a zero, a linha some.
create function private.goal_money_adjust(ws uuid,uid uuid,p_goal uuid,p_account uuid,delta bigint) returns void
language plpgsql security invoker set search_path='' as $$
declare f public.financial_allocations%rowtype;n numeric;
begin
 select * into f from public.financial_allocations where workspace_id=ws and purpose='goal' and goal_id=p_goal and account_id=p_account for update;
 n:=coalesce(f.amount_cents,0)+delta;
 if n<0 then raise exception using errcode='PT422',message='Não há tanto separado nesta meta, nesta conta';end if;
 if n>9007199254740991 then raise exception using errcode='22023',message='Valor separado ultrapassa centavos seguros';end if;
 if f.id is null then
  if n>0 then insert into public.financial_allocations(workspace_id,user_id,purpose,goal_id,account_id,amount_cents) values(ws,uid,'goal',p_goal,p_account,n);end if;
 elsif n=0 then delete from public.financial_allocations where id=f.id;
 else update public.financial_allocations set amount_cents=n,updated_at=now() where id=f.id;end if;
end $$;

create function private.goal_money_command(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='America/Sao_Paulo' as $$
declare uid uuid:=auth.uid();op text;ws uuid;gid uuid;g public.goals%rowtype;m public.goal_money_movements%rowtype;
 intent jsonb;sealed private.goal_money_write_receipts%rowtype;cached jsonb;result jsonb;keys text[];
 ref uuid;amt bigint;day date;acc uuid;other uuid;a public.accounts%rowtype;cash numeric;used numeric;ledger numeric;
 t public.transactions%rowtype;previous_scope text;loose numeric;tid uuid;cid uuid;mid uuid;note text;saved bigint;rev bigint:=1;is_entry boolean;created boolean:=false;
 entry_kinds constant text[]:=array['allocate','transfer_in','link_in'];
begin
 if uid is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 if p_request_id is null then raise exception using errcode='22023',message='Identificador da tentativa obrigatório';end if;
 if p_input is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception using errcode='22023',message='Movimentação inválida';end if;
 op:=p_input->>'op';
 keys:=case op
  when 'allocate' then array['op','goal_id','account_id','amount_cents','occurred_on','note']
  when 'transfer_in' then array['op','goal_id','from_account_id','account_id','amount_cents','occurred_on','note']
  when 'link_in' then array['op','goal_id','transfer_id']
  when 'release' then array['op','goal_id','account_id','amount_cents','occurred_on','note']
  when 'transfer_out' then array['op','goal_id','account_id','to_account_id','amount_cents','occurred_on','note']
  when 'undo' then array['op','movement_id','expected_revision']
  else null end;
 if keys is null or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(keys)) then
  raise exception using errcode='22023',message='Movimentação inválida';end if;
 intent:=jsonb_build_object('operation','goal_money','input',p_input);
 -- Meta ou movimentação de outro espaço dá o mesmo erro de "não é seu": não revela existência.
 if op='undo' then
  ref:=private.goal_money_uuid(p_input->>'movement_id','Movimentação inválida');
  select workspace_id,goal_id into ws,gid from public.goal_money_movements where id=ref;
  if ws is null then
   -- Repetição de um desfazer que já foi confirmado: a movimentação não existe mais, o recibo selado sim.
   select * into sealed from private.goal_money_write_receipts where user_id=uid and request_id=p_request_id;
   if sealed.request_id is not null and sealed.payload is not distinct from intent
    and exists(select 1 from public.workspace_members where workspace_id=sealed.workspace_id and user_id=uid)
   then return sealed.result;end if;
  end if;
 else
  select workspace_id,id into ws,gid from public.goals where id=private.goal_money_uuid(p_input->>'goal_id','Meta inválida');
 end if;
 if ws is null or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=uid)
 then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 perform pg_advisory_xact_lock(hashtextextended('goal-money-request:'||uid::text||':'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('financial-allocations:'||ws::text,0));
 perform 1 from public.workspace_members where workspace_id=ws and user_id=uid for share;
 if not found then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 select * into sealed from private.goal_money_write_receipts where user_id=uid and request_id=p_request_id;
 if sealed.request_id is not null then
  if sealed.workspace_id<>ws or sealed.payload is distinct from intent then
   raise exception using errcode='22023',message='Identificador reutilizado com dados diferentes';end if;
  return sealed.result;
 end if;
 cached:=private.reserve_payment_request(p_request_id,intent);
 if cached is not null then raise exception using errcode='42501',message='Recibo não confirmado pelo comando da meta';end if;
 -- Ordem: advisory do workspace, meta, linhas de alocação (dentro de goal_money_adjust).
 select * into g from public.goals where id=gid and workspace_id=ws for update;
 if g.id is null then raise exception using errcode='42501',message='Meta não encontrada';end if;
 note:=nullif(trim(coalesce(p_input->>'note','')),'');

 if op='undo' then
  select * into m from public.goal_money_movements where id=ref and goal_id=g.id for update;
  if m.id is null then raise exception using errcode='22023',message='Essa movimentação não existe mais';end if;
  if jsonb_typeof(p_input->'expected_revision') is distinct from 'number' then raise exception using errcode='22023',message='Revisão inválida';end if;
  if (p_input->>'expected_revision')::numeric<>m.edit_revision
  then raise exception using errcode='PT409',message='A movimentação mudou. Abra de novo';end if;
  select coalesce(sum(amount_cents),0) into ledger from public.goal_contributions where goal_id=g.id;
  select amount_cents into amt from public.goal_contributions where id=m.contribution_id;
  if ledger-coalesce(amt,0)<0 then raise exception using errcode='PT422',message='Não dá para desfazer: a meta ficaria com menos que zero guardado.';end if;
  if m.kind='release' and m.account_id is not null then perform private.goal_money_capacity(ws,m.account_id,m.amount_cents);end if;
  if m.account_id is not null then
   perform private.goal_money_adjust(ws,uid,g.id,m.account_id,case when m.kind=any(entry_kinds) then -m.amount_cents else m.amount_cents end);
  end if;
  previous_scope:=current_setting('proops.goal_money_scope',true);
  perform set_config('proops.goal_money_scope','on',true);
  delete from public.goal_money_movements where id=m.id;
  delete from public.goal_contributions where id=m.contribution_id;
  perform set_config('proops.goal_money_scope',coalesce(previous_scope,''),true);
  if m.created_transfer and m.transfer_id is not null then delete from public.transactions where id=m.transfer_id and workspace_id=ws;end if;
  mid:=null;cid:=null;tid:=null;
 else
  if g.archived then raise exception using errcode='22023',message='A meta está arquivada';end if;
  if op='link_in' then
   select * into t from public.transactions where id=private.goal_money_uuid(p_input->>'transfer_id','Transferência inválida') and workspace_id=ws for update;
   if t.id is null or t.kind<>'transfer' or t.pays_invoice_id is not null then raise exception using errcode='22023',message='Transferência não encontrada';end if;
   if t.status<>'cleared' then raise exception using errcode='22023',message='A transferência ainda não aconteceu; vincule depois de confirmada';end if;
   if exists(select 1 from public.goal_money_movements where transfer_id=t.id) then
    raise exception using errcode='23505',message='Essa transferência já foi vinculada a uma meta';end if;
   a:=private.goal_money_account(ws,t.counterparty_account_id,true,false);
   amt:=t.amount_cents;day:=t.occurred_at;acc:=a.id;other:=t.account_id;tid:=t.id;
  else
   amt:=private.goal_money_amount(p_input->>'amount_cents');
   day:=private.goal_money_day(p_input->>'occurred_on');
   if op in('allocate','release') and day>current_date then raise exception using errcode='22023',message='A data não pode ser futura';end if;
   acc:=case when nullif(p_input->>'account_id','') is null then null else private.goal_money_uuid(p_input->>'account_id','Conta inválida') end;
   if acc is null and op<>'release' then raise exception using errcode='22023',message='Escolha a conta';end if;
   if op='transfer_in' then
    other:=private.goal_money_uuid(p_input->>'from_account_id','Conta de origem inválida');
    if other is null or other=acc then raise exception using errcode='22023',message='Origem e destino precisam ser contas diferentes';end if;
    perform private.goal_money_account(ws,other,true,false);
    a:=private.goal_money_account(ws,acc,true,false);
   elsif op='transfer_out' then
    other:=private.goal_money_uuid(p_input->>'to_account_id','Conta de destino inválida');
    if day>current_date then raise exception using errcode='22023',message='Transferir de volta só com data de hoje ou anterior';end if;
    if other is null or other=acc then raise exception using errcode='22023',message='Origem e destino precisam ser contas diferentes';end if;
    a:=private.goal_money_account(ws,acc,false,false);
    perform private.goal_money_account(ws,other,true,false);
   elsif acc is not null then a:=private.goal_money_account(ws,acc,op='allocate',op='release');end if;
  end if;

  if op in('allocate','link_in') then perform private.goal_money_capacity(ws,acc,amt);end if;
  if op in('release','transfer_out') then
   select coalesce(sum(amount_cents),0) into ledger from public.goal_contributions where goal_id=g.id;
   if amt>ledger then raise exception using errcode='PT422',message='Não dá para retirar mais do que está guardado nessa meta.';end if;
   if acc is null then
    select coalesce(sum(amount_cents),0) into loose from public.financial_allocations where workspace_id=ws and purpose='goal' and goal_id=g.id;
    if amt>ledger-loose then raise exception using errcode='PT422',message='Sem origem só dá para retirar o dinheiro que não está separado em conta. Libere pela conta onde ele está.';end if;
   end if;
   if acc is not null and amt>coalesce((select amount_cents from public.financial_allocations
     where workspace_id=ws and purpose='goal' and goal_id=g.id and account_id=acc),0)
   then raise exception using errcode='PT422',message='Não dá para liberar mais do que está separado nesta conta';end if;
  end if;
  if op in('transfer_in','transfer_out') then
   -- A regra atual de transferência decide o resto (paid_at, fatura); aqui só o status pela data.
   insert into public.transactions(user_id,workspace_id,kind,amount_cents,description,account_id,counterparty_account_id,occurred_at,source,status)
   values(uid,ws,'transfer',amt,'Meta: '||g.name,case when op='transfer_in' then other else acc end,
    case when op='transfer_in' then acc else other end,day,'app',case when day>current_date then 'pending' else 'cleared' end)
   returning id into tid;
   created:=true;
  end if;
  is_entry:=op=any(entry_kinds);
  insert into public.goal_contributions(workspace_id,user_id,goal_id,amount_cents,occurred_at,note)
   values(ws,uid,g.id,case when is_entry then amt else -amt end,day,note) returning id into cid;
  if acc is not null then perform private.goal_money_adjust(ws,uid,g.id,acc,case when is_entry then amt else -amt end);end if;
  insert into public.goal_money_movements(workspace_id,user_id,goal_id,kind,account_id,from_account_id,amount_cents,occurred_on,contribution_id,transfer_id,created_transfer)
   values(ws,uid,g.id,op,acc,other,amt,day,cid,tid,created) returning id,edit_revision into mid,rev;
 end if;
 select coalesce(sum(amount_cents),0) into ledger from public.goal_contributions where goal_id=g.id;
 saved:=greatest(ledger,0);
 update public.goals set saved_cents=saved where id=g.id;
 result:=jsonb_build_object('movement_id',mid,'contribution_id',cid,'transfer_id',tid,'saved_cents',saved::text,'revision',rev);
 insert into private.goal_money_write_receipts(user_id,request_id,workspace_id,payload,result) values(uid,p_request_id,ws,intent,result);
 perform private.finish_payment_request(p_request_id,result);
 return result;
end $$;

create function public.goal_money_command(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.goal_money_command(p_input,p_request_id);$$;

create function public.goal_money_state(p_goal_id uuid,p_limit integer default 20,p_before timestamptz default null) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
declare g public.goals%rowtype;accs jsonb;movs jsonb;more boolean;nxt timestamptz;lim integer:=least(greatest(coalesce(p_limit,20),1),100);
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 select * into g from public.goals where id=p_goal_id;
 if g.id is null or not exists(select 1 from public.workspace_members where workspace_id=g.workspace_id and user_id=auth.uid())
 then raise exception using errcode='42501',message='Meta não encontrada';end if;
 with cx as (select c.account_id,c.cents from private.caixa_das_contas(array[g.workspace_id],current_date) c),
 x as (select a.id,a.name,a.type,a.archived,
  coalesce((select sum(f.amount_cents) from public.financial_allocations f where f.workspace_id=g.workspace_id and f.account_id=a.id and f.purpose='goal' and f.goal_id=g.id),0) as goal_cents,
  coalesce((select cx.cents from cx where cx.account_id=a.id),0)::numeric as cash_cents,
  coalesce((select sum(f.amount_cents) from public.financial_allocations f where f.workspace_id=g.workspace_id and f.account_id=a.id
   and (f.purpose='reserve' or exists(select 1 from public.goals h where h.id=f.goal_id and not h.archived))),0) as allocated_cents
  from public.accounts a where a.workspace_id=g.workspace_id and a.type<>'credit_card')
 select coalesce(jsonb_agg(jsonb_build_object('account_id',x.id,'name',x.name,'type',x.type,'archived',x.archived,
   'goal_cents',x.goal_cents::text,'cash_cents',x.cash_cents::text,'allocated_cents',x.allocated_cents::text,
   'free_cents',(x.cash_cents-x.allocated_cents)::text) order by x.name,x.id),'[]'::jsonb) into accs
 from x where not x.archived or x.goal_cents>0;
 with page as (select m.*,row_number() over(order by m.created_at desc,m.id desc) as rn from public.goal_money_movements m
  where m.goal_id=g.id and (p_before is null or m.created_at<p_before) order by m.created_at desc,m.id desc limit lim+1)
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'account_id',p.account_id,'account_name',a.name,
   'other_account_id',p.from_account_id,'other_account_name',b.name,'amount_cents',p.amount_cents::text,'occurred_on',p.occurred_on,
   'transfer_id',p.transfer_id,'created_transfer',p.created_transfer,'contribution_id',p.contribution_id,'revision',p.edit_revision,'created_at',p.created_at,'note',c.note)
   order by p.created_at desc,p.id desc) filter(where p.rn<=lim),'[]'::jsonb),
  coalesce(bool_or(p.rn>lim),false),min(p.created_at) filter(where p.rn<=lim)
 into movs,more,nxt
 from page p left join public.accounts a on a.id=p.account_id left join public.accounts b on b.id=p.from_account_id
 left join public.goal_contributions c on c.id=p.contribution_id;
 return jsonb_build_object('goal_id',g.id,'accounts',accs,'movements',movs,'has_more',more,'next_before',case when more then nxt end);
end $$;

create function public.goal_link_candidates(p_goal_id uuid,p_limit integer default 30) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare g public.goals%rowtype;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 select * into g from public.goals where id=p_goal_id;
 if g.id is null or not exists(select 1 from public.workspace_members where workspace_id=g.workspace_id and user_id=auth.uid())
 then raise exception using errcode='42501',message='Meta não encontrada';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'amount_cents',t.amount_cents::text,'occurred_on',t.occurred_at,
   'status',t.status,'description',t.description,'from_account_id',t.account_id,'from_name',a.name,'to_account_id',t.counterparty_account_id,'to_name',b.name)
   order by t.occurred_at desc,t.created_at desc,t.id)
  from (select * from public.transactions x where x.workspace_id=g.workspace_id and x.kind='transfer' and x.pays_invoice_id is null
    and not exists(select 1 from public.goal_money_movements m where m.transfer_id=x.id)
    and exists(select 1 from public.accounts d where d.id=x.counterparty_account_id and d.type<>'credit_card')
    order by x.occurred_at desc,x.created_at desc limit least(greatest(coalesce(p_limit,30),1),100)) t
  left join public.accounts a on a.id=t.account_id left join public.accounts b on b.id=t.counterparty_account_id),'[]'::jsonb);
end $$;

-- `edit_goal_contribution` (20260926160000) + recusa do aporte que pertence a uma movimentação.
-- Mesmo cabeçalho da definição viva: security invoker, search_path=public, sem fuso.
create or replace function public.edit_goal_contribution(
  p_contribution_id uuid,
  p_amount_cents bigint,
  p_occurred_at date,
  p_note text default null
)
returns bigint
language plpgsql security invoker
set search_path = public
as $$
declare
  aporte record;
  meta record;
  novo bigint;
begin
  select c.* into aporte from public.goal_contributions c where c.id = p_contribution_id for update;
  if aporte.id is null then
    raise exception 'Esse aporte não existe mais.';
  end if;
  if exists (select 1 from public.goal_money_movements m where m.contribution_id = aporte.id) then
    raise exception 'Esse aporte pertence a uma movimentação de dinheiro: desfaça a movimentação em vez de editar o aporte.';
  end if;
  select g.* into meta from public.goals g where g.id = aporte.goal_id for update;
  if p_amount_cents is null or p_amount_cents = 0 then
    raise exception 'O valor precisa ser diferente de zero';
  end if;
  if p_occurred_at is null then
    raise exception 'Informe a data do aporte';
  end if;

  select coalesce(sum(c.amount_cents), 0) - aporte.amount_cents + p_amount_cents into novo
  from public.goal_contributions c where c.goal_id = aporte.goal_id;
  if novo < 0 then
    raise exception 'Não dá para retirar mais do que está guardado nessa meta.';
  end if;

  update public.goal_contributions c set
    amount_cents = p_amount_cents,
    occurred_at = p_occurred_at,
    note = nullif(trim(coalesce(p_note, '')), '')
  where c.id = aporte.id;

  update public.goals set saved_cents = novo where id = aporte.goal_id;
  return novo;
end;
$$;

revoke execute on function private.goal_money_uuid(text,text),private.goal_money_capacity(uuid,uuid,bigint),private.guard_goal_money_contribution(),private.goal_money_amount(text),private.goal_money_day(text),
 private.goal_money_account(uuid,uuid,boolean,boolean),private.goal_money_adjust(uuid,uuid,uuid,uuid,bigint),
 private.goal_money_command(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.goal_money_uuid(text,text),private.goal_money_capacity(uuid,uuid,bigint),private.goal_money_amount(text),private.goal_money_day(text),
 private.goal_money_account(uuid,uuid,boolean,boolean),private.goal_money_adjust(uuid,uuid,uuid,uuid,bigint),
 private.goal_money_command(jsonb,uuid) to authenticated;
revoke execute on function public.goal_money_command(jsonb,uuid),public.goal_money_state(uuid,integer,timestamptz),
 public.goal_link_candidates(uuid,integer),public.edit_goal_contribution(uuid,bigint,date,text) from public,anon;
grant execute on function public.goal_money_command(jsonb,uuid),public.goal_money_state(uuid,integer,timestamptz),
 public.goal_link_candidates(uuid,integer),public.edit_goal_contribution(uuid,bigint,date,text) to authenticated;
