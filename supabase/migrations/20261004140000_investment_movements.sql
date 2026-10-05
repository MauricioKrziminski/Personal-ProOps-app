-- F12: aplicar e resgatar com origem e destino.
--
-- A POSIÇÃO é uma conta `type='investment'` (saldo derivado, como sempre). Aplicar/resgatar é UMA
-- transferência real entre a posição e uma conta comum — neutra em receita, despesa e patrimônio.
-- Valor, data e contraparte moram na transferência (fonte única); `investment_movements` só liga
-- a transferência à posição e diz se foi o comando que a criou (desfazer apaga) ou se foi vinculada
-- (desfazer só solta). Tudo passa por `investment_command` (idempotente por request id, recibo
-- selado, advisory lock do workspace + posição `for no key update`). Reaproveita os validadores do F11.
-- Teste: `supabase/tests/investment_movements.sql`.

create table if not exists public.investment_movements (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 position_account_id uuid not null references public.accounts(id) on delete cascade,
 kind text not null check(kind in('contribution','redemption')),
 transfer_id uuid unique references public.transactions(id) on delete set null,
 created_transfer boolean not null default false,
 edit_revision bigint not null default 1,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists investment_movements_workspace_idx on public.investment_movements(workspace_id);
create index if not exists investment_movements_position_idx on public.investment_movements(position_account_id,created_at desc);
create index if not exists investment_movements_user_idx on public.investment_movements(user_id);
alter table public.investment_movements enable row level security;
drop policy if exists investment_movements_members_read on public.investment_movements;
create policy investment_movements_members_read on public.investment_movements for select to authenticated
 using(workspace_id in(select private.my_workspace_ids()));
revoke all on public.investment_movements from public,anon,authenticated;
grant select on public.investment_movements to authenticated;
grant all on public.investment_movements to service_role;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='investment_movements') then
  alter publication supabase_realtime add table public.investment_movements;
 end if;
end $$;

create table if not exists private.investment_write_receipts (
 user_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
create index if not exists investment_write_receipts_workspace_idx on private.investment_write_receipts(workspace_id);
alter table private.investment_write_receipts enable row level security;
revoke all on private.investment_write_receipts from public,anon,authenticated,service_role;

-- Uma transferência entra em no máximo UM movimento: de meta (F11) OU de investimento. O lock por
-- transferência serializa os dois lados (a segunda inserção, ao acordar, já enxerga a primeira).
create or replace function private.guard_transfer_link() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.transfer_id is null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('transfer-link:'||new.transfer_id::text,0));
 if (tg_table_name='investment_movements' and exists(select 1 from public.goal_money_movements m where m.transfer_id=new.transfer_id))
  or (tg_table_name='goal_money_movements' and exists(select 1 from public.investment_movements m where m.transfer_id=new.transfer_id))
 then raise exception using errcode='23505',message='Essa transferência já foi vinculada a '||case when tg_table_name='investment_movements' then 'uma meta' else 'um investimento' end;end if;
 return new;
end $$;
drop trigger if exists guard_transfer_link on public.investment_movements;
create trigger guard_transfer_link before insert or update of transfer_id on public.investment_movements
 for each row execute function private.guard_transfer_link();
drop trigger if exists guard_transfer_link on public.goal_money_movements;
create trigger guard_transfer_link before insert or update of transfer_id on public.goal_money_movements
 for each row execute function private.guard_transfer_link();

-- A transferência CRIADA por um movimento só muda/some pelo comando (ou em cascata de conta/espaço).
create or replace function private.guard_investment_transfer() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('proops.investment_scope',true),'')='on' or pg_trigger_depth()>1 then
  return case when tg_op='DELETE' then old else new end;end if;
 if exists(select 1 from public.investment_movements m where m.transfer_id=old.id and m.created_transfer)
  and (tg_op='DELETE' or (new.kind,new.account_id,new.counterparty_account_id,new.amount_cents,new.occurred_at)
   is distinct from (old.kind,old.account_id,old.counterparty_account_id,old.amount_cents,old.occurred_at))
 then raise exception using errcode='22023',message='Esta transferência pertence a uma aplicação ou resgate: edite ou desfaça pela posição.';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists guard_investment_transfer on public.transactions;
create trigger guard_investment_transfer before update or delete on public.transactions
 for each row when (old.kind='transfer') execute function private.guard_investment_transfer();

