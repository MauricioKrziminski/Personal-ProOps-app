-- Fase 6: uma cota por workspace, com consumo observável por canal.
-- Executar contra o Postgres LOCAL, sempre dentro desta transação descartável.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'canal-a@teste.local', '{}', '{}'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'canal-b@teste.local', '{}', '{}');

-- B participa do workspace de A, mas também conserva o workspace próprio criado no signup.
-- É o caso que dupla-contava quando ai_events só dizia quem usou, sem dizer onde usou.
insert into public.workspace_members (workspace_id, user_id, role)
select w.id, '00000000-0000-0000-0000-00000000c002', 'member'
from public.workspaces w
where w.owner_id = '00000000-0000-0000-0000-00000000c001';

insert into public.ai_events (user_id, workspace_id, channel, model)
select '00000000-0000-0000-0000-00000000c001', w.id, 'whatsapp', 'teste'
from public.workspaces w where w.owner_id = '00000000-0000-0000-0000-00000000c001';

insert into public.ai_events (user_id, workspace_id, channel, model)
select '00000000-0000-0000-0000-00000000c002', w.id, 'app', 'teste'
from public.workspaces w where w.owner_id = '00000000-0000-0000-0000-00000000c001';

-- Uso de B no espaço próprio não pertence à cota de A, apesar de ser o mesmo user_id.
insert into public.ai_events (user_id, workspace_id, channel, model)
select '00000000-0000-0000-0000-00000000c002', w.id, 'whatsapp', 'teste'
from public.workspaces w where w.owner_id = '00000000-0000-0000-0000-00000000c002';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c001', true);
set local role authenticated;

do $$
declare total int; pelo_whatsapp int; pelo_app int;
begin
  select ai_messages_month, ai_messages_whatsapp, ai_messages_app
    into total, pelo_whatsapp, pelo_app
  from public.plan_status();

  assert total = 2, format('workspace A deveria ter 2 mensagens, veio %s', total);
  assert pelo_whatsapp = 1, format('WhatsApp no workspace A deveria ser 1, veio %s', pelo_whatsapp);
  assert pelo_app = 1, format('app no workspace A deveria ser 1, veio %s', pelo_app);
end $$;

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c002', true);
set local role authenticated;

do $$
declare total int; pelo_whatsapp int; pelo_app int;
begin
  select ai_messages_month, ai_messages_whatsapp, ai_messages_app
    into total, pelo_whatsapp, pelo_app
  from public.plan_status();

  assert total = 1, format('workspace próprio de B deveria ter 1 mensagem, veio %s', total);
  assert pelo_whatsapp = 1 and pelo_app = 0,
    format('divisão do workspace B veio WhatsApp=%s app=%s', pelo_whatsapp, pelo_app);
end $$;

reset role;

do $$
declare workspace_a uuid;
begin
  select id into workspace_a from public.workspaces
  where owner_id = '00000000-0000-0000-0000-00000000c001';

  begin
    insert into public.ai_events (user_id, workspace_id, model)
    values ('00000000-0000-0000-0000-00000000c001', workspace_a, 'sem-canal');
    raise exception 'evento sem canal deveria ter sido recusado';
  exception when not_null_violation then null;
  end;

  begin
    insert into public.ai_events (user_id, workspace_id, channel, model)
    values ('00000000-0000-0000-0000-00000000c001', workspace_a, 'email', 'canal-invalido');
    raise exception 'canal fora de whatsapp/app deveria ter sido recusado';
  exception when check_violation then null;
  end;

  begin
    insert into public.ai_events (user_id, channel, model)
    values ('00000000-0000-0000-0000-00000000c001', 'app', 'sem-workspace');
    raise exception 'evento de usuário sem workspace deveria ter sido recusado';
  exception when check_violation or not_null_violation then null;
  end;

  assert has_function_privilege('authenticated', 'public.plan_status()', 'execute');
  assert not has_function_privilege('authenticated', 'public._plan_status(uuid)', 'execute');
  assert not has_function_privilege('authenticated', 'private.plan_status_for(uuid)', 'execute');
  assert has_function_privilege('service_role', 'public._plan_status(uuid)', 'execute');
end $$;

rollback;
\echo '✓ consumo de IA separado por workspace e canal'
