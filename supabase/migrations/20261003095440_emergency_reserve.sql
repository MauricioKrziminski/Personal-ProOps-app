-- F07: allocations identify existing money; these tables never move money.
create table public.emergency_reserves (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 base_mode text not null check(base_mode in ('manual','observed')),
 manual_monthly_cents bigint,
 target_months integer not null check(target_months between 1 and 60),
 edit_revision bigint not null default 1 check(edit_revision between 1 and 9007199254740991),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((base_mode='manual' and manual_monthly_cents is not null and manual_monthly_cents between 1 and 9007199254740991)
   or (base_mode='observed' and manual_monthly_cents is null))
);
create table public.financial_allocations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 purpose text not null check(purpose in ('reserve','goal')),
 goal_id uuid references public.goals(id) on delete cascade,
 account_id uuid references public.accounts(id) on delete cascade,
 asset_id uuid references public.assets(id) on delete cascade,
 amount_cents bigint not null check(amount_cents between 1 and 9007199254740991),
 liquidity_confirmed boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((purpose='reserve' and goal_id is null) or (purpose='goal' and goal_id is not null)),
 check((account_id is null) <> (asset_id is null)),
 unique nulls not distinct(workspace_id,purpose,goal_id,account_id,asset_id)
);
-- FKs identify objects; this check also enforces their workspace boundary for service writes.
create function private.check_financial_allocation_scope() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.account_id is not null and not exists(select 1 from public.accounts a where a.id=new.account_id and a.workspace_id=new.workspace_id))
  or (new.asset_id is not null and not exists(select 1 from public.assets a where a.id=new.asset_id and a.workspace_id=new.workspace_id))
  or (new.goal_id is not null and not exists(select 1 from public.goals g where g.id=new.goal_id and g.workspace_id=new.workspace_id))
 then raise exception using errcode='23514',message='Fonte e meta devem pertencer ao workspace';end if;
 return new;
end $$;
revoke execute on function private.check_financial_allocation_scope() from public,anon,authenticated;
create trigger check_financial_allocation_scope before insert or update on public.financial_allocations
 for each row execute function private.check_financial_allocation_scope();
create index financial_allocations_workspace_idx on public.financial_allocations(workspace_id);
create index financial_allocations_goal_idx on public.financial_allocations(goal_id) where goal_id is not null;
create table public.reserve_month_reviews (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 month date not null check(month=date_trunc('month',month)::date),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{32}$'),
 user_id uuid not null references public.profiles(id),reviewed_at timestamptz not null default now(),
 primary key(workspace_id,month)
);
-- SELECT is a distinct privilege from RLS. All changes go through the checked command.
alter table public.emergency_reserves enable row level security;
alter table public.financial_allocations enable row level security;
alter table public.reserve_month_reviews enable row level security;
create policy reserve_members_read on public.emergency_reserves for select to authenticated
 using(workspace_id in(select private.my_workspace_ids()));
create policy allocation_members_read on public.financial_allocations for select to authenticated
 using(workspace_id in(select private.my_workspace_ids()));
create policy reserve_review_members_read on public.reserve_month_reviews for select to authenticated
 using(workspace_id in(select private.my_workspace_ids()));
revoke all on public.emergency_reserves,public.financial_allocations,public.reserve_month_reviews from public,anon,authenticated;
grant select on public.emergency_reserves,public.financial_allocations,public.reserve_month_reviews to authenticated;
grant all on public.emergency_reserves,public.financial_allocations,public.reserve_month_reviews to service_role;
alter publication supabase_realtime add table public.emergency_reserves,public.financial_allocations,public.reserve_month_reviews;

