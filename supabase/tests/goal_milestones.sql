-- F19: marcos e aparência das metas (RLS por espaço, unique, cascade, alvo).
--   cat supabase/migrations/20261005170000_goal_milestones.sql supabase/tests/goal_milestones.sql \
--     > $TMPDIR/f19.sql && agent/.venv/bin/python scripts/sql-test.py $TMPDIR/f19.sql
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid:=gen_random_uuid();o uuid:=gen_random_uuid();w uuid:=gen_random_uuid();ow uuid:=gen_random_uuid();
 g uuid:=gen_random_uuid();og uuid:=gen_random_uuid();m uuid;
begin
 insert into auth.users(id,email) values(u,'f19-'||u||'@example.invalid'),(o,'f19-'||o||'@example.invalid');
 insert into public.profiles(id) values(u),(o) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F19'),(ow,o,'F19 outro');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(ow,o,'owner');
 insert into public.goals(id,workspace_id,user_id,name,target_cents) values(g,w,u,'Meta',100000),(og,ow,o,'Alheia',100000);

 -- aparência: cor fora da paleta é recusada
 update public.goals set icon='airplane',color='oceano' where id=g;
 begin update public.goals set color='roxo' where id=g;raise exception 'cor fora da paleta aceita';
 exception when check_violation then null;end;

 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
 assert not has_table_privilege('anon','public.goal_milestones','select');
 -- o espaço vem da meta, mesmo que o chamador mande outro
 insert into public.goal_milestones(workspace_id,goal_id,amount_cents) values(ow,g,25000) returning id into m;
 assert (select workspace_id from public.goal_milestones where id=m)=w,'espaço não veio da meta';
 insert into public.goal_milestones(goal_id,amount_cents) values(g,50000),(g,75000);
 -- unique (goal_id, amount_cents)
 begin insert into public.goal_milestones(goal_id,amount_cents) values(g,50000);raise exception 'marco duplicado aceito';
 exception when unique_violation then null;end;
 -- 100% é o alvo, nunca marco; zero também não
 begin insert into public.goal_milestones(goal_id,amount_cents) values(g,100000);raise exception 'marco no alvo aceito';
 exception when check_violation then null;end;
 begin insert into public.goal_milestones(goal_id,amount_cents) values(g,0);raise exception 'marco zero aceito';
 exception when check_violation then null;end;
 -- RLS: meta de outro espaço não recebe marco
 begin insert into public.goal_milestones(goal_id,amount_cents) values(og,100);raise exception 'marco em meta alheia aceito';
 exception when others then assert sqlstate in('23503','42501'),'inesperado: '||sqlerrm;end;
 assert (select count(*) from public.goal_milestones)=3;
 -- sem UPDATE para o app
 begin update public.goal_milestones set amount_cents=1 where id=m;raise exception 'update aceito';
 exception when insufficient_privilege then null;end;
 delete from public.goal_milestones where id=m;
 assert (select count(*) from public.goal_milestones)=2;

 -- outro usuário não enxerga nem apaga
 perform set_config('role','none',true);
 perform set_config('request.jwt.claim.sub',o::text,true);perform set_config('role','authenticated',true);
 assert (select count(*) from public.goal_milestones)=0,'RLS vazou marcos';
 delete from public.goal_milestones where goal_id=g;
 perform set_config('role','none',true);
 assert (select count(*) from public.goal_milestones where goal_id=g)=2,'outro espaço apagou marcos';

 -- baixar o alvo abaixo dos marcos NÃO apaga nem recusa: eles ficam guardados (o app os esconde)
 update public.goals set target_cents=1 where id=g;
 assert (select count(*) from public.goal_milestones where goal_id=g)=2,'baixar o alvo mexeu nos marcos';

 -- cascade: apagar a meta leva os marcos
 delete from public.goals where id=g;
 assert (select count(*) from public.goal_milestones where goal_id=g)=0,'cascade falhou';
 raise notice 'goal_milestones ok';
end $$;
rollback;
