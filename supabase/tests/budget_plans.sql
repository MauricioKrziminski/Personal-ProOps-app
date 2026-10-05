-- F14: planejamento por percentual (budget_plan_preview / budget_plan_command / budget_plan_state).
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/budget_plans.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
create function pg_temp.cmd(i jsonb,r uuid default gen_random_uuid()) returns jsonb language sql as $$select public.budget_plan_command(i,r)$$;
create function pg_temp.bad(i jsonb,code text,frag text) returns void language plpgsql as $$
begin
 begin perform public.budget_plan_command(i,gen_random_uuid());
 exception when others then
  assert sqlstate=code,format('esperava %s veio %s: %s',code,sqlstate,sqlerrm);
  assert sqlerrm like frag,format('mensagem inesperada: %s',sqlerrm);
  return;
 end;
 raise exception 'aceitou o que devia recusar: %',i;
end $$;
create function pg_temp.ln(g text,c text,bp int) returns jsonb language sql as $$select jsonb_build_object('group',g,'category',c,'share_bp',bp)$$;
create function pg_temp.sv(base text,lines jsonb,rev int) returns jsonb language sql as $$
 select jsonb_build_object('op','save','base_income_cents',base,'lines',lines,'expected_revision',rev)$$;
do $$
declare u uuid:=gen_random_uuid();o uuid:=gen_random_uuid();w uuid:=gen_random_uuid();ow uuid:=gen_random_uuid();
 r jsonb;r2 jsonb;req uuid:=gen_random_uuid();pv jsonb;st jsonb;m0 date:=date_trunc('month',current_date)::date;
 v1 jsonb;bu record;
