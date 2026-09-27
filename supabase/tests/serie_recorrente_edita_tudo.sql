-- A série recorrente se edita inteira (`20260926120000`, `20260927120000`).
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/serie_recorrente_edita_tudo.sql
--
-- 1. Mudar o calendário (rrule + próximo vencimento) tira as EM ABERTO do mês do próximo vencimento
--    em diante — a primeira delas MUDA de data e fica com o mesmo id; as de meses antes dele, o
--    passado, a atrasada e a paga ficam. A série fica com a
--    regra nova, a âncora no próximo vencimento e `materialized_until` nulo (o agendador gera de
--    novo). A compra de cartão já feita fica. Outra série do mesmo workspace não é tocada. 2. Calendário no passado, regra que o app
--    não monta (inclusive INTERVAL=0 e dia 0) e regra sem o próximo vencimento são recusados; o
--    vencimento no mês da paga adiantada DESLIZA para o mês seguinte (nunca recusa). 3. Tipo e estabelecimento vão para as
--    futuras em aberto. 4. "Termina em" mais cedo tira as futuras depois do fim. 5. Fim antes de uma
--    atrasada não a apaga. 6. O Fundacred de produção: setembro PAGO com vencimento 30/09 e
--    "próximo em 30/09" vira o fim do mês seguinte, refazendo o de outubro. 7. A atrasada do mês
--    também segura o calendário: a série começa no mês seguinte.
-- Datas relativas a hoje: o teste não envelhece. Roda numa transação e dá rollback.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000001a1';
  w uuid := '00000000-0000-0000-0000-0000000001b1';
  cc uuid := '00000000-0000-0000-0000-0000000001c1';
  cartao uuid := '00000000-0000-0000-0000-0000000001c2';
  s uuid := '00000000-0000-0000-0000-0000000001d1';
  outra uuid := '00000000-0000-0000-0000-0000000001d2';
  s3 uuid := '00000000-0000-0000-0000-0000000001d3';
  s4 uuid := '00000000-0000-0000-0000-0000000001d4';
  hoje date := current_date;
  -- último dia do mês SEGUINTE ao da paga adiantada (hoje + 100)
  proxima timestamptz := (date_trunc('month', current_date + 100) + interval '2 month - 1 day')::date + time '09:00';
  l record;
  n bigint;
  movida uuid;
