-- agent_activity e spendable_path (20260918120000).
-- Rodar contra o STAGING numa transação descartável (ver o runner na Task 13 do plano).
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'conversa-a@teste.local', '{}', '{}'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'conversa-b@teste.local', '{}', '{}');

-- B participa do workspace de A: é o caso em que o texto de um NÃO pode aparecer para o outro.
insert into public.workspace_members (workspace_id, user_id, role)
select w.id, '00000000-0000-0000-0000-00000000e002', 'member'
from public.workspaces w where w.owner_id = '00000000-0000-0000-0000-00000000e001';

do $$
declare
  ws uuid;
  tx uuid;
begin
  select id into ws from public.workspaces where owner_id = '00000000-0000-0000-0000-00000000e001';

  insert into public.transactions (workspace_id, user_id, kind, amount_cents, occurred_at, category, description, source)
  values (ws, '00000000-0000-0000-0000-00000000e001', 'expense', 4500, current_date, 'mercado', 'Mercado', 'app')
  returning id into tx;

  -- A falou pelo app e criou o gasto.
  insert into public.executed_actions (source_message_id, action_index, action_type, result_id, user_id, workspace_id, origin_text)
  values ('app:11111111-1111-1111-1111-111111111111', 0, 'create_expense', tx,
          '00000000-0000-0000-0000-00000000e001', ws, 'gastei 45 no mercado');

  -- A criou uma nota que depois foi apagada: o registro volta nulo.
  insert into public.executed_actions (source_message_id, action_index, action_type, result_id, user_id, workspace_id, origin_text, executed_at)
  values ('app:22222222-2222-2222-2222-222222222222', 0, 'create_note', gen_random_uuid(),
          '00000000-0000-0000-0000-00000000e001', ws, 'anota a senha do wifi', now() - interval '1 hour');

  -- A mandou um lote pelo WhatsApp, com um áudio no meio.
  insert into public.messages_queue (wa_message_id, thread_id, phone, message_type, payload, batch_id, status)
  values
    ('wamid.teste-1', 'thread-teste-e001', '5511900000001', 'text', '{"text":{"body":"gastei 10"}}', '00000000-0000-0000-0000-0000000000b1', 'done'),
    ('wamid.teste-2', 'thread-teste-e001', '5511900000001', 'audio', '{"audio":{"id":"x"}}', '00000000-0000-0000-0000-0000000000b1', 'done');
  insert into public.executed_actions (source_message_id, action_index, action_type, result_id, user_id, workspace_id, origin_text, executed_at)
  values ('wamid.teste-2', 0, 'create_expense', tx,
          '00000000-0000-0000-0000-00000000e001', ws, E'gastei 10\nno pão', now() - interval '2 hours');

  -- B falou no MESMO workspace. A não pode ler isto.
  insert into public.executed_actions (source_message_id, action_index, action_type, result_id, user_id, workspace_id, origin_text)
  values ('app:33333333-3333-3333-3333-333333333333', 0, 'create_expense', tx,
          '00000000-0000-0000-0000-00000000e002', ws, 'segredo do B');
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e001', true);
set local role authenticated;

do $$
declare
  linhas int;
  r record;
begin
  select count(*) into linhas from public.agent_activity(10);
  assert linhas = 3, format('A deveria ver 3 ações, viu %s', linhas);

  assert not exists (select 1 from public.agent_activity(10) where origin_text = 'segredo do B'),
    'o texto de B vazou para A';

  select * into r from public.agent_activity(10) where source_message_id like 'app:1111%';
  assert r.channel = 'app', 'canal do app';
  assert r.record->>'kind' = 'transaction', format('registro deveria ser transaction, veio %s', r.record);
  assert (r.record->>'amount_cents')::int = 4500, 'valor do registro';

  select * into r from public.agent_activity(10) where source_message_id like 'app:2222%';
  assert r.record is null, 'nota apagada deveria vir sem registro';

  select * into r from public.agent_activity(10) where source_message_id = 'wamid.teste-2';
  assert r.channel = 'whatsapp', 'canal do WhatsApp';
  assert r.input_kind = 'audio', format('lote com áudio deveria ser audio, veio %s', r.input_kind);

  -- p_limit conta FALAS, não linhas.
  select count(distinct source_message_id) into linhas from public.agent_activity(1);
  assert linhas = 1, format('p_limit 1 deveria trazer 1 fala, trouxe %s', linhas);

  raise notice 'ok: agent_activity isola por pessoa, resume o registro e agrupa o lote';
end $$;

-- A Pista soma exatamente o comprometido do herói.
do $$
declare
  s record;
  soma bigint;
begin
  select * into s from public.spendable();
  select coalesce(sum(out_cents), 0) into soma from public.spendable_path();
  assert soma = s.comprometido_ate_entrada,
    format('spendable_path soma %s e comprometido_ate_entrada é %s', soma, s.comprometido_ate_entrada);
  raise notice 'ok: spendable_path fecha com o livre';
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
begin
  begin
    perform public.agent_activity(1);
    raise exception 'anon executou agent_activity';
  exception when insufficient_privilege then
    raise notice 'ok: anon sem execute';
  end;
end $$;

rollback;
