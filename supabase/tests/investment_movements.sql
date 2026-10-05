-- F12: aplicar e resgatar com origem e destino (investment_command).
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/investment_movements.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
create function pg_temp.cmd(i jsonb,r uuid default gen_random_uuid()) returns jsonb language sql as $$select public.investment_command(i,r)$$;
create function pg_temp.bad(i jsonb,code text,frag text) returns void language plpgsql as $$
begin
 begin perform public.investment_command(i,gen_random_uuid());
 exception when others then
  assert sqlstate=code,format('esperava %s veio %s: %s',code,sqlstate,sqlerrm);
  assert sqlerrm like frag,format('mensagem inesperada: %s',sqlerrm);
  return;
 end;
 raise exception 'aceitou o que devia recusar: %',i;
end $$;
do $$
declare u uuid:=gen_random_uuid();o uuid:=gen_random_uuid();w uuid:=gen_random_uuid();ow uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();p uuid:=gen_random_uuid();q uuid:=gen_random_uuid();card uuid:=gen_random_uuid();
 arch uuid:=gen_random_uuid();oa uuid:=gen_random_uuid();op uuid:=gen_random_uuid();g uuid:=gen_random_uuid();
 d0 date:=current_date;r jsonb;r2 jsonb;req uuid:=gen_random_uuid();req2 uuid:=gen_random_uuid();req3 uuid:=gen_random_uuid();
 cash0 bigint;inc0 numeric;exp0 numeric;net0 bigint;
 mv_c uuid;mv_r1 uuid;mv_r2 uuid;mv_fc uuid;mv_fr uuid;mv_l1 uuid;mv_l2 uuid;mv_q uuid;mv_pg uuid;t_c uuid;t_r1 uuid;
 t1 uuid;t2 uuid;t_pend uuid;t_card uuid;t_inv uuid;t_cc uuid;t_oth uuid;t_g uuid;t_g2 uuid;n bigint;pg jsonb;pg2 jsonb;