begin
 insert into auth.users(id,email) values(u,'f14-'||u||'@example.invalid'),(o,'f14-'||o||'@example.invalid');
 insert into public.profiles(id) values(u),(o) on conflict do nothing;
 -- o espaço padrão é o que `my_default_workspace()` acha (um gatilho de perfil pode já tê-lo criado)
 perform set_config('request.jwt.claim.sub',u::text,true);w:=public.my_default_workspace();
 perform set_config('request.jwt.claim.sub',o::text,true);ow:=public.my_default_workspace();
 if w is null then w:=gen_random_uuid();insert into public.workspaces(id,owner_id,name) values(w,u,'F14');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');end if;
 if ow is null then ow:=gen_random_uuid();insert into public.workspaces(id,owner_id,name) values(ow,o,'F14 outro');
  insert into public.workspace_members(workspace_id,user_id,role) values(ow,o,'owner');end if;
 insert into public.budgets(workspace_id,user_id,category,limit_cents,rollover,month) values(w,u,'moradia',250000,true,null);
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,description,occurred_at,source,status,category) values
  (u,w,'income',500000,'Salario',current_date,'app','cleared',null),
  (u,w,'expense',120000,'Aluguel',current_date,'app','cleared','moradia'),
  (u,w,'expense',30000,'Mercado previsto',current_date,'app','pending','mercado');
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);

 -- anon nunca executa; escrita direta recusada
 assert not has_function_privilege('anon','public.budget_plan_preview(jsonb)','execute');
 assert not has_function_privilege('anon','public.budget_plan_command(jsonb,uuid)','execute');
 assert not has_function_privilege('anon','public.budget_plan_state(date,text)','execute');
 assert not has_function_privilege('anon','private.budget_plan_command(jsonb,uuid)','execute');
 assert not has_function_privilege('anon','private.budget_plan_calc(jsonb)','execute');
 begin insert into public.budget_plans(workspace_id,user_id,version,base_income_cents) values(w,u,9,1);raise exception 'DML direto aceito';
 exception when insufficient_privilege then null;end;
 begin insert into public.budget_plan_applications(workspace_id,plan_id,line_position,category,scope,applied_cents) values(w,gen_random_uuid(),0,'x','default',1);raise exception 'DML direto aceito';
 exception when insufficient_privilege then null;end;

 -- prévia: renda zero e negativa
 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','0','lines',jsonb_build_array(pg_temp.ln('G','a',1000))));
 assert not (pv->>'ok')::boolean and pv->'errors'->0->>'message' like 'Informe uma renda-base%';
 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','-5','lines',jsonb_build_array(pg_temp.ln('G','a',1000))));
 assert not (pv->>'ok')::boolean and pv->'errors'->0->>'code'='base';
 -- 99,99 / 100 / 100,01
 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','1000','lines',jsonb_build_array(pg_temp.ln('G','a',5000),pg_temp.ln('G','b',4999))));
 assert (pv->>'ok')::boolean and (pv->>'total_bp')::int=9999 and (pv->>'undistributed_bp')::int=1;
 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','1000','lines',jsonb_build_array(pg_temp.ln('G','a',5000),pg_temp.ln('G','b',5000))));
 assert (pv->>'ok')::boolean and (pv->>'undistributed_cents')::bigint=0 and (pv->>'total_cents')::bigint=1000;
 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','1000','lines',jsonb_build_array(pg_temp.ln('G','a',5000),pg_temp.ln('G','b',5001))));
 assert not (pv->>'ok')::boolean and pv->'errors'->0->>'message'='A soma dos percentuais é 100,01%: passa de 100%.',pv::text;
 -- centavos de resto fecham EXATAMENTE a renda em 100%: maior resto, empate pela posição
 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','1001','lines',
  jsonb_build_array(pg_temp.ln('G','a',3333),pg_temp.ln('G','b',3333),pg_temp.ln('G','c',3334))));
 assert (pv->'lines'->0->>'amount_cents')='334' and (pv->'lines'->1->>'amount_cents')='333' and (pv->'lines'->2->>'amount_cents')='334',pv::text;
 assert (pv->>'total_cents')::bigint=1001 and (pv->>'undistributed_cents')::bigint=0;
 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','7','lines',
  jsonb_build_array(pg_temp.ln('G','a',3333),pg_temp.ln('G','b',3333),pg_temp.ln('G','c',3334))));
 assert (select sum((l->>'amount_cents')::bigint) from jsonb_array_elements(pv->'lines') l)=7;
 -- abaixo de 100%: não distribuído = renda - soma
 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','1000000','lines',jsonb_build_array(pg_temp.ln('G','a',3333))));
 assert (pv->'lines'->0->>'amount_cents')='333300' and (pv->>'undistributed_cents')='666700' and (pv->>'undistributed_bp')::int=6667;
 -- categoria em dois grupos (com acento/caixa) e grupo com nome repetido
 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','1000','lines',jsonb_build_array(pg_temp.ln('A','Saúde',1000),pg_temp.ln('B','saude',1000))));
 assert not (pv->>'ok')::boolean and pv->'errors'->0->>'code'='category_dup' and pv->'errors'->0->>'message' like '%mais de uma linha%',pv::text;
 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','1000','lines',jsonb_build_array(pg_temp.ln('Essenciais','a',1000),pg_temp.ln('essenciais','b',1000))));
 assert not (pv->>'ok')::boolean and pv->'errors'->0->>'code'='group_dup';
 -- percentual fora de 0..100% e entrada malformada
 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','1000','lines',jsonb_build_array(pg_temp.ln('A','a',10001))));
 assert not (pv->>'ok')::boolean and pv->'errors'->0->>'code'='share';
 begin perform public.budget_plan_preview('{"base_income_cents":"1000","lines":[{"group":"A","category":"a","share_bp":10.5}]}'::jsonb);raise exception 'fracionado aceito';
 exception when invalid_parameter_value then null;end;
 begin perform public.budget_plan_preview('[]'::jsonb);raise exception 'array aceito';exception when invalid_parameter_value then null;end;

 pv:=public.budget_plan_preview(jsonb_build_object('base_income_cents','1000','lines',(select jsonb_agg(pg_temp.ln('G','c'||i,1)) from generate_series(1,61) i)));
 assert not (pv->>'ok')::boolean and pv->'errors'->0->>'message'='O plano aceita até 60 linhas.',pv::text;
 -- salvar: recusas pela frase (P0001) e nada gravado
 perform pg_temp.bad(pg_temp.sv('0',jsonb_build_array(pg_temp.ln('G','a',1000)),0),'P0001','Informe uma renda-base%');
 perform pg_temp.bad(pg_temp.sv('1000',jsonb_build_array(pg_temp.ln('G','a',5000),pg_temp.ln('G','b',5001)),0),'P0001','A soma dos percentuais é 100,01%%');
 perform pg_temp.bad(pg_temp.sv('1000',jsonb_build_array(pg_temp.ln('A','a',100),pg_temp.ln('B','A',100)),0),'P0001','A categoria a aparece%');
 assert (select count(*) from public.budget_plans where workspace_id=w)=0;

 -- salvar v1 (com linha sem categoria) e repetir a requisição
 v1:=jsonb_build_array(pg_temp.ln('Essenciais','Moradia',3000),pg_temp.ln('Essenciais','mercado',1500),
  pg_temp.ln('Estilo de vida','lazer',1000),pg_temp.ln('Futuro',null,2000));
 r:=pg_temp.cmd(pg_temp.sv('1000000',v1,0),req);
 assert (r->>'version')::int=1 and (r->>'revision')::int=1;
 r2:=pg_temp.cmd(pg_temp.sv('1000000',v1,0),req);
 assert r2=r and (select count(*) from public.budget_plans where workspace_id=w)=1;
 begin perform pg_temp.cmd(pg_temp.sv('1000001',v1,0),req);raise exception 'payload diferente aceito';
 exception when invalid_parameter_value then null;end;
 assert (select category from public.budget_plan_lines where plan_id=(r->>'plan_id')::uuid and position=0)='moradia';
 -- revisão velha
 perform pg_temp.bad(pg_temp.sv('1000000',v1,0),'PT409','O plano mudou%');

 -- estado: plano, valores, renda e realizado na régua
 st:=public.budget_plan_state(m0,null);
 assert (st->>'revision')::int=1 and (st->>'income_cents')='500000' and (st->>'income_unsettled_cents')='0',st::text;
 assert st->'plan'->>'total_cents'='750000' and st->'plan'->>'undistributed_cents'='250000' and (st->'plan'->>'undistributed_bp')::int=2500;
 assert st->'plan'->'lines'->0->>'amount_cents'='300000' and st->'plan'->'lines'->0->>'spent_cents'='120000'
  and st->'plan'->'lines'->0->>'current_default_cents'='250000',st::text;
 assert st->'plan'->'lines'->1->>'spent_cents'='0' and st->'plan'->'lines'->3->'category'='null'::jsonb and st->'plan'->'lines'->3->>'spent_cents' is null;

 -- aplicar: recusas
 perform pg_temp.bad(jsonb_build_object('op','apply','version',1,'categories',jsonb_build_array(),'scope','default','month',null),'P0001','Escolha ao menos%');
 perform pg_temp.bad(jsonb_build_object('op','apply','version',1,'categories',jsonb_build_array('investir'),'scope','default','month',null),'P0001','A categoria investir não está no plano.');
 perform pg_temp.bad(jsonb_build_object('op','apply','version',2,'categories',jsonb_build_array('moradia'),'scope','default','month',null),'PT409','O plano mudou%');
 perform pg_temp.bad(jsonb_build_object('op','apply','version',1,'categories',jsonb_build_array('moradia'),'scope','month','month',null),'22023','Mês inválido');
 perform pg_temp.bad(jsonb_build_object('op','apply','version',1,'categories',jsonb_build_array('lazer'),'scope','default','month',null),'P0001','A categoria lazer não existe mais: edite o plano.');
 -- aplicar o padrão: antes -> depois, rollover preservado, só o escolhido muda
 req:=gen_random_uuid();
 r:=pg_temp.cmd(jsonb_build_object('op','apply','version',1,'categories',jsonb_build_array('Moradia','mercado'),'scope','default','month',null),req);
 assert r->'applied'->0->>'category'='moradia' and r->'applied'->0->>'before_cents'='250000' and r->'applied'->0->>'applied_cents'='300000',r::text;
 assert r->'applied'->1->>'category'='mercado' and r->'applied'->1->'before_cents'='null'::jsonb and r->'applied'->1->>'applied_cents'='150000';
 assert pg_temp.cmd(jsonb_build_object('op','apply','version',1,'categories',jsonb_build_array('Moradia','mercado'),'scope','default','month',null),req)=r;
 select limit_cents,rollover into bu from public.budgets where workspace_id=w and category='moradia' and month is null;
 assert bu.limit_cents=300000 and bu.rollover,'rollover deve ficar';
 select limit_cents,rollover into bu from public.budgets where workspace_id=w and category='mercado' and month is null;
 assert bu.limit_cents=150000 and not bu.rollover;
 assert not exists(select 1 from public.budgets where workspace_id=w and category='lazer');
 assert (select count(*) from public.budget_plan_applications where workspace_id=w)=2;
 -- budgets_status segue a semântica de sempre (limite base = o aplicado)
 select limit_cents,base_limit_cents into bu from public.budgets_status(current_date) where category='moradia';
 assert bu.base_limit_cents=300000,'budgets_status base';
 -- aplicar só no mês: override do mês, padrão intacto
 r:=pg_temp.cmd(jsonb_build_object('op','apply','version',1,'categories',jsonb_build_array('moradia'),'scope','month','month',current_date),gen_random_uuid());
 assert r->'applied'->0->'before_cents'='null'::jsonb and r->>'month'=m0::text;
 assert (select limit_cents from public.budgets where workspace_id=w and category='moradia' and month=m0)=300000;
 assert (select rollover from public.budgets where workspace_id=w and category='moradia' and month=m0),'o mês novo herda o rollover do padrão';
 assert (select limit_cents from public.budgets where workspace_id=w and category='moradia' and month is null)=300000;
 -- reaplicar no mês: antes -> depois
 r:=pg_temp.cmd(jsonb_build_object('op','apply','version',1,'categories',jsonb_build_array('moradia'),'scope','month','month',m0),gen_random_uuid());
 assert r->'applied'->0->>'before_cents'='300000';
 st:=public.budget_plan_state(m0,null);
 assert st->'plan'->'lines'->0->>'current_month_cents'='300000' and jsonb_array_length(st->'applications')=4;
 -- mudar a renda depois não mexe no que foi aplicado; aplicar a versão velha é revisão velha
 r:=pg_temp.cmd(pg_temp.sv('2000000',v1,1));
 assert (r->>'version')::int=2;
 assert (select limit_cents from public.budgets where workspace_id=w and category='moradia' and month is null)=300000;
 assert (select limit_cents from public.budgets where workspace_id=w and category='mercado' and month is null)=150000;
 perform pg_temp.bad(jsonb_build_object('op','apply','version',1,'categories',jsonb_build_array('moradia'),'scope','default','month',null),'PT409','O plano mudou%');
 assert (select applied_cents from public.budget_plan_applications where workspace_id=w order by created_at,id limit 1)=300000;
 -- uma nova aplicação (v2) é o que muda o limite; 0 reais recusado
 r:=pg_temp.cmd(jsonb_build_object('op','apply','version',2,'categories',jsonb_build_array('moradia'),'scope','default','month',null),gen_random_uuid());
 assert r->'applied'->0->>'applied_cents'='600000' and r->'applied'->0->>'before_cents'='300000';
 r:=pg_temp.cmd(pg_temp.sv('2000000',jsonb_build_array(pg_temp.ln('G','zero',0),pg_temp.ln('G','x',1000)),2));
 perform pg_temp.bad(jsonb_build_object('op','apply','version',3,'categories',jsonb_build_array('zero'),'scope','default','month',null),'P0001','%R$ 0,00%');

 -- isolamento: outro workspace não vê plano, não aplica, não lê
 perform set_config('request.jwt.claim.sub',o::text,true);
 assert (select count(*) from public.budget_plans)=0 and (select count(*) from public.budget_plan_lines)=0 and (select count(*) from public.budget_plan_applications)=0;
 st:=public.budget_plan_state(m0,null);
 assert (st->>'revision')::int=0 and st->'plan'='null'::jsonb and st->>'income_cents'='0' and jsonb_array_length(st->'applications')=0;
 perform pg_temp.bad(jsonb_build_object('op','apply','version',3,'categories',jsonb_build_array('moradia'),'scope','default','month',null),'PT409','O plano mudou%');
 r:=pg_temp.cmd(pg_temp.sv('1000',jsonb_build_array(pg_temp.ln('G','moradia',10000)),0));
 assert (r->>'version')::int=1;
 assert (select limit_cents from public.budgets where workspace_id=w and category='moradia' and month is null) is null;
 perform set_config('request.jwt.claim.sub',u::text,true);
 assert (select count(*) from public.budget_plans where workspace_id=ow)=0;
 raise notice 'budget_plans OK';
end $$;
rollback;
