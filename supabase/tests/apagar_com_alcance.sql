-- Apagar com alcance (07/10/2026): "Só esta / Esta e as próximas / Todas" numa operação atômica.
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, instance_id, aud, role, phone, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-0000000da001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999992001', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000da002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999992002', '{}', '{}');

do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000da001';
  outro constant uuid := '00000000-0000-0000-0000-0000000da002';
  ws uuid; ws_outro uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  conta uuid; serie uuid; t_pago uuid; t_atrasada uuid; t_ancora uuid; t_depois uuid; t_longe uuid;
  r jsonb; n int; chave uuid := gen_random_uuid(); cfg text[];
begin
  select id into ws from public.workspaces where owner_id = u;
  select id into ws_outro from public.workspaces where owner_id = outro;

  for cfg in select p.proconfig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where s.nspname = 'private' and p.proname = 'delete_scoped' loop
    assert array_to_string(cfg, ',') like '%TimeZone=America/Sao_Paulo%', 'comando sem fuso no cabeçalho';
  end loop;

  insert into public.accounts (workspace_id, user_id, name, type) values (ws, u, 'Conta AA', 'checking') returning id into conta;
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
  values (ws, u, 'expense', 10000, 'Academia AA', 'FREQ=MONTHLY;BYMONTHDAY=5',
          ((hoje - 70) + time '09:00') at time zone 'America/Sao_Paulo',
          ((hoje + 20) + time '09:00') at time zone 'America/Sao_Paulo', conta)
  returning id into serie;
  -- paga há 70 dias, atrasada há 40, ÂNCORA há 10 (atrasada), em aberto daqui a 20 e daqui a 50
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 10000, 'Academia AA', hoje - 70, 'cleared', conta, serie) returning id into t_pago;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 10000, 'Academia AA', hoje - 40, 'pending', conta, serie) returning id into t_atrasada;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 10000, 'Academia AA', hoje - 10, 'pending', conta, serie) returning id into t_ancora;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 10000, 'Academia AA', hoje + 20, 'pending', conta, serie) returning id into t_depois;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 10000, 'Academia AA', hoje + 50, 'pending', conta, serie) returning id into t_longe;

  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1) prévia de "Todas" conta a paga e não apaga nada
  r := public.delete_scoped_preview('occurrence', t_ancora, 'all');
  assert (r->>'apagadas')::int = 5 and (r->>'pagas_apagadas')::int = 1 and r->>'soma_pagas_cents' = '10000',
    format('prévia todas: %s', r);
  assert r->'contas' = '["Conta AA"]'::jsonb and (r->>'desde')::date = hoje - 70, format('contas/desde: %s', r);
  select count(*) into n from public.transactions where recurring_id = serie;
  assert n = 5, 'prévia não apaga';

  -- 2) "Esta e as próximas" a partir da âncora atrasada: âncora, +20 e +50 saem; paga e atrasada ANTES ficam;
  --    a série termina na véspera da âncora
  r := public.delete_scoped('occurrence', t_ancora, 'future', chave);
  assert (r->>'apagadas')::int = 3 and (r->>'pagas_apagadas')::int = 0, format('futuras: %s', r);
  select count(*) into n from public.transactions where recurring_id = serie;
  assert n = 2, format('ficam a paga e a atrasada, veio %s', n);
  assert (select end_date from public.recurring_transactions where id = serie) = hoje - 11, 'fim = véspera da âncora';

  -- 3) mesma chave = mesmo resultado, sem efeito novo; mesma chave com outro pedido = recusa
  r := public.delete_scoped('occurrence', t_ancora, 'future', chave);
  assert (r->>'apagadas')::int = 3, 'repetição devolve o recibo';
  begin
    perform public.delete_scoped('occurrence', t_atrasada, 'one', chave);
    n := -1;
  exception when others then
    assert sqlstate = '22023' and sqlerrm = 'Identificador reutilizado com dados diferentes', format('chave: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'chave reutilizada devia ser recusada';

  -- 4) "Só esta" na atrasada: some e a data não volta (marca do agendador)
  -- O teste é UMA transação: a marca `proops.series_editadas` do passo 2 (o UPDATE de end_date) ainda
  -- valeria aqui e calaria `ocorrencia_apagada_nao_volta`. Na vida real cada chamada é outra transação.
  perform set_config('proops.series_editadas', '', true);
  r := public.delete_scoped('occurrence', t_atrasada, 'one', gen_random_uuid());
  assert (r->>'apagadas')::int = 1, format('só esta: %s', r);
  reset role;
  assert exists (select 1 from private.recurring_moved_occurrences m where m.recurring_id = serie and m.original_date = hoje - 40),
    'a data apagada não pode voltar pelo agendador';
  set local role authenticated;

  -- 5) contrato não tem "só esta"; outro espaço não apaga
  begin
    perform public.delete_scoped_preview('recurring', serie, 'one');
    n := -1;
  exception when others then
    assert sqlstate = '22023', format('contrato one: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'contrato com "só esta" devia ser recusado';
  perform set_config('request.jwt.claim.sub', outro::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', outro, 'role', 'authenticated')::text, true);
  begin
    perform public.delete_scoped_preview('recurring', serie, 'all');
    n := -1;
  exception when others then
    assert sqlstate = 'P0001' and sqlerrm = 'Esse registro não existe mais', format('outro espaço: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'outro espaço devia ser recusado';
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- 6) "Todas" pelo contrato: a série e a paga saem
  r := public.delete_scoped('recurring', serie, 'all', gen_random_uuid());
  assert (r->>'apagadas')::int = 1 and (r->>'pagas_apagadas')::int = 1, format('todas: %s', r);
  reset role;
  assert not exists (select 1 from public.recurring_transactions where id = serie), 'a série sai';
  assert not exists (select 1 from public.transactions where recurring_id = serie or id = t_pago), 'as ocorrências saem';
  set local role authenticated;

  -- 7) "Esta e as próximas" na PRIMEIRA ocorrência = "Todas"
  reset role;
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
  values (ws, u, 'expense', 5000, 'Streaming AA', 'FREQ=MONTHLY;BYMONTHDAY=10',
          ((hoje + 5) + time '09:00') at time zone 'America/Sao_Paulo',
          ((hoje + 5) + time '09:00') at time zone 'America/Sao_Paulo', conta)
  returning id into serie;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 5000, 'Streaming AA', hoje + 5, 'pending', conta, serie) returning id into t_ancora;
  set local role authenticated;
  r := public.delete_scoped('occurrence', t_ancora, 'future', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.recurring_transactions where id = serie), 'a partir da primeira = a série inteira';
  set local role authenticated;

  -- dívida pelo contrato só oferece "todas"
  begin
    perform public.delete_scoped_preview('debt', gen_random_uuid(), 'future');
    n := -1;
  exception when others then
    assert sqlstate = '22023', format('debt future: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'debt + future devia ser recusado';

  -- BLOCOS DAS PRÓXIMAS TAREFAS ENTRAM AQUI
  reset role;
end $$;

rollback;