-- Saldo da posição (realizado + transferência pendente já datada; receita/despesa pendente não conta) em todas as datas >= p_from nunca
-- fica negativo. Roda DEPOIS de a escrita acontecer; falhando, a transação inteira volta.
create or replace function private.investment_capacity(p_position uuid,p_from date,p_ctx text) returns void
language plpgsql security invoker set search_path='' as $$
declare bad date;bal numeric;red date;
begin
 with ev as (select t.occurred_at d,sum(case
   when t.kind='income' and t.account_id=p_position then t.amount_cents
   when t.kind='expense' and t.account_id=p_position then -t.amount_cents
   when t.kind='transfer' and t.account_id=p_position then -t.amount_cents
   when t.kind='transfer' and t.counterparty_account_id=p_position then t.amount_cents
   else 0 end) delta
  from public.transactions t where (t.account_id=p_position or t.counterparty_account_id=p_position)
   and (t.status='cleared' or t.kind='transfer') group by t.occurred_at),
 cum as (select ev.d,(select a.initial_balance_cents from public.accounts a where a.id=p_position)+sum(ev.delta) over(order by ev.d) b from ev)
 select cum.d,cum.b into bad,bal from cum where cum.d>=p_from and cum.b<0 order by cum.d limit 1;
 if bad is null then return;end if;
 select max(t.occurred_at) into red from public.transactions t where t.kind='transfer' and t.account_id=p_position and t.occurred_at<=bad;
 if p_ctx='redeem' then
  raise exception using errcode='PT422',message='SALDO_INSUFICIENTE: faltam '||(-bal)::text||' centavos em '||to_char(bad,'DD/MM/YYYY');
 end if;
 raise exception using errcode='PT422',message='Não dá para fazer isso: o resgate de '||to_char(coalesce(red,bad),'DD/MM')||' ficaria sem saldo. Desfaça o resgate de '||to_char(coalesce(red,bad),'DD/MM')||' antes.';
end $$;

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
  if t.id is not null and not(t.kind='transfer' and pos.id in(t.account_id,t.counterparty_account_id)) then t.id:=null;end if;
  mid:=m.id;tid:=m.transfer_id;rev:=m.edit_revision;
  if op='undo' then
   delete from public.investment_movements where id=m.id;
   if m.created_transfer and t.id is not null then
    prev_scope:=current_setting('proops.investment_scope',true);
    perform set_config('proops.investment_scope','on',true);
    delete from public.transactions where id=t.id;
    perform set_config('proops.investment_scope',coalesce(prev_scope,''),true);
    if m.kind='contribution' then perform private.investment_capacity(pos.id,t.occurred_at,'undo');end if;
   end if;
   mid:=null;tid:=null;
  else
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

create or replace function public.investment_command(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.investment_command(p_input,p_request_id);$$;

-- Posições: contas de investimento do usuário (RLS), saldo realizado e aportado líquido (só o que já aconteceu).
create or replace function public.investment_positions() returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 return coalesce((with cx as (select w.workspace_id,c.account_id,c.cents
    from (select distinct a.workspace_id from public.accounts a where a.type='investment' and not a.archived) w,
    lateral private.caixa_das_contas(array[w.workspace_id],current_date) c)
  select jsonb_agg(jsonb_build_object('account_id',a.id,'workspace_id',a.workspace_id,'name',a.name,'type','investment',
   'type_label','Conta de investimento','balance_cents',coalesce(cx.cents,0)::text,
   'net_contributed_cents',coalesce((select sum(case when m.kind='contribution' then t.amount_cents else -t.amount_cents end)
     from public.investment_movements m join public.transactions t on t.id=m.transfer_id
     where m.position_account_id=a.id and t.status='cleared'),0)::text,
   'movements_count',(select count(*) from public.investment_movements m where m.position_account_id=a.id and m.transfer_id is not null))
   order by a.name,a.id)
  from public.accounts a left join cx on cx.account_id=a.id
  where a.type='investment' and not a.archived),'[]'::jsonb);
end $$;

-- Histórico: pela DATA da transferência (a do dia em que o movimento foi criado, se ela foi apagada),
-- depois criação e id; cursor composto. Movimento sem lançamento aparece, para poder ser desfeito.
create or replace function public.investment_movements_page(p_position_account_id uuid,p_limit integer default 20,
 p_before_on date default null,p_before_created timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
declare a public.accounts%rowtype;movs jsonb;more boolean;nxt jsonb;lim integer:=least(greatest(coalesce(p_limit,20),1),100);
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 select * into a from public.accounts where id=p_position_account_id;
 if a.id is null or a.type<>'investment' then raise exception using errcode='42501',message='Posição não encontrada';end if;
 with base as (select m.*,t.amount_cents as t_amount,t.status as t_status,t.description as t_desc,
    coalesce(t.occurred_at,(m.created_at at time zone 'America/Sao_Paulo')::date) as k_on,
    case when m.kind='contribution' then t.account_id else t.counterparty_account_id end as cp_id
   from public.investment_movements m left join public.transactions t on t.id=m.transfer_id
   where m.position_account_id=a.id),
 page as (select b.*,row_number() over(order by b.k_on desc,b.created_at desc,b.id desc) as rn from base b
  where p_before_id is null or (b.k_on,b.created_at,b.id)<(p_before_on,p_before_created,p_before_id)
  order by b.k_on desc,b.created_at desc,b.id desc limit lim+1)
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'amount_cents',p.t_amount::text,'occurred_on',p.k_on,'status',p.t_status,
   'counterparty_account_id',p.cp_id,'counterparty_name',b.name,'transfer_id',p.transfer_id,'created_transfer',p.created_transfer,
   'revision',p.edit_revision,'created_at',p.created_at,'description',p.t_desc,'deleted',p.transfer_id is null)
   order by p.k_on desc,p.created_at desc,p.id desc) filter(where p.rn<=lim),'[]'::jsonb),
  coalesce(bool_or(p.rn>lim),false),
  (select jsonb_build_object('on',q.k_on,'created',q.created_at,'id',q.id) from page q where q.rn=lim)
 into movs,more,nxt
 from page p left join public.accounts b on b.id=p.cp_id;
 return jsonb_build_object('position_account_id',a.id,'movements',movs,'has_more',more,'next_before',case when more then nxt end);
