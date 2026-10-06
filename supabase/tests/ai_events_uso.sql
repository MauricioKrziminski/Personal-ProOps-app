
-- ===== asserções =====
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'uso-a@teste.local', '{}', '{}');

do $$
declare ws uuid; u uuid := '00000000-0000-0000-0000-00000000d001'; n int; rid uuid;
        lim int; r record;
begin
  select id into ws from public.workspaces where owner_id = u;
  assert ws is not null, 'workspace do usuário não nasceu';

  -- colunas novas: turno medido round-trip
  insert into public.ai_events (user_id, workspace_id, channel, model, input_tokens, output_tokens,
                                cached_tokens, reasoning_tokens, estimated_cost_usd, calls)
  values (u, ws, 'app', 'm', 100, 20, 10, 5, 0.000123,
          '[{"papel":"parse","modelo":"gemini-3.1-flash-lite","input_tokens":100}]'::jsonb);
  select * into r from public.ai_events where workspace_id = ws and model = 'm';
  assert r.kind = 'turn' and r.reserved = false, 'defaults de kind/reserved';
  assert r.estimated_cost_usd = 0.000123 and r.cached_tokens = 10 and r.reasoning_tokens = 5;
  assert r.calls -> 0 ->> 'papel' = 'parse', 'jsonb não voltou';

  -- kind inválido viola o check
  begin
    insert into public.ai_events (user_id, workspace_id, channel, model, kind)
    values (u, ws, 'app', 'x', 'foo');
    assert false, 'kind foo deveria violar o check';
  exception when check_violation then null;
  end;

  -- plan_status: conta o turno medido (1); import/transcription NÃO contam; reserva conta
  insert into public.ai_events (user_id, workspace_id, channel, model, kind)
  values (u, ws, 'app', 'i', 'import'), (u, ws, 'app', 't', 'transcription');
  select ai_messages_month into n from private.plan_status_for(ws);
  assert n = 1, format('import/transcription não contam: esperado 1, veio %s', n);

  insert into public.ai_events (user_id, workspace_id, channel, model, kind, reserved, result)
  values (u, ws, 'app', 'reserva', 'turn', true, '{}'::jsonb) returning id into rid;
  select ai_messages_month into n from private.plan_status_for(ws);
  assert n = 2, format('a reserva tem que contar: esperado 2, veio %s', n);

  -- as MESMAS consultas do agente (db.reservar_cota / record_ai_event / liberar_reserva)
  perform pg_advisory_xact_lock(hashtextextended(ws::text, 0));
  delete from public.ai_events
   where workspace_id = ws and reserved and created_at < now() - make_interval(mins => 6);
  assert exists (select 1 from public.ai_events where id = rid), 'reserva recente não pode sumir';

  select count(*)::int into n from public.ai_events
   where user_id = u and created_at >= now() - interval '1 hour';
  assert n = 4, format('contagem por hora esperada 4, veio %s', n);

  select min(l.max_ai_messages_month)::int into lim
    from unnest(array['free', 'pro', 'family']) as p(plano),
         lateral private.plan_limits(p.plano) as l;
  assert lim = 15, format('limite mais restrito esperado 15, veio %s', lim);

  -- reserva vencida sai no passo de limpeza
  update public.ai_events set created_at = now() - interval '7 minutes' where id = rid;
  delete from public.ai_events
   where workspace_id = ws and reserved and created_at < now() - make_interval(mins => 6);
  assert not exists (select 1 from public.ai_events where id = rid), 'reserva vencida deveria sair';

  -- completar/soltar a reserva comparando o id como TEXTO (o agente manda str, não uuid)
  insert into public.ai_events (user_id, workspace_id, channel, model, kind, reserved, result)
  values (u, ws, 'app', 'reserva', 'turn', true, '{}'::jsonb) returning id into rid;
  update public.ai_events set model = 'm2', reserved = false, input_tokens = 7
   where id = rid::text::uuid and reserved;
  assert (select reserved from public.ai_events where id = rid) = false;
  delete from public.ai_events where id = rid and reserved;
  assert exists (select 1 from public.ai_events where id = rid),
    'liberar não pode apagar a linha já completa';
end $$;

rollback;