begin
 insert into auth.users(id,email) values(u,'f12-'||u||'@example.invalid'),(o,'f12-'||o||'@example.invalid');
 insert into public.profiles(id) values(u),(o) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F12'),(ow,o,'F12 outro');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(ow,o,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values
  (a,w,u,'Conta A','checking',100000),(b,w,u,'Conta B','checking',0),(p,w,u,'Posicao P','investment',0),(q,w,u,'Posicao Q','investment',10000),
  (card,w,u,'Cartao','credit_card',0),(oa,ow,o,'Conta alheia','checking',99999),(op,ow,o,'Posicao alheia','investment',0);
 insert into public.accounts(id,workspace_id,user_id,name,type,archived) values(arch,w,u,'Arquivada','checking',true);
 insert into public.goals(id,workspace_id,user_id,name,target_cents) values(g,w,u,'Meta',1000000);
 -- baseline dos agregados (papel dono: net_worth_now e cash_total são internos)
 cash0:=private.cash_total(array[w]);
 select coalesce(sum(amount_cents) filter(where kind='income'),0),coalesce(sum(amount_cents) filter(where kind='expense'),0) into inc0,exp0 from public.transactions where workspace_id=w;
 select net_cents into net0 from private.net_worth_now(w);
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
 -- anon nunca executa
 assert not has_function_privilege('anon','public.investment_command(jsonb,uuid)','execute');
 assert not has_function_privilege('anon','public.investment_positions()','execute');
 assert not has_function_privilege('anon','public.investment_movements_page(uuid,integer,date,timestamptz,uuid)','execute');
 assert not has_function_privilege('anon','public.investment_link_candidates(integer)','execute');
 assert not has_function_privilege('anon','private.investment_command(jsonb,uuid)','execute');
 begin insert into public.investment_movements(workspace_id,user_id,position_account_id,kind) values(w,u,p,'contribution');raise exception 'DML direto aceito';
 exception when insufficient_privilege then null;end;

 -- 1. aplicar: UMA transferência origem -> posição; replay idempotente
 r:=pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','50000','occurred_on',d0-3,'note','CDB'),req);
 mv_c:=(r->>'movement_id')::uuid;t_c:=(r->>'transfer_id')::uuid;
 assert r->>'position_balance_cents'='50000' and (r->>'revision')::int=1;
 assert (select count(*) from public.transactions where id=t_c and kind='transfer' and account_id=a and counterparty_account_id=p and amount_cents=50000 and status='cleared' and description='CDB')=1;
 assert (select count(*) from public.transactions where workspace_id=w and kind='transfer')=1;
 r2:=pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','50000','occurred_on',d0-3,'note','CDB'),req);
 assert r2=r and (select count(*) from public.investment_movements where position_account_id=p)=1;
 begin perform pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','50001','occurred_on',d0-3,'note','CDB'),req);raise exception 'payload diferente aceito';
 exception when invalid_parameter_value then null;end;
 assert (select cents from private.caixa_das_contas(array[w],current_date) where account_id=a)=50000;

 -- 2. resgate parcial, total e excessivo
 r:=pg_temp.cmd(jsonb_build_object('op','redeem','position_account_id',p,'to_account_id',b,'amount_cents','20000','occurred_on',d0));
 mv_r1:=(r->>'movement_id')::uuid;t_r1:=(r->>'transfer_id')::uuid;
 assert r->>'position_balance_cents'='30000';
 assert (select count(*) from public.transactions where id=t_r1 and kind='transfer' and account_id=p and counterparty_account_id=b and amount_cents=20000)=1;
 perform pg_temp.bad(jsonb_build_object('op','redeem','position_account_id',p,'to_account_id',b,'amount_cents','30001','occurred_on',d0),'PT422','SALDO_INSUFICIENTE: faltam 1 centavos%');
 r:=pg_temp.cmd(jsonb_build_object('op','redeem','position_account_id',p,'to_account_id',b,'amount_cents','30000','occurred_on',d0));
 mv_r2:=(r->>'movement_id')::uuid;assert r->>'position_balance_cents'='0';
 perform pg_temp.bad(jsonb_build_object('op','redeem','position_account_id',p,'to_account_id',b,'amount_cents','1','occurred_on',d0),'PT422','SALDO_INSUFICIENTE%');
 assert (select count(*) from public.transactions where workspace_id=w and kind='transfer')=3,'recusa criou transferência';

 -- 3. desfazer/editar o aporte que um resgate consumiu é recusado
 perform pg_temp.bad(jsonb_build_object('op','undo','movement_id',mv_c,'expected_revision',1),'PT422','%Desfaça o resgate de%antes%');
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_r2,'expected_revision',1));
 assert (select count(*) from public.transactions where workspace_id=w and kind='transfer')=2;
 perform pg_temp.bad(jsonb_build_object('op','undo','movement_id',mv_c,'expected_revision',1),'PT422','%Desfaça o resgate%');
 perform pg_temp.bad(jsonb_build_object('op','edit','movement_id',mv_c,'amount_cents','19999','occurred_on',d0-3,'expected_revision',1),'PT422','%Desfaça o resgate%');
 perform pg_temp.bad(jsonb_build_object('op','edit','movement_id',mv_c,'amount_cents','50000','occurred_on',d0+2,'expected_revision',1),'PT422','%Desfaça o resgate%');
 perform pg_temp.bad(jsonb_build_object('op','edit','movement_id',mv_c,'amount_cents','50000','occurred_on',d0-3,'expected_revision',7),'PT409','%mudou%');
 -- editar para baixo até o que ainda cobre o resgate, mesma linha e mesmo id
 r:=pg_temp.cmd(jsonb_build_object('op','edit','movement_id',mv_c,'amount_cents','20000','occurred_on',d0-4,'expected_revision',1));
 assert (r->>'revision')::int=2 and (r->>'transfer_id')::uuid=t_c and r->>'position_balance_cents'='0';
 assert (select amount_cents from public.transactions where id=t_c)=20000 and (select occurred_at from public.transactions where id=t_c)=d0-4;
 assert (select count(*) from public.transactions where workspace_id=w and kind='transfer')=2;
 perform pg_temp.bad(jsonb_build_object('op','edit','movement_id',mv_c,'amount_cents','0','occurred_on',d0-4,'expected_revision',2),'22023','%centavos%');
 perform pg_temp.bad(jsonb_build_object('op','edit','movement_id',mv_c,'amount_cents','1','occurred_on','31/12/2026','expected_revision',2),'22023','Data inválida');
 -- editar o resgate para cima além do saldo
 perform pg_temp.bad(jsonb_build_object('op','edit','movement_id',mv_r1,'amount_cents','20001','occurred_on',d0,'expected_revision',1),'PT422','SALDO_INSUFICIENTE%');
 r:=pg_temp.cmd(jsonb_build_object('op','edit','movement_id',mv_r1,'amount_cents','15000','occurred_on',d0,'expected_revision',1));
 assert r->>'position_balance_cents'='5000';

 -- 4. datas futuras: pendente, e a regra vale em TODA data posterior
 r:=pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','1000','occurred_on',d0+5));
 mv_fc:=(r->>'movement_id')::uuid;
 assert (select status from public.transactions where id=(r->>'transfer_id')::uuid)='pending' and r->>'position_balance_cents'='5000';
 r:=pg_temp.cmd(jsonb_build_object('op','redeem','position_account_id',p,'to_account_id',b,'amount_cents','6000','occurred_on',d0+8));
 mv_fr:=(r->>'movement_id')::uuid;
 assert (select status from public.transactions where id=(r->>'transfer_id')::uuid)='pending';
 -- resgate retroativo que deixaria o resgate futuro sem saldo
 perform pg_temp.bad(jsonb_build_object('op','redeem','position_account_id',p,'to_account_id',b,'amount_cents','1','occurred_on',d0+6),'PT422','SALDO_INSUFICIENTE%');
 perform pg_temp.bad(jsonb_build_object('op','undo','movement_id',mv_fc,'expected_revision',1),'PT422','%Desfaça o resgate de%');
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_fr,'expected_revision',1));
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_fc,'expected_revision',1));

 -- 5. dois resgates da mesma posição: o segundo recusa
 r:=pg_temp.cmd(jsonb_build_object('op','redeem','position_account_id',q,'to_account_id',b,'amount_cents','10000','occurred_on',d0));
 mv_q:=(r->>'movement_id')::uuid;
 perform pg_temp.bad(jsonb_build_object('op','redeem','position_account_id',q,'to_account_id',a,'amount_cents','10000','occurred_on',d0),'PT422','SALDO_INSUFICIENTE%');
 -- repetir um desfazer já confirmado devolve o recibo selado
 r:=pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_q,'expected_revision',1),req3);
 r2:=pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_q,'expected_revision',1),req3);
 assert r2=r and r->>'movement_id' is null and r->>'position_balance_cents'='10000';

 -- 6. validações e isolamento entre espaços
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',p,'amount_cents','1','occurred_on',d0),'22023','%diferentes%');
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',card,'amount_cents','1','occurred_on',d0),'22023','%Cartão%');
 perform pg_temp.bad(jsonb_build_object('op','redeem','position_account_id',p,'to_account_id',card,'amount_cents','1','occurred_on',d0),'22023','%Cartão%');
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',q,'amount_cents','1','occurred_on',d0),'22023','%não seja de investimento%');
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',arch,'amount_cents','1','occurred_on',d0),'22023','%arquivada%');
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',a,'from_account_id',b,'amount_cents','1','occurred_on',d0),'22023','%conta de investimento%');
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','0','occurred_on',d0),'22023','%centavos%');
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','9007199254740992','occurred_on',d0),'22023','%centavos%');
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','1','occurred_on','amanhã'),'22023','Data inválida');
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','1','occurred_on',d0,'extra',1),'22023','%inválida%');
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',oa,'amount_cents','1','occurred_on',d0),'42501','%Conta não encontrada%');
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',op,'from_account_id',oa,'amount_cents','1','occurred_on',d0),'42501','%não autorizado%');
 perform pg_temp.bad(jsonb_build_object('op','undo','movement_id',mv_c,'expected_revision','2'),'22023','%Revisão inválida%');
 assert (select count(*) from public.transactions where workspace_id=w and kind='transfer')=2,'recusas criaram transferência';

 -- 7. vincular transferência já lançada/importada
 perform set_config('role','none',true);
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source,description) values(u,w,'transfer',700,a,p,d0,'import','Aplicação importada') returning id into t1;
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source) values(u,w,'transfer',300,p,b,d0,'import') returning id into t2;
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source,status) values(u,w,'transfer',10,a,p,d0+4,'import','pending') returning id into t_pend;
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source) values(u,w,'transfer',20,a,card,d0,'app') returning id into t_card;
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source) values(u,w,'transfer',30,p,q,d0,'app') returning id into t_inv;
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source) values(u,w,'transfer',40,b,a,d0,'app') returning id into t_cc;
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source) values(o,ow,'transfer',50,oa,op,d0,'app') returning id into t_oth;
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source) values(u,w,'transfer',400,a,p,d0,'app') returning id into t_g2;
 perform set_config('role','authenticated',true);
 assert exists(select 1 from jsonb_array_elements(public.investment_link_candidates(100)) x where (x->>'id')::uuid=t1 and x->>'kind'='contribution' and (x->>'position_account_id')::uuid=p);
 assert exists(select 1 from jsonb_array_elements(public.investment_link_candidates(100)) x where (x->>'id')::uuid=t2 and x->>'kind'='redemption');
 assert not exists(select 1 from jsonb_array_elements(public.investment_link_candidates(100)) x where (x->>'id')::uuid in(t_pend,t_card,t_inv,t_cc,t_oth,t_c,t_r1)),'candidata inválida';
 perform pg_temp.bad(jsonb_build_object('op','link','transfer_id',t_pend),'22023','%ainda não aconteceu%');
 perform pg_temp.bad(jsonb_build_object('op','link','transfer_id',t_card),'22023','%Cartão%');
 perform pg_temp.bad(jsonb_build_object('op','link','transfer_id',t_inv),'22023','%não seja de investimento%');
 perform pg_temp.bad(jsonb_build_object('op','link','transfer_id',t_cc),'22023','%conta de investimento%');
 perform pg_temp.bad(jsonb_build_object('op','link','transfer_id',t_oth),'42501','%não autorizado%');
 perform pg_temp.bad(jsonb_build_object('op','link','transfer_id',t_c),'23505','%já está vinculada%');
 select count(*) into n from public.transactions where workspace_id=w and kind='transfer';
 r:=pg_temp.cmd(jsonb_build_object('op','link','transfer_id',t1),req2);
 mv_l1:=(r->>'movement_id')::uuid;assert (r->>'transfer_id')::uuid=t1;
 assert (select kind||created_transfer::text from public.investment_movements where id=mv_l1)='contributionfalse';
 assert (select count(*) from public.transactions where workspace_id=w and kind='transfer')=n,'vincular criou outra transferência';
 r2:=pg_temp.cmd(jsonb_build_object('op','link','transfer_id',t1),req2);assert r2=r;
 perform pg_temp.bad(jsonb_build_object('op','link','transfer_id',t1),'23505','%já está vinculada%');
 r:=pg_temp.cmd(jsonb_build_object('op','link','transfer_id',t2));mv_l2:=(r->>'movement_id')::uuid;
 assert (select kind from public.investment_movements where id=mv_l2)='redemption';
 perform pg_temp.bad(jsonb_build_object('op','edit','movement_id',mv_l1,'amount_cents','1','occurred_on',d0,'expected_revision',1),'22023','%Edite o lançamento%');
 -- desfazer movimento vinculado só solta: a transferência fica e volta a ser candidata
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_l1,'expected_revision',1));
 assert exists(select 1 from public.transactions where id=t1);
 assert exists(select 1 from jsonb_array_elements(public.investment_link_candidates(100)) x where (x->>'id')::uuid=t1);
 -- a transferência apagada fora do movimento deixa o movimento "sem lançamento"
 perform set_config('role','none',true);delete from public.transactions where id=t2;perform set_config('role','authenticated',true);
 assert (select transfer_id from public.investment_movements where id=mv_l2) is null;
 perform pg_temp.bad(jsonb_build_object('op','edit','movement_id',mv_l2,'amount_cents','1','occurred_on',d0,'expected_revision',1),'22023','%sem lançamento%');
  assert (select (x->>'deleted')::boolean from jsonb_array_elements(public.investment_movements_page(p,50)->'movements') x where (x->>'id')::uuid=mv_l2),'movimento sem lançamento some do histórico';
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_l2,'expected_revision',1));
 assert not exists(select 1 from public.investment_movements where id=mv_l2);

 -- 8. a mesma transferência não entra numa meta E num investimento
 r:=public.goal_money_command(jsonb_build_object('op','link_in','goal_id',g,'transfer_id',t_g2),gen_random_uuid());
 perform pg_temp.bad(jsonb_build_object('op','link','transfer_id',t_g2),'23505','%já está vinculada%');
 begin perform public.goal_money_command(jsonb_build_object('op','link_in','goal_id',g,'transfer_id',t1),gen_random_uuid());
  perform pg_temp.cmd(jsonb_build_object('op','link','transfer_id',t1));raise exception 'aceitou o mesmo transfer nas duas tabelas';
 exception when others then assert sqlstate='23505',sqlerrm;end;
 -- o gatilho vale para DML direto, nos dois sentidos
 perform set_config('role','none',true);
 begin insert into public.investment_movements(workspace_id,user_id,position_account_id,kind,transfer_id) values(w,u,p,'contribution',t_g2);raise exception 'investimento aceitou transfer de meta';
 exception when unique_violation then assert sqlerrm like '%já foi vinculada a um investimento%' or sqlerrm like '%uma meta%',sqlerrm;end;
 perform set_config('role','none',true);
 r2:=null;
 insert into public.investment_movements(workspace_id,user_id,position_account_id,kind,transfer_id,created_transfer) values(w,u,p,'contribution',t_inv,false) returning to_jsonb(investment_movements.*) into r2;
 begin insert into public.goal_money_movements(workspace_id,user_id,goal_id,kind,amount_cents,occurred_on,transfer_id) values(w,u,g,'link_in',1,d0,t_inv);raise exception 'meta aceitou transfer de investimento';
 exception when unique_violation then assert sqlerrm like '%investimento%',sqlerrm;end;
 delete from public.investment_movements where transfer_id=t_inv;
 perform set_config('role','authenticated',true);

 -- 9. leitura: posições e histórico paginado, do mais recente ao mais antigo
 pg:=public.investment_positions();
 assert exists(select 1 from jsonb_array_elements(pg) x where (x->>'account_id')::uuid=p and x->>'name'='Posicao P' and x->>'type_label' is not null and x->>'balance_cents'='6070');
 assert not exists(select 1 from jsonb_array_elements(pg) x where (x->>'account_id')::uuid in(a,b,card,oa,op)),'posição indevida';
 assert (select x->>'net_contributed_cents' from jsonb_array_elements(pg) x where (x->>'account_id')::uuid=p)='5000';
 pg:=public.investment_movements_page(p,1);
 assert jsonb_array_length(pg->'movements')=1 and (pg->>'has_more')::boolean and pg->'next_before' is not null;
 pg2:=public.investment_movements_page(p,50,(pg->'next_before'->>'on')::date,(pg->'next_before'->>'created')::timestamptz,(pg->'next_before'->>'id')::uuid);
 assert jsonb_array_length(pg2->'movements')=1 and not (pg2->>'has_more')::boolean;
 assert (pg->'movements'->0->>'kind')='redemption' and (pg2->'movements'->0->>'kind')='contribution','ordem do histórico';
 begin perform public.investment_movements_page(a,10);raise exception 'página de conta comum aceita';
 exception when others then assert sqlstate='42501',sqlerrm;end;

 -- 10. outro espaço não vê nem mexe
 perform set_config('request.jwt.claim.sub',o::text,true);
 assert not exists(select 1 from jsonb_array_elements(public.investment_positions()) x where (x->>'account_id')::uuid=p);
 assert not exists(select 1 from jsonb_array_elements(public.investment_link_candidates(100)) x where (x->>'id')::uuid=t1);
 perform pg_temp.bad(jsonb_build_object('op','undo','movement_id',mv_c,'expected_revision',2),'42501','%não autorizado%');
 perform pg_temp.bad(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',oa,'amount_cents','1','occurred_on',d0),'42501','%não autorizado%');
 begin perform public.investment_movements_page(p,10);raise exception 'histórico de outro espaço visível';
 exception when others then assert sqlstate='42501',sqlerrm;end;
 perform set_config('request.jwt.claim.sub',u::text,true);

 -- 11. agregados intactos: aplicar/resgatar nunca é receita, despesa ou mudança de patrimônio
 perform set_config('role','none',true);
 -- a transferência de/para cartão do cenário é pagamento de verdade (move caixa): fora da conta
 delete from public.transactions where id=t_card;
 assert (select coalesce(sum(amount_cents) filter(where kind='income'),0) from public.transactions where workspace_id=w)=inc0,'receita mudou';
 assert (select coalesce(sum(amount_cents) filter(where kind='expense'),0) from public.transactions where workspace_id=w)=exp0,'despesa mudou';
 assert private.cash_total(array[w])=cash0,'caixa total mudou';
 assert (select net_cents from private.net_worth_now(w))=net0,'patrimônio líquido mudou';
end $$;
-- Terceiro cenário: proteção da transferência criada, paid_at/status/auto_confirm na edição e cascata.
do $$
declare u uuid:=gen_random_uuid();w uuid:=gen_random_uuid();a uuid:=gen_random_uuid();p uuid:=gen_random_uuid();
 d0 date:=current_date;r jsonb;t uuid;mv uuid;pg jsonb;
begin
 insert into auth.users(id,email) values(u,'f12c-'||u||'@example.invalid');
 insert into public.profiles(id) values(u) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F12c');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values(a,w,u,'A','checking',100000),(p,w,u,'P','investment',0);
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
 -- futura: pendente e confirma sozinha no dia
 r:=pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','1000','occurred_on',d0+3));
 t:=(r->>'transfer_id')::uuid;mv:=(r->>'movement_id')::uuid;
 assert (select status='pending' from public.transactions where id=t),'futura pending';
 assert (select auto_confirm from public.transactions where id=t),'futura auto_confirm';
 assert (select paid_at is null from public.transactions where id=t),'futura sem paid_at';
 -- passada: já confirmada, sem auto_confirm
 r:=pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','50','occurred_on',d0));
 assert (select not auto_confirm and status='cleared' from public.transactions where id=(r->>'transfer_id')::uuid),'passada confirmada sem auto_confirm';
 -- editar: status só muda quando a data cruza hoje; paid_at acompanha
 r:=pg_temp.cmd(jsonb_build_object('op','edit','movement_id',mv,'amount_cents','1100','occurred_on',d0+5,'expected_revision',1));
 assert (select status='pending' and paid_at is null and amount_cents=1100 from public.transactions where id=t),'futuro->futuro preserva pending';
 r:=pg_temp.cmd(jsonb_build_object('op','edit','movement_id',mv,'amount_cents','1100','occurred_on',d0-2,'expected_revision',2));
 assert (select status='cleared' and paid_at=d0-2 from public.transactions where id=t),'futuro->passado vira cleared com paid_at';
 r:=pg_temp.cmd(jsonb_build_object('op','edit','movement_id',mv,'amount_cents','1200','occurred_on',d0-1,'expected_revision',3));
 assert (select status='cleared' and paid_at=d0-1 from public.transactions where id=t),'paid_at segue a data';
 r:=pg_temp.cmd(jsonb_build_object('op','edit','movement_id',mv,'amount_cents','1200','occurred_on',d0+2,'expected_revision',4));
 assert (select status='pending' and paid_at is null from public.transactions where id=t),'passado->futuro vira pending';
 -- a transferência criada só muda pelo comando
 perform set_config('role','none',true);
 begin delete from public.transactions where id=t;raise exception 'apagou direto';
 exception when others then assert sqlstate='P0001' and sqlerrm like '%pertence a uma aplicação%',sqlerrm;end;
 begin update public.transactions set amount_cents=1 where id=t;raise exception 'editou valor direto';
 exception when others then assert sqlstate='P0001' and sqlerrm like '%pertence a uma aplicação%',sqlerrm;end;
 begin update public.transactions set occurred_at=d0 where id=t;raise exception 'editou data direto';
 exception when others then assert sqlstate='P0001' and sqlerrm like '%pertence a uma aplicação%',sqlerrm;end;
 update public.transactions set description='renomeada',status='cleared' where id=t;
 update public.transactions set status='pending' where id=t;
 -- lançamento apagado por fora (escopo ligado): o movimento fica "Lançamento apagado" e o undo o remove
 perform set_config('proops.investment_scope','on',true);delete from public.transactions where id=t;perform set_config('proops.investment_scope','',true);
 perform set_config('role','authenticated',true);
 pg:=public.investment_movements_page(p,50);
 assert (select (x->>'deleted')::boolean and x->>'amount_cents' is null from jsonb_array_elements(pg->'movements') x where (x->>'id')::uuid=mv);
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv,'expected_revision',5));
 assert not exists(select 1 from public.investment_movements where id=mv);
 -- apagar a CONTA e o ESPAÇO continua funcionando (cascata)
 perform pg_temp.cmd(jsonb_build_object('op','contribute','position_account_id',p,'from_account_id',a,'amount_cents','70','occurred_on',d0));
 perform set_config('role','none',true);
 delete from public.accounts where id=a;
 assert not exists(select 1 from public.accounts where id=a),'conta não foi apagada';
 delete from public.workspaces where id=w;
 assert not exists(select 1 from public.investment_movements where workspace_id=w);
end $$;
rollback;
