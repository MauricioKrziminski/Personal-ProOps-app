-- Lembrete de conta (07/10/2026): a intenção é gravada, o disparo é derivado do vencimento ATUAL.
begin;
set local timezone to 'America/Sao_Paulo';
-- O aviso só é devido se já existia no momento dele (20261009140000): os lembretes do teste nascem
-- "antigos"; o caso do recém-criado (15c) grava `created_at` à mão. Volta com o rollback.
alter table public.bill_reminders alter column created_at set default now() - interval '2 days';

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
  -- a compra é a compra (não a fatura): cada uma avisa dela, no vencimento da fatura em que cai
  select count(*) into n from private.bill_reminder_dues(array[ws]) d
  where d.target = 'transaction' and d.ref in (select id from public.transactions where invoice_id = fatura)
    and d.due_date = (select due_date from public.card_invoices where id = fatura)
    and d.title = 'Streaming BL (fatura Cartão BL)';
  assert n = 2, format('cada compra devia avisar dela, veio %s', n);
  select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref = fatura;
  assert n = 0, 'o lembrete da compra não vira lembrete da fatura';
  update public.card_invoices set status = 'paid' where id = fatura;
  select count(*) into n from private.bill_reminder_dues(array[ws]) d
  where d.ref in (select id from public.transactions where invoice_id = fatura);
  assert n = 0, 'compra de fatura paga não toca';

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
  -- fatura: o lembrete de uma compra dela NÃO cala o automático da fatura (são coisas diferentes)
  update public.card_invoices set status = 'open', due_date = hoje + 2 where id = fatura;
  select count(*) into n from public._alerts_to_send() a where a.kind = 'invoice_due' and a.ref = fatura::text;
  assert n = 1, 'lembrete de compra não cala o automático da fatura';
  delete from public.bill_reminders where recurring_id = serie2;
  select count(*) into n from public._alerts_to_send() a where a.kind = 'invoice_due' and a.ref = fatura::text;
  assert n = 1, 'sem lembrete, a fatura recebe o automático';
  insert into public.bill_reminders (workspace_id, user_id, invoice_id, days_before, at_time, channel)
  values (ws, u, fatura, 0, '09:00', 'push');
  select count(*) into n from public._alerts_to_send() a where a.kind = 'invoice_due' and a.ref = fatura::text;
  assert n = 0, 'lembrete na própria fatura cala o automático';

  -- 9) salvar de novo NÃO re-dispara o aviso já enviado hoje (alvo: fatura)
  delete from public.bill_reminders where invoice_id = fatura;
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.save_bill_reminder(jsonb_build_object('invoice_id', fatura), '[{"days_before":2,"at_time":"00:00"}]', 'push');
  reset role;
  select count(*) into n from public._bill_reminders_due() d where d.ref = fatura;
  assert n = 1, format('fatura: aviso devia tocar, veio %s', n);
  insert into private.bill_reminder_sends (bill_reminder_id, due_date, sent_at)
  select id, hoje + 2, now() from public.bill_reminders where invoice_id = fatura;
  set local role authenticated;
  perform public.save_bill_reminder(jsonb_build_object('invoice_id', fatura), '[{"days_before":2,"at_time":"00:00"}]', 'both');
  perform public.save_bill_reminder(jsonb_build_object('invoice_id', fatura),
    '[{"days_before":2,"at_time":"00:00"},{"days_before":30,"at_time":"09:00"}]', 'both');
  reset role;
  select count(*) into n from public._bill_reminders_due() d where d.ref = fatura;
  assert n = 0, format('salvar de novo não pode re-disparar o enviado, veio %s', n);
  assert (select count(*) from public.bill_reminders where invoice_id = fatura) = 2, 'devia ter 2 avisos';
  assert (select bool_and(channel = 'both') from public.bill_reminders where invoice_id = fatura), 'canal devia atualizar';
  set local role authenticated;
  perform public.save_bill_reminder(jsonb_build_object('invoice_id', fatura), '[{"days_before":30,"at_time":"09:00"}]', 'both');
  reset role;
  assert (select count(*) from public.bill_reminders where invoice_id = fatura) = 1, 'removido sai';

  -- 10) financiamento sem nº de parcelas não vira título nulo
  update public.debts set installments = null, installment_cents = 10000 where id = divida;
  delete from public.bill_reminders where debt_id = divida;
  insert into public.bill_reminders (workspace_id, user_id, debt_id, days_before, at_time, channel)
  values (ws, u, divida, 0, '00:00', 'push');
  select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref = divida and d.title is null;
  assert n = 0, 'título da parcela não pode ser nulo';

  -- 11) série + "só esta": a ocorrência com lembrete próprio toca UMA vez (o dela); a irmã segue a série
  select id into tx2 from public.transactions where recurring_id = serie and occurred_at = hoje + 30;
  insert into public.bill_reminders (workspace_id, user_id, transaction_id, days_before, at_time, channel)
  values (ws, u, tx2, 3, '10:00', 'push');
  select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref = tx2;
  assert n = 1, format('ocorrência com "só esta" devia aparecer 1 vez, veio %s', n);
  assert (select b.transaction_id from private.bill_reminder_dues(array[ws]) d
          join public.bill_reminders b on b.id = d.bill_reminder_id where d.ref = tx2) = tx2, 'quem toca é o "só esta"';
  select count(*) into n from private.bill_reminder_dues(array[ws]) d
    join public.bill_reminders b on b.id = d.bill_reminder_id where b.recurring_id = serie;
  assert n = 1, format('a série devia ficar só com a irmã, veio %s', n);
  delete from public.bill_reminders where transaction_id = tx2;
  select count(*) into n from private.bill_reminder_dues(array[ws]) d
    join public.bill_reminders b on b.id = d.bill_reminder_id where b.recurring_id = serie;
  assert n = 2, 'tirado o "só esta", a série volta a valer na ocorrência';

  -- 12) cartão: compra e fatura são coisas diferentes
  declare
    cartao2 uuid; sa uuid; sb uuid; fat2 uuid; linha_a uuid; linha_b uuid; so uuid;
  begin
    insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
    values (ws, u, 'Cartão BL2', 'credit_card', 1, 10) returning id into cartao2;
    insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
    values (ws, u, 'expense', 1000, 'Série A BL', 'FREQ=MONTHLY', hoje, hoje, cartao2) returning id into sa;
    insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
    values (ws, u, 'expense', 2000, 'Série B BL', 'FREQ=MONTHLY', hoje, hoje, cartao2) returning id into sb;
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id, source)
    values (ws, u, 'expense', 1000, 'Série A BL', hoje, 'pending', cartao2, sa, 'recurring') returning id into linha_a;
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id, source)
    values (ws, u, 'expense', 2000, 'Série B BL', hoje, 'pending', cartao2, sb, 'recurring') returning id into linha_b;
    select invoice_id into fat2 from public.transactions where id = linha_a;
    assert (select count(distinct invoice_id) from public.transactions where account_id = cartao2) = 1, 'fixture: mesma fatura';
    update public.card_invoices set status = 'open', due_date = hoje where id = fat2;
    insert into public.bill_reminders (workspace_id, user_id, recurring_id, days_before, at_time, channel)
    values (ws, u, sa, 0, '00:00', 'push'), (ws, u, sb, 0, '00:00', 'whatsapp');
    -- duas séries na mesma fatura, mesma hora: DOIS avisos, um de cada compra, com o nome e o valor dela
    select count(*) into n from public._bill_reminders_due() d where d.ref in (linha_a, linha_b);
    assert n = 2, format('cada compra avisa dela mesma, veio %s', n);
    assert (select d.title || '|' || d.amount_cents || '|' || d.channel from public._bill_reminders_due() d where d.ref = linha_a)
      = 'Série A BL (fatura Cartão BL2)|1000|push', 'aviso da compra A';
    -- "só esta" na compra A substitui só a série A, naquela compra; a B segue com a dela
    insert into public.bill_reminders (workspace_id, user_id, transaction_id, days_before, at_time, channel)
    values (ws, u, linha_a, 1, '08:00', 'push') returning id into so;
    select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref = linha_a;
    assert n = 1, format('compra A: só o "só esta", veio %s', n);
    assert (select d.bill_reminder_id from private.bill_reminder_dues(array[ws]) d where d.ref = linha_a) = so, 'quem vale na A é o "só esta"';
    select count(*) into n from private.bill_reminder_dues(array[ws]) d
      join public.bill_reminders b on b.id = d.bill_reminder_id where d.ref = linha_b and b.recurring_id = sb;
    assert n = 1, '"só esta" numa compra não cala a série de OUTRA compra da fatura';
    -- o lembrete da fatura é dela: não cala nem é calado pelos das compras
    insert into public.bill_reminders (workspace_id, user_id, invoice_id, days_before, at_time, channel)
    values (ws, u, fat2, 0, '00:00', 'push');
    select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref = fat2 and d.target = 'invoice';
    assert n = 1, 'a fatura avisa dela';
    select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref in (linha_a, linha_b);
    assert n = 2, 'as compras continuam com os delas';
    -- enviado: tirar o "só esta" não faz a série A reenviar o mesmo aviso (livro de envios)
    delete from public.bill_reminders where id = so;
    insert into private.bill_reminder_sends (bill_reminder_id, due_date, sent_at)
    select d.bill_reminder_id, d.due_date, now() from public._bill_reminders_due() d where d.ref = linha_a;
    insert into public.bill_reminders (workspace_id, user_id, transaction_id, days_before, at_time, channel)
    values (ws, u, linha_a, 0, '00:00', 'whatsapp') returning id into so;
    select count(*) into n from public._bill_reminders_due() d where d.ref = linha_a;
    assert n = 0, format('mesmo aviso já enviado pela série: o "só esta" não reenvia (veio %s)', n);
  end;

  -- 13) dívida inteira + "só a Nª": a parcela toca UMA vez, pelo lembrete dela
  declare
    moto uuid;
  begin
    insert into public.debts (workspace_id, user_id, name, kind, principal_cents, remaining_cents, installments, installment_cents, due_day, account_id)
    values (ws, u, 'Moto BL', 'financing', 120000, 120000, 12, 10000, extract(day from hoje)::int, conta) returning id into moto;
    insert into public.bill_reminders (workspace_id, user_id, debt_id, days_before, at_time, channel)
    values (ws, u, moto, 0, '00:00', 'push');
    insert into public.bill_reminders (workspace_id, user_id, debt_id, debt_installment_no, days_before, at_time, channel)
    values (ws, u, moto, 1, 0, '00:00', 'whatsapp');
    select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref = moto and d.title like '%(1/12)';
    assert n = 1, format('a 1ª parcela devia aparecer 1 vez, veio %s', n);
    assert (select b.debt_installment_no from private.bill_reminder_dues(array[ws]) d
            join public.bill_reminders b on b.id = d.bill_reminder_id
            where d.ref = moto and d.title like '%(1/12)') = 1, 'quem toca a 1ª é o lembrete dela';
    select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref = moto and d.title like '%(2/12)';
    assert n = 1, 'a 2ª segue com o da dívida inteira';
    select count(*) into n from public._bill_reminders_due() d where d.ref = moto;
    assert n = case when (select min(s.due_date) from private.debt_schedule_for(moto) s) = hoje then 1 else 0 end,
      format('a parcela de hoje toca uma vez, veio %s', n);

    -- 14) o salvar recusa o que nunca toca (e remover sempre passa)
    perform set_config('request.jwt.claim.sub', u::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.save_bill_reminder(jsonb_build_object('debt_id', moto, 'debt_installment_no', 13), '[{"days_before":0,"at_time":"09:00"}]', 'push');
      n := -1;
    exception when others then
      assert sqlerrm = 'Essa parcela não existe no contrato', format('parcela 13: %s', sqlerrm);
    end;
    assert n <> -1, 'parcela fora do contrato devia ser recusada';
    begin
      perform public.save_bill_reminder(jsonb_build_object('debt_id', moto, 'debt_installment_no', 0), '[{"days_before":0,"at_time":"09:00"}]', 'push');
      n := -1;
    exception when others then
      assert sqlerrm = 'Essa parcela não existe no contrato', format('parcela 0: %s', sqlerrm);
    end;
    assert n <> -1, 'parcela 0 devia ser recusada';
    reset role;
    update public.debts set installments_paid = 2, remaining_cents = 100000 where id = moto;
    set local role authenticated;
    begin
      perform public.save_bill_reminder(jsonb_build_object('debt_id', moto, 'debt_installment_no', 2), '[{"days_before":0,"at_time":"09:00"}]', 'push');
      n := -1;
    exception when others then
      assert sqlerrm = 'Essa parcela já foi paga', format('parcela paga: %s', sqlerrm);
    end;
    assert n <> -1, 'parcela já paga devia ser recusada';
    n := public.save_bill_reminder(jsonb_build_object('debt_id', moto, 'debt_installment_no', 3), '[{"days_before":0,"at_time":"09:00"}]', 'push');
    assert n = 1, 'parcela futura grava';
    -- remover um lembrete que virou morto (a 1ª, já paga) sempre passa
    n := public.save_bill_reminder(jsonb_build_object('debt_id', moto, 'debt_installment_no', 1), '[]', 'push');
    assert n = 0, 'remover devia passar';
    reset role;
    assert not exists (select 1 from public.bill_reminders where debt_id = moto and debt_installment_no = 1), 'a 1ª devia sair';
    -- o título da lista diz qual parcela
    set local role authenticated;
    assert (select o.title from public.bill_reminders_overview() o
            where o.alvo ->> 'debt_installment_no' = '3') = 'Moto BL · 3ª parcela', 'título devia dizer a parcela';
    reset role;
  end;
  -- ocorrência paga e receita não aceitam "só esta"
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, paid_at, account_id)
  values (ws, u, 'expense', 900, 'Paga BL', hoje, 'cleared', hoje, conta) returning id into tx2;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id)
  values (ws, u, 'income', 900, 'Receita BL', hoje + 1, 'pending', conta) returning id into tx;
  set local role authenticated;
  begin
    perform public.save_bill_reminder(jsonb_build_object('transaction_id', tx2), '[{"days_before":0,"at_time":"09:00"}]', 'push');
    n := -1;
  exception when others then
    assert sqlerrm like 'Essa já foi paga%', format('paga: %s', sqlerrm);
  end;
  assert n <> -1, 'ocorrência paga devia ser recusada';
  begin
    perform public.save_bill_reminder(jsonb_build_object('transaction_id', tx), '[{"days_before":0,"at_time":"09:00"}]', 'push');
    n := -1;
  exception when others then
    assert sqlerrm = 'Lembrete é para conta a pagar', format('receita: %s', sqlerrm);
  end;
  assert n <> -1, 'receita devia ser recusada';
  reset role;

  -- 15) o lembrete é DA PESSOA
  declare
    hoje_occ uuid; tx3 uuid; tx5 uuid; rep uuid; plano uuid;
  begin
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, outro, 'member');
    select id into hoje_occ from public.transactions where recurring_id = serie and occurred_at = hoje;
    -- (a) o membro salva e apaga o DELE; o meu fica
    perform set_config('request.jwt.claim.sub', outro::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', outro, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.save_bill_reminder(jsonb_build_object('recurring_id', serie), '[{"days_before":0,"at_time":"00:00"}]', 'push');
    reset role;
    assert (select count(*) from public.bill_reminders where recurring_id = serie) = 2, 'o do membro soma, não substitui';
    set local role authenticated;
    -- a lista do membro só tem o dele
    assert (select count(*) from public.bill_reminders_overview() o where o.alvo ->> 'recurring_id' = serie::text) = 1,
      'a lista mostra só os meus';
    perform public.save_bill_reminder(jsonb_build_object('recurring_id', serie), '[]', 'push');
    reset role;
    assert (select count(*) from public.bill_reminders where recurring_id = serie and user_id = u) = 1,
      'apagar o do membro não apaga o meu';
    -- (b) o "só esta" do membro não cala a minha série naquela ocorrência
    insert into public.bill_reminders (workspace_id, user_id, transaction_id, days_before, at_time, channel)
    values (ws, outro, hoje_occ, 0, '00:00', 'push');
    select count(*) into n from private.bill_reminder_dues(array[ws]) d
      join public.bill_reminders b on b.id = d.bill_reminder_id where d.ref = hoje_occ and b.user_id = u;
    assert n = 1, 'a minha série continua tocando a ocorrência';
    -- (c) quem sai do espaço deixa de receber
    select count(*) into n from public._bill_reminders_due() d where d.user_id = outro and d.ref = hoje_occ;
    assert n = 1, format('membro recebe, veio %s', n);
    delete from public.workspace_members where workspace_id = ws and user_id = outro;
    select count(*) into n from public._bill_reminders_due() d where d.user_id = outro;
    assert n = 0, 'ex-membro não recebe';
    -- (d) o aviso automático (do dono) só cala pelo lembrete do dono
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id)
    values (ws, u, 'expense', 3300, 'Gás BL', hoje, 'pending', conta) returning id into tx3;
    insert into public.bill_reminders (workspace_id, user_id, transaction_id, days_before, at_time, channel)
    values (ws, outro, tx3, 0, '09:00', 'push');
    select count(*) into n from public._alerts_to_send() a where a.kind = 'bill_due' and a.ref = tx3::text;
    assert n = 1, 'lembrete de outra pessoa não cala o aviso do dono';

    -- (e) o aviso criado depois do seu momento não toca hoje (mudar a hora não reenvia)
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id)
    values (ws, u, 'expense', 4400, 'Net BL', hoje, 'pending', conta) returning id into tx5;
    insert into public.bill_reminders (workspace_id, user_id, transaction_id, days_before, at_time, channel, created_at)
    values (ws, u, tx5, 0, '00:00', 'push', now()) returning id into rep;
    select count(*) into n from public._bill_reminders_due() d where d.ref = tx5;
    assert n = 0, 'criado depois do momento não toca hoje';
    update public.bill_reminders set created_at = now() - interval '2 days' where id = rep;
    select count(*) into n from public._bill_reminders_due() d where d.ref = tx5;
    assert n = 1, 'existia no momento: toca';

    -- (f) espera entre tentativas dobra; com 8 desiste
    insert into private.bill_reminder_sends (bill_reminder_id, due_date, attempts) values (rep, hoje, 1);
    assert (select user_id = u and transaction_id = tx5 and at_time = '00:00'
            from private.bill_reminder_sends where bill_reminder_id = rep), 'o envio descreve o lembrete';
    update private.bill_reminder_sends set attempts = 2 where bill_reminder_id = rep;
    select count(*) into n from public._bill_reminders_due() d where d.ref = tx5;
    assert n = 0, 'logo depois de falhar, espera';
    update private.bill_reminder_sends set tentado_em = now() - interval '5 minutes' where bill_reminder_id = rep;
    select count(*) into n from public._bill_reminders_due() d where d.ref = tx5;
    assert n = 1, 'passada a espera (4 min para a 2ª), tenta de novo';
    update private.bill_reminder_sends set attempts = 8, tentado_em = now() - interval '1 day' where bill_reminder_id = rep;
    select count(*) into n from public._bill_reminders_due() d where d.ref = tx5;
    assert n = 0, 'com 8 tentativas desiste';

    -- (g) salvar recusa fatura paga e compra sem parcela em aberto
    update public.card_invoices set status = 'paid' where id = fatura;
    insert into public.installment_plans (workspace_id, user_id, total_cents, installments, first_occurred_at, description)
    values (ws, u, 2000, 2, hoje - 60, 'Plano BL') returning id into plano;
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, paid_at, account_id, installment_plan_id, installment_no)
    values (ws, u, 'expense', 1000, 'Plano BL (1/2)', hoje - 60, 'cleared', hoje - 60, conta, plano, 1),
           (ws, u, 'expense', 1000, 'Plano BL (2/2)', hoje - 30, 'cleared', hoje - 30, conta, plano, 2);
    perform set_config('request.jwt.claim.sub', u::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.save_bill_reminder(jsonb_build_object('invoice_id', fatura), '[{"days_before":0,"at_time":"09:00"}]', 'push');
      n := -1;
    exception when others then
      assert sqlerrm = 'Essa fatura já foi paga ou adiada', format('fatura paga: %s', sqlerrm);
    end;
    assert n <> -1, 'fatura paga devia ser recusada';
    begin
      perform public.save_bill_reminder(jsonb_build_object('installment_plan_id', plano), '[{"days_before":0,"at_time":"09:00"}]', 'push');
      n := -1;
    exception when others then
      assert sqlerrm = 'Essa compra já foi toda paga', format('compra paga: %s', sqlerrm);
    end;
    assert n <> -1, 'compra toda paga devia ser recusada';
    -- remover continua passando
    n := public.save_bill_reminder(jsonb_build_object('invoice_id', fatura), '[]', 'push');
    assert n = 0, 'remover da fatura paga passa';
    reset role;
  end;

  -- 7) RLS: o outro usuário não lê
  perform set_config('request.jwt.claim.sub', outro::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', outro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.bill_reminders;
  assert n = 0, 'outro espaço não pode ler';
  reset role;
end $$;

rollback;
