-- F14: planejamento por percentual da renda, junto do orçamento.
--
-- O PLANO é versionado e imutável (salvar = versão nova). Cada linha é uma categoria (ou uma linha
-- sem categoria, ex. "Investir") com um percentual em pontos-base. Aplicar grava o LIMITE de cada
-- categoria em `budgets` pela mesma regra de `save_budget` (padrão = `month is null`; do mês =
-- `month` ancorado no dia 1; `lower(trim)`; só `limit_cents` muda, o `rollover` do que já existia
-- fica) e registra antes/depois em `budget_plan_applications`. Mudar a renda-base depois NÃO mexe
-- em limite já aplicado: só uma nova aplicação muda. `budgets_status_for` não é tocada.
-- Todo cálculo de reais é UM só (`private.budget_plan_calc`): prévia, salvar e aplicar o usam.
-- Teste: `supabase/tests/budget_plans.sql`.

create table if not exists public.budget_plans (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 version int not null check(version>0),
 base_income_cents bigint not null check(base_income_cents>0),
 created_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,version)
);
create index if not exists budget_plans_user_idx on public.budget_plans(user_id);

create table if not exists public.budget_plan_lines (
 plan_id uuid not null references public.budget_plans(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 position int not null check(position>=0),
 group_name text not null check(length(group_name) between 1 and 60),
 category text check(category is null or length(category) between 1 and 60),
 share_bp int not null check(share_bp between 0 and 10000),
 primary key(plan_id,position)
);
create index if not exists budget_plan_lines_workspace_idx on public.budget_plan_lines(workspace_id);

create table if not exists public.budget_plan_applications (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 plan_id uuid not null references public.budget_plans(id) on delete cascade,
 line_position int not null,
 category text not null,
 scope text not null check(scope in('default','month')),
 month date,
 before_cents bigint,
 applied_cents bigint not null check(applied_cents>0),
 created_at timestamptz not null default clock_timestamp(),
 check((scope='month')=(month is not null))
);
create index if not exists budget_plan_applications_ws_idx on public.budget_plan_applications(workspace_id,created_at desc);
create index if not exists budget_plan_applications_plan_idx on public.budget_plan_applications(plan_id);

do $$ declare t text; begin
 foreach t in array array['budget_plans','budget_plan_lines','budget_plan_applications'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('drop policy if exists %I on public.%I',t||'_members_read',t);
  execute format('create policy %I on public.%I for select to authenticated using(workspace_id in(select private.my_workspace_ids()))',t||'_members_read',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

do $$ declare t text; begin
 foreach t in array array['budget_plans','budget_plan_lines','budget_plan_applications'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;

create table if not exists private.budget_plan_receipts (
 user_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
create index if not exists budget_plan_receipts_workspace_idx on private.budget_plan_receipts(workspace_id);
alter table private.budget_plan_receipts enable row level security;
revoke all on private.budget_plan_receipts from public,anon,authenticated,service_role;

-- 1250 -> '12,5', 10001 -> '100,01', 3000 -> '30'
create or replace function private.budget_plan_pct(p int) returns text
language sql immutable security invoker set search_path='' as $$
 select (p/100)::text||case when p%100=0 then '' when p%10=0 then ','||(p%100/10)::text else ','||lpad((p%100)::text,2,'0') end
$$;

-- Cálculo único (puro). Erros que a pessoa lê voltam em `errors`; entrada malformada é 22023.
create or replace function private.budget_plan_calc(p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare braw text;base numeric;arr jsonb;el jsonb;n int;o int;errs jsonb:='[]';
 gs text[]:='{}';cs text[]:='{}';bps int[]:='{}';g text;c text;tot int:=0;lines jsonb;dup text;
 total_cents numeric:=0;
begin
 if p_input is null or jsonb_typeof(p_input) is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(array['op','base_income_cents','lines','expected_revision']))
 then raise exception using errcode='22023',message='Plano inválido';end if;
 braw:=p_input->>'base_income_cents';
 if braw is null or braw !~ '^-?[0-9]{1,15}$' then raise exception using errcode='22023',message='Renda-base inválida';end if;
 base:=braw::numeric;
 if base<=0 then errs:=errs||jsonb_build_object('code','base','position',null,'message','Informe uma renda-base maior que zero.');
 elsif base>10000000000000 then errs:=errs||jsonb_build_object('code','base','position',null,'message','Renda-base grande demais.');end if;
 arr:=p_input->'lines';
 if arr is null or jsonb_typeof(arr) is distinct from 'array' then
  raise exception using errcode='22023',message='Linhas inválidas';end if;
 if jsonb_array_length(arr)>60 then
  errs:=errs||jsonb_build_object('code','lines','position',null,'message','O plano aceita até 60 linhas.');
  return jsonb_build_object('ok',false,'errors',errs,'base_income_cents',case when base>0 then base::text else '0' end,'lines','[]'::jsonb,
   'total_bp',0,'total_cents','0','undistributed_bp',10000,'undistributed_cents','0');
 end if;
 n:=jsonb_array_length(arr);
 if n=0 then errs:=errs||jsonb_build_object('code','lines','position',null,'message','Adicione ao menos uma linha ao plano.');end if;
 for o in 0..n-1 loop
  el:=arr->o;
  if jsonb_typeof(el) is distinct from 'object' or exists(select 1 from jsonb_object_keys(el) k where k<>all(array['group','category','share_bp']))
   or jsonb_typeof(el->'share_bp') is distinct from 'number' or (el->>'share_bp')::numeric<>trunc((el->>'share_bp')::numeric)
   or jsonb_typeof(el->'group') is distinct from 'string'
   or (el->'category' is not null and jsonb_typeof(el->'category') not in('string','null'))
  then raise exception using errcode='22023',message='Linha inválida';end if;
  g:=trim(el->>'group');c:=nullif(lower(trim(coalesce(el->>'category',''))),'');
  if g='' or length(g)>60 then errs:=errs||jsonb_build_object('code','group','position',o,'message','Dê um nome ao grupo (até 60 letras).');end if;
  if c is not null and length(c)>60 then errs:=errs||jsonb_build_object('code','category','position',o,'message','O nome da categoria passa de 60 letras.');end if;
  if (el->>'share_bp')::numeric<0 or (el->>'share_bp')::numeric>10000 then
   errs:=errs||jsonb_build_object('code','share','position',o,'message','Cada linha vai de 0% a 100%.');
   bps:=bps||0;
  else bps:=bps||(el->>'share_bp')::numeric::int;end if;
  gs:=gs||coalesce(g,'');cs:=cs||c;
 end loop;
 -- grupo: o mesmo nome (sem acento e caixa) escrito de dois jeitos é dois grupos com nome repetido
 select min(x.g) into dup from (select min(gg) g from unnest(gs) gg group by private.fold(gg) having count(distinct gg)>1) x;
 if dup is not null then errs:=errs||jsonb_build_object('code','group_dup','position',null,'message','Dois grupos com o nome '||dup||': use um só.');end if;
 -- categoria em no máximo uma linha
 for o in 1..n loop
  if cs[o] is not null and exists(select 1 from generate_series(1,o-1) q where cs[q] is not null and private.fold(cs[q])=private.fold(cs[o])) then
   errs:=errs||jsonb_build_object('code','category_dup','position',o-1,'message','A categoria '||cs[o]||' aparece em mais de uma linha.');end if;
 end loop;
 for o in 1..n loop tot:=tot+bps[o];end loop;
 if tot>10000 then errs:=errs||jsonb_build_object('code','total','position',null,
  'message','A soma dos percentuais é '||private.budget_plan_pct(tot)||'%: passa de 100%.');end if;
 if base>0 and n>0 then
  with l as (select s.o-1 pos,bps[s.o] bp,div(base*bps[s.o],10000) fl,mod(base*bps[s.o],10000) rm from generate_series(1,n) s(o)),
   t as (select div(base*tot,10000)-coalesce(sum(fl),0) lo from l),
   r as (select l.*,row_number() over(order by rm desc,pos) rn from l)
  select jsonb_agg(jsonb_build_object('position',r.pos,'group',gs[r.pos+1],'category',to_jsonb(cs[r.pos+1]),'share_bp',r.bp,
    'amount_cents',(r.fl+case when r.rn<=t.lo then 1 else 0 end)::text) order by r.pos),
   sum(r.fl+case when r.rn<=t.lo then 1 else 0 end)
  into lines,total_cents from r,t;
 else
  select coalesce(jsonb_agg(jsonb_build_object('position',s.o-1,'group',gs[s.o],'category',to_jsonb(cs[s.o]),'share_bp',bps[s.o],'amount_cents','0') order by s.o),'[]')
  into lines from generate_series(1,n) s(o);
 end if;
 return jsonb_build_object('ok',jsonb_array_length(errs)=0,'errors',errs,'base_income_cents',case when base>0 then base::text else '0' end,
  'lines',coalesce(lines,'[]'),'total_bp',tot,'total_cents',total_cents::text,
  'undistributed_bp',10000-tot,'undistributed_cents',(case when base>0 then base-total_cents else 0 end)::text);
end $$;

create or replace function public.budget_plan_preview(p_input jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 return private.budget_plan_calc(p_input);
end $$;

create or replace function private.budget_plan_command(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='America/Sao_Paulo' as $$
declare uid uuid:=auth.uid();ws uuid;op text;keys text[];intent jsonb;sealed private.budget_plan_receipts%rowtype;cached jsonb;
 cur int;calc jsonb;plan public.budget_plans%rowtype;result jsonb;ver int;scope text;mes date;cats text[];cat text;
 ln jsonb;applied jsonb:='[]';before bigint;amt bigint;pid uuid;wanted text;okc boolean;
begin
 if uid is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 if p_request_id is null then raise exception using errcode='22023',message='Identificador da tentativa obrigatório';end if;
 if p_input is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception using errcode='22023',message='Plano inválido';end if;
 op:=p_input->>'op';
 keys:=case op when 'save' then array['op','base_income_cents','lines','expected_revision']
  when 'apply' then array['op','version','categories','scope','month'] else null end;
 if keys is null or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(keys)) then
  raise exception using errcode='22023',message='Plano inválido';end if;
 intent:=jsonb_build_object('operation','budget_plan','input',p_input);
 ws:=public.my_default_workspace();
 if ws is null or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=uid)
 then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 perform pg_advisory_xact_lock(hashtextextended('budget-plan-request:'||uid::text||':'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('budget-plan:'||ws::text,0));
 perform 1 from public.workspace_members where workspace_id=ws and user_id=uid for share;
 if not found then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 select * into sealed from private.budget_plan_receipts where user_id=uid and request_id=p_request_id;
 if sealed.request_id is not null then
  if sealed.workspace_id<>ws or sealed.payload is distinct from intent then
   raise exception using errcode='22023',message='Identificador reutilizado com dados diferentes';end if;
  return sealed.result;
 end if;
 cached:=private.reserve_payment_request(p_request_id,intent);
 if cached is not null then raise exception using errcode='42501',message='Recibo não confirmado pelo comando do plano';end if;
 select coalesce(max(version),0) into cur from public.budget_plans where workspace_id=ws;

 if op='save' then
  if jsonb_typeof(p_input->'expected_revision') is distinct from 'number' or (p_input->>'expected_revision')::numeric<>trunc((p_input->>'expected_revision')::numeric)
  then raise exception using errcode='22023',message='Revisão inválida';end if;
  if (p_input->>'expected_revision')::numeric<>cur then
   raise exception using errcode='PT409',message='O plano mudou. Abra de novo';end if;
  calc:=private.budget_plan_calc(p_input-'op'-'expected_revision');
  if not (calc->>'ok')::boolean then
   raise exception using errcode='P0001',message=calc->'errors'->0->>'message';end if;
  insert into public.budget_plans(workspace_id,user_id,version,base_income_cents)
   values(ws,uid,cur+1,(calc->>'base_income_cents')::bigint) returning id into pid;
  insert into public.budget_plan_lines(plan_id,workspace_id,position,group_name,category,share_bp)
   select pid,ws,(l->>'position')::int,l->>'group',l->>'category',(l->>'share_bp')::int from jsonb_array_elements(calc->'lines') l;
  result:=jsonb_build_object('plan_id',pid,'version',cur+1,'revision',cur+1,'base_income_cents',calc->>'base_income_cents');
 else
  if jsonb_typeof(p_input->'version') is distinct from 'number' or (p_input->>'version')::numeric<>trunc((p_input->>'version')::numeric)
  then raise exception using errcode='22023',message='Versão inválida';end if;
  ver:=(p_input->>'version')::int;
  if ver<>cur or cur=0 then raise exception using errcode='PT409',message='O plano mudou. Abra de novo';end if;
  scope:=p_input->>'scope';
  if scope is null or scope not in('default','month') then raise exception using errcode='22023',message='Alcance inválido';end if;
  if scope='month' then
   if coalesce(p_input->>'month','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='Mês inválido';end if;
   begin mes:=date_trunc('month',(p_input->>'month')::date)::date;
   exception when others then raise exception using errcode='22023',message='Mês inválido';end;
  elsif p_input->'month' is not null and jsonb_typeof(p_input->'month')<>'null' then
   raise exception using errcode='22023',message='Mês inválido';end if;
  if jsonb_typeof(p_input->'categories') is distinct from 'array' or jsonb_array_length(p_input->'categories')>60
   or exists(select 1 from jsonb_array_elements(p_input->'categories') e where jsonb_typeof(e) is distinct from 'string')
  then raise exception using errcode='22023',message='Categorias inválidas';end if;
  if jsonb_array_length(p_input->'categories')=0 then raise exception using errcode='P0001',message='Escolha ao menos uma categoria para aplicar.';end if;
  select * into plan from public.budget_plans where workspace_id=ws and version=ver;
  select private.budget_plan_calc(jsonb_build_object('base_income_cents',plan.base_income_cents::text,'lines',
   (select jsonb_agg(jsonb_build_object('group',group_name,'category',category,'share_bp',share_bp) order by position)
    from public.budget_plan_lines where plan_id=plan.id))) into calc;
  -- cada categoria pedida precisa ser uma linha do plano
  for wanted in select jsonb_array_elements_text(p_input->'categories') loop
   select exists(select 1 from jsonb_array_elements(calc->'lines') l where l->>'category' is not null
    and private.fold(l->>'category')=private.fold(wanted)) into okc;
   if not okc then raise exception using errcode='P0001',message='A categoria '||trim(wanted)||' não está no plano.';end if;
  end loop;
  for ln in select l from jsonb_array_elements(calc->'lines') l where l->>'category' is not null
   and exists(select 1 from jsonb_array_elements_text(p_input->'categories') w where private.fold(w)=private.fold(l->>'category'))
   order by (l->>'position')::int loop
   cat:=ln->>'category';amt:=(ln->>'amount_cents')::bigint;
   if amt<=0 then raise exception using errcode='P0001',message='A categoria '||cat||' ficou com R$ 0,00 no plano: aumente o percentual ou a renda-base.';end if;
   if not exists(select 1 from public.transactions t where t.workspace_id=ws and private.fold(t.category)=private.fold(cat))
    and not exists(select 1 from public.budgets b where b.workspace_id=ws and private.fold(b.category)=private.fold(cat))
    and not exists(select 1 from public.categories c where c.workspace_id=ws and private.fold(c.name)=private.fold(cat))
   then raise exception using errcode='P0001',message='A categoria '||cat||' não existe mais: edite o plano.';end if;
   -- a mesma regra de `save_budget`: dois unique parciais, só o limite muda (o rollover fica)
   if scope='default' then
    select b.limit_cents into before from public.budgets b where b.workspace_id=ws and b.category=cat and b.month is null for update;
    insert into public.budgets(workspace_id,user_id,category,limit_cents,rollover,month) values(ws,uid,cat,amt,false,null)
     on conflict(workspace_id,category) where month is null do update set limit_cents=excluded.limit_cents;
   else
    select b.limit_cents into before from public.budgets b where b.workspace_id=ws and b.category=cat and b.month=mes for update;
    insert into public.budgets(workspace_id,user_id,category,limit_cents,rollover,month) values(ws,uid,cat,amt,coalesce((select d.rollover from public.budgets d where d.workspace_id=ws and d.category=cat and d.month is null),false),mes)
     on conflict(workspace_id,category,month) where month is not null do update set limit_cents=excluded.limit_cents;
   end if;
   insert into public.budget_plan_applications(workspace_id,plan_id,line_position,category,scope,month,before_cents,applied_cents)
    values(ws,plan.id,(ln->>'position')::int,cat,scope,case when scope='month' then mes end,before,amt);
   applied:=applied||jsonb_build_object('category',cat,'before_cents',before::text,'applied_cents',amt::text);
   before:=null;
  end loop;
  result:=jsonb_build_object('version',ver,'scope',scope,'month',mes,'applied',applied);
 end if;
 insert into private.budget_plan_receipts(user_id,request_id,workspace_id,payload,result) values(uid,p_request_id,ws,intent,result);
 perform private.finish_payment_request(p_request_id,result);
 return result;
end $$;

create or replace function public.budget_plan_command(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.budget_plan_command(p_input,p_request_id);$$;

-- Plano atual + valores + o que já está em orçamento + realizado na régua pedida (a MESMA janela de
-- `budgets_status_for`: ciclo ou mês civil). O denominador do realizado é a renda lançada no período
-- (`month_summary`, que inclui o previsto).
create or replace function public.budget_plan_state(p_month date default null,p_view text default null) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
declare ws uuid:=public.my_default_workspace();plan public.budget_plans%rowtype;close_day int;rotulo date;ini date;fim date;
 income bigint;calc jsonb;lines jsonb;apps jsonb;pendente bigint;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Autenticação obrigatória';end if;
 if ws is null then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 close_day:=private.cycle_close_day(array[ws],p_view);
 rotulo:=private.cycle_month_of(close_day,coalesce(p_month,current_date));
 select b.ini,b.fim into ini,fim from private.cycle_bounds(close_day,rotulo) b;
 select s.income_cents,s.income_unsettled_cents into income,pendente from private.month_summary_for(array[ws],rotulo,p_view) s;
 select * into plan from public.budget_plans where workspace_id=ws order by version desc limit 1;
 if plan.id is not null then
  select private.budget_plan_calc(jsonb_build_object('base_income_cents',plan.base_income_cents::text,'lines',
   (select jsonb_agg(jsonb_build_object('group',group_name,'category',category,'share_bp',share_bp) order by position)
    from public.budget_plan_lines where plan_id=plan.id))) into calc;
  select jsonb_agg(l||jsonb_build_object(
    'current_default_cents',(select b.limit_cents::text from public.budgets b where b.workspace_id=ws and b.category=l->>'category' and b.month is null),
    'current_month_cents',(select b.limit_cents::text from public.budgets b where b.workspace_id=ws and b.category=l->>'category' and b.month=rotulo),
    'spent_cents',case when l->>'category' is null then null else (select coalesce(sum(t.amount_cents) filter(where t.status='cleared' or t.invoice_id is not null),0)::text
      from public.transactions t where t.workspace_id=ws and t.kind='expense' and t.rollover_of_invoice_id is null
       and coalesce(t.category,'outros')=l->>'category' and t.occurred_at>=ini and t.occurred_at<=fim) end)
   order by (l->>'position')::int) into lines from jsonb_array_elements(calc->'lines') l;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('plan_version',p.version,'position',a.line_position,'category',a.category,'scope',a.scope,
   'month',a.month,'before_cents',a.before_cents::text,'applied_cents',a.applied_cents::text,'created_at',a.created_at) order by a.created_at desc,a.id),'[]')
  into apps from (select * from public.budget_plan_applications x where x.workspace_id=ws order by x.created_at desc,x.id limit 30) a
  join public.budget_plans p on p.id=a.plan_id;
 return jsonb_build_object('workspace_id',ws,'revision',coalesce(plan.version,0),'month',rotulo,'period_start',ini,'period_end',fim,
  'income_cents',coalesce(income,0)::text,'income_unsettled_cents',coalesce(pendente,0)::text,
  'plan',case when plan.id is null then null else jsonb_build_object('id',plan.id,'version',plan.version,'created_at',plan.created_at,
    'base_income_cents',plan.base_income_cents::text,'lines',coalesce(lines,'[]'),'total_bp',calc->'total_bp','total_cents',calc->>'total_cents',
    'undistributed_bp',calc->'undistributed_bp','undistributed_cents',calc->>'undistributed_cents') end,
  'applications',apps);
end $$;

revoke execute on function private.budget_plan_pct(int),private.budget_plan_calc(jsonb),
 private.budget_plan_command(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.budget_plan_pct(int),private.budget_plan_calc(jsonb),
 private.budget_plan_command(jsonb,uuid) to authenticated;
revoke execute on function public.budget_plan_preview(jsonb),public.budget_plan_command(jsonb,uuid),public.budget_plan_state(date,text) from public,anon;
grant execute on function public.budget_plan_preview(jsonb),public.budget_plan_command(jsonb,uuid),public.budget_plan_state(date,text) to authenticated;