-- The generic intent receipt is caller writable. This sealed result is command-owned,
-- so a forged generic response cannot authenticate a write or spoof a successful replay.
create table private.emergency_reserve_write_receipts (
 user_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
alter table private.emergency_reserve_write_receipts enable row level security;
revoke all on private.emergency_reserve_write_receipts from public,anon,authenticated,service_role;

-- Internal read helper remains INVOKER. Membership is also checked by both APIs.
create function private.reserve_months(p_ws uuid,p_as_of date)
returns table(month date,expense_count bigint,essential_cents numeric,unclassified_count bigint,
 unclassified_cents numeric,fingerprint text,reviewed boolean)
language sql stable security invoker set search_path='' as $$
 with months as (
  select (date_trunc('month',p_as_of)-n*interval '1 month')::date as month from generate_series(1,3) n
 ), consumption as (
  select t.id,t.amount_cents,t.occurred_at,t.expense_necessity,date_trunc('month',t.occurred_at)::date as month
  from public.transactions t
  where t.workspace_id=p_ws and p_ws in(select private.my_workspace_ids())
   and t.kind='expense' and t.pays_invoice_id is null and t.occurred_at<=p_as_of
   and t.occurred_at>=(date_trunc('month',p_as_of)-interval '3 months')::date
   and t.occurred_at<date_trunc('month',p_as_of)::date
   and (t.status='cleared' or t.invoice_id is not null)
 ), totals as (
  select m.month,count(c.id) as expense_count,
   coalesce(sum(c.amount_cents) filter(where c.expense_necessity='essential'),0) as essential_cents,
   count(c.id) filter(where c.expense_necessity is null) as unclassified_count,
   coalesce(sum(c.amount_cents) filter(where c.expense_necessity is null),0) as unclassified_cents,
   md5(coalesce(string_agg(jsonb_build_array(c.id,c.amount_cents,c.occurred_at,c.expense_necessity)::text,
     ',' order by c.id) filter(where c.id is not null),'')) as fingerprint
  from months m left join consumption c using(month) group by m.month
 ) select t.*,coalesce(r.fingerprint=t.fingerprint and t.unclassified_count=0,false) as reviewed
 from totals t left join public.reserve_month_reviews r on r.workspace_id=p_ws and r.month=t.month order by t.month;
$$;
revoke execute on function private.reserve_months(uuid,date) from public,anon;
grant execute on function private.reserve_months(uuid,date) to authenticated;

-- Numeric accumulators and safe-range checks precede any JSON/JavaScript conversion.
create function public.emergency_reserve_state(p_workspace_id uuid default null,p_as_of date default (now() at time zone 'America/Sao_Paulo')::date)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
declare
 ws uuid:=coalesce(p_workspace_id,public.my_default_workspace());ws_name text;cfg jsonb;src jsonb;mos jsonb;
 unbound numeric;entry record;total_alloc numeric:=0;total_available numeric:=0;total_essential numeric:=0;total_unknown numeric:=0;
 maxsafe constant numeric:=9007199254740991;
begin
 if auth.uid() is null or ws is null or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=auth.uid())
 then raise exception using errcode='42501',message='Workspace não autorizado';end if;
 if p_as_of is null or p_as_of<>current_date then raise exception using errcode='22023',message='A reserva exige a data local atual';end if;
 select w.name into ws_name from public.workspaces w where w.id=ws;
 select jsonb_build_object('base_mode',r.base_mode,'manual_monthly_cents',r.manual_monthly_cents::text,
  'target_months',r.target_months,'edit_revision',r.edit_revision) into cfg from public.emergency_reserves r where r.workspace_id=ws;
 with active_allocations as (
  select a.* from public.financial_allocations a
  where a.workspace_id=ws and (a.purpose='reserve' or exists(select 1 from public.goals g
   where g.id=a.goal_id and g.workspace_id=ws and not g.archived))
 ), candidates as (
  select 'account'::text as kind,a.id,a.name,not a.archived and a.type<>'credit_card' as eligible,a.archived,
   greatest(coalesce(c.cents,0),0)::numeric as available_cents,null::date as valuation_date
  from public.accounts a left join private.caixa_das_contas(array[ws],p_as_of) c on c.account_id=a.id
  where a.workspace_id=ws and ((not a.archived and a.type<>'credit_card') or exists(select 1 from active_allocations f where f.account_id=a.id))
  union all
  select 'asset',a.id,a.name,not a.archived and not a.is_liability and a.class in('investment','crypto','equity'),a.archived,
   a.current_value_cents::numeric,(select max(v.as_of) from public.asset_valuations v where v.asset_id=a.id and v.workspace_id=ws and v.as_of<=p_as_of)
  from public.assets a where a.workspace_id=ws and ((not a.archived and not a.is_liability and a.class in('investment','crypto','equity'))
   or exists(select 1 from active_allocations f where f.asset_id=a.id))
 ), amounts as (
  select c.*,coalesce(sum(f.amount_cents) filter(where f.purpose='goal'),0)::numeric as other_allocated_cents,
   coalesce(sum(f.amount_cents) filter(where f.purpose='reserve'),0)::numeric as allocated_cents,
   coalesce(bool_or(f.liquidity_confirmed) filter(where f.purpose='reserve'),false) as liquidity_confirmed
  from candidates c left join active_allocations f on (c.kind='account' and f.account_id=c.id) or (c.kind='asset' and f.asset_id=c.id)
  group by c.kind,c.id,c.name,c.eligible,c.archived,c.available_cents,c.valuation_date
 ), effective as (
  select a.*,case when eligible and liquidity_confirmed and allocated_cents>0
    then floor(allocated_cents*least(available_cents,allocated_cents+other_allocated_cents)/(allocated_cents+other_allocated_cents))
    else 0 end as effective_cents from amounts a
 ) select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'name',name,'eligible',eligible,'archived',archived,
   'available_cents',available_cents::text,'other_allocated_cents',other_allocated_cents::text,'allocated_cents',allocated_cents::text,
   'liquidity_confirmed',liquidity_confirmed,'effective_cents',effective_cents::text,'valuation_date',valuation_date) order by kind,id),'[]'::jsonb),
   coalesce(sum(allocated_cents+other_allocated_cents),0),coalesce(sum(available_cents),0)
 into src,total_alloc,total_available from effective;
 for entry in select x from jsonb_array_elements(src) x loop
  if (entry.x->>'available_cents')::numeric>maxsafe or (entry.x->>'allocated_cents')::numeric+(entry.x->>'other_allocated_cents')::numeric>maxsafe
  then raise exception using errcode='22003',message='Fonte ultrapassa centavos seguros';end if;
 end loop;
 select coalesce(sum(greatest(g.saved_cents::numeric-coalesce((select sum(a.amount_cents) from public.financial_allocations a
  where a.workspace_id=ws and a.goal_id=g.id and a.purpose='goal'),0),0)),0)
 into unbound from public.goals g where g.workspace_id=ws and not g.archived;
 select jsonb_agg(jsonb_build_object('month',m.month,'expense_count',m.expense_count,'essential_cents',m.essential_cents::text,
  'unclassified_count',m.unclassified_count,'unclassified_cents',m.unclassified_cents::text,'fingerprint',m.fingerprint,'reviewed',m.reviewed) order by m.month),
  sum(m.essential_cents),sum(m.unclassified_cents)
 into mos,total_essential,total_unknown from private.reserve_months(ws,p_as_of) m;
 if total_alloc>maxsafe or total_available>maxsafe or unbound>maxsafe or total_essential>maxsafe or total_unknown>maxsafe
  or (cfg->>'base_mode'='manual' and (cfg->>'manual_monthly_cents')::numeric*(cfg->>'target_months')::numeric>maxsafe)
  or (cfg->>'base_mode'='observed' and not exists(select 1 from jsonb_array_elements(mos) j where j->>'reviewed'<>'true')
      and ceil(total_essential/3)*(cfg->>'target_months')::numeric>maxsafe)
 then raise exception using errcode='22003',message='Total ultrapassa centavos seguros';end if;
 return jsonb_build_object('workspace_id',ws,'workspace_name',ws_name,'as_of',p_as_of,'config',cfg,'sources',src,'months',mos,'unassigned_goals_cents',unbound::text);
