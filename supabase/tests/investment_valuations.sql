-- F13: principal, resultado e reavaliação (investment_value_command, investment_positions, net_worth_now).
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/investment_valuations.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
create function pg_temp.cmd(i jsonb,r uuid default gen_random_uuid()) returns jsonb language sql as $$select public.investment_command(i,r)$$;
create function pg_temp.val(i jsonb,r uuid default gen_random_uuid()) returns jsonb language sql as $$select public.investment_value_command(i,r)$$;
create function pg_temp.bad(i jsonb,code text,frag text) returns void language plpgsql as $$
begin
 begin perform public.investment_value_command(i,gen_random_uuid());
 exception when others then
  assert sqlstate=code,format('esperava %s veio %s: %s',code,sqlstate,sqlerrm);
  assert sqlerrm like frag,format('mensagem inesperada: %s',sqlerrm);
  return;
 end;
 raise exception 'aceitou o que devia recusar: %',i;
end $$;
-- papel dono para ler o interno, e volta ao usuário
create function pg_temp.nw(w uuid) returns table(cash_cents bigint,investments_cents bigint,other_assets_cents bigint,liabilities_cents bigint,net_cents bigint)
language plpgsql as $$
begin perform set_config('role','none',true);
 return query select * from private.net_worth_now(w);
 perform set_config('role','authenticated',true);end $$;
create function pg_temp.cash(w uuid) returns bigint language plpgsql as $$
declare n bigint;
begin perform set_config('role','none',true);n:=private.cash_total(array[w]);
 perform set_config('role','authenticated',true);return n;end $$;
create function pg_temp.pos(p uuid) returns jsonb language sql as $$
 select x from jsonb_array_elements(public.investment_positions()) x where (x->>'account_id')::uuid=p $$;
