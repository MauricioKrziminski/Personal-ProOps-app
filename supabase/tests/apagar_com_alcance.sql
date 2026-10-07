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
  plano uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; soma bigint; k int; ent uuid; q1 uuid; q2 uuid; q3 uuid; q4 uuid;
  lem uuid; filho uuid; fatura uuid; compra uuid;
  d uuid; pg1 uuid; pg2 uuid; pg3 uuid; restante bigint;
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

  -- ── Fix round 1: renumerar, fatura travada, entrada, âncora do contrato ──
  -- "Só esta" na 2ª de 4: sobram 1,2,3 com rótulo (k/3); renomear a compra depois mantém as 3
  reset role;
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, conta, 12000, 4, hoje - 30, 'Mesa BB') returning id into plano;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  select ws, u, 'expense', 3000, 'Mesa BB (' || i || '/4)', hoje - 30 + 30 * (i - 1), case when i = 1 then 'cleared' else 'pending' end, conta, plano, i
  from generate_series(1, 4) i;
  set local role authenticated;
  r := public.delete_scoped_preview('installment', (select id from public.transactions where installment_plan_id = plano and installment_no = 2), 'one');
  assert (r->>'apagadas')::int = 1 and (r->>'vira_avista')::boolean = false and (r->>'apaga_contrato')::boolean = false, format('prévia: %s', r);
  reset role;
  assert (select count(*) from public.transactions where installment_plan_id = plano) = 4, 'a prévia não escreve';
  set local role authenticated;
  r := public.delete_scoped('installment', (select id from public.transactions where installment_plan_id = plano and installment_no = 2), 'one', gen_random_uuid());
  reset role;
  assert (select array_agg(installment_no order by installment_no) from public.transactions where installment_plan_id = plano) = array[1,2,3], 'renumera 1..3';
  assert (select array_agg(description order by installment_no) from public.transactions where installment_plan_id = plano)
         = array['Mesa BB (1/3)', 'Mesa BB (2/3)', 'Mesa BB (3/3)'], 'rótulos (k/3)';
  assert (select total_cents = 9000 and installments = 3 and first_occurred_at = hoje - 30 from public.installment_plans where id = plano), 'total e 1ª data';
  set local role authenticated;
  perform public.update_installment_plan(plano, 9000, 3, hoje - 30, 'Mesa CC', null, null, conta, null);
  reset role;
  assert (select count(*) = 3 and array_agg(installment_no order by installment_no) = array[1,2,3]
          from public.transactions where installment_plan_id = plano), 'renomear mantém as 3 parcelas';
  set local role authenticated;

  -- "Só esta" na 1ª: a 2ª vira a primeira e o plano passa a começar na data dela
  reset role;
  r := null;
  set local role authenticated;
  r := public.delete_scoped('installment', (select id from public.transactions where installment_plan_id = plano and installment_no = 1), 'one', gen_random_uuid());
  reset role;
  assert (select first_occurred_at from public.installment_plans where id = plano) = hoje + 30, 'first_occurred_at = a nova 1ª';
  assert (select array_agg(installment_no order by installment_no) from public.transactions where installment_plan_id = plano) = array[1,2], 'renumera 1..2';
  delete from public.installment_plans where id = plano;

  -- parcela TRAVADA (fatura paga) fica onde está ao renumerar, e a compra segue editável
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, cartao, 8000, 4, hoje - 70, 'Sofá BB') returning id into plano;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2000, 'Sofá BB (1/4)', hoje - 70, 'pending', cartao, plano, 1) returning id into q1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2000, 'Sofá BB (2/4)', hoje - 40, 'pending', cartao, plano, 2) returning id into q2;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2000, 'Sofá BB (3/4)', hoje + 20, 'pending', cartao, plano, 3) returning id into q3;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2000, 'Sofá BB (4/4)', hoje + 50, 'pending', cartao, plano, 4) returning id into q4;
  update public.card_invoices set status = 'paid' where id = (select invoice_id from public.transactions where id = q1);
  set local role authenticated;
  -- recusa: a travada pela parcela e pelo contrato inteiro
  begin
    perform public.delete_scoped('installment', q1, 'one', gen_random_uuid());
    n := -3;
  exception when others then
    assert sqlstate = 'P0001', format('travada (parcela): %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -3, 'parcela em fatura paga devia recusar';
  begin
    perform public.delete_scoped('plan', plano, 'all', gen_random_uuid());
    n := -4;
  exception when others then
    assert sqlstate = 'P0001', format('travada (plano): %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -4, 'compra com parcela em fatura paga devia recusar';
  -- apagar uma em aberto renumera sem tirar a travada da fatura
  reset role;
  select invoice_id into ent from public.transactions where id = q1;
  set local role authenticated;
  r := public.delete_scoped('installment', q3, 'one', gen_random_uuid());
  reset role;
  assert (select invoice_id = ent and occurred_at = hoje - 70 and installment_no = 1 and description = 'Sofá BB (1/3)'
          from public.transactions where id = q1), 'a travada continua na fatura, com data e número';
  assert (select array_agg(installment_no order by installment_no) from public.transactions where installment_plan_id = plano) = array[1,2,3], 'renumera com travada';
  set local role authenticated;
  perform public.update_installment_plan(plano, 6000, 3, hoje - 70, 'Sofá CC', null, null, cartao, null);
  reset role;
  assert (select count(*) = 3 from public.transactions where installment_plan_id = plano), 'compra com travada segue editável';
  delete from public.transactions where installment_plan_id = plano;
  delete from public.installment_plans where id = plano;

  -- "Esta e as próximas" pelo contrato ancora na primeira EM ABERTO (a 1ª paga fica): sobra 1 = à vista
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, conta, 9000, 3, hoje - 30, 'Cama BB') returning id into plano;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  select ws, u, 'expense', 3000, 'Cama BB (' || i || '/3)', hoje - 30 + 30 * (i - 1), case when i = 1 then 'cleared' else 'pending' end, conta, plano, i
  from generate_series(1, 3) i;
  -- entrada já paga, ligada ao plano
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, down_payment_plan_id)
  values (ws, u, 'expense', 1000, 'Entrada Cama BB', hoje - 30, 'cleared', conta, plano) returning id into ent;
  set local role authenticated;
  r := public.delete_scoped_preview('plan', plano, 'future');
  assert (r->>'apagadas')::int = 2 and (r->>'vira_avista')::boolean, format('contrato, a partir da primeira em aberto: %s', r);
  r := public.delete_scoped('plan', plano, 'future', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.installment_plans where id = plano), 'sobrou uma: o plano sai';
  assert (select installment_plan_id is null and description = 'Cama BB' from public.transactions where installment_plan_id is null and description = 'Cama BB' and occurred_at = hoje - 30), 'a 1ª virou à vista';
  assert exists (select 1 from public.transactions where id = ent and down_payment_plan_id is null), 'a entrada fica (avulsa)';

  -- não sobra parcela nenhuma: é a compra inteira e a entrada entra na prévia e sai junto
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, conta, 4000, 2, hoje + 5, 'Rack BB') returning id into plano;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2000, 'Rack BB (2/2)', hoje + 5, 'pending', conta, plano, 2) returning id into q1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, down_payment_plan_id)
  values (ws, u, 'expense', 500, 'Entrada Rack BB', hoje - 1, 'cleared', conta, plano) returning id into ent;
  set local role authenticated;
  r := public.delete_scoped_preview('installment', q1, 'one');
  assert (r->>'apagadas')::int = 2 and (r->'apaga_contrato')::boolean, format('0 sobrando = contrato com entrada: %s', r);
  r := public.delete_scoped('installment', q1, 'one', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.transactions where id in (q1, ent)) and not exists (select 1 from public.installment_plans where id = plano), 'compra e entrada saem';
  set local role authenticated;

  -- ── Task 3: financiamento de parcela fixa, 6x de 100,00, três pagas ──
  reset role;
  insert into public.debts(workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents, due_day, first_due_date, account_id)
  values (ws, u, 'Moto AA', 'financing', 'fixed_installments', 60000, 60000, 0, 6, 0, 10000, 10, hoje - 80, conta)
  returning id into d;
  perform public.pay_debt_installment(d, 10000, conta, hoje - 80);
  perform public.pay_debt_installment(d, 10000, conta, hoje - 50);
  perform public.pay_debt_installment(d, 10000, conta, hoje - 20);
  select id into pg1 from public.transactions where debt_id = d and debt_payment_no = 1;
  select id into pg2 from public.transactions where debt_id = d and debt_payment_no = 2;
  set local role authenticated;

  -- "Este e os próximos" a partir do 2º: saem o 3º e o 2º (do mais recente para trás); o saldo volta
  r := public.delete_scoped_preview('debt_payment', pg2, 'future');
  assert (r->>'apagadas')::int = 2 and (r->>'pagas_apagadas')::int = 2 and r->>'soma_pagas_cents' = '20000',
    format('prévia pagamentos: %s', r);
  reset role;
  assert (select count(*) from public.transactions where debt_id = d) = 3
     and (select remaining_cents from public.debts where id = d) = 30000, 'a prévia não escreve';
  set local role authenticated;
  r := public.delete_scoped('debt_payment', pg2, 'future', gen_random_uuid());
  reset role;
  select remaining_cents into restante from public.debts where id = d;
  assert restante = 50000, format('o saldo volta a 50000, veio %s', restante);
  assert (select installments_paid from public.debts where id = d) = 1, 'volta a 1 paga';
  assert (select count(*) from public.transactions where debt_id = d) = 1, 'fica só o 1º pagamento';
  set local role authenticated;

  -- "Todos" = a dívida inteira com os pagamentos
  r := public.delete_scoped('debt_payment', pg1, 'all', gen_random_uuid());
  assert (r->>'apaga_contrato')::boolean, format('todos apaga o contrato: %s', r);
  reset role;
  assert not exists (select 1 from public.debts where id = d), 'a dívida sai';
  set local role authenticated;

  -- ── Task 4: lembrete que repete ──
  reset role;
  insert into public.reminders (user_id, workspace_id, title, recurrence, next_run_at, timezone, channel, active, source)
  values (u, ws, 'Remédio AA', 'FREQ=DAILY', now() + interval '1 hour', 'America/Sao_Paulo', 'push', true, 'app')
  returning id into lem;
  set local role authenticated;
  r := public.delete_scoped_preview('reminder', lem, 'one');
  reset role;
  assert (select skip_run_at is null from public.reminders where id = lem), 'a prévia não escreve';
  set local role authenticated;
  r := public.delete_scoped('reminder', lem, 'one', gen_random_uuid());
  reset role;
  assert (select skip_run_at = next_run_at from public.reminders where id = lem), 'só esta pula a próxima vez';
  update public.reminders set skip_run_at = null where id = lem;
  insert into public.reminders (user_id, workspace_id, title, next_run_at, timezone, channel, active, source, parent_reminder_id, original_run_at)
  select u, ws, 'Remédio AA (antes)', next_run_at - interval '30 minutes', 'America/Sao_Paulo', 'push', true, 'app', id, next_run_at
    from public.reminders where id = lem returning id into filho;
  update public.reminders set skip_run_at = next_run_at where id = lem;
  set local role authenticated;
  r := public.delete_scoped('reminder', filho, 'one', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.reminders where id = filho), 'o filho sai';
  assert (select skip_run_at = next_run_at from public.reminders where id = lem), 'a vez continua pulada';
  set local role authenticated;
  begin
    perform public.delete_scoped_preview('reminder', lem, 'future');
    n := -1;
  exception when others then
    assert sqlstate = '22023', format('lembrete future: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'future em lembrete devia ser recusado';
  -- (a) "Só esta" no pai com edição pendente da mesma vez: o filho sai também
  reset role;
  update public.reminders set skip_run_at = null where id = lem;
  insert into public.reminders (user_id, workspace_id, title, next_run_at, timezone, channel, active, source, parent_reminder_id, original_run_at)
  select u, ws, 'Remédio AA (depois)', next_run_at + interval '5 minutes', 'America/Sao_Paulo', 'push', true, 'app', id, next_run_at
    from public.reminders where id = lem returning id into filho;
  set local role authenticated;
  r := public.delete_scoped('reminder', lem, 'one', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.reminders where id = filho), 'só esta leva a edição pendente da mesma vez';
  assert (select skip_run_at = next_run_at from public.reminders where id = lem), 'e a vez fica pulada';
  -- (b)+(c) "Todas" pelo filho: conta pai + filhos e apaga tudo
  reset role;
  insert into public.reminders (user_id, workspace_id, title, next_run_at, timezone, channel, active, source, parent_reminder_id, original_run_at)
  select u, ws, 'Remédio AA (filho)', next_run_at + interval '5 minutes', 'America/Sao_Paulo', 'push', true, 'app', id, next_run_at
    from public.reminders where id = lem returning id into filho;
  set local role authenticated;
  r := public.delete_scoped_preview('reminder', filho, 'all');
  assert (r->>'apagadas')::int = 2, format('prévia conta pai + filho: %s', r);
  r := public.delete_scoped('reminder', filho, 'all', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.reminders where id in (lem, filho) or parent_reminder_id = lem), 'todas apaga pai e filhos';
  -- só esta num lembrete avulso apaga a linha
  insert into public.reminders (user_id, workspace_id, title, next_run_at, timezone, channel, active, source)
  values (u, ws, 'Avulso AA', now() + interval '2 hours', 'America/Sao_Paulo', 'push', true, 'app') returning id into lem;
  set local role authenticated;
  r := public.delete_scoped('reminder', lem, 'one', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.reminders where id = lem), 'avulso: só esta apaga';
  -- lembrete de outro membro
  insert into public.reminders (user_id, workspace_id, title, next_run_at, timezone, channel, active, source)
  values (outro, ws_outro, 'Alheio AA', now() + interval '2 hours', 'America/Sao_Paulo', 'push', true, 'app') returning id into lem;
  set local role authenticated;
  n := 0;
  begin
    perform public.delete_scoped('reminder', lem, 'one', gen_random_uuid());
    n := -1;
  exception when others then
    assert sqlerrm = 'Esse registro não existe mais', format('alheio: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'lembrete alheio devia ser recusado';
  set local role authenticated;

  -- ── Task 5: fatura paga em parte não fica com total abaixo do pago ──
  reset role;
  insert into public.card_invoices (workspace_id, user_id, account_id, reference_month, closing_date, due_date, paid_cents)
  values (ws, u, cartao, date '2031-03-01', hoje - 5, hoje + 2, 5000) returning id into fatura;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, invoice_id)
  values (ws, u, 'expense', 6000, 'Mercado AA', hoje - 10, 'pending', cartao, fatura) returning id into compra;
  update public.transactions set invoice_id = fatura where id = compra;
  set local role authenticated;
  n := 0;
  begin
    delete from public.transactions where id = compra;
    n := -1;
  exception when others then
    assert sqlstate = 'P0001' and sqlerrm like 'A fatura de % já tem pagamento:%', format('fatura parcial: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'apagar a compra devia ser recusado';

  -- BLOCOS DAS PRÓXIMAS TAREFAS ENTRAM AQUI
  reset role;
end $$;

rollback;
