
-- ===== asserções =====
-- agent_feedback (ciclo de dados), métricas, unit economics e account_aliases.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'fb-a@teste.local', '{}', '{}'),
       ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'fb-b@teste.local', '{}', '{}');

do $$
declare
  ua uuid := '00000000-0000-0000-0000-00000000f001';
  ub uuid := '00000000-0000-0000-0000-00000000f002';
  wa uuid; wb uuid; acc_a uuid; acc_b uuid; pid uuid; n int; r record;
begin
  select id into wa from public.workspaces where owner_id = ua;
  select id into wb from public.workspaces where owner_id = ub;
  assert wa is not null and wb is not null, 'workspaces não nasceram';

  -- ===== agent_feedback: round-trip, check de desfecho, pending_id único =====
  insert into public.agent_feedback (pending_id, workspace_id, user_id, channel, input_text, proposal,
                                     summary, outcome, prompt_versions, models)
  values (gen_random_uuid(), wa, ua, 'app', 'gastei 45 no mercado',
          '[{"type":"create_expense"}]', 'Registrar R$ 45', 'approved',
          '{"finance":"v1"}', '{"parse":"lite"}'),
         (gen_random_uuid(), wa, ua, 'app', 'gastei 50', '[{"type":"create_expense"}]', 's', 'approved',
          '{"finance":"v1"}', '{}'),
         (gen_random_uuid(), wa, ua, 'whatsapp', 'apaga o café', '[{"type":"delete_transaction"}]', 's',
          'rejected', '{"finance":"v2"}', '{}'),
         (gen_random_uuid(), wa, ua, 'app', 'comprei em 2x', '[{"type":"create_expense"}]', 's',
          'revised', '{"finance":"v2"}', '{}'),
         (gen_random_uuid(), wa, ua, 'app', 'x', '[{"type":"create_expense"}]', 's', 'expired',
          '{"finance":"v2"}', '{}');

  begin
    insert into public.agent_feedback (workspace_id, channel, outcome) values (wa, 'app', 'talvez');
    assert false, 'outcome inválido deveria violar o check';
  exception when check_violation then null;
  end;

  pid := gen_random_uuid();
  insert into public.agent_feedback (pending_id, workspace_id, channel, outcome)
  values (pid, wa, 'app', 'approved');
  begin
    insert into public.agent_feedback (pending_id, workspace_id, channel, outcome)
    values (pid, wa, 'app', 'rejected');
    assert false, 'pending_id repetido deveria violar o unique';
  exception when unique_violation then null;
  end;

  -- ===== agent_quality =====
  -- A métrica é GLOBAL (todos os espaços): na janela de hoje entra o feedback real do staging
  -- (06/10/2026, um E2E fez o total ir de 6 a 8). As linhas do teste vão para um dia só delas.
  update public.agent_feedback set created_at = '2001-01-15 12:00' where workspace_id = wa;
  select * into r from private.agent_quality('2001-01-14', '2001-01-16')
   where dimensao = 'geral';
  assert r.total = 6, format('geral: total esperado 6, veio %s', r.total);
  assert r.aprovadas = 3 and r.corrigidas = 1 and r.recusadas = 1 and r.expiradas = 1,
    'geral: contagem por desfecho';
  assert r.taxa_aprovacao = 0.5, format('taxa de aprovação esperada 0.5, veio %s', r.taxa_aprovacao);

  select * into r from private.agent_quality('2001-01-14', '2001-01-16')
   where dimensao = 'tipo_acao' and chave = 'delete_transaction';
  assert r.total = 1 and r.recusadas = 1, 'por tipo de ação';

  select * into r from private.agent_quality('2001-01-14', '2001-01-16')
   where dimensao = 'versao_prompt' and chave = 'finance=v2';
  assert r.total = 3 and r.corrigidas = 1, format('por versão de prompt: total %s', r.total);

  select count(*) into n from private.agent_quality('2001-02-01', '2001-02-10');
  assert n = 0, 'período sem feedback devolve vazio';

  -- ===== expire_pending_actions grava o feedback `expired` (e só dos que têm `feedback`) =====
  insert into public.user_sessions (phone, thread_id, user_id, workspace_id)
  values ('5551000000099', 'fb_thread', ua, wa) on conflict (phone) do nothing;
  insert into public.pending_actions (session_id, thread_id, phone, user_id, workspace_id, action,
                                      summary, expires_at)
  select s.id, 'fb_thread:0', s.phone, ua, wa,
         '{"candidates":[],"feedback":{"channel":"whatsapp","source_message_id":"m1","input_text":"apaga tudo",
           "proposal":[{"type":"delete_transaction"}],"prompt_versions":{"finance":"v9"},"models":{"parse":"lite"}}}'::jsonb,
         'Apagar X', now() - interval '1 minute'
  from public.user_sessions s where s.phone = '5551000000099';
  select public.expire_pending_actions('fb_thread:0') into n;
  assert n = 1, format('expire_pending_actions devolveu %s, esperado 1', n);
  select * into r from public.agent_feedback where source_message_id = 'm1';
  assert r.outcome = 'expired' and r.channel = 'whatsapp' and r.input_text = 'apaga tudo'
     and r.proposal -> 0 ->> 'type' = 'delete_transaction' and r.prompt_versions ->> 'finance' = 'v9',
    'feedback expired não foi gravado do pendente';
  -- pendente antigo, sem `feedback` na ação: expira normal e não gera linha
  insert into public.pending_actions (session_id, thread_id, phone, user_id, workspace_id, action,
                                      summary, expires_at)
  select s.id, 'fb_thread:0', s.phone, ua, wa, '{}'::jsonb, 'velho', now() - interval '1 minute'
  from public.user_sessions s where s.phone = '5551000000099';
  select public.expire_pending_actions('fb_thread:0') into n;
  assert n = 1, 'pendente sem feedback deve expirar';
  select count(*) into n from public.agent_feedback where summary = 'velho';
  assert n = 0, 'pendente sem feedback não gera linha';

  -- ===== ai_unit_economics =====
  insert into public.ai_events (user_id, workspace_id, channel, model, estimated_cost_usd, kind)
  values (ua, wa, 'app', 'm', 0.002, 'turn'),
         (ua, wa, 'app', 'm', 0.004, 'turn'),
         (ua, wa, 'app', 'm', null, 'turn'),
         (ua, wa, 'app', 'm', 9, 'import'),
         (ub, wb, 'app', 'm', 0.01, 'turn');
  insert into public.ai_events (user_id, workspace_id, channel, model, estimated_cost_usd, kind, reserved)
  values (ua, wa, 'app', 'm', 7, 'turn', true);
  select * into r from private.ai_unit_economics(current_date) where workspace_id = wa;
  assert r.turnos = 3 and r.turnos_sem_custo = 1, format('turnos %s / sem custo %s', r.turnos, r.turnos_sem_custo);
  assert r.custo_usd = 0.006 and r.custo_medio_turno_usd = 0.003,
    format('custo %s / médio %s', r.custo_usd, r.custo_medio_turno_usd);
  assert r.plano = 'free', format('plano esperado free, veio %s', r.plano);
  select * into r from private.ai_unit_economics(current_date) where workspace_id = wb;
  assert r.turnos = 1 and r.custo_usd = 0.01, 'isolamento por workspace';

  -- ===== account_aliases =====
  insert into public.accounts (user_id, workspace_id, name, type)
  values (ua, wa, 'Nubank Cartão', 'credit_card') returning id into acc_a;
  insert into public.accounts (user_id, workspace_id, name, type)
  values (ub, wb, 'Inter', 'checking') returning id into acc_b;

  insert into public.account_aliases (workspace_id, account_id, alias) values (wa, acc_a, 'roxinho');
  begin
    insert into public.account_aliases (workspace_id, account_id, alias) values (wa, acc_a, 'roxinho');
    assert false, 'alias repetido no workspace deveria violar o unique';
  exception when unique_violation then null;
  end;
  -- o mesmo apelido em OUTRO workspace é outra coisa
  insert into public.account_aliases (workspace_id, account_id, alias) values (wb, acc_b, 'roxinho');
  begin
    insert into public.account_aliases (workspace_id, account_id, alias) values (wa, acc_a, 'Roxinho Maiusculo');
    assert false, 'alias fora da forma normalizada deveria violar o check';
  exception when check_violation then null;
  end;

  -- RLS: o membro lê e apaga os dele, não vê nem apaga os do outro, e não cria
  perform set_config('request.jwt.claim.sub', ua::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.account_aliases;
  assert n = 1, format('membro deveria ver só o apelido do seu workspace, viu %s', n);
  begin
    insert into public.account_aliases (workspace_id, account_id, alias) values (wa, acc_a, 'novo');
    assert false, 'membro não pode criar apelido';
  exception when insufficient_privilege then null;
  end;
  delete from public.account_aliases where workspace_id = wb;
  get diagnostics n = row_count;
  assert n = 0, 'membro apagou apelido de outro workspace';
  delete from public.account_aliases where workspace_id = wa;
  get diagnostics n = row_count;
  assert n = 1, 'membro deveria apagar o próprio apelido';
  reset role;

  -- apagar a conta apaga os apelidos dela
  insert into public.account_aliases (workspace_id, account_id, alias) values (wa, acc_a, 'roxinho');
  delete from public.accounts where id = acc_a;
  select count(*) into n from public.account_aliases where account_id = acc_a;
  assert n = 0, 'apagar a conta não apagou o apelido (on delete cascade)';

  -- as funções de métrica não são do app
  begin
    set local role authenticated;
    perform * from private.agent_quality(current_date, current_date);
    reset role;
    assert false, 'authenticated não pode executar agent_quality';
  exception when insufficient_privilege then reset role;
  end;
end $$;

rollback;
