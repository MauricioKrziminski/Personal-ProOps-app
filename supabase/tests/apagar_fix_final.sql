-- Apagar com alcance, revisão final (07/10/2026): espaço do pai, fatura x apagar usuário, "futuras" com paga depois.
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, instance_id, aud, role, phone, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-0000000db001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999993001', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000db002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999993002', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000db003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999993003', '{}', '{}');

do $$
declare
  a constant uuid := '00000000-0000-0000-0000-0000000db001';
  b constant uuid := '00000000-0000-0000-0000-0000000db002';
  c constant uuid := '00000000-0000-0000-0000-0000000db003';
  ws_a uuid; ws_b uuid; ws_c uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  conta_a uuid; conta_b uuid; cartao uuid; fatura uuid;
  serie_b uuid; tb uuid; ta uuid; serie_a uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid;
  rem_b uuid; filho uuid; r jsonb; ok boolean; alc text; apl boolean;
begin
  select id into ws_a from public.workspaces where owner_id = a;
  select id into ws_b from public.workspaces where owner_id = b;
  select id into ws_c from public.workspaces where owner_id = c;
  insert into public.accounts (workspace_id, user_id, name, type) values (ws_a, a, 'Conta A', 'checking') returning id into conta_a;
  insert into public.accounts (workspace_id, user_id, name, type) values (ws_b, b, 'Conta B', 'checking') returning id into conta_b;

  -- C1: transação de A aponta para a série de B
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
  values (ws_b, b, 'expense', 10000, 'Série B', 'FREQ=MONTHLY', now(), now() + interval '20 days', conta_b) returning id into serie_b;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws_b, b, 'expense', 10000, 'Série B', hoje + 20, 'pending', conta_b, serie_b) returning id into tb;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws_a, a, 'expense', 10000, 'Forjada A', hoje + 1, 'pending', conta_a, null) returning id into ta;
  -- defesa em profundidade: o gatilho zy_inherit_payment_method já barra o vínculo forjado; sem ele o apagar também recusa
  set local session_replication_role = replica;
  update public.transactions set recurring_id = serie_b where id = ta;
  set local session_replication_role = origin;
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach alc in array array['all', 'future'] loop
    foreach apl in array array[false, true] loop
      ok := false;
      begin
        if apl then perform public.delete_scoped('occurrence', ta, alc, gen_random_uuid());
        else perform public.delete_scoped_preview('occurrence', ta, alc); end if;
      exception when others then
        assert sqlstate = 'P0001' and sqlerrm = 'Recorrência não encontrada', format('C1 %s %s: %s %s', alc, apl, sqlstate, sqlerrm);
        ok := true;
      end;
      assert ok, format('C1 %s %s devia recusar', alc, apl);
    end loop;
  end loop;
  reset role;
  assert exists (select 1 from public.recurring_transactions where id = serie_b and end_date is null), 'C1: série de B intacta';
  assert exists (select 1 from public.transactions where id = tb), 'C1: linha de B intacta';
  assert exists (select 1 from public.transactions where id = ta), 'C1: linha de A intacta';

  -- C1b: filho de A aponta para o lembrete de B
  insert into public.reminders (user_id, workspace_id, title, recurrence, next_run_at, timezone, channel, active, source)
  values (b, ws_b, 'Lembrete B', 'FREQ=DAILY', now() + interval '1 hour', 'America/Sao_Paulo', 'push', true, 'app') returning id into rem_b;
  insert into public.reminders (user_id, workspace_id, title, next_run_at, timezone, channel, active, source, parent_reminder_id, original_run_at)
  select a, ws_a, 'Filho forjado', next_run_at + interval '5 minutes', 'America/Sao_Paulo', 'push', true, 'app', id, next_run_at
    from public.reminders where id = rem_b returning id into filho;
  set local role authenticated;
  foreach alc in array array['one', 'all'] loop
    ok := false;
    begin
      perform public.delete_scoped('reminder', filho, alc, gen_random_uuid());
    exception when others then
      assert sqlstate = 'P0001', format('C1b %s: %s %s', alc, sqlstate, sqlerrm);
      ok := true;
    end;
    assert ok, format('C1b %s devia recusar', alc);
  end loop;
  reset role;
  assert exists (select 1 from public.reminders where id = rem_b and skip_run_at is null), 'C1b: lembrete de B intacto';

  -- Minor 1: "Esta e as próximas" no meio leva também a paga DEPOIS da âncora; antes dela nada sai
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
  values (ws_a, a, 'expense', 10000, 'Série A', 'FREQ=MONTHLY', ((hoje - 70) + time '09:00') at time zone 'America/Sao_Paulo',
          ((hoje + 20) + time '09:00') at time zone 'America/Sao_Paulo', conta_a) returning id into serie_a;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws_a, a, 'expense', 10000, 'Série A', hoje - 70, 'cleared', conta_a, serie_a) returning id into t1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws_a, a, 'expense', 10000, 'Série A', hoje - 40, 'pending', conta_a, serie_a) returning id into t2;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws_a, a, 'expense', 10000, 'Série A', hoje - 10, 'pending', conta_a, serie_a) returning id into t3;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws_a, a, 'expense', 10000, 'Série A', hoje + 20, 'cleared', conta_a, serie_a) returning id into t4;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws_a, a, 'expense', 10000, 'Série A', hoje + 50, 'pending', conta_a, serie_a) returning id into t5;
  set local role authenticated;
  r := public.delete_scoped_preview('occurrence', t3, 'future');
  assert (r->>'apagadas')::int = 3 and (r->>'pagas_apagadas')::int = 1, format('Minor1 prévia: %s', r);
  r := public.delete_scoped('occurrence', t3, 'future', gen_random_uuid());
  assert (r->>'apagadas')::int = 3 and (r->>'pagas_apagadas')::int = 1, format('Minor1: %s', r);
  reset role;
  assert (select count(*) from public.transactions where recurring_id = serie_a) = 2, 'Minor1: ficam a paga e a atrasada antes';
  assert not exists (select 1 from public.transactions where id in (t3, t4, t5)), 'Minor1: âncora, paga e pendente depois saem';

  -- I1: apagar o USUÁRIO com fatura aberta paga em parte
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
  values (ws_c, c, 'Cartão C', 'credit_card', 3, 10) returning id into cartao;
  insert into public.card_invoices (workspace_id, user_id, account_id, reference_month, closing_date, due_date, paid_cents)
  values (ws_c, c, cartao, date '2031-06-01', hoje - 5, hoje + 2, 5000) returning id into fatura;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, invoice_id)
  values (ws_c, c, 'expense', 6000, 'Compra C1', hoje - 10, 'pending', cartao, fatura),
         (ws_c, c, 'expense', 4000, 'Compra C2', hoje - 9, 'pending', cartao, fatura);
  update public.transactions set invoice_id = fatura where workspace_id = ws_c and account_id = cartao;
  delete from auth.users where id = c;
  assert not exists (select 1 from public.transactions where workspace_id = ws_c), 'I1: apagar o usuário leva as linhas';
end $$;

rollback;
