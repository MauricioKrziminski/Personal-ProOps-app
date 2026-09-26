-- A série recorrente se edita inteira (`20260926120000`).
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/serie_recorrente_edita_tudo.sql
--
-- 1. Mudar o calendário (rrule + próximo vencimento) tira as EM ABERTO do mês do próximo vencimento
--    em diante — a primeira delas MUDA de data e fica com o mesmo id; as de meses antes dele, o
--    passado, a atrasada e a paga ficam. A série fica com a
--    regra nova, a âncora no próximo vencimento e `materialized_until` nulo (o agendador gera de
--    novo). A compra de cartão já feita fica. Outra série do mesmo workspace não é tocada. 2. Calendário no passado, regra que o app
--    não monta (inclusive INTERVAL=0 e dia 0), regra sem o próximo vencimento e vencimento no mês da
--    paga adiantada são recusados. 3. Tipo e estabelecimento vão para as
--    futuras em aberto. 4. "Termina em" mais cedo tira as futuras depois do fim. 5. Fim antes de uma
--    atrasada não a apaga. 6. O Fundacred de produção: setembro PAGO com vencimento 30/09 recusa
--    "próximo em 30/09" e aceita o fim do mês seguinte, refazendo o de outubro. 7. A atrasada do
--    mês também segura o calendário.
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

  -- 1. o calendário muda: último dia do mês, a partir do mês depois da paga adiantada.
  --    Antes, no mesmo mês dela, é recusado — o mês pago ganharia uma segunda cobrança.
  begin
    perform public.update_recurring_series(s, jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=-1',
      'next_run_at', (date_trunc('month', current_date + 100) + interval '1 month - 1 day')::date + time '09:00'));
    raise exception '1: vencimento no mês da paga adiantada deveria ser recusado';
  exception when others then if sqlerrm not like 'A de % já está paga%' then raise; end if;
  end;
  perform public.update_recurring_series(s,
    jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=-1', 'next_run_at', proxima));
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
  begin
    perform public.update_recurring_series(s3, jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=-1',
      'next_run_at', (hoje + 4) + time '09:00'));
    raise exception '6: vencimento no mês já pago deveria ser recusado';
  exception when others then if sqlerrm not like 'A de % já está paga: o próximo vencimento vem depois dela' then raise; end if;
  end;
  perform public.update_recurring_series(s3, jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=-1',
    'next_run_at', (date_trunc('month', hoje + 4) + interval '2 month - 1 day')::date + time '09:00'));
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
    begin
      perform public.update_recurring_series(s4, jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=-1',
        'next_run_at', hoje + time '09:00'));
      raise exception '7: vencimento no mês da atrasada deveria ser recusado';
    exception when others then if sqlerrm not like 'A de % ainda está em aberto%' then raise; end if;
    end;
  end if;
end $$;

rollback;
