-- F11: movimentação de dinheiro das metas (separar, transferir, vincular, liberar, desfazer).
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/goal_money_movements.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
create function pg_temp.cmd(i jsonb,r uuid default gen_random_uuid()) returns jsonb language sql as $$select public.goal_money_command(i,r)$$;
create function pg_temp.bad(i jsonb,code text,frag text) returns void language plpgsql as $$
begin
 begin perform public.goal_money_command(i,gen_random_uuid());
 exception when others then
  assert sqlstate=code,format('esperava %s veio %s: %s',code,sqlstate,sqlerrm);
  assert sqlerrm like frag,format('mensagem inesperada: %s',sqlerrm);
  return;
 end;
 raise exception 'aceitou o que devia recusar: %',i;
end $$;
do $$
declare u uuid:=gen_random_uuid();o uuid:=gen_random_uuid();w uuid:=gen_random_uuid();ow uuid:=gen_random_uuid();
 g1 uuid:=gen_random_uuid();g2 uuid:=gen_random_uuid();og uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();card uuid:=gen_random_uuid();arch uuid:=gen_random_uuid();oa uuid:=gen_random_uuid();
 d0 date:=current_date;r jsonb;r2 jsonb;req uuid:=gen_random_uuid();
 cash0 bigint;inc0 numeric;exp0 numeric;tx0 bigint;mv_allocate uuid;mv_tin uuid;mv_future uuid;mv_link uuid;mv_rel uuid;mv_out uuid;mv_free uuid;
 t_in uuid;t_future uuid;t_ext uuid;t_ext2 uuid;st jsonb;n bigint;