begin
  insert into auth.users (id, email) values (u, 'teste-serie@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste série');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta teste', 'checking', 500000);
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents, closing_day, due_day)
    values (cartao, w, u, 'Cartão teste', 'credit_card', 0, 3, 10);
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, category, description, account_id, rrule,
     next_run_at, dtstart, materialized_until, active, auto_confirm)
  values (s, w, u, 'expense', 119885, 'estudo', 'Fundacred', cc, 'FREQ=MONTHLY;BYMONTHDAY=4',
          hoje + 30, hoje - 90, hoje + 300, true, false);

  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, category, description, account_id, rrule,
     next_run_at, dtstart, materialized_until, active, auto_confirm)
  values (outra, w, u, 'expense', 5000, 'lazer', 'Streaming', cc, 'FREQ=MONTHLY;BYMONTHDAY=10',
          hoje + 5, hoje - 90, hoje + 300, true, false);
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   occurred_at, due_at, status, source, recurring_id) values
    (w, u, 'expense', 5000, 'Streaming', cc, hoje + 5, hoje + 5, 'pending', 'recurring', outra),
    (w, u, 'expense', 5000, 'Streaming', cc, hoje + 35, hoje + 35, 'pending', 'recurring', outra);

  -- passado pago, atrasada em aberto, três futuras em aberto e uma futura paga adiantada
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   occurred_at, due_at, status, source, recurring_id) values
    (w, u, 'expense', 119885, 'Fundacred', cc, hoje - 60, hoje - 60, 'cleared', 'recurring', s),
    (w, u, 'expense', 119885, 'Fundacred', cc, hoje - 20, hoje - 20, 'pending', 'recurring', s),
    (w, u, 'expense', 119885, 'Fundacred', cc, hoje + 10, hoje + 10, 'pending', 'recurring', s),
    (w, u, 'expense', 119885, 'Fundacred', cc, hoje + 40, hoje + 40, 'pending', 'recurring', s),
    (w, u, 'expense', 119885, 'Fundacred', cc, hoje + 70, hoje + 70, 'pending', 'recurring', s),
    (w, u, 'expense', 119885, 'Fundacred', cc, hoje + 100, hoje + 100, 'cleared', 'recurring', s),
    -- o Fundacred de setembro: data no passado, vencimento daqui a 4 dias
    (w, u, 'expense', 119885, 'Fundacred', cc, hoje - 22, hoje + 4, 'pending', 'recurring', s),
    -- a do mês seguinte ao do próximo vencimento: sai
    (w, u, 'expense', 119885, 'Fundacred', cc, (date_trunc('month', proxima) + interval '1 month')::date + 3, (date_trunc('month', proxima) + interval '1 month')::date + 3, 'pending', 'recurring', s);
  -- a do mês do próximo vencimento: muda para a data nova e fica com o mesmo id
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   occurred_at, due_at, status, source, recurring_id)
    values (w, u, 'expense', 119885, 'Fundacred', cc, date_trunc('month', proxima)::date + 3,
            date_trunc('month', proxima)::date + 3, 'pending', 'recurring', s)
    returning id into movida;
  -- a do cartão de ontem: `set_invoice` a põe na fatura e o vencimento é o da fatura
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   occurred_at, status, source, recurring_id)
    values (w, u, 'expense', 119885, 'Fundacred', cartao, hoje - 1, 'pending', 'recurring', s);
  select count(*) into n from public.transactions
   where recurring_id = s and account_id = cartao and invoice_id is not null;
  if n <> 1 then raise exception '1: a compra do cartão não entrou na fatura (o teste não prova nada)'; end if;

  -- 1. o calendário muda: último dia do mês. Pedido NO mês da paga adiantada, ele desliza para o
  --    mês seguinte (`proxima`) — o mês pago ganharia uma segunda cobrança, e recusar era o erro.
  perform public.update_recurring_series(s, jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=-1',
    'next_run_at', (date_trunc('month', current_date + 100) + interval '1 month - 1 day')::date + time '09:00'));
  select count(*) filter (where status = 'pending' and occurred_at >= date_trunc('month', proxima)) as do_mes_em_diante,
         count(*) filter (where status = 'pending' and occurred_at >= hoje and occurred_at < date_trunc('month', proxima)) as antes_dele,
         count(*) filter (where occurred_at < hoje and account_id = cc) as passado,
         count(*) filter (where status = 'cleared' and occurred_at >= hoje) as adiantada,
         count(*) filter (where occurred_at = hoje - 22) as setembro,
         count(*) filter (where account_id = cartao) as do_cartao
    into l from public.transactions where recurring_id = s;
  if l.do_mes_em_diante <> 1 or l.antes_dele <> 3 or l.passado <> 3 or l.adiantada <> 1 or l.setembro <> 1 or l.do_cartao <> 1 then
    raise exception '1: do mês em diante % (1, a movida), antes dele % (3), passado % (3), adiantada % (1), setembro % (1), cartão % (1)',
      l.do_mes_em_diante, l.antes_dele, l.passado, l.adiantada, l.setembro, l.do_cartao;
  end if;
  select occurred_at, due_at into l from public.transactions where id = movida;
  if l.occurred_at is distinct from proxima::date or l.due_at is distinct from proxima::date then
    raise exception '1: a primeira do mês não mudou para a data nova com o mesmo id (% / %)', l.occurred_at, l.due_at;
  end if;
  select rrule, dtstart, next_run_at, materialized_until into l from public.recurring_transactions where id = s;
  if l.rrule <> 'FREQ=MONTHLY;BYMONTHDAY=-1' or l.dtstart <> proxima or l.next_run_at <> proxima
     or l.materialized_until is not null then
    raise exception '1: série % % % %', l.rrule, l.dtstart, l.next_run_at, l.materialized_until;
  end if;
  select count(*) into n from public.transactions where recurring_id = outra and status = 'pending';
  if n <> 2 then raise exception '1: a outra série perdeu ocorrência (%)', n; end if;

  -- 2. recusas
  begin
    perform public.update_recurring_series(s, jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=5', 'next_run_at', (hoje - 1) + time '09:00'));
    raise exception '2: calendário no passado deveria ser recusado';
  exception when others then if sqlerrm not like 'O próximo vencimento%' then raise; end if;
  end;
  begin
    perform public.update_recurring_series(s, jsonb_build_object('rrule', 'FREQ=DAILY', 'next_run_at', proxima));
    raise exception '2: regra que o app não monta deveria ser recusada';
  exception when others then if sqlerrm not like 'Repetição inválida%' then raise; end if;
  end;
  begin
    perform public.update_recurring_series(s, jsonb_build_object('rrule', 'FREQ=MONTHLY;INTERVAL=0;BYMONTHDAY=5', 'next_run_at', proxima));
    raise exception '2: INTERVAL=0 deveria ser recusado';
  exception when others then if sqlerrm not like 'Repetição inválida%' then raise; end if;
  end;
  begin
    perform public.update_recurring_series(s, jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=0', 'next_run_at', proxima));
    raise exception '2: dia 0 deveria ser recusado';
  exception when others then if sqlerrm not like 'Repetição inválida%' then raise; end if;
  end;
  begin
    perform public.update_recurring_series(s, jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=5'));
    raise exception '2: regra sem o próximo vencimento deveria ser recusada';
  exception when others then if sqlerrm not like 'A repetição e o próximo vencimento%' then raise; end if;
  end;

  -- 3. tipo e estabelecimento vão para as futuras em aberto (e só para elas)
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   occurred_at, due_at, status, source, recurring_id) values
    (w, u, 'expense', 119885, 'Fundacred', cc, hoje + 45, hoje + 45, 'pending', 'recurring', s),
    (w, u, 'expense', 119885, 'Fundacred', cc, hoje + 200, hoje + 200, 'pending', 'recurring', s);
  -- em aberto e ainda não vencidas: +10, +40, +70, a de vencimento +4, a movida, +45 e +200
  n := public.update_recurring_series(s, jsonb_build_object('kind', 'income', 'merchant', 'Fundacred SA'));
  if n <> 7 then raise exception '3: esperadas 7 futuras alteradas, vieram %', n; end if;
  select count(*) into n from public.transactions
   where recurring_id = s and status = 'pending' and kind = 'income' and merchant = 'Fundacred SA';
  if n <> 7 then raise exception '3: futuras sem o tipo/estabelecimento novos (%)', n; end if;
  select count(*) into n from public.transactions where recurring_id = s and occurred_at < hoje and kind = 'expense' and account_id = cc;
  if n <> 2 then raise exception '3: o passado mudou de tipo'; end if;
  select merchant into l from public.recurring_transactions where id = s;
  if l.merchant <> 'Fundacred SA' then raise exception '3: a série não guardou o estabelecimento'; end if;

  -- 4. fim mais cedo: a de +200 dias sai, a de +45 fica
  perform public.update_recurring_series(s, jsonb_build_object('end_date', hoje + 100));
  select count(*) into n from public.transactions where recurring_id = s and status = 'pending' and occurred_at > hoje + 100;
  if n <> 0 then raise exception '4: sobrou ocorrência depois do fim (%)', n; end if;
  select count(*) into n from public.transactions where recurring_id = s and status = 'pending' and occurred_at = hoje + 45;
  if n <> 1 then raise exception '4: a de antes do fim sumiu'; end if;
  select count(*) into n from public.transactions where recurring_id = outra and status = 'pending';
  if n <> 2 then raise exception '4: a outra série perdeu ocorrência (%)', n; end if;

  -- 5. fim antes da atrasada: ela é conta em aberto, fica
  perform public.update_recurring_series(s, jsonb_build_object('end_date', hoje - 30));
  select count(*) into n from public.transactions where recurring_id = s and status = 'pending' and occurred_at = hoje - 20;
  if n <> 1 then raise exception '5: a atrasada sumiu com o fim'; end if;

  -- 6. o Fundacred de produção: setembro PAGO (data -22, vence +4) e outubro em aberto
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, category, description, account_id, rrule,
     next_run_at, dtstart, materialized_until, active, auto_confirm)
  values (s3, w, u, 'expense', 119885, 'estudo', 'Fundacred', cc, 'FREQ=MONTHLY;BYMONTHDAY=4',
          hoje + 30, hoje - 90, hoje + 300, true, false);
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   occurred_at, due_at, status, source, recurring_id) values
    (w, u, 'expense', 119885, 'Fundacred', cc, hoje - 22, hoje + 4, 'cleared', 'recurring', s3),
    (w, u, 'expense', 119885, 'Fundacred', cc, (date_trunc('month', hoje + 4) + interval '1 month')::date + 3,
     (date_trunc('month', hoje + 4) + interval '1 month')::date + 3, 'pending', 'recurring', s3);
  -- "próximo em 30/09" com setembro pago: desliza para o fim de outubro, com a hora pedida.
  perform public.update_recurring_series(s3, jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=-1',
    'next_run_at', (hoje + 4) + time '09:00'));
  select next_run_at into l from public.recurring_transactions where id = s3;
  if l.next_run_at <> (date_trunc('month', hoje + 4) + interval '2 month - 1 day')::date + time '09:00' then
    raise exception '6: a série não deslizou para o fim do mês seguinte (%)', l.next_run_at;
  end if;
  select count(*) filter (where status = 'pending'
                            and occurred_at = (date_trunc('month', hoje + 4) + interval '2 month - 1 day')::date) as outubro,
         count(*) filter (where status = 'cleared') as setembro
    into l from public.transactions where recurring_id = s3;
  if l.outubro <> 1 or l.setembro <> 1 then
    raise exception '6: outubro no fim do mês % (1, a mesma linha movida), setembro pago % (1)', l.outubro, l.setembro;
  end if;

  -- 7. a atrasada deste mês também segura (só dá para montar fora do dia 1º)
  if date_trunc('month', hoje - 1) = date_trunc('month', hoje) then
    insert into public.recurring_transactions
      (id, workspace_id, user_id, kind, amount_cents, category, description, account_id, rrule,
       next_run_at, dtstart, materialized_until, active, auto_confirm)
    values (s4, w, u, 'expense', 1000, 'casa', 'Luz', cc, 'FREQ=MONTHLY;BYMONTHDAY=1',
            hoje + 30, hoje - 90, hoje + 300, true, false);
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                     occurred_at, due_at, status, source, recurring_id)
      values (w, u, 'expense', 1000, 'Luz', cc, hoje - 1, hoje - 1, 'pending', 'recurring', s4);
    perform public.update_recurring_series(s4, jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=-1',
      'next_run_at', hoje + time '09:00'));
    select next_run_at into l from public.recurring_transactions where id = s4;
    if l.next_run_at::date <> (date_trunc('month', hoje) + interval '2 month - 1 day')::date then
      raise exception '7: a atrasada deste mês segura: a série vai para o fim do mês seguinte (%)', l.next_run_at;
    end if;
    select count(*) into n from public.transactions where recurring_id = s4 and occurred_at = hoje - 1 and status = 'pending';
    if n <> 1 then raise exception '7: a atrasada saiu do lugar'; end if;
  end if;

  -- 8. o caso de 27/09/2026: "todo dia 4" com o 4 deste mês PAGO; a pessoa pede o dia do último
  --    dia deste mês (30 em setembro). Desliza para o mesmo dia no mês seguinte; a paga fica, e a
  --    em aberto do mês seguinte muda de data com o MESMO id.
  --    9. "a cada 2 meses" anda 2. 10. semanal anda uma semana.
  declare
    s5 uuid := gen_random_uuid();
    s6 uuid := gen_random_uuid();
    s7 uuid := gen_random_uuid();
    paga uuid;
    aberta uuid;
    fim_mes date := (date_trunc('month', hoje) + interval '1 month - 1 day')::date;
    dia int := extract(day from (date_trunc('month', hoje) + interval '1 month - 1 day'))::int;
    esperado date := private.day_in_month((date_trunc('month', hoje) + interval '1 month')::date,
                                          extract(day from (date_trunc('month', hoje) + interval '1 month - 1 day'))::int);
  begin
    insert into public.recurring_transactions
      (id, workspace_id, user_id, kind, amount_cents, category, description, account_id, rrule,
       next_run_at, dtstart, materialized_until, active, auto_confirm)
    values (s5, w, u, 'expense', 5000, 'casa', 'Internet', cc, 'FREQ=MONTHLY;BYMONTHDAY=1',
            (date_trunc('month', hoje) + interval '1 month')::date, hoje - 90, hoje + 300, true, false);
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                     occurred_at, due_at, status, source, recurring_id)
      values (w, u, 'expense', 5000, 'Internet', cc, date_trunc('month', hoje)::date, date_trunc('month', hoje)::date,
              'cleared', 'recurring', s5)
      returning id into paga;
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                     occurred_at, due_at, status, source, recurring_id)
      values (w, u, 'expense', 5000, 'Internet', cc, (date_trunc('month', hoje) + interval '1 month')::date,
              (date_trunc('month', hoje) + interval '1 month')::date, 'pending', 'recurring', s5)
      returning id into aberta;
    perform public.update_recurring_series(s5, jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=' || dia,
      'next_run_at', fim_mes + time '09:00'));
    select next_run_at into l from public.recurring_transactions where id = s5;
    if l.next_run_at <> esperado + time '09:00' then
      raise exception '8: dia % deveria ir para % (foi %)', dia, esperado, l.next_run_at;
    end if;
    select occurred_at into l from public.transactions where id = paga;
    if l.occurred_at <> date_trunc('month', hoje)::date then raise exception '8: a paga saiu do dia dela (%)', l.occurred_at; end if;
    select occurred_at into l from public.transactions where id = aberta;
    if l.occurred_at <> esperado then raise exception '8: a em aberto não foi para % com o mesmo id (%)', esperado, l.occurred_at; end if;
    select count(*) into n from public.transactions where recurring_id = s5 and date_trunc('month', occurred_at) = date_trunc('month', hoje);
    if n <> 1 then raise exception '8: o mês pago ganhou outra cobrança (%)', n; end if;

    insert into public.recurring_transactions
      (id, workspace_id, user_id, kind, amount_cents, category, description, account_id, rrule,
       next_run_at, dtstart, materialized_until, active, auto_confirm)
    values (s6, w, u, 'expense', 5000, 'casa', 'Revisão', cc, 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1',
            (date_trunc('month', hoje) + interval '2 month')::date, hoje - 90, hoje + 300, true, false);
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                     occurred_at, due_at, status, source, recurring_id)
      values (w, u, 'expense', 5000, 'Revisão', cc, date_trunc('month', hoje)::date, date_trunc('month', hoje)::date,
              'cleared', 'recurring', s6);
    perform public.update_recurring_series(s6, jsonb_build_object('rrule', 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=' || dia,
      'next_run_at', fim_mes + time '09:00'));
    select next_run_at into l from public.recurring_transactions where id = s6;
    if l.next_run_at::date <> private.day_in_month((date_trunc('month', hoje) + interval '2 month')::date, dia) then
      raise exception '9: a cada 2 meses deveria andar 2 (%)', l.next_run_at;
    end if;

    insert into public.recurring_transactions
      (id, workspace_id, user_id, kind, amount_cents, category, description, account_id, rrule,
       next_run_at, dtstart, materialized_until, active, auto_confirm)
    values (s7, w, u, 'expense', 3000, 'casa', 'Feira', cc, 'FREQ=WEEKLY;BYDAY=MO',
            hoje + 7, hoje - 90, hoje + 300, true, false);
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                     occurred_at, due_at, status, source, recurring_id)
      values (w, u, 'expense', 3000, 'Feira', cc, hoje, hoje, 'cleared', 'recurring', s7);
    perform public.update_recurring_series(s7, jsonb_build_object('rrule', 'FREQ=WEEKLY;BYDAY=FR',
      'next_run_at', hoje + time '09:00'));
    select next_run_at into l from public.recurring_transactions where id = s7;
    if date_trunc('week', l.next_run_at::date) <> date_trunc('week', hoje) + interval '1 week' then
      raise exception '10: semanal deveria ir para a semana seguinte (%)', l.next_run_at;
    end if;
  end;
end $$;

rollback;
