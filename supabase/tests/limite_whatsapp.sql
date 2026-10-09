-- ===== asserções =====
-- Limites e contagens do WhatsApp (whatsapp_sends, plan_limits, plan_status_for).
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'wa-a@teste.local', '{}', '{}');

do $$
declare ws uuid; u uuid := '00000000-0000-0000-0000-00000000e001'; r record;
begin
  select id into ws from public.workspaces where owner_id = u;

  -- limites por plano (e o teste de 7 dias só rebaixa as respostas, nunca os avisos)
  assert (select (max_whatsapp_replies_month, max_whatsapp_notices_day) = (0, 0) from private.plan_limits('free')), 'free 0/0';
  assert (select (max_whatsapp_replies_month, max_whatsapp_notices_day) = (150, 1) from private.plan_limits('pro')), 'pro 150/1';
  assert (select (max_whatsapp_replies_month, max_whatsapp_notices_day) = (300, 2) from private.plan_limits('family')), 'family 300/2';
  assert (select (max_whatsapp_replies_month, max_whatsapp_notices_day) = (40, 1) from private.plan_limits('pro', true)), 'teste pro 40/1';
  assert (select (max_whatsapp_replies_month, max_whatsapp_notices_day) = (40, 2) from private.plan_limits('family', true)), 'teste family 40/2';
  assert (select max_whatsapp_replies_month from private.plan_limits('free', true)) = 0, 'teste free segue 0';

  -- contagens: sem envio, zero
  select * into r from private.plan_status_for(ws);
  assert r.whatsapp_replies_month = 0 and r.whatsapp_notices_today = 0, 'começa zerado';
  assert r.max_whatsapp_replies_month = 0 and r.max_whatsapp_notices_day = 0, 'sem assinatura 0/0';

  update public.subscriptions set plan = 'pro', status = 'active', provider = 'google' where workspace_id = ws;

  insert into public.whatsapp_sends (workspace_id, user_id, kind) values
    (ws, u, 'reply'), (ws, u, 'reply'), (ws, u, 'notice'),
    (ws, u, 'reply'), (ws, u, 'notice');
  -- um do mês passado (fora do mês) e um aviso de ontem (fora do dia)
  insert into public.whatsapp_sends (workspace_id, user_id, kind, created_at) values
    (ws, u, 'reply', now() - interval '40 days'),
    (ws, u, 'notice', date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' - interval '1 minute');

  select * into r from private.plan_status_for(ws);
  assert r.whatsapp_replies_month = 3, format('respostas do mês esperado 3, veio %s', r.whatsapp_replies_month);
  assert r.whatsapp_notices_today = 2, format('avisos de hoje esperado 2, veio %s', r.whatsapp_notices_today);
  assert r.max_whatsapp_replies_month = 150 and r.max_whatsapp_notices_day = 1, 'pro 150/1';

  -- outro workspace não conta
  assert (select whatsapp_replies_month from public._plan_status(ws)) = 3, '_plan_status devolve as colunas';

  -- RLS ligada e sem policy: o app não lê nem escreve
  assert (select relrowsecurity from pg_class where oid = 'public.whatsapp_sends'::regclass), 'RLS ligada';
  assert not exists (select 1 from pg_policies where tablename = 'whatsapp_sends'), 'sem policy';

  -- kind inválido
  begin
    insert into public.whatsapp_sends (workspace_id, kind) values (ws, 'otp');
    assert false, 'kind otp deveria violar o check';
  exception when check_violation then null;
  end;
end $$;

rollback;
