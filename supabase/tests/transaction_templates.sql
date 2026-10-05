-- F22: RLS entre usuários/espaços e unicidade do nome entre não arquivados. Sempre rollback.
\set ON_ERROR_STOP on
begin;
do $$
declare
 u uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); fw uuid:=gen_random_uuid();
 t uuid; n int;
begin
 insert into auth.users(id,email) values(u,'f22-'||u||'@example.invalid'),(o,'f22-'||o||'@example.invalid');
 insert into public.profiles(id) values(u),(o) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F22 a'),(fw,o,'F22 b');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(fw,o,'owner');
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('role','authenticated',true);
 insert into public.transaction_templates(workspace_id,user_id,name,fields) values(w,u,'Café','{"kind":"expense"}') returning id into t;
 -- nome repetido (sem caixa/espaços) entre não arquivados é recusado
 begin insert into public.transaction_templates(workspace_id,user_id,name,fields) values(w,u,' café ','{}');
  raise exception 'duplicate accepted'; exception when unique_violation then null; end;
 -- arquivado libera o nome; desarquivar com nome em uso volta a recusar
 update public.transaction_templates set archived=true where id=t;
 insert into public.transaction_templates(workspace_id,user_id,name,fields) values(w,u,'café','{}');
 begin update public.transaction_templates set archived=false where id=t;
  raise exception 'unarchive collision accepted'; exception when unique_violation then null; end;
 -- fields precisa ser objeto; nome vazio recusado
 begin insert into public.transaction_templates(workspace_id,user_id,name,fields) values(w,u,'x','[]');
  raise exception 'array accepted'; exception when check_violation then null; end;
 begin insert into public.transaction_templates(workspace_id,user_id,name,fields) values(w,u,'  ','{}');
  raise exception 'blank accepted'; exception when check_violation then null; end;
 -- escrever em espaço alheio é recusado
 begin insert into public.transaction_templates(workspace_id,user_id,name,fields) values(fw,u,'y','{}');
  raise exception 'foreign write accepted'; exception when insufficient_privilege then null; end;
 -- o outro usuário não vê nada do espaço w e não altera
 perform set_config('request.jwt.claim.sub',o::text,true);
 select count(*) into n from public.transaction_templates; assert n=0,'outsider reads';
 update public.transaction_templates set name='hack'; get diagnostics n=row_count; assert n=0,'outsider updates';
 delete from public.transaction_templates; get diagnostics n=row_count; assert n=0,'outsider deletes';
 -- dono apaga o que é dele; lançamento nenhum está envolvido
 perform set_config('request.jwt.claim.sub',u::text,true);
 delete from public.transaction_templates where workspace_id=w; get diagnostics n=row_count; assert n=2,'owner delete';
 -- anon não enxerga a tabela
 perform set_config('role','anon',true);
 begin perform 1 from public.transaction_templates; raise exception 'anon read'; exception when insufficient_privilege then null; end;
end $$;
rollback;