end $$;

-- Transferências já lançadas ou importadas entre uma conta comum e uma de investimento, ainda sem movimento.
create or replace function public.investment_link_candidates(p_limit integer default 30) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'amount_cents',t.amount_cents::text,'occurred_on',t.occurred_at,
   'description',t.description,'from_account_id',t.account_id,'from_name',a.name,'to_account_id',t.counterparty_account_id,'to_name',b.name,
   'position_account_id',case when a.type='investment' then a.id else b.id end,
   'kind',case when a.type='investment' then 'redemption' else 'contribution' end)
   order by t.occurred_at desc,t.created_at desc,t.id)
  from (select * from public.transactions x where x.kind='transfer' and x.status='cleared' and x.pays_invoice_id is null
    and not exists(select 1 from public.goal_money_movements m where m.transfer_id=x.id)
    and not exists(select 1 from public.investment_movements m where m.transfer_id=x.id)
    order by x.occurred_at desc,x.created_at desc limit 500) t -- ponytail: 500 mais recentes antes do filtro de tipo; filtrar na subconsulta se faltar candidata
  join public.accounts a on a.id=t.account_id join public.accounts b on b.id=t.counterparty_account_id
  where a.type<>'credit_card' and b.type<>'credit_card' and not a.archived and not b.archived and (a.type='investment')<>(b.type='investment')
  limit least(greatest(coalesce(p_limit,30),1),100)),'[]'::jsonb);
end $$;

create or replace function public.goal_link_candidates(p_goal_id uuid,p_limit integer default 30) returns jsonb
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
    and not exists(select 1 from public.investment_movements m where m.transfer_id=x.id)
    and exists(select 1 from public.accounts d where d.id=x.counterparty_account_id and d.type<>'credit_card')
    order by x.occurred_at desc,x.created_at desc limit least(greatest(coalesce(p_limit,30),1),100)) t
  left join public.accounts a on a.id=t.account_id left join public.accounts b on b.id=t.counterparty_account_id),'[]'::jsonb);
end $$;

revoke execute on function private.guard_transfer_link(),private.guard_investment_transfer(),private.investment_capacity(uuid,date,text),private.investment_command(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.investment_capacity(uuid,date,text),private.investment_command(jsonb,uuid) to authenticated;
revoke execute on function public.investment_command(jsonb,uuid),public.investment_positions(),
 public.investment_movements_page(uuid,integer,date,timestamptz,uuid),public.investment_link_candidates(integer),public.goal_link_candidates(uuid,integer) from public,anon;
grant execute on function public.investment_command(jsonb,uuid),public.investment_positions(),
 public.investment_movements_page(uuid,integer,date,timestamptz,uuid),public.investment_link_candidates(integer),public.goal_link_candidates(uuid,integer) to authenticated;
