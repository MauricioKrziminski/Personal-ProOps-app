-- Fase 8: preferências independentes e dedupe por canal.
-- Executar após as migrations, dentro de uma transação descartável.

begin;

do $$
declare
  push_default text;
  whatsapp_default text;
begin
  select column_default into push_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name = 'alerts_push_enabled';

  select column_default into whatsapp_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name = 'alerts_whatsapp_enabled';

  if push_default is distinct from 'false' then
    raise exception 'alerts_push_enabled precisa iniciar false, veio %', push_default;
  end if;
  if whatsapp_default is distinct from 'false' then
    raise exception 'alerts_whatsapp_enabled precisa iniciar false, veio %', whatsapp_default;
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = '_alerts_to_send'
      and p.proargnames @> array['alerts_push_enabled', 'alerts_whatsapp_enabled']
  ) then
    raise exception '_alerts_to_send não devolve as duas preferências';
  end if;
end;
$$;

insert into auth.users (
  id, instance_id, aud, role, phone, raw_user_meta_data, raw_app_meta_data
)
values (
  '00000000-0000-0000-0000-00000000a008',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '+5511999990008',
  '{}',
  '{}'
);

update public.profiles
set expo_push_token = 'ExponentPushToken[phase8]'
where id = '00000000-0000-0000-0000-00000000a008';

update public.subscriptions s
set status = 'trialing', is_trial = true, current_period_end = current_date + 2
from public.workspaces w
where w.id = s.workspace_id
  and w.owner_id = '00000000-0000-0000-0000-00000000a008';

do $$
declare
  test_user constant uuid := '00000000-0000-0000-0000-00000000a008';
  found int;
  push_flag boolean;
  whatsapp_flag boolean;
begin
  -- Default: os dois desligados e nenhum candidato, mesmo com telefone e token.
  select count(*) into found
  from public._alerts_to_send() a
  where a.user_id = test_user and a.kind = 'trial_ending';
  assert found = 0, 'nenhum canal deveria produzir candidato';

  update public.profiles set alerts_push_enabled = true where id = test_user;
  select count(*), bool_and(a.alerts_push_enabled), bool_and(a.alerts_whatsapp_enabled)
    into found, push_flag, whatsapp_flag
  from public._alerts_to_send() a
  where a.user_id = test_user and a.kind = 'trial_ending';
  assert found = 1 and push_flag and not whatsapp_flag,
    'somente push deveria produzir um candidato com flags corretas';

  update public.profiles
  set alerts_push_enabled = false, alerts_whatsapp_enabled = true
  where id = test_user;
  select count(*), bool_and(a.alerts_push_enabled), bool_and(a.alerts_whatsapp_enabled)
    into found, push_flag, whatsapp_flag
  from public._alerts_to_send() a
  where a.user_id = test_user and a.kind = 'trial_ending';
  assert found = 1 and not push_flag and whatsapp_flag,
    'somente WhatsApp deveria produzir um candidato com flags corretas';

  update public.profiles
  set alerts_push_enabled = true, alerts_whatsapp_enabled = true
  where id = test_user;
  select count(*), bool_and(a.alerts_push_enabled), bool_and(a.alerts_whatsapp_enabled)
    into found, push_flag, whatsapp_flag
  from public._alerts_to_send() a
  where a.user_id = test_user and a.kind = 'trial_ending';
  assert found = 1 and push_flag and whatsapp_flag,
    'ambos deveriam produzir um único alerta lógico para duas entregas';

  -- Preferência sem capacidade não autoriza fallback nem cria trabalho inútil.
  update public.profiles
  set expo_push_token = null, alerts_whatsapp_enabled = false
  where id = test_user;
  select count(*) into found
  from public._alerts_to_send() a
  where a.user_id = test_user and a.kind = 'trial_ending';
  assert found = 0, 'push sem token não deveria produzir candidato';

  update public.profiles
  set alerts_push_enabled = false, alerts_whatsapp_enabled = true, phone = null
  where id = test_user;
  select count(*) into found
  from public._alerts_to_send() a
  where a.user_id = test_user and a.kind = 'trial_ending';
  assert found = 0, 'WhatsApp sem telefone não deveria produzir candidato';
end;
$$;

-- A constraint nova precisa incluir channel; a antiga, sem channel, não pode sobreviver.
do $$
declare
  test_user constant uuid := '00000000-0000-0000-0000-00000000a008';
  test_workspace uuid;
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'alerts_sent'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) like '%workspace_id, kind, ref, sent_on, channel%'
  ) then
    raise exception 'dedupe de alerts_sent precisa incluir channel';
  end if;

  select id into test_workspace from public.workspaces where owner_id = test_user;
  insert into public.alerts_sent (workspace_id, user_id, kind, ref, channel)
  values
    (test_workspace, test_user, 'trial_ending', 'phase-8', 'push'),
    (test_workspace, test_user, 'trial_ending', 'phase-8', 'whatsapp');

  begin
    insert into public.alerts_sent (workspace_id, user_id, kind, ref, channel)
    values (test_workspace, test_user, 'trial_ending', 'phase-8', 'push');
    raise exception 'o mesmo canal deveria ter sido deduplicado';
  exception when unique_violation then null;
  end;

  begin
    insert into public.alerts_sent (workspace_id, user_id, kind, ref)
    values (test_workspace, test_user, 'trial_ending', 'sem-canal');
    raise exception 'uma reserva sem canal deveria ter sido recusada';
  exception when not_null_violation then null;
  end;
end;
$$;

rollback;
