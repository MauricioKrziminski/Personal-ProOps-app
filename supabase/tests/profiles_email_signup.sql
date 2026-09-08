-- Cadastro por e-mail (0051): dois usuários sem telefone não colidem, e nome vazio vira NULL.
-- Rodar contra o Postgres LOCAL (npx supabase start && npx supabase db reset):
--   psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f supabase/tests/profiles_email_signup.sql
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'a@teste.local', '{"display_name": "Ana Teste"}', '{}'),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'b@teste.local', '{"display_name": "   "}', '{}'),
  ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'c@teste.local', '{}', '{}');

-- O caminho antigo continua: quem entra POR TELEFONE com convite pendente aceita o convite.
insert into public.workspace_invites (workspace_id, phone, role, invited_by)
select w.id, '+5511999990000', 'member', w.owner_id
from public.workspaces w where w.owner_id = '00000000-0000-0000-0000-00000000a001';

insert into auth.users (id, instance_id, aud, role, phone, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', '+5511999990000', '{}', '{}');

do $$
declare n int; nome text;
begin
  -- os três entraram: nenhum 23505 no unique(phone) — era o bug da 0029
  select count(*) into n from public.profiles where id::text like '00000000-0000-0000-0000-00000000a00%';
  assert n = 4, format('esperava 4 profiles (3 por e-mail + 1 por telefone), veio %s', n);

  select count(*) into n from public.profiles
   where id::text like '00000000-0000-0000-0000-00000000a00%' and phone is null;
  assert n = 3, 'phone tinha que ser NULL nos três de e-mail';

  select display_name into nome from public.profiles where id = '00000000-0000-0000-0000-00000000a001';
  assert nome = 'Ana Teste', format('display_name esperado "Ana Teste", veio %L', nome);

  select display_name into nome from public.profiles where id = '00000000-0000-0000-0000-00000000a002';
  assert nome is null, format('display_name em branco tinha que virar NULL, veio %L', nome);

  select display_name into nome from public.profiles where id = '00000000-0000-0000-0000-00000000a003';
  assert nome is null, 'sem metadata: display_name NULL';

  -- cada um ganhou workspace, membership de owner e assinatura (o resto da 0029 continua)
  select count(*) into n from public.workspace_members wm
   where wm.user_id::text like '00000000-0000-0000-0000-00000000a00%' and wm.role = 'owner';
  assert n = 4, 'cada usuário precisa ser owner do próprio workspace';

  -- o usuário de telefone entrou no workspace da Ana pelo convite (regressão da 0029)
  select count(*) into n from public.workspace_members wm
   join public.workspaces w on w.id = wm.workspace_id
   where wm.user_id = '00000000-0000-0000-0000-00000000a004'
     and w.owner_id = '00000000-0000-0000-0000-00000000a001' and wm.role = 'member';
  assert n = 1, 'convite pendente por telefone tinha que ser aceito no signup';
  select count(*) into n from public.workspace_invites
   where phone = '+5511999990000' and status = 'accepted';
  assert n = 1, 'convite tinha que virar accepted';

  -- a trava contra '' vale também para escrita direta (app, agente, importação)
  begin
    update public.profiles set display_name = '' where id = '00000000-0000-0000-0000-00000000a001';
    raise exception 'display_name vazio deveria ter sido recusado';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set display_name = repeat('x', 81) where id = '00000000-0000-0000-0000-00000000a001';
    raise exception 'display_name com 81 caracteres deveria ter sido recusado';
  exception when check_violation then null;
  end;

  raise notice 'profiles_email_signup: OK';
end $$;

rollback;