begin
 insert into auth.users(id,email) values(u,'f11-'||u||'@example.invalid'),(o,'f11-'||o||'@example.invalid');
 insert into public.profiles(id) values(u),(o) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F11'),(ow,o,'F11 outro');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(ow,o,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values
  (a,w,u,'Conta A','checking',10000),(b,w,u,'Conta B','checking',0),(c,w,u,'Conta C','savings',0),
  (card,w,u,'Cartao','credit_card',0),(oa,ow,o,'Conta alheia','checking',99999);
 insert into public.accounts(id,workspace_id,user_id,name,type,archived) values(arch,w,u,'Arquivada','checking',true);
 insert into public.goals(id,workspace_id,user_id,name,target_cents) values(g1,w,u,'Meta 1',100000),(g2,w,u,'Meta 2',100000),(og,ow,o,'Alheia',1000);
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
 -- anon nunca executa
 assert not has_function_privilege('anon','public.goal_money_command(jsonb,uuid)','execute');
 assert not has_function_privilege('anon','public.goal_money_state(uuid,integer,timestamptz)','execute');
 assert not has_function_privilege('anon','public.goal_link_candidates(uuid,integer)','execute');
 assert not has_function_privilege('anon','private.goal_money_command(jsonb,uuid)','execute');
 begin insert into public.goal_money_movements(workspace_id,user_id,goal_id,kind,amount_cents,occurred_on) values(w,u,g1,'allocate',1,d0);raise exception 'DML direto aceito';
 exception when insufficient_privilege then null;end;

 -- 1. separar dentro do livre; agregados não mudam
 cash0:=private.cash_total(array[w]);
 select coalesce(sum(amount_cents) filter(where kind='income'),0),coalesce(sum(amount_cents) filter(where kind='expense'),0),count(*) into inc0,exp0,tx0 from public.transactions where workspace_id=w;
 r:=pg_temp.cmd(jsonb_build_object('op','allocate','goal_id',g1,'account_id',a,'amount_cents','6000','occurred_on',d0,'note','sobra'),req);
 assert r->>'saved_cents'='6000' and (r->>'transfer_id') is null and (r->>'revision')::int=1;
 mv_allocate:=(r->>'movement_id')::uuid;
 assert (select amount_cents from public.financial_allocations where goal_id=g1 and account_id=a and purpose='goal')=6000;
 assert (select saved_cents from public.goals where id=g1)=6000;
 assert private.cash_total(array[w])=cash0,'separar mexeu no caixa';
 assert (select count(*) from public.transactions where workspace_id=w)=tx0,'separar criou transação';
 -- replay idempotente
 r2:=pg_temp.cmd(jsonb_build_object('op','allocate','goal_id',g1,'account_id',a,'amount_cents','6000','occurred_on',d0,'note','sobra'),req);
 assert r2=r;assert (select count(*) from public.goal_money_movements where goal_id=g1)=1;
 begin perform pg_temp.cmd(jsonb_build_object('op','allocate','goal_id',g1,'account_id',a,'amount_cents','6001','occurred_on',d0,'note','sobra'),req);raise exception 'payload diferente aceito';
 exception when invalid_parameter_value then null;end;
 -- 2. duas metas disputando o mesmo caixa
 perform pg_temp.bad(jsonb_build_object('op','allocate','goal_id',g2,'account_id',a,'amount_cents','4001','occurred_on',d0),'PT422','SALDO_INSUFICIENTE: livre 4000%');
 perform pg_temp.cmd(jsonb_build_object('op','allocate','goal_id',g2,'account_id',a,'amount_cents','4000','occurred_on',d0));
 perform pg_temp.bad(jsonb_build_object('op','allocate','goal_id',g1,'account_id',a,'amount_cents','1','occurred_on',d0),'PT422','SALDO_INSUFICIENTE%');
 -- validações
 perform pg_temp.bad(jsonb_build_object('op','allocate','goal_id',g1,'account_id',a,'amount_cents','0','occurred_on',d0),'22023','%centavos%');
 perform pg_temp.bad(jsonb_build_object('op','allocate','goal_id',g1,'account_id',card,'amount_cents','1','occurred_on',d0),'22023','%Cartão%');
 perform pg_temp.bad(jsonb_build_object('op','allocate','goal_id',g1,'account_id',arch,'amount_cents','1','occurred_on',d0),'22023','%arquivada%');
 perform pg_temp.bad(jsonb_build_object('op','allocate','goal_id',g1,'account_id',a,'amount_cents','1','occurred_on',d0+1),'22023','%futura%');
 perform pg_temp.bad(jsonb_build_object('op','allocate','goal_id',g1,'account_id',a,'amount_cents','1','occurred_on',d0,'extra',1),'22023','%inválida%');
 -- isolamento entre espaços
 perform pg_temp.bad(jsonb_build_object('op','allocate','goal_id',g1,'account_id',oa,'amount_cents','1','occurred_on',d0),'42501','%Conta não encontrada%');
 perform pg_temp.bad(jsonb_build_object('op','allocate','goal_id',og,'account_id',a,'amount_cents','1','occurred_on',d0),'42501','%não autorizado%');
 perform pg_temp.bad(jsonb_build_object('op','transfer_in','goal_id',g1,'from_account_id',oa,'account_id',b,'amount_cents','1','occurred_on',d0),'42501','%Conta não encontrada%');

 -- 3. transferir: UMA transferência e a separação no destino; total de caixa igual
 r:=pg_temp.cmd(jsonb_build_object('op','transfer_in','goal_id',g1,'from_account_id',a,'account_id',b,'amount_cents','3000','occurred_on',d0));
 t_in:=(r->>'transfer_id')::uuid;mv_tin:=(r->>'movement_id')::uuid;
 assert r->>'saved_cents'='9000';
 assert (select count(*) from public.transactions where workspace_id=w and kind='transfer')=1;
 assert (select count(*) from public.transactions where id=t_in and kind='transfer' and account_id=a and counterparty_account_id=b and amount_cents=3000 and status='cleared')=1;
 assert (select amount_cents from public.financial_allocations where goal_id=g1 and account_id=b)=3000;
 assert private.cash_total(array[w])=cash0,'transferência mudou o caixa total';
 assert (select coalesce(sum(amount_cents) filter(where kind='income'),0) from public.transactions where workspace_id=w)=inc0 and (select coalesce(sum(amount_cents) filter(where kind='expense'),0) from public.transactions where workspace_id=w)=exp0,'receita/despesa mudaram';
 perform pg_temp.bad(jsonb_build_object('op','transfer_in','goal_id',g1,'from_account_id',a,'account_id',a,'amount_cents','1','occurred_on',d0),'22023','%diferentes%');
 perform pg_temp.bad(jsonb_build_object('op','transfer_in','goal_id',g1,'from_account_id',a,'account_id',arch,'amount_cents','1','occurred_on',d0),'22023','%arquivada%');
 perform pg_temp.bad(jsonb_build_object('op','transfer_in','goal_id',g1,'from_account_id',arch,'account_id',b,'amount_cents','1','occurred_on',d0),'22023','%arquivada%');
 perform pg_temp.bad(jsonb_build_object('op','transfer_in','goal_id',g1,'from_account_id',a,'account_id',card,'amount_cents','1','occurred_on',d0),'22023','%Cartão%');
 assert (select count(*) from public.transactions where workspace_id=w and kind='transfer')=1,'recusa criou transferência';
 -- data futura: transferência pendente
 r:=pg_temp.cmd(jsonb_build_object('op','transfer_in','goal_id',g1,'from_account_id',a,'account_id',b,'amount_cents','500','occurred_on',d0+5));
 t_future:=(r->>'transfer_id')::uuid;mv_future:=(r->>'movement_id')::uuid;
 assert (select status from public.transactions where id=t_future)='pending';
 assert (select amount_cents from public.financial_allocations where goal_id=g1 and account_id=b)=3500;

 -- 4. vincular transferência existente
 perform set_config('role','none',true);
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source,description)
  values(u,w,'transfer',700,a,c,d0,'import','Importada') returning id into t_ext;
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source)
  values(u,w,'transfer',50,a,card,d0,'app') returning id into t_ext2;
 perform set_config('role','authenticated',true);
 assert exists(select 1 from jsonb_array_elements(public.goal_link_candidates(g1,50)) x where (x->>'id')::uuid=t_ext);
 assert not exists(select 1 from jsonb_array_elements(public.goal_link_candidates(g1,50)) x where (x->>'id')::uuid in(t_in,t_ext2)),'candidata vinculada ou com destino cartão';
 r:=pg_temp.cmd(jsonb_build_object('op','link_in','goal_id',g1,'transfer_id',t_ext));
 mv_link:=(r->>'movement_id')::uuid;assert r->>'saved_cents'='10200' and (r->>'transfer_id')::uuid=t_ext;
 assert (select count(*) from public.transactions where workspace_id=w and kind='transfer')=4,'vincular criou outra transferência';
 assert (select amount_cents from public.financial_allocations where goal_id=g1 and account_id=c)=700;
 perform pg_temp.bad(jsonb_build_object('op','link_in','goal_id',g1,'transfer_id',t_ext),'23505','%já foi vinculada%');
 perform pg_temp.bad(jsonb_build_object('op','link_in','goal_id',g2,'transfer_id',t_in),'23505','%já foi vinculada%');
 perform pg_temp.bad(jsonb_build_object('op','link_in','goal_id',g1,'transfer_id',t_ext2),'22023','%Cartão%');
 assert not exists(select 1 from jsonb_array_elements(public.goal_link_candidates(g1,50)) x where (x->>'id')::uuid=t_ext);

 -- 5. liberar e transferir de volta
 perform pg_temp.bad(jsonb_build_object('op','release','goal_id',g1,'account_id',b,'amount_cents','3501','occurred_on',d0),'PT422','%separado%');
 r:=pg_temp.cmd(jsonb_build_object('op','release','goal_id',g1,'account_id',b,'amount_cents','1000','occurred_on',d0));
 mv_rel:=(r->>'movement_id')::uuid;assert r->>'saved_cents'='9200';
 assert (select amount_cents from public.financial_allocations where goal_id=g1 and account_id=b)=2500;
 -- sem conta só tira o dinheiro que não está separado em conta: aqui não há nenhum
 perform pg_temp.bad(jsonb_build_object('op','release','goal_id',g1,'account_id',null,'amount_cents','1','occurred_on',d0),'PT422','Sem origem%');
 perform public.goal_deposit(g1,300,d0);
 perform pg_temp.bad(jsonb_build_object('op','release','goal_id',g1,'account_id',null,'amount_cents','301','occurred_on',d0),'PT422','Sem origem%');
 r:=pg_temp.cmd(jsonb_build_object('op','release','goal_id',g1,'account_id',null,'amount_cents','100','occurred_on',d0));mv_free:=(r->>'movement_id')::uuid;
 assert (select saved_cents from public.goals where id=g1)=9400;
 assert (select sum(amount_cents) from public.financial_allocations where goal_id=g1)=6000+2500+700,'liberar sem conta mexeu em separação';
 r:=pg_temp.cmd(jsonb_build_object('op','transfer_out','goal_id',g1,'account_id',b,'to_account_id',a,'amount_cents','500','occurred_on',d0));
 mv_out:=(r->>'movement_id')::uuid;
 assert (select count(*) from public.transactions where id=(r->>'transfer_id')::uuid and account_id=b and counterparty_account_id=a and amount_cents=500)=1;
 assert (select amount_cents from public.financial_allocations where goal_id=g1 and account_id=b)=2000;
 perform pg_temp.bad(jsonb_build_object('op','transfer_out','goal_id',g1,'account_id',b,'to_account_id',b,'amount_cents','1','occurred_on',d0),'22023','%diferentes%');

 -- 6. leitura
 st:=public.goal_money_state(g1,3,null);
 assert jsonb_array_length(st->'movements')=3 and (st->>'has_more')::boolean and st->'next_before' is not null;
 assert (select (x->>'goal_cents') from jsonb_array_elements(st->'accounts') x where (x->>'account_id')::uuid=b)='2000';
 assert (select count(*) from jsonb_array_elements(st->'accounts') x where (x->>'account_id')::uuid=card)=0;

 -- 7. editar o aporte de uma movimentação é recusado
 begin perform public.edit_goal_contribution((select contribution_id from public.goal_money_movements where id=mv_allocate),5000,d0,null);raise exception 'edição aceita';
 exception when others then assert sqlerrm like '%pertence a uma movimentação%',sqlerrm;end;

 -- 8. desfazer: revisão velha, depois cada tipo (a saída antes da entrada que ela consumiu)
 perform pg_temp.bad(jsonb_build_object('op','undo','movement_id',mv_out,'expected_revision',2),'PT409','%mudou%');
 r:=pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_out,'expected_revision',1));
 assert r->>'movement_id' is null;
 assert (select count(*) from public.transactions where workspace_id=w and kind='transfer')=4,'transferência da saída não foi apagada';
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_future,'expected_revision',1));
 assert not exists(select 1 from public.transactions where id=t_future);
 -- a parte futura (pendente) já saiu; só então a liberação cabe de novo no caixa de hoje
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_rel,'expected_revision',1));
 assert (select amount_cents from public.financial_allocations where goal_id=g1 and account_id=b)=3000;
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_link,'expected_revision',1));
 assert exists(select 1 from public.transactions where id=t_ext),'vínculo desfeito apagou a transferência';
 assert not exists(select 1 from public.financial_allocations where goal_id=g1 and account_id=c);
 assert exists(select 1 from jsonb_array_elements(public.goal_link_candidates(g1,50)) x where (x->>'id')::uuid=t_ext),'transferência não voltou a ser candidata';
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_tin,'expected_revision',1));
 assert not exists(select 1 from public.transactions where id=t_in);
 assert not exists(select 1 from public.financial_allocations where goal_id=g1 and account_id=b);
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_free,'expected_revision',1));
 perform pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_allocate,'expected_revision',1));
 assert (select count(*) from public.goal_money_movements where goal_id=g1)=0;
 assert (select saved_cents from public.goals where id=g1)=300;
 assert (select count(*) from public.financial_allocations where goal_id=g1)=0;
 perform pg_temp.bad(jsonb_build_object('op','undo','movement_id',mv_allocate,'expected_revision',1),'42501','%autorizado%');
 assert (select count(*) from public.transactions where workspace_id=w and kind='transfer')=2 and private.cash_total(array[w])=cash0-50;