do $$
declare u uuid:=gen_random_uuid();o uuid:=gen_random_uuid();w uuid:=gen_random_uuid();ow uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();p uuid:=gen_random_uuid();q uuid:=gen_random_uuid();r3 uuid:=gen_random_uuid();rr uuid:=gen_random_uuid();
 card uuid:=gen_random_uuid();arch uuid:=gen_random_uuid();oa uuid:=gen_random_uuid();op uuid:=gen_random_uuid();bem uuid:=gen_random_uuid();
 d0 date:=current_date;x jsonb;y jsonb;req uuid:=gen_random_uuid();req2 uuid:=gen_random_uuid();
 cash0 bigint;cash0b bigint;net0 bigint;inc0 numeric;exp0 numeric;res0 jsonb;n0 record;n1 record;
 v1 uuid;v2 uuid;vq uuid;vo uuid;vo2 uuid;mv_i1 uuid;mv_i2 uuid;t_i1 uuid;t_i2 uuid;mv_c uuid;pg jsonb;pg2 jsonb;cnt int;seen int:=0;cur jsonb;
 a0 bigint;b0 bigint;tot int;sd uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,'f13-'||u||'@example.invalid'),(o,'f13-'||o||'@example.invalid');
 insert into public.profiles(id) values(u),(o) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F13'),(ow,o,'F13 outro');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(ow,o,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values
  (a,w,u,'Conta A','checking',1000000),(b,w,u,'Conta B','checking',0),(p,w,u,'Posicao P','investment',0),(q,w,u,'Posicao Q','investment',10000),
  (r3,w,u,'Posicao R3','investment',0),(rr,w,u,'Posicao RR','investment',0),(card,w,u,'Cartao','credit_card',0),(oa,ow,o,'Conta alheia','checking',99999),(op,ow,o,'Posicao alheia','investment',0);
 insert into public.accounts(id,workspace_id,user_id,name,type,archived) values(arch,w,u,'Arquivada','checking',true);
 insert into public.assets(id,workspace_id,user_id,name,class,current_value_cents) values(bem,w,u,'Bem','real_estate',1000);

 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
 -- anon nunca executa; DML direto não existe
 assert not has_function_privilege('anon','public.investment_value_command(jsonb,uuid)','execute');
 assert not has_function_privilege('anon','public.delete_asset_valuation(uuid)','execute');
 assert not has_function_privilege('anon','private.investment_value_command(jsonb,uuid)','execute');
 begin insert into public.investment_valuations(workspace_id,user_id,position_account_id,kind,value_cents,as_of) values(w,u,p,'valuation',1,d0);raise exception 'DML direto aceito';
 exception when insufficient_privilege then null;end;

 -- posição sem atualização: resultado INDISPONÍVEL (null), nunca zero; valor = saldo no app
 x:=pg_temp.pos(rr);
 assert x->>'result_quality'='indisponível' and x->'result_cents' = 'null'::jsonb and x->>'value_cents'='0' and x->'last_valuation_on'='null'::jsonb,'sem atualização: '||x::text;

 -- aplicar 50000 em P (d0-10) e 5000 em Q (d0-10)
 perform pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','50000','occurred_on',d0-10));
 perform pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',q,'from_account_id',a,'amount_cents','5000','occurred_on',d0-10));
 -- baseline (depois dos aportes, antes de qualquer atualização)
 cash0:=pg_temp.cash(w);select * into n0 from pg_temp.nw(w);net0:=n0.net_cents;
 select coalesce(sum(amount_cents) filter(where kind='income'),0),coalesce(sum(amount_cents) filter(where kind='expense'),0) into inc0,exp0 from public.transactions where workspace_id=w;
 res0:=public.emergency_reserve_state(w,d0);
 x:=pg_temp.pos(p);
 assert x->>'value_cents'='50000' and x->>'result_quality'='indisponível' and x->'result_cents'='null'::jsonb and x->>'principal_cents'='50000','aporte sem atualização: '||x::text;

 -- 1. atualizar valor: replay idempotente; resultado positivo; quality conhecido (conta nasceu com 0)
 y:=pg_temp.val(jsonb_build_object('op','valuation','position_account_id',p,'value_cents','60000','as_of',d0-5,'note','corretora'),req);
 v1:=(y->>'valuation_id')::uuid;
 assert y->>'position_value_cents'='60000' and (y->>'revision')::int=1;
 assert pg_temp.val(jsonb_build_object('op','valuation','position_account_id',p,'value_cents','60000','as_of',d0-5,'note','corretora'),req)=y;
 assert (select count(*) from public.investment_valuations where position_account_id=p)=1,'replay duplicou';
 begin perform pg_temp.val(jsonb_build_object('op','valuation','position_account_id',p,'value_cents','60001','as_of',d0-5,'note','corretora'),req);raise exception 'payload diferente aceito';
 exception when invalid_parameter_value then null;end;
 x:=pg_temp.pos(p);
 assert x->>'value_cents'='60000' and x->>'principal_cents'='50000' and x->>'result_cents'='10000' and x->>'result_quality'='conhecido'
  and x->>'last_valuation_on'=(d0-5)::text and x->>'received_cents'='0' and x->>'balance_cents'='50000','positivo: '||x::text;
 -- aportado líquido e contagem continuam só aplicação/resgate
 assert x->>'net_contributed_cents'='50000' and (x->>'movements_count')::int=1;
 -- caixa, receita, despesa e reserva iguais; patrimônio muda SÓ pelo resultado não realizado
 assert pg_temp.cash(w)=cash0,'caixa mudou com a atualização';
 assert (select coalesce(sum(amount_cents) filter(where kind='income'),0) from public.transactions where workspace_id=w)=inc0,'receita mudou';
 assert (select coalesce(sum(amount_cents) filter(where kind='expense'),0) from public.transactions where workspace_id=w)=exp0,'despesa mudou';
 assert public.emergency_reserve_state(w,d0)=res0,'reserva mudou com a atualização de valor';
 select * into n1 from pg_temp.nw(w);
 assert n1.net_cents=net0+10000,'patrimônio deveria subir só o resultado: '||(n1.net_cents-net0);
 assert n1.cash_cents=n0.cash_cents and n1.investments_cents=n0.investments_cents+10000,'posição sai do caixa e entra em investimentos pelo valor';
 -- a posição está em Investimentos (valor), não em Dinheiro: caixa do patrimônio = caixa total − saldo da posição
 assert n1.cash_cents=cash0-65000,'dinheiro em conta ainda conta a posição';
 assert n1.investments_cents=75000,'investimentos pelo valor atual: '||n1.investments_cents;

 -- resultado negativo
 pg2:=pg_temp.val(jsonb_build_object('op','valuation','position_account_id',p,'value_cents','40000','as_of',d0-1));
 x:=pg_temp.pos(p);
 assert x->>'value_cents'='40000' and x->>'result_cents'='-10000','negativo: '||x::text;
 -- retroativa (d0-8) NÃO muda o valor atual
 perform pg_temp.val(jsonb_build_object('op','valuation','position_account_id',p,'value_cents','99999','as_of',d0-8));
 x:=pg_temp.pos(p);
 assert x->>'value_cents'='40000' and x->>'last_valuation_on'=(d0-1)::text,'retroativa mudou o valor atual: '||x::text;
 -- duas atualizações no mesmo dia: recusa com o caminho; futura e malformada recusadas
 perform pg_temp.bad(jsonb_build_object('op','valuation','position_account_id',p,'value_cents','1','as_of',d0-1),'P0001','%edite a de '||to_char(d0-1,'DD/MM')||'%');
 perform pg_temp.bad(jsonb_build_object('op','valuation','position_account_id',p,'value_cents','1','as_of',d0+1),'P0001','%não pode ser futura%');
 perform pg_temp.bad(jsonb_build_object('op','valuation','position_account_id',p,'value_cents','-1','as_of',d0),'22023','%centavos%');
 perform pg_temp.bad(jsonb_build_object('op','valuation','position_account_id',p,'value_cents','1','as_of',d0,'x',1),'22023','%inválida%');
 perform pg_temp.bad(jsonb_build_object('op','valuation','position_account_id',a,'value_cents','1','as_of',d0),'22023','%conta de investimento%');
 perform pg_temp.bad(jsonb_build_object('op','valuation','position_account_id',op,'value_cents','1','as_of',d0),'42501','%não autorizado%');

 -- 2. estimado (saldo inicial > 0, sem abertura) e conhecido (com abertura); abertura única substitui
 perform pg_temp.val(jsonb_build_object('op','valuation','position_account_id',q,'value_cents','20000','as_of',d0-5));
 x:=pg_temp.pos(q);
 assert x->>'result_quality'='estimado' and x->>'principal_cents'='15000' and x->>'result_cents'='5000','estimado: '||x::text;
 y:=pg_temp.val(jsonb_build_object('op','opening','position_account_id',q,'value_cents','12000','as_of',d0-20));
 vo:=(y->>'valuation_id')::uuid;
 x:=pg_temp.pos(q);
 assert x->>'result_quality'='conhecido' and x->>'principal_cents'='17000' and x->>'result_cents'='3000','conhecido: '||x::text;
 assert x->>'opening_on'=(d0-20)::text,'opening_on: '||x::text;
 assert pg_temp.pos(p)->'opening_on'='null'::jsonb;
 y:=pg_temp.val(jsonb_build_object('op','opening','position_account_id',q,'value_cents','13000','as_of',d0-30));
 assert (y->>'valuation_id')::uuid=vo and (y->>'revision')::int=2,'abertura nova não substituiu';
 assert (select count(*) from public.investment_valuations where position_account_id=q and kind='opening')=1;
 x:=pg_temp.pos(q);
 assert x->>'principal_cents'='18000','principal com a nova abertura: '||x::text;
 -- abertura não muda caixa nem patrimônio além do resultado
 assert pg_temp.cash(w)=cash0;
 -- resgate total do principal: aplicado cai, valor cai, resultado fica
 perform pg_temp.cmd(jsonb_build_object('op','redeem','position_account_id',p,'to_account_id',b,'amount_cents','40000','occurred_on',d0));
 x:=pg_temp.pos(p);
 assert x->>'value_cents'='0' and x->>'principal_cents'='10000' and x->>'result_cents'='-10000' and x->>'balance_cents'='10000'
  ,'resgate total: '||x::text;
 -- (a atualização de d0-1 vale 40000; o resgate de d0 tirou 40000 → 0; o saldo no app é 10000 porque o aporte foi 50000)
 -- dois aportes no mesmo dia somam sem duplicar
 perform pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',r3,'from_account_id',a,'amount_cents','100','occurred_on',d0-3));
 perform pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',r3,'from_account_id',a,'amount_cents','200','occurred_on',d0-3));
 x:=pg_temp.pos(r3);
 assert x->>'principal_cents'='300' and x->>'balance_cents'='300' and x->>'value_cents'='300' and x->>'result_quality'='indisponível','dois aportes: '||x::text;

 -- 3. corrigir e apagar atualização: revisão velha, replay do apagar
 perform pg_temp.bad(jsonb_build_object('op','edit','valuation_id',v1,'value_cents','1','as_of',d0-5,'expected_revision',99),'PT409','%mudou%');
 y:=pg_temp.val(jsonb_build_object('op','edit','valuation_id',v1,'value_cents','65000','as_of',d0-5,'expected_revision',1));
 assert (y->>'revision')::int=2;
 perform pg_temp.bad(jsonb_build_object('op','edit','valuation_id',v1,'value_cents','1','as_of',d0-8,'expected_revision',2),'P0001','%edite a de%');
 -- a mais recente (d0-1) apagada: o valor volta para a anterior por as_of (d0-5 = 65000 + o que mexeu depois: resgate de 40000)
 select id into v2 from public.investment_valuations where position_account_id=p and as_of=d0-1;
 y:=pg_temp.val(jsonb_build_object('op','delete','valuation_id',v2,'expected_revision',1),req2);
 assert y->>'valuation_id' is null;
 assert pg_temp.val(jsonb_build_object('op','delete','valuation_id',v2,'expected_revision',1),req2)=y,'replay do apagar depois do commit';
 x:=pg_temp.pos(p);
 assert x->>'last_valuation_on'=(d0-5)::text and x->>'value_cents'='25000','apagar recalcula: '||x::text;
 perform pg_temp.bad(jsonb_build_object('op','delete','valuation_id',v2,'expected_revision',1),'42501','%não autorizado%');

 -- 4. rendimento recebido: na posição e noutra conta (é receita; caixa muda; valor atual muda uma vez)
 cash0b:=pg_temp.cash(w);
 y:=pg_temp.val(jsonb_build_object('op','income','position_account_id',p,'to_account_id',p,'amount_cents','300','occurred_on',d0,'note','dividendos'));
 assert pg_temp.cash(w)=cash0b+300,'rendimento na posição deve mover o caixa';
 mv_i1:=(y->>'movement_id')::uuid;t_i1:=(y->>'transaction_id')::uuid;
 assert y->>'position_value_cents'='25300';
 assert (select kind='income' and category='rendimentos' and account_id=p and amount_cents=300 and status='cleared' and description='dividendos' from public.transactions where id=t_i1);
 x:=pg_temp.pos(p);
 assert x->>'value_cents'='25300' and x->>'received_cents'='300' and x->>'principal_cents'='10000','rendimento na posição: '||x::text;
 y:=pg_temp.val(jsonb_build_object('op','income','position_account_id',p,'to_account_id',b,'amount_cents','200','occurred_on',d0-2));
 mv_i2:=(y->>'movement_id')::uuid;t_i2:=(y->>'transaction_id')::uuid;
 assert pg_temp.cash(w)=cash0b+500,'rendimento em outra conta também move o caixa';
 x:=pg_temp.pos(p);
 assert x->>'value_cents'='25300' and x->>'received_cents'='500','rendimento noutra conta: '||x::text;
 assert (select coalesce(sum(amount_cents) filter(where kind='income'),0) from public.transactions where workspace_id=w)=inc0+500,'receita entra uma vez';
 assert (select count(*) from public.transactions where workspace_id=w and category='rendimentos')=2;
 perform pg_temp.bad(jsonb_build_object('op','income','position_account_id',p,'to_account_id',card,'amount_cents','1','occurred_on',d0),'P0001','%Cartão%');
 perform pg_temp.bad(jsonb_build_object('op','income','position_account_id',p,'to_account_id',arch,'amount_cents','1','occurred_on',d0),'P0001','%arquivada%');
 perform pg_temp.bad(jsonb_build_object('op','income','position_account_id',p,'to_account_id',q,'amount_cents','1','occurred_on',d0),'P0001','%não seja de investimento%');
 perform pg_temp.bad(jsonb_build_object('op','income','position_account_id',p,'to_account_id',oa,'amount_cents','1','occurred_on',d0),'42501','%não encontrada%');
 perform pg_temp.bad(jsonb_build_object('op','income','position_account_id',p,'to_account_id',b,'amount_cents','1','occurred_on',d0+1),'P0001','%futura%');
 perform pg_temp.bad(jsonb_build_object('op','income','position_account_id',p,'to_account_id',b,'amount_cents','0','occurred_on',d0),'22023','%centavos%');
 -- a receita criada é protegida como a transferência; renomear continua livre
 perform set_config('role','none',true);
 begin delete from public.transactions where id=t_i1;raise exception 'apagou receita direto';
 exception when others then assert sqlstate='P0001' and sqlerrm like '%rendimento pertence%',sqlerrm;end;
 begin update public.transactions set amount_cents=1 where id=t_i1;raise exception 'editou valor direto';
 exception when others then assert sqlstate='P0001' and sqlerrm like '%rendimento pertence%',sqlerrm;end;
 begin update public.transactions set kind='expense' where id=t_i1;raise exception 'trocou tipo direto';
 exception when others then assert sqlstate='P0001' and sqlerrm like '%rendimento pertence%',sqlerrm;end;
 begin update public.transactions set occurred_at=d0-9 where id=t_i2;raise exception 'editou data direto';
 exception when others then assert sqlstate='P0001' and sqlerrm like '%rendimento pertence%',sqlerrm;end;
 begin update public.transactions set status='pending' where id=t_i1;raise exception 'mudou status direto';
 exception when others then assert sqlstate='P0001' and sqlerrm like '%rendimento pertence%',sqlerrm;end;
 begin update public.transactions set paid_at=d0-1 where id=t_i1;raise exception 'mudou paid_at direto';
 exception when others then assert sqlstate='P0001' and sqlerrm like '%rendimento pertence%',sqlerrm;end;
 update public.transactions set description='renomeado' where id=t_i1;
 perform set_config('role','authenticated',true);
 -- editar rendimento: recusa clara; desfazer apaga a receita junto
 begin perform pg_temp.cmd(jsonb_build_object('op','edit','movement_id',mv_i1,'amount_cents','1','occurred_on',d0,'expected_revision',1));raise exception 'editou rendimento';
 exception when others then assert sqlstate='P0001' and sqlerrm like '%desfaça e lance de novo%',sqlerrm;end;
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_i1,'expected_revision',1));
 assert not exists(select 1 from public.transactions where id=t_i1) and not exists(select 1 from public.investment_movements where id=mv_i1),'undo do rendimento deixou resto';
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_i2,'expected_revision',1));
 assert (select count(*) from public.transactions where workspace_id=w and category='rendimentos')=0;
 assert (select count(*) from public.investment_movements where position_account_id=p and kind='income')=0;
 x:=pg_temp.pos(p);
 assert x->>'value_cents'='25000' and x->>'received_cents'='0','depois de desfazer: '||x::text;
 -- desfazer rendimento que a posição já gastou: recusa (saldo ficaria negativo)
 y:=pg_temp.val(jsonb_build_object('op','income','position_account_id',rr,'to_account_id',rr,'amount_cents','300','occurred_on',d0-4));
 perform pg_temp.cmd(jsonb_build_object('op','redeem','position_account_id',rr,'to_account_id',a,'amount_cents','300','occurred_on',d0-1));
 begin perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',(y->>'movement_id')::uuid,'expected_revision',1));raise exception 'desfez rendimento já resgatado';
 exception when others then assert sqlstate='PT422',sqlerrm;end;

 -- 5. histórico: valores, abertura, rendimento e movimentos juntos, mais novo primeiro, cursor composto
 pg:=public.investment_movements_page(q,50);
 assert (select count(*) from jsonb_array_elements(pg->'movements') m where m->>'nature'='opening')=1
  and (select count(*) from jsonb_array_elements(pg->'movements') m where m->>'nature'='valuation')=1
  and (select count(*) from jsonb_array_elements(pg->'movements') m where m->>'nature'='movement')=1,'natureza no histórico: '||pg::text;
 assert (select m->>'amount_cents' from jsonb_array_elements(pg->'movements') m where m->>'nature'='valuation')='20000';
 assert (select not (m->>'deleted')::boolean from jsonb_array_elements(pg->'movements') m where m->>'nature'='valuation');
 pg:=public.investment_movements_page(rr,50);
 assert (select count(*) from jsonb_array_elements(pg->'movements') m where m->>'nature'='income')=1;
 select count(*) into tot from jsonb_array_elements(public.investment_movements_page(p,100)->'movements');
 cur:=null;seen:=0;
 loop
  pg:=case when cur is null then public.investment_movements_page(p,2)
   else public.investment_movements_page(p,2,(cur->>'on')::date,(cur->>'created')::timestamptz,(cur->>'id')::uuid) end;
  seen:=seen+jsonb_array_length(pg->'movements');
  exit when not (pg->>'has_more')::boolean;
  cur:=pg->'next_before';
 end loop;
 assert seen=tot and tot>=4,'paginação perdeu ou repetiu linha '||seen||'/'||tot;
 assert (select bool_and((m->>'occurred_on')>=lead_on) from (select m,lead(m->>'occurred_on') over(order by ord) lead_on from jsonb_array_elements(public.investment_movements_page(p,100)->'movements') with ordinality t(m,ord)) s where lead_on is not null),'ordem por data desc';

 -- 6. bens: marcação retroativa não muda o valor atual; apagar recalcula; a única não se apaga
 assert public.update_asset_value(bem,2000,d0)=2000;
 assert (select current_value_cents from public.assets where id=bem)=2000;
 assert public.update_asset_value(bem,500,d0-30)=2000,'retroativa devolve o valor atual';
 assert (select current_value_cents from public.assets where id=bem)=2000,'retroativa mudou o valor atual do bem';
 assert (select count(*) from public.asset_valuations where asset_id=bem)=2;
 assert public.delete_asset_valuation((select id from public.asset_valuations where asset_id=bem and as_of=d0))=500;
 assert (select current_value_cents from public.assets where id=bem)=500,'apagar não recalculou';
 begin perform public.delete_asset_valuation((select id from public.asset_valuations where asset_id=bem));raise exception 'apagou a única marcação';
 exception when others then assert sqlstate='P0001' and sqlerrm like '%única marcação%',sqlerrm;end;
 -- o patrimônio enxerga o valor do bem pela marcação mais recente
 assert (select other_assets_cents from pg_temp.nw(w))=500;

 -- bem: data futura vira hoje
 assert public.update_asset_value(bem,700,d0+5)=700;
 assert exists(select 1 from public.asset_valuations where asset_id=bem and as_of=d0 and value_cents=700) and not exists(select 1 from public.asset_valuations where asset_id=bem and as_of>d0);
 -- valor da posição nunca negativo
 perform pg_temp.cmd(jsonb_build_object('op','redeem','position_account_id',q,'to_account_id',b,'amount_cents','15000','occurred_on',d0));
 assert (pg_temp.pos(q)->>'value_cents')::bigint>=0,'valor negativo';

 -- 7. outro espaço não vê nem mexe
 perform set_config('request.jwt.claim.sub',o::text,true);
 assert not exists(select 1 from jsonb_array_elements(public.investment_positions()) z where (z->>'account_id')::uuid=p);
 perform pg_temp.bad(jsonb_build_object('op','delete','valuation_id',vo,'expected_revision',2),'42501','%não autorizado%');
 begin perform public.delete_asset_valuation((select id from public.asset_valuations where asset_id=bem));raise exception 'apagou marcação alheia';
 exception when others then assert sqlstate='P0001',sqlerrm;end;
 perform set_config('request.jwt.claim.sub',u::text,true);

 -- mesmo dia: o movimento registrado DEPOIS do valor informado conta; o de ANTES, não.
 -- Numa transação só now() não anda, então o "antes" é recuado à mão (papel dono).
 perform set_config('role','none',true);
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values(sd,w,u,'Posicao SD','investment',0);
 perform set_config('role','authenticated',true);
 perform pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',sd,'from_account_id',a,'amount_cents','100000','occurred_on',d0));
 perform set_config('role','none',true);
 update public.transactions set created_at=now()-interval '2 minutes' where counterparty_account_id=sd;
 perform set_config('role','authenticated',true);
 perform pg_temp.val(jsonb_build_object('op','valuation','position_account_id',sd,'value_cents','85000','as_of',d0));
 perform set_config('role','none',true);
 update public.investment_valuations set recorded_at=now()-interval '1 minute' where position_account_id=sd;
 perform set_config('role','authenticated',true);
 -- o aporte de antes já está dentro dos 850: o valor é 850, não 1.850
 assert (pg_temp.pos(sd)->>'value_cents')::bigint=85000,'aporte anterior contado duas vezes: '||pg_temp.pos(sd)::text;
 perform pg_temp.cmd(jsonb_build_object('op','redeem','position_account_id',sd,'to_account_id',b,'amount_cents','81000','occurred_on',d0));
 -- o resgate de depois sai do valor: 850 − 810 = 40, e o resultado é 40 − 190 = −150 (não +660)
 x:=pg_temp.pos(sd);
 assert (x->>'value_cents')::bigint=4000 and (x->>'principal_cents')::bigint=19000 and (x->>'result_cents')::bigint=-15000,'resgate do mesmo dia: '||x::text;
 -- editar o valor é informar de novo: o resgate já registrado passa a estar dentro dele
 perform pg_temp.val(jsonb_build_object('op','edit','valuation_id',(select id from public.investment_valuations where position_account_id=sd),
  'value_cents','4000','as_of',d0,'expected_revision',1));
 assert (pg_temp.pos(sd)->>'value_cents')::bigint=4000,'edição recontou o resgate: '||pg_temp.pos(sd)::text;

 -- 8. a RPC pública do app (invoker) e a série seguem funcionando, e o app lê o mesmo número
 assert (select net_cents from public.net_worth())=(select net_cents from pg_temp.nw(w)),'net_worth() difere de net_worth_now';
 perform * from public.net_worth_series(3);
 perform set_config('role','none',true);
 -- foto diária: as mesmas colunas, na mesma ordem
 insert into public.net_worth_snapshots(workspace_id,as_of,cash_cents,investments_cents,other_assets_cents,liabilities_cents,net_cents)
  select w,d0,n.cash_cents,n.investments_cents,n.other_assets_cents,n.liabilities_cents,n.net_cents from private.net_worth_now(w) n;
end $$;
rollback;
