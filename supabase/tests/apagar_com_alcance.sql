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
  conta uuid; serie uuid; t_pago uuid; t_atrasada uuid; t_ancora uuid; t_depois uuid; t_longe uuid; cartao uuid; t_pai uuid; t_fee uuid;
  r jsonb; n int; chave uuid := gen_random_uuid(); cfg text[];
  plano uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; soma bigint; k int;
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
  assert not exists (select 1 from public.transactions where id = t_ancora), 'a ocorrência sai junto';
  set local role authenticated;

  -- dívida pelo contrato só oferece "todas"
  begin
    perform public.delete_scoped_preview('debt', gen_random_uuid(), 'future');
    n := -1;
  exception when others then
    assert sqlstate = '22023' and sqlerrm = 'Pelo contrato da dívida só existe "todas"', format('debt future: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'debt + future devia ser recusado';

  -- 8) série JÁ encerrada: "das próximas em diante" nunca reabre (end_date só encolhe)
  reset role;
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, end_date, account_id)
  values (ws, u, 'expense', 3000, 'Encerrada AA', 'FREQ=MONTHLY;BYMONTHDAY=7',
          ((hoje - 60) + time '09:00') at time zone 'America/Sao_Paulo',
          ((hoje + 30) + time '09:00') at time zone 'America/Sao_Paulo', hoje - 20, conta)
  returning id into serie;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 3000, 'Encerrada AA', hoje - 30, 'pending', conta, serie);
  set local role authenticated;
  r := public.delete_scoped('recurring', serie, 'future', gen_random_uuid());
  reset role;
  assert (select end_date from public.recurring_transactions where id = serie) = hoje - 20, 'end_date não pode crescer';
  assert (select count(*) from public.transactions where recurring_id = serie) = 1, 'a ocorrência anterior à âncora fica';
  set local role authenticated;

  -- 9) juros do Pix saem com a compra e entram na conta; fatura paga ou paga em parte recusa tudo
  reset role;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day) values (ws, u, 'Cartão AA', 'credit_card', 10, 20) returning id into cartao;
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
  values (ws, u, 'expense', 8000, 'Cartão série AA', 'FREQ=MONTHLY;BYMONTHDAY=3',
          ((hoje - 5) + time '09:00') at time zone 'America/Sao_Paulo',
          ((hoje + 25) + time '09:00') at time zone 'America/Sao_Paulo', cartao)
  returning id into serie;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 8000, 'Cartão série AA', hoje - 5, 'cleared', cartao, serie) returning id into t_pai;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, pix_fee_for_transaction_id)
  values (ws, u, 'expense', 250, 'Juro Pix AA', hoje - 5, 'cleared', cartao, t_pai) returning id into t_fee;
  set local role authenticated;
  r := public.delete_scoped_preview('recurring', serie, 'all');
  assert (r->>'apagadas')::int = 2 and (r->>'pagas_apagadas')::int = 2 and r->>'soma_pagas_cents' = '8250', format('juro do Pix na prévia: %s', r);
  reset role;
  update public.card_invoices set status = 'paid' where id = (select invoice_id from public.transactions where id = t_pai);
  set local role authenticated;
  begin
    perform public.delete_scoped('recurring', serie, 'all', gen_random_uuid());
    n := -1;
  exception when others then
    assert sqlstate = 'P0001' and sqlerrm = 'Há lançamento numa fatura paga, adiada ou paga em parte. Desfaça o pagamento da fatura antes.', format('fatura paga: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'fatura paga devia recusar';
  reset role;
  assert exists (select 1 from public.recurring_transactions where id = serie) and exists (select 1 from public.transactions where id in (t_pai, t_fee)), 'nada mudou';
  update public.card_invoices set status = 'open', paid_cents = 100 where id = (select invoice_id from public.transactions where id = t_pai);
  set local role authenticated;
  begin
    perform public.delete_scoped('occurrence', t_pai, 'one', gen_random_uuid());
    n := -2;
  exception when others then
    assert sqlstate = 'P0001', format('paga em parte: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -2, 'fatura paga em parte devia recusar';

  -- ── Task 2: compra parcelada (conta corrente, 4x de 25,00; a 1ª paga) ──
  reset role;
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, conta, 10000, 4, hoje - 30, 'Fone AA') returning id into plano;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AA (1/4)', hoje - 30, 'cleared', conta, plano, 1) returning id into p1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AA (2/4)', hoje, 'pending', conta, plano, 2) returning id into p2;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AA (3/4)', hoje + 30, 'pending', conta, plano, 3) returning id into p3;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AA (4/4)', hoje + 60, 'pending', conta, plano, 4) returning id into p4;
  set local role authenticated;

  -- "Só esta" na 4ª: o total vira a soma das que ficam
  r := public.delete_scoped('installment', p4, 'one', gen_random_uuid());
  reset role;
  select total_cents, installments into soma, k from public.installment_plans where id = plano;
  assert soma = 7500 and k = 3, format('só esta: total %s, parcelas %s', soma, k);
  set local role authenticated;

  -- "Esta e as próximas" na 3ª: sobram 1ª e 2ª, total 5000
  r := public.delete_scoped('installment', p3, 'future', gen_random_uuid());
  reset role;
  select total_cents, installments into soma, k from public.installment_plans where id = plano;
  assert soma = 5000 and k = 2, format('futuras: total %s, parcelas %s', soma, k);
  set local role authenticated;

  -- sobrar UMA: a 2ª sai e a 1ª vira lançamento à vista; o plano some
  r := public.delete_scoped('installment', p2, 'one', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.installment_plans where id = plano), 'sobrando uma, o plano sai';
  assert (select installment_plan_id is null and installment_no is null and description = 'Fone AA'
          from public.transactions where id = p1), 'a sobrevivente vira lançamento à vista com o nome da compra';
  set local role authenticated;

  -- "Esta e as próximas" pela 1ª = a compra inteira (com a paga)
  reset role;
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, conta, 6000, 2, hoje - 30, 'Tênis AA') returning id into plano;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 3000, 'Tênis AA (1/2)', hoje - 30, 'cleared', conta, plano, 1) returning id into p1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 3000, 'Tênis AA (2/2)', hoje + 30, 'pending', conta, plano, 2) returning id into p2;
  set local role authenticated;
  r := public.delete_scoped_preview('installment', p1, 'future');
  assert (r->>'apagadas')::int = 2 and (r->>'pagas_apagadas')::int = 1 and (r->>'apaga_contrato')::boolean,
    format('a partir da 1ª: %s', r);
  r := public.delete_scoped('plan', plano, 'all', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.installment_plans where id = plano), 'todas: o plano sai';
  assert not exists (select 1 from public.transactions where id in (p1, p2)), 'todas: as parcelas saem';
  set local role authenticated;

  -- BLOCOS DAS PRÓXIMAS TAREFAS ENTRAM AQUI
  reset role;
end $$;

rollback;