end $$;

-- Segundo cenário: capacidade ao vincular/desfazer, replay de undo, trava do aporte, casos recusados.
do $$
declare u uuid:=gen_random_uuid();w uuid:=gen_random_uuid();h1 uuid:=gen_random_uuid();h2 uuid:=gen_random_uuid();
 x uuid:=gen_random_uuid();y uuid:=gen_random_uuid();z uuid:=gen_random_uuid();wk uuid:=gen_random_uuid();card uuid:=gen_random_uuid();
 d0 date:=current_date;r jsonb;r2 jsonb;ru uuid:=gen_random_uuid();t1 uuid;t2 uuid;t3 uuid;mv_alloc uuid;mv_rel uuid;mv_replay uuid;cid uuid;
begin
  perform set_config('role','none',true);
 insert into auth.users(id,email) values(u,'f11b-'||u||'@example.invalid');
 insert into public.profiles(id) values(u) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F11b');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values(x,w,u,'X','checking',1000),(y,w,u,'Y','checking',0),(wk,w,u,'W','checking',1000),(card,w,u,'Cartao','credit_card',0);
 insert into public.accounts(id,workspace_id,user_id,name,type,archived) values(z,w,u,'Z','checking',true);
 insert into public.goals(id,workspace_id,user_id,name,target_cents) values(h1,w,u,'H1',100000),(h2,w,u,'H2',100000);
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source) values(u,w,'transfer',600,x,y,d0,'import') returning id into t1;
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source,status) values(u,w,'transfer',50,x,y,d0+3,'import','pending') returning id into t2;
 insert into public.transactions(user_id,workspace_id,kind,amount_cents,account_id,counterparty_account_id,occurred_at,source) values(u,w,'transfer',70,x,z,d0,'import') returning id into t3;
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
 -- vincular respeita o caixa já separado: Y tem 600 e a outra meta já separou tudo
 perform pg_temp.cmd(jsonb_build_object('op','allocate','goal_id',h2,'account_id',y,'amount_cents','600','occurred_on',d0));
 perform pg_temp.bad(jsonb_build_object('op','link_in','goal_id',h1,'transfer_id',t1),'PT422','SALDO_INSUFICIENTE: livre 0%');
 perform pg_temp.bad(jsonb_build_object('op','link_in','goal_id',h1,'transfer_id',t2),'22023','%ainda não aconteceu%');
 perform pg_temp.bad(jsonb_build_object('op','link_in','goal_id',h1,'transfer_id',t3),'22023','%arquivada%');
 -- desfazer liberação não devolve separação que outra meta já ocupou
 r:=pg_temp.cmd(jsonb_build_object('op','allocate','goal_id',h1,'account_id',wk,'amount_cents','1000','occurred_on',d0));mv_alloc:=(r->>'movement_id')::uuid;
 cid:=(r->>'contribution_id')::uuid;
 r:=pg_temp.cmd(jsonb_build_object('op','release','goal_id',h1,'account_id',wk,'amount_cents','1000','occurred_on',d0));mv_rel:=(r->>'movement_id')::uuid;
 perform pg_temp.cmd(jsonb_build_object('op','allocate','goal_id',h2,'account_id',wk,'amount_cents','1000','occurred_on',d0));
 perform pg_temp.bad(jsonb_build_object('op','undo','movement_id',mv_rel,'expected_revision',1),'PT422','SALDO_INSUFICIENTE%');
 -- sem origem não cria separação órfã (todo o dinheiro de H2 está separado)
 perform pg_temp.bad(jsonb_build_object('op','release','goal_id',h2,'account_id',null,'amount_cents','1','occurred_on',d0),'PT422','Sem origem%');
 -- repetir um desfazer já confirmado devolve o recibo selado
 r:=pg_temp.cmd(jsonb_build_object('op','allocate','goal_id',h1,'account_id',x,'amount_cents','100','occurred_on',d0));mv_replay:=(r->>'movement_id')::uuid;
 r:=pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_replay,'expected_revision',1),ru);
 r2:=pg_temp.cmd(jsonb_build_object('op','undo','movement_id',mv_replay,'expected_revision',1),ru);
 assert r2=r and r->>'movement_id' is null;
 -- recusas de entrada
 perform pg_temp.bad(jsonb_build_object('op','transfer_out','goal_id',h2,'account_id',wk,'to_account_id',x,'amount_cents','1','occurred_on',d0+1),'22023','%hoje ou anterior%');
 perform pg_temp.bad(jsonb_build_object('op','transfer_in','goal_id',h1,'from_account_id',card,'account_id',x,'amount_cents','1','occurred_on',d0),'22023','%Cartão%');
 perform pg_temp.bad(jsonb_build_object('op','allocate','goal_id','nao-e-uuid','account_id',x,'amount_cents','1','occurred_on',d0),'22023','%Meta inválida%');
 perform pg_temp.bad(jsonb_build_object('op','allocate','goal_id',h1,'account_id','x','amount_cents','1','occurred_on',d0),'22023','%Conta inválida%');
 perform pg_temp.bad(jsonb_build_object('op','undo','movement_id','x','expected_revision',1),'22023','%inválida%');
 perform pg_temp.bad(jsonb_build_object('op','undo','movement_id',mv_alloc,'expected_revision','1'),'22023','%Revisão inválida%');
 -- o aporte de uma movimentação não muda nem some por DML direto (nem pelo dono)
 perform set_config('role','none',true);
 begin delete from public.goal_contributions where id=cid;raise exception 'apagou o aporte da movimentação';
 exception when others then assert sqlerrm like '%pertence a uma movimentação%',sqlerrm;end;
 begin update public.goal_contributions set note='x' where id=cid;raise exception 'editou o aporte da movimentação';
 exception when others then assert sqlerrm like '%pertence a uma movimentação%',sqlerrm;end;
 -- apagar a meta continua cascateando, com movimentação dentro
 delete from public.goals where id=h1;
 assert not exists(select 1 from public.goal_money_movements where goal_id=h1);
 assert not exists(select 1 from public.goal_contributions where goal_id=h1);
 assert not exists(select 1 from public.financial_allocations where goal_id=h1);
end $$;
rollback;
