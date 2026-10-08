-- A Projeção com hipóteses é o real com as hipóteses gravadas (20261010140000): o adiantamento do
-- rascunho é APLICADO dentro de `simular`, e o ciclo do mês da parcela adiantada não a lista mais.
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, instance_id, aud, role, phone, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-0000000ad002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999993002', '{}', '{}');

do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000ad002';
  ws uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  conta uuid; plano uuid; p3 uuid; p4 uuid; item jsonb; r jsonb; mes4 date;
  cartao uuid; planoc uuid; c4 uuid; fatura4 uuid; mesf date;
  n int;
begin
  select id into ws from public.workspaces where owner_id = u;
  insert into public.accounts (workspace_id, user_id, name, type) values (ws, u, 'Conta SIM', 'checking') returning id into conta;
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, conta, 40000, 4, hoje - 30, 'Mac SIM') returning id into plano;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 10000, 'Mac SIM (1/4)', hoje - 30, 'cleared', conta, plano, 1),
         (ws, u, 'expense', 10000, 'Mac SIM (2/4)', private.add_months(hoje, 1), 'pending', conta, plano, 2);
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 10000, 'Mac SIM (3/4)', private.add_months(hoje, 2), 'pending', conta, plano, 3) returning id into p3;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 10000, 'Mac SIM (4/4)', private.add_months(hoje, 3), 'pending', conta, plano, 4) returning id into p4;
  mes4 := date_trunc('month', private.add_months(hoje, 3))::date;
  -- no cartão: a 4ª mora numa fatura futura
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
    values (ws, u, 'Cartão SIM', 'credit_card', 1, 10) returning id into cartao;
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, cartao, 40000, 4, hoje, 'Mac CARTAO') returning id into planoc;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 10000, 'Mac CARTAO (1/4)', hoje, 'pending', cartao, planoc, 1),
         (ws, u, 'expense', 10000, 'Mac CARTAO (2/4)', private.add_months(hoje, 1), 'pending', cartao, planoc, 2),
         (ws, u, 'expense', 10000, 'Mac CARTAO (3/4)', private.add_months(hoje, 2), 'pending', cartao, planoc, 3);
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 10000, 'Mac CARTAO (4/4)', private.add_months(hoje, 3), 'pending', cartao, planoc, 4) returning id into c4;
  select t.invoice_id, date_trunc('month', ci.due_date)::date into fatura4, mesf
    from public.transactions t join public.card_invoices ci on ci.id = t.invoice_id where t.id = c4;

  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- a conta da origem vem nas candidatas: é o padrão do campo "Conta ou cartão"
  select x into item from jsonb_array_elements(public.anticipation_candidates(hoje)) x where x->>'ref_id' = plano::text;
  assert (item->>'account_id')::uuid = conta, format('conta da origem: %s', item);

  -- sem a hipótese, o ciclo da 4ª lista a parcela
  select count(*) into n from public.cycle_lines(mes4, 'civil') c where c.ref_id = p4;
  assert n = 1, format('o ciclo real lista a 4ª: %s', n);

  -- com a hipótese de adiantar a 3ª e a 4ª hoje, ele não lista mais; o pagamento está no mês de hoje
  r := public.simular(
    jsonb_build_array(jsonb_build_object('tipo', 'adiantamento', 'dados', jsonb_build_object(
      'source', 'plan', 'ref_id', plano, 'paid_on', hoje, 'amount_cents', 18000, 'account_id', conta,
      'description', 'Adiantei 2 do Mac', 'parcelas', jsonb_build_array(jsonb_build_object('id', p3), jsonb_build_object('id', p4))))),
    jsonb_build_object('linhas_do_ciclo', jsonb_build_object('mes', mes4, 'view', 'civil'),
                       'detalhe_do_ciclo', jsonb_build_object('mes', mes4, 'view', 'civil')));
  assert jsonb_array_length(r->'erros') = 0, format('sem erro: %s', r->'erros');
  assert not exists (select 1 from jsonb_array_elements(r->'leituras'->'linhas_do_ciclo') l where (l->>'ref_id')::uuid = p4),
    format('a 4ª saiu do ciclo dela: %s', r->'leituras'->'linhas_do_ciclo');
  assert r->'leituras'->'detalhe_do_ciclo' is not null, 'o detalhe do ciclo vem simulado';
  assert jsonb_array_length(r->'criados'->0->'ids') = 1, format('o lançamento criado: %s', r->'criados');

  -- nada ficou: a simulação é desfeita
  assert exists (select 1 from public.transactions where id = p4 and adiantamento is null), 'a 4ª continua real';
  assert not exists (select 1 from public.transactions where installment_plan_id = plano and adiantamento is not null), 'sem adiantamento gravado';

  -- a fatura do mês da 4ª, aberta no ciclo: sem a hipótese tem a 4ª, com ela não
  r := public.simular('[]'::jsonb, jsonb_build_object('compras_das_faturas', jsonb_build_object('mes', mesf, 'view', 'civil')));
  assert exists (select 1 from jsonb_array_elements(r->'leituras'->'compras_das_faturas'->(fatura4::text)) x where (x->>'id')::uuid = c4),
    format('a fatura real lista a 4ª: %s', r);
  r := public.simular(
    jsonb_build_array(jsonb_build_object('tipo', 'adiantamento', 'dados', jsonb_build_object(
      'source', 'plan', 'ref_id', planoc, 'paid_on', hoje, 'amount_cents', 9500, 'account_id', cartao,
      'description', 'Adiantei a última', 'parcelas', jsonb_build_array(jsonb_build_object('id', c4))))),
    jsonb_build_object('compras_das_faturas', jsonb_build_object('mes', mesf, 'view', 'civil')));
  assert jsonb_array_length(r->'erros') = 0, format('cartão: %s', r->'erros');
  assert not exists (select 1 from jsonb_array_elements(coalesce(r->'leituras'->'compras_das_faturas'->(fatura4::text), '[]'::jsonb)) x
                      where (x->>'id')::uuid = c4 and x->>'adiantamento' is null),
    format('a 4ª saiu da fatura dela: %s', r->'leituras');

  -- sem conta vale, como em todo lançamento
  r := public.simular(
    jsonb_build_array(jsonb_build_object('tipo', 'adiantamento', 'dados', jsonb_build_object(
      'source', 'plan', 'ref_id', plano, 'paid_on', hoje, 'amount_cents', 9000,
      'description', 'Adiantei a última', 'parcelas', jsonb_build_array(jsonb_build_object('id', p4))))),
    jsonb_build_object('linhas_do_ciclo', jsonb_build_object('mes', mes4, 'view', 'civil')));
  assert jsonb_array_length(r->'erros') = 0, format('sem conta: %s', r->'erros');

  -- e de verdade também: sem conta, pago hoje
  r := public.apply_anticipation(jsonb_build_object(
    'source', 'plan', 'ref_id', plano, 'paid_on', hoje, 'amount_cents', 9000,
    'description', 'Adiantei a última', 'parcelas', jsonb_build_array(jsonb_build_object('id', p4))), gen_random_uuid());
  assert (select account_id is null and status = 'cleared' from public.transactions where id = (r->>'id')::uuid),
    'sem conta: pago na data, fora de conta';
end $$;

rollback;
