-- Lembrete de conta (07/10/2026): a intenção é gravada, o disparo é derivado do vencimento ATUAL.
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, instance_id, aud, role, phone, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-0000000b1001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999991001', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000b1002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999991002', '{}', '{}');

update public.profiles set expo_push_token = 'ExponentPushToken[bill]'
where id = '00000000-0000-0000-0000-0000000b1001';

do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000b1001';
  outro constant uuid := '00000000-0000-0000-0000-0000000b1002';
  ws uuid; ws_outro uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  agora time := (now() at time zone 'America/Sao_Paulo')::time;
  conta uuid; cartao uuid; fatura uuid; tx uuid; tx2 uuid; serie uuid; divida uuid; tx_outro uuid; serie2 uuid;
  n int; cfg text[];
begin
  select id into ws from public.workspaces where owner_id = u;
  select id into ws_outro from public.workspaces where owner_id = outro;

  -- as funções novas fixam o fuso no cabeçalho (o bug das 21h)
  for cfg in select p.proconfig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where p.proname in ('bill_reminder_dues', '_bill_reminders_due', 'bill_reminders_overview') loop
    assert array_to_string(cfg, ',') like '%TimeZone=America/Sao_Paulo%', 'função sem fuso no cabeçalho';
  end loop;

  insert into public.accounts (workspace_id, user_id, name, type) values (ws, u, 'Conta BL', 'checking') returning id into conta;

  -- 1) lançamento avulso que vence AMANHÃ, aviso 1 dia antes às 00:00 → toca hoje
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id)
  values (ws, u, 'expense', 150000, 'Aluguel BL', hoje + 1, 'pending', conta) returning id into tx;

  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.save_bill_reminder(jsonb_build_object('transaction_id', tx),
         '[{"days_before":1,"at_time":"00:00"},{"days_before":0,"at_time":"09:00"}]', 'push');
  assert n = 2, 'devia gravar 2 avisos';
  -- salvar de novo SUBSTITUI o conjunto (não duplica)
  n := public.save_bill_reminder(jsonb_build_object('transaction_id', tx),
         '[{"days_before":1,"at_time":"00:00"},{"days_before":0,"at_time":"09:00"}]', 'push');
  select count(*) into n from public.bill_reminders where transaction_id = tx;
  assert n = 2, 'salvar duas vezes não pode duplicar';

  -- alvo de OUTRO espaço é recusado
  reset role;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status)
  values (ws_outro, outro, 'expense', 100, 'Alheio', hoje + 1, 'pending') returning id into tx_outro;
  set local role authenticated;
  begin
    perform public.save_bill_reminder(jsonb_build_object('transaction_id', tx_outro), '[{"days_before":0,"at_time":"09:00"}]', 'push');
    n := -1;
  exception when others then
    assert sqlerrm = 'Esse registro não existe mais' and sqlstate = 'P0001', format('outro espaço: %s / %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'alvo de outro espaço devia ser recusado';
  -- dias fora de 0..30 é recusado pelo check
  begin
    perform public.save_bill_reminder(jsonb_build_object('transaction_id', tx), '[{"days_before":31,"at_time":"09:00"}]', 'push');
    n := -1;
  exception when others then
    assert sqlstate = '23514' and sqlerrm like '%bill_reminders_days_before_check%', format('days_before 31: %s / %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'days_before 31 devia ser recusado';
  -- avisos repetidos em p_avisos colapsam em um
  n := public.save_bill_reminder(jsonb_build_object('transaction_id', tx),
         '[{"days_before":1,"at_time":"00:00"},{"days_before":1,"at_time":"00:00"},{"days_before":0,"at_time":"09:00"}]', 'push');
  assert n = 2, format('duplicados devem colapsar, veio %s', n);
  reset role;

  -- quem recebe é quem criou
  assert (select bool_and(user_id = u) from public.bill_reminders where transaction_id = tx), 'user_id devia ser o autor';

  -- toca hoje o "1 dia antes às 00:00"; o "no dia às 09:00" não (é amanhã)
  select count(*) into n from public._bill_reminders_due() d
  where d.ref = tx and d.due_date = hoje + 1 and d.days_before = 1 and d.target = 'transaction';
  assert n = 1, format('aviso de 1 dia antes devia tocar hoje, veio %s', n);
  select count(*) into n from public._bill_reminders_due() d where d.ref = tx and d.days_before = 0;
  assert n = 0, 'aviso do dia não pode tocar na véspera';

  -- reservado e enviado = não toca de novo
  insert into private.bill_reminder_sends (bill_reminder_id, due_date, sent_at)
  select id, hoje + 1, now() from public.bill_reminders where transaction_id = tx and days_before = 1;
  select count(*) into n from public._bill_reminders_due() d where d.ref = tx;
  assert n = 0, 'enviado não pode tocar de novo';

  -- vencimento que MUDA gera chave nova: amanhã → depois de amanhã, aviso 2 dias antes
  delete from private.bill_reminder_sends;
  update public.bill_reminders set days_before = 2 where transaction_id = tx and days_before = 1;
  update public.transactions set occurred_at = hoje + 2 where id = tx;
  select count(*) into n from public._bill_reminders_due() d where d.ref = tx and d.due_date = hoje + 2;
  assert n = 1, 'aviso devia seguir o vencimento novo';

  -- conta paga não toca
  update public.transactions set status = 'cleared', paid_at = hoje where id = tx;
  select count(*) into n from public._bill_reminders_due() d where d.ref = tx;
  assert n = 0, 'conta paga não pode tocar';

  -- 2) hora ainda não chegou: aviso hoje às 23:59 só toca se já for 23:59
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id)
  values (ws, u, 'expense', 2000, 'Luz BL', hoje, 'pending', conta) returning id into tx2;
  insert into public.bill_reminders (workspace_id, user_id, transaction_id, days_before, at_time, channel)
  values (ws, u, tx2, 0, '23:59', 'push'), (ws, u, tx2, 0, '00:00', 'push');
  select count(*) into n from public._bill_reminders_due() d where d.ref = tx2;
  assert n = case when agora >= '23:59' then 2 else 1 end, format('dois avisos no mesmo dia: veio %s', n);

  -- 3) série: "todas" toca cada ocorrência, "só esta" não toca as irmãs
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
  values (ws, u, 'expense', 5000, 'Academia BL', 'FREQ=MONTHLY', hoje, hoje, conta) returning id into serie;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id, source)
  values (ws, u, 'expense', 5000, 'Academia BL', hoje, 'pending', conta, serie, 'recurring'),
         (ws, u, 'expense', 5000, 'Academia BL', hoje + 30, 'pending', conta, serie, 'recurring');
  insert into public.bill_reminders (workspace_id, user_id, recurring_id, days_before, at_time, channel)
  values (ws, u, serie, 0, '00:00', 'push');
  select count(*) into n from private.bill_reminder_dues(array[ws]) d
    join public.bill_reminders b on b.id = d.bill_reminder_id where b.recurring_id = serie;
  assert n = 2, format('"todas" devia expandir 2 ocorrências, veio %s', n);

  -- 4) cartão: várias compras na mesma fatura = UM vencimento (a fatura); fatura paga não toca
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
  values (ws, u, 'Cartão BL', 'credit_card', 1, 10) returning id into cartao;
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
  values (ws, u, 'expense', 3000, 'Streaming BL', 'FREQ=DAILY', hoje, hoje, cartao) returning id into serie2;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id, source)
  values (ws, u, 'expense', 3000, 'Streaming BL', hoje, 'pending', cartao, serie2, 'recurring'),
         (ws, u, 'expense', 3000, 'Streaming BL', hoje + 1, 'pending', cartao, serie2, 'recurring');
  select invoice_id into fatura from public.transactions where account_id = cartao limit 1;
  assert fatura is not null, 'set_invoice devia pendurar a compra numa fatura';
  assert (select count(distinct invoice_id) from public.transactions where account_id = cartao) = 1, 'fixture: as duas compras na mesma fatura';
  insert into public.bill_reminders (workspace_id, user_id, recurring_id, days_before, at_time, channel)
  values (ws, u, serie2, 0, '00:00', 'push');
  select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.target = 'invoice' and d.ref = fatura;
  assert n = 1, format('fatura devia aparecer UMA vez, veio %s', n);
  update public.card_invoices set status = 'paid' where id = fatura;
  select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref = fatura;
  assert n = 0, 'fatura paga não toca';

  -- 5) financiamento: "todas" expande o cronograma; "só a nº N" só ela
  insert into public.debts (workspace_id, user_id, name, kind, principal_cents, remaining_cents, installments, installment_cents, due_day, account_id)
  values (ws, u, 'Carro BL', 'financing', 480000, 480000, 48, 10000, extract(day from hoje)::int, conta) returning id into divida;
  insert into public.bill_reminders (workspace_id, user_id, debt_id, days_before, at_time, channel)
  values (ws, u, divida, 0, '00:00', 'push');
  select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.target = 'debt' and d.ref = divida;
  assert n > 1, format('financiamento "todas" devia expandir o cronograma, veio %s', n);
  delete from public.bill_reminders where debt_id = divida;
  insert into public.bill_reminders (workspace_id, user_id, debt_id, debt_installment_no, days_before, at_time, channel)
  values (ws, u, divida, 2, 0, '00:00', 'push');
  select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref = divida;
  assert n = 1, format('"só a 2ª" devia dar 1 vencimento, veio %s', n);

  -- 6) apagar o registro apaga o lembrete
  delete from public.transactions where id = tx2;
  select count(*) into n from public.bill_reminders where transaction_id = tx2;
  assert n = 0, 'apagar o registro devia apagar o lembrete';

  -- 8) o aviso automático deixa de mandar o que tem lembrete próprio
  update public.profiles set alerts_push_enabled = true where id = u;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id)
  values (ws, u, 'expense', 7000, 'Água BL', hoje, 'pending', conta) returning id into tx2;
  select count(*) into n from public._alerts_to_send() a where a.kind = 'bill_due' and a.ref = tx2::text;
  assert n = 1, 'sem lembrete, o automático avisa';
  insert into public.bill_reminders (workspace_id, user_id, transaction_id, days_before, at_time, channel)
  values (ws, u, tx2, 0, '09:00', 'push');
  select count(*) into n from public._alerts_to_send() a where a.kind = 'bill_due' and a.ref = tx2::text;
  assert n = 0, 'com lembrete próprio, o automático cala';
  -- fatura: coberta por uma ocorrência dentro dela (a série2 tem lembrete "todas")
  update public.card_invoices set status = 'open', due_date = hoje + 2 where id = fatura;
  select count(*) into n from public._alerts_to_send() a where a.kind = 'invoice_due' and a.ref = fatura::text;
  assert n = 0, 'fatura com compra coberta não recebe o automático';
  delete from public.bill_reminders where recurring_id = serie2;
  select count(*) into n from public._alerts_to_send() a where a.kind = 'invoice_due' and a.ref = fatura::text;
  assert n = 1, 'sem lembrete, a fatura recebe o automático';
  insert into public.bill_reminders (workspace_id, user_id, invoice_id, days_before, at_time, channel)
  values (ws, u, fatura, 0, '09:00', 'push');
  select count(*) into n from public._alerts_to_send() a where a.kind = 'invoice_due' and a.ref = fatura::text;
  assert n = 0, 'lembrete na própria fatura cala o automático';

  -- 7) RLS: o outro usuário não lê
  perform set_config('request.jwt.claim.sub', outro::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', outro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.bill_reminders;
  assert n = 0, 'outro espaço não pode ler';
  reset role;
end $$;

rollback;