end $$;
revoke execute on function public.emergency_reserve_state(uuid,date) from public,anon;
grant execute on function public.emergency_reserve_state(uuid,date) to authenticated;

create function private.save_emergency_reserve(p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='America/Sao_Paulo' as $$
declare
 ws uuid;uid uuid:=auth.uid();cached jsonb;snapshot jsonb;r public.emergency_reserves%rowtype;
 sealed private.emergency_reserve_write_receipts%rowtype;intent jsonb;
 x jsonb;s jsonb;k text;sourceid uuid;monthdate date;amount numeric;total numeric:=0;rev bigint;months_seen date[]:='{}';
 ids_seen text[]:='{}';maxsafe constant numeric:=9007199254740991;monthly numeric;observed_total numeric;
 keys constant text[]:=array['workspace_id','expected_revision','base_mode','manual_monthly_cents','target_months','unassigned_goals_ack_cents','allocations','reviewed_months'];
begin
 if uid is null then raise exception using errcode='42501',message='Sessão obrigatória';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input?&keys)
  or exists(select 1 from jsonb_object_keys(p_input) j where not(j=any(keys)))
 then raise exception using errcode='22023',message='Configuração de reserva inválida';end if;
 if jsonb_typeof(p_input->'workspace_id') is distinct from 'string' then raise exception using errcode='22023',message='Workspace inválido';end if;
 begin ws:=(p_input->>'workspace_id')::uuid;
 exception when invalid_text_representation then raise exception using errcode='22023',message='Workspace inválido';end;
 if ws is null or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=uid)
 then raise exception using errcode='42501',message='Workspace não autorizado';end if;
 if p_request_id is null then raise exception using errcode='22023',message='Identificador de requisição obrigatório';end if;
 -- Serialize allocation/config writers by workspace. KEY SHARE keeps the workspace
 -- alive without blocking legacy goal_deposit's FK insert (that command locks goals first).
 -- Sources/goals use sorted SHARE locks: their current values stay stable through this
 -- command, while actual later spending/depreciation is free to reduce backing.
 -- Existing consumption rows being reviewed stay stable; a concurrent new consumption
 -- insert is permitted and invalidates the saved fingerprint on the next read.
 -- Do not lock contribution rows: legacy edit_goal_contribution acquires them before
 -- goals, and reversing that order here would introduce a deadlock.
 perform pg_advisory_xact_lock(hashtextextended('financial-allocations:'||ws::text,0));
 perform 1 from public.workspaces where id=ws for key share;
 perform 1 from public.workspace_members where workspace_id=ws and user_id=uid for share;
 if not found then raise exception using errcode='42501',message='Workspace não autorizado';end if;
 intent:=jsonb_build_object('operation','save_emergency_reserve','input',p_input);
 select * into sealed from private.emergency_reserve_write_receipts where user_id=uid and request_id=p_request_id;
 if sealed.request_id is not null then
  if sealed.workspace_id<>ws or sealed.payload is distinct from intent
  then raise exception using errcode='22023',message='Identificador de requisição reutilizado com dados diferentes';end if;
  return sealed.result;
 end if;
 cached:=private.reserve_payment_request(p_request_id,intent);
 if cached is not null then raise exception using errcode='42501',message='Recibo não confirmado pelo comando da reserva';end if;
 select * into r from public.emergency_reserves where workspace_id=ws for update;
 if jsonb_typeof(p_input->'expected_revision') not in('null','number') then raise exception using errcode='22023',message='Revisão inválida';end if;
 if p_input->'expected_revision'<>'null'::jsonb and ((p_input->>'expected_revision')!~'^[0-9]+$' or (p_input->>'expected_revision')::numeric not between 1 and maxsafe)
 then raise exception using errcode='22023',message='Revisão inválida';end if;
 if (r.workspace_id is null and p_input->'expected_revision'<>'null'::jsonb)
  or (r.workspace_id is not null and (p_input->'expected_revision'='null'::jsonb or (p_input->>'expected_revision')::numeric<>r.edit_revision))
 then raise exception using errcode='40001',message='Reserva alterada; confira novamente';end if;
 if jsonb_typeof(p_input->'base_mode') is distinct from 'string' or p_input->>'base_mode' not in('manual','observed')
 then raise exception using errcode='22023',message='Base inválida';end if;
 foreach k in array array['target_months','unassigned_goals_ack_cents'] loop
  if jsonb_typeof(p_input->k) is distinct from 'number' or (p_input->>k)!~'^[0-9]+$' or (p_input->>k)::numeric>maxsafe
  then raise exception using errcode='22023',message='Valor inteiro inválido';end if;
 end loop;
 if (p_input->>'target_months')::numeric not between 1 and 60 then raise exception using errcode='22023',message='Meses inválidos';end if;
 if p_input->>'base_mode'='manual' then
  if jsonb_typeof(p_input->'manual_monthly_cents') is distinct from 'number' or (p_input->>'manual_monthly_cents')!~'^[0-9]+$'
    or (p_input->>'manual_monthly_cents')::numeric not between 1 and maxsafe
  then raise exception using errcode='22023',message='Base mensal inválida';end if;
  monthly:=(p_input->>'manual_monthly_cents')::numeric;
  if monthly*(p_input->>'target_months')::numeric>maxsafe then raise exception using errcode='22023',message='Alvo ultrapassa centavos seguros';end if;
 elsif p_input->'manual_monthly_cents'<>'null'::jsonb then raise exception using errcode='22023',message='Base observada exige valor manual nulo';end if;
 if jsonb_typeof(p_input->'allocations') is distinct from 'array' or jsonb_typeof(p_input->'reviewed_months') is distinct from 'array'
 then raise exception using errcode='22023',message='Listas inválidas';end if;
 perform 1 from public.accounts where workspace_id=ws order by id for share;
 perform 1 from public.assets where workspace_id=ws order by id for share;
 perform 1 from public.goals where workspace_id=ws order by id for share;
 if jsonb_array_length(p_input->'reviewed_months')>0 then
  perform 1 from public.transactions where workspace_id=ws and kind='expense'
   and occurred_at>=(date_trunc('month',current_date)-interval '3 months')::date
   and occurred_at<date_trunc('month',current_date)::date order by id for share;
 end if;
 perform 1 from public.financial_allocations where workspace_id=ws order by id for update;
 perform 1 from public.reserve_month_reviews where workspace_id=ws order by month for update;
 snapshot:=public.emergency_reserve_state(ws,current_date);
 if (p_input->>'unassigned_goals_ack_cents')::numeric<>(snapshot->>'unassigned_goals_cents')::numeric
 then raise exception using errcode='22023',message='Metas sem origem mudaram; confira novamente';end if;
 for x in select value from jsonb_array_elements(p_input->'allocations') loop
  if jsonb_typeof(x) is distinct from 'object' or not(x?&array['kind','id','amount_cents','liquidity_confirmed'])
   or exists(select 1 from jsonb_object_keys(x) j where not(j=any(array['kind','id','amount_cents','liquidity_confirmed'])))
   or jsonb_typeof(x->'kind') is distinct from 'string' or x->>'kind' not in('account','asset')
   or jsonb_typeof(x->'id') is distinct from 'string'
   or jsonb_typeof(x->'amount_cents') is distinct from 'number' or (x->>'amount_cents')!~'^[0-9]+$'
   or (x->>'amount_cents')::numeric not between 1 and maxsafe or x->'liquidity_confirmed' is distinct from 'true'::jsonb
  then raise exception using errcode='22023',message='Alocação inválida';end if;
  begin sourceid:=(x->>'id')::uuid;
  exception when invalid_text_representation then raise exception using errcode='22023',message='Fonte inválida';end;
  k:=(x->>'kind')||':'||sourceid::text;
  if k=any(ids_seen) then raise exception using errcode='22023',message='Fonte duplicada';end if;ids_seen:=array_append(ids_seen,k);
  select value into s from jsonb_array_elements(snapshot->'sources') where value->>'kind'=x->>'kind' and value->>'id'=sourceid::text;
  amount:=(x->>'amount_cents')::numeric;total:=total+amount;
  if s is null or s->'eligible'<>'true'::jsonb or amount+(s->>'other_allocated_cents')::numeric>(s->>'available_cents')::numeric or total>maxsafe
  then raise exception using errcode='22023',message='Fonte sem lastro disponível';end if;
 end loop;
 for x in select value from jsonb_array_elements(p_input->'reviewed_months') loop
  if jsonb_typeof(x) is distinct from 'object' or not(x?&array['month','fingerprint'])
   or exists(select 1 from jsonb_object_keys(x) j where not(j=any(array['month','fingerprint'])))
   or jsonb_typeof(x->'month') is distinct from 'string' or (x->>'month')!~'^\d{4}-\d{2}-01$'
   or jsonb_typeof(x->'fingerprint') is distinct from 'string' or (x->>'fingerprint')!~'^[a-f0-9]{32}$'
  then raise exception using errcode='22023',message='Revisão mensal inválida';end if;
  begin monthdate:=(x->>'month')::date;
  exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='Mês inválido';end;
  if monthdate=any(months_seen) then raise exception using errcode='22023',message='Mês duplicado';end if;months_seen:=array_append(months_seen,monthdate);
  select value into s from jsonb_array_elements(snapshot->'months') where value->>'month'=monthdate::text;
  if s is null or s->>'fingerprint'<>x->>'fingerprint' or (s->>'unclassified_count')::numeric<>0
  then raise exception using errcode='22023',message='Consumo mudou ou está sem classificação';end if;
 end loop;
 if cardinality(months_seen)=3 then
  select sum((value->>'essential_cents')::numeric) into observed_total from jsonb_array_elements(snapshot->'months');
  if ceil(observed_total/3)*(p_input->>'target_months')::numeric>maxsafe then raise exception using errcode='22023',message='Alvo ultrapassa centavos seguros';end if;
 end if;
 if coalesce(r.edit_revision,0)>=maxsafe then raise exception using errcode='22023',message='Limite de revisão atingido';end if;
 rev:=coalesce(r.edit_revision,0)+1;
 insert into public.emergency_reserves(workspace_id,user_id,base_mode,manual_monthly_cents,target_months,edit_revision)
 values(ws,uid,p_input->>'base_mode',monthly::bigint,(p_input->>'target_months')::integer,rev)
 on conflict(workspace_id) do update set user_id=excluded.user_id,base_mode=excluded.base_mode,
  manual_monthly_cents=excluded.manual_monthly_cents,target_months=excluded.target_months,edit_revision=excluded.edit_revision,updated_at=now();
 delete from public.financial_allocations where workspace_id=ws and purpose='reserve';
 insert into public.financial_allocations(workspace_id,user_id,purpose,account_id,asset_id,amount_cents,liquidity_confirmed)
 select ws,uid,'reserve',case when elem.value->>'kind'='account' then (elem.value->>'id')::uuid end,
  case when elem.value->>'kind'='asset' then (elem.value->>'id')::uuid end,(elem.value->>'amount_cents')::bigint,true
 from jsonb_array_elements(p_input->'allocations') elem;
 delete from public.reserve_month_reviews where workspace_id=ws;
 insert into public.reserve_month_reviews(workspace_id,month,fingerprint,user_id)
 select ws,(elem.value->>'month')::date,elem.value->>'fingerprint',uid from jsonb_array_elements(p_input->'reviewed_months') elem;
 cached:=jsonb_build_object('workspace_id',ws,'edit_revision',rev);
 insert into private.emergency_reserve_write_receipts(user_id,request_id,workspace_id,payload,result)
 values(uid,p_request_id,ws,intent,cached);
 perform private.finish_payment_request(p_request_id,cached);return cached;
end $$;
revoke execute on function private.save_emergency_reserve(jsonb,uuid) from public,anon;
grant execute on function private.save_emergency_reserve(jsonb,uuid) to authenticated;
create function public.save_emergency_reserve(p_input jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.save_emergency_reserve(p_input,p_request_id);
$$;
revoke execute on function public.save_emergency_reserve(jsonb,uuid) from public,anon;
grant execute on function public.save_emergency_reserve(jsonb,uuid) to authenticated;
