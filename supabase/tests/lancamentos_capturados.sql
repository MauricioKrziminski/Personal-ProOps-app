-- Lançamentos capturados das notificações: o membro LÊ e muda só status/texto; não insere, não apaga,
-- não vê o de outro espaço; anon não vê nada; ai_events aceita kind 'capture'.
--
--     agent/.venv/bin/python scripts/sql-test.py supabase/tests/lancamentos_capturados.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000ca001';
  w uuid := '00000000-0000-0000-0000-0000000ca002';
  outro uuid := '00000000-0000-0000-0000-0000000ca003';
  w2 uuid := '00000000-0000-0000-0000-0000000ca004';
  c uuid; c2 uuid; n int;
begin
  insert into auth.users(id,email) values (u,'captura@example.invalid'), (outro,'captura2@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values (u), (outro) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Captura'), (w2,outro,'Outro');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner'), (w2,outro,'owner');

  -- o agente (postgres) insere
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,entendido,kind,amount_cents,occurred_at)
  values (w,u,'ext-00000001','Nubank',now(),'Compra de R$ 45,90 aprovada em MERCADO','pending',
          '{"tipo":"uma","params":{"kind":"expense","amount":"4590"},"perguntas":[],"entendido":"Gasto de R$ 45,90"}',
          'Gasto de R$ 45,90','expense',4590,current_date)
  returning id into c;
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
  values (w2,outro,'ext-00000002','Itaú',now(),'ignored') returning id into c2;

  -- mesmo external_id no mesmo espaço é recusado
  begin
    insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
    values (w,u,'ext-00000001','Nubank',now(),'ignored');
    raise exception 'external_id repetido passou';
  exception when unique_violation then null;
  end;

  -- pendente sem rascunho é recusado
  begin
    insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
    values (w,u,'ext-00000009','Nubank',now(),'pending');
    raise exception 'pendente sem rascunho passou';
  exception when check_violation then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.captured_notifications;
  if n <> 1 then raise exception 'membro vê % linhas (esperado 1: a do próprio espaço)', n; end if;

  update public.captured_notifications set status = 'confirmed', texto = null where id = c;
  if (select status from public.captured_notifications where id = c) <> 'confirmed' then
    raise exception 'status não mudou';
  end if;

  begin
    update public.captured_notifications set amount_cents = 1 where id = c;
    raise exception 'membro mudou amount_cents';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
    values (w,u,'ext-00000003','Nubank',now(),'ignored');
    raise exception 'membro inseriu';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.captured_notifications where id = c;
    raise exception 'membro apagou';
  exception when insufficient_privilege then null;
  end;

  update public.captured_notifications set status = 'discarded' where id = c2;
  reset role;
  if (select status from public.captured_notifications where id = c2) <> 'ignored' then
    raise exception 'membro mudou linha de outro espaço';
  end if;

  if has_table_privilege('anon', 'public.captured_notifications', 'select') then
    raise exception 'anon lê captured_notifications';
  end if;

  -- ai_events aceita kind capture
  perform 1 from pg_constraint
   where conname = 'ai_events_kind_check' and pg_get_constraintdef(oid) like '%capture%';
  if not found then raise exception 'ai_events_kind_check sem capture'; end if;

  -- gatilho de assinatura e realtime
  perform 1 from pg_trigger where tgname = 'a0_exige_assinatura'
     and tgrelid = 'public.captured_notifications'::regclass;
  if not found then raise exception 'sem a0_exige_assinatura'; end if;
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime'
     and schemaname = 'public' and tablename = 'captured_notifications';
  if not found then raise exception 'fora do realtime'; end if;
end $$;
rollback;
