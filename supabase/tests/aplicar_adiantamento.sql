-- Aplicar o adiantamento do "E se…?" (08/10/2026): um lançamento só, a origem muda, apagar desfaz.
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, instance_id, aud, role, phone, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-0000000ad001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999993001', '{}', '{}');

do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000ad001';
  ws uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  conta uuid; cartao uuid; plano uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid;
  item jsonb; r jsonb; chave uuid := gen_random_uuid(); n int; soma bigint; t record;
  divida uuid; serie uuid; o1 uuid; o2 uuid; d1 date; d2 date; d3 date; plano2 uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid;
begin
  select id into ws from public.workspaces where owner_id = u;
  insert into public.accounts (workspace_id, user_id, name, type) values (ws, u, 'Conta AD', 'checking') returning id into conta;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
    values (ws, u, 'Cartão AD', 'credit_card', 10, 20) returning id into cartao;

  -- compra em 6x na conta: a 1ª paga, as outras uma por mês
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, conta, 15000, 6, hoje - 30, 'Fone AD') returning id into plano;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AD (1/6)', hoje - 30, 'cleared', conta, plano, 1) returning id into p1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AD (2/6)', private.add_months(hoje, 1), 'pending', conta, plano, 2) returning id into p2;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AD (3/6)', private.add_months(hoje, 2), 'pending', conta, plano, 3) returning id into p3;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AD (4/6)', private.add_months(hoje, 3), 'pending', conta, plano, 4) returning id into p4;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AD (5/6)', private.add_months(hoje, 4), 'pending', conta, plano, 5) returning id into p5;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AD (6/6)', private.add_months(hoje, 5), 'pending', conta, plano, 6) returning id into p6;

  -- financiamento de parcela fixa: 10 × R$ 100, 2 pagas, a 3ª vence daqui a 5 dias
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents, remaining_cents,
                            interest_rate_monthly, installments, installments_paid, installment_cents, due_day, first_due_date)
  values (ws, u, 'Moto AD', 'financing', 'fixed_installments', 100000, 80000, 0, 10, 2, 10000,
          extract(day from hoje + 5)::int, private.add_months(hoje + 5, -2))
  returning id into divida;

  -- recorrente no dia 15: as duas próximas geradas, o resto só na regra
  d1 := (date_trunc('month', hoje) + interval '1 month' + interval '14 days')::date;
  d2 := private.add_months(d1, 1);
  d3 := private.add_months(d1, 2);
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, category, rrule,
                                             dtstart, next_run_at, account_id, materialized_until)
  values (ws, u, 'expense', 5000, 'Academia AD', 'saúde', 'FREQ=MONTHLY;BYMONTHDAY=15',
          (d1 + time '09:00') at time zone 'America/Sao_Paulo', (d1 + time '09:00') at time zone 'America/Sao_Paulo',
          conta, (d2 + time '23:00') at time zone 'America/Sao_Paulo')
  returning id into serie;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, category, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 5000, 'Academia AD', 'saúde', d1, 'pending', conta, serie) returning id into o1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, category, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 5000, 'Academia AD', 'saúde', d2, 'pending', conta, serie) returning id into o2;

  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ── 1) as candidatas trazem a identidade de cada parcela ───────────────────────────────────
  select x into item from jsonb_array_elements(public.anticipation_candidates(hoje)) x where x->>'ref_id' = plano::text;
  assert jsonb_array_length(item->'events') = 5, format('5 a vencer: %s', item);
  assert exists (select 1 from jsonb_array_elements(item->'events') e where e->>'id' = p6::text and (e->>'n')::int = 6),
    'evento com id e número';

  -- ── 2) compra: adianta as 2 últimas pagando R$ 45 (eram R$ 50) hoje ────────────────────────
  r := public.apply_anticipation(jsonb_build_object(
         'source', 'plan', 'ref_id', plano, 'paid_on', hoje, 'amount_cents', 4500, 'account_id', conta,
         'description', 'Adiantamento de 2 parcelas de Fone AD',
         'parcelas', jsonb_build_array(jsonb_build_object('id', p5), jsonb_build_object('id', p6))), chave);
  assert (r->>'id')::uuid = p5, format('o lançamento é a 1ª coberta: %s', r);
  select * into t from public.transactions where id = p5;
  assert t.amount_cents = 4500 and t.expected_amount_cents = 5000 and t.status = 'cleared' and t.paid_at = hoje
     and t.occurred_at = hoje and t.installment_no = 5 and t.description = 'Adiantamento de 2 parcelas de Fone AD',
    format('lançamento do adiantamento: %s', row_to_json(t));
  assert jsonb_array_length(t.adiantamento->'parcelas') = 2, 'guarda as duas cobertas';
  assert not exists (select 1 from public.transactions where id = p6), 'a 6ª saiu';
  select total_cents, installments into soma, n from public.installment_plans where id = plano;
  assert soma = 4 * 2500 + 4500 and n = 6, format('total %s e 6x mantidas (%s)', soma, n);

  -- mesma chave = recibo; mesma chave com outro pedido = recusa
  r := public.apply_anticipation(jsonb_build_object(
         'source', 'plan', 'ref_id', plano, 'paid_on', hoje, 'amount_cents', 4500, 'account_id', conta,
         'description', 'Adiantamento de 2 parcelas de Fone AD',
         'parcelas', jsonb_build_array(jsonb_build_object('id', p5), jsonb_build_object('id', p6))), chave);
  assert (r->>'id')::uuid = p5, 'repetição devolve o recibo';
  begin
    perform public.apply_anticipation(jsonb_build_object(
         'source', 'plan', 'ref_id', plano, 'paid_on', hoje, 'amount_cents', 1, 'account_id', conta,
         'description', 'x', 'parcelas', jsonb_build_array(jsonb_build_object('id', p4))), chave);
    assert false, 'chave reutilizada devia recusar';
  exception when sqlstate '22023' then null;
  end;

  -- o adiantamento não é mais candidato
  select x into item from jsonb_array_elements(public.anticipation_candidates(hoje)) x where x->>'ref_id' = plano::text;
  assert not exists (select 1 from jsonb_array_elements(item->'events') e where e->>'id' = p5::text), 'adiantamento fora das candidatas';

  -- ── 3) o lançamento não muda por tabela ───────────────────────────────────────────────────
  update public.transactions set amount_cents = 1, description = 'x', occurred_at = hoje + 90 where id = p5;
  select * into t from public.transactions where id = p5;
  assert t.amount_cents = 4500 and t.description = 'Adiantamento de 2 parcelas de Fone AD' and t.occurred_at = hoje,
    'escrita direta não desfaz o adiantamento';
  begin
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, adiantamento)
    values (ws, u, 'expense', 1, 'x', hoje, '{"source":"debt"}');
    assert false, 'adiantamento só nasce pelo aplicar';
  exception when sqlstate '42501' then null;
  end;

  -- propagar valor "desta em diante" pula o adiantamento
  perform public.update_transaction_scoped(p2, 'future', jsonb_build_object('amount_cents', 3000));
  assert (select amount_cents from public.transactions where id = p3) = 3000, 'a 3ª recebeu o valor';
  assert (select amount_cents from public.transactions where id = p5) = 4500, 'o adiantamento ficou';

  -- editar a compra não recria as cobertas nem reparte no adiantamento
  perform public.update_installment_plan(plano, 20000, 6, hoje - 30, 'Fone AD', null, null, conta, null);
  assert not exists (select 1 from public.transactions where installment_plan_id = plano and installment_no = 6),
    'a 6ª não renasce';
  assert (select amount_cents from public.transactions where id = p5) = 4500, 'sem repartir no adiantamento';
  assert (select description from public.transactions where id = p2) = 'Fone AD (2/6)', 'número das que ficam';
  select sum(amount_cents) into soma from public.transactions where installment_plan_id = plano;
  assert soma = 20000, format('soma fecha com o total: %s', soma);

  -- ── 4) editar o adiantamento ─────────────────────────────────────────────────────────────
  perform public.edit_anticipation(p5, jsonb_build_object('description', 'Adiantei Fone', 'amount_cents', 4000,
                                                          'paid_on', hoje, 'account_id', conta));
  select * into t from public.transactions where id = p5;
  assert t.amount_cents = 4000 and t.description = 'Adiantei Fone' and t.expected_amount_cents = 5000, 'editado';
  assert (select total_cents from public.installment_plans where id = plano) = 19500, 'total acompanha';

  -- ── 5) "Só esta" sobre o adiantamento DESFAZ ─────────────────────────────────────────────
  r := public.delete_scoped('installment', p5, 'one', gen_random_uuid());
  select * into t from public.transactions where id = p5;
  assert t.adiantamento is null and t.amount_cents = 2500 and t.status = 'pending' and t.description = 'Fone AD (5/6)'
     and t.occurred_at = private.add_months(hoje, 4), format('a 5ª voltou: %s', row_to_json(t));
  select * into t from public.transactions where id = p6;
  assert t.id is not null and t.installment_no = 6 and t.amount_cents = 2500, 'a 6ª voltou com o mesmo id';
  select sum(amount_cents) into soma from public.transactions where installment_plan_id = plano;
  assert soma = (select total_cents from public.installment_plans where id = plano), 'total = soma depois de desfazer';

  -- ── 6) apagar parcela renumera pelo PESO ──────────────────────────────────────────────────
  perform public.apply_anticipation(jsonb_build_object(
         'source', 'plan', 'ref_id', plano, 'paid_on', hoje + 3, 'amount_cents', 5000, 'account_id', conta,
         'description', 'Adiantei 3 e 4',
         'parcelas', jsonb_build_array(jsonb_build_object('id', p3), jsonb_build_object('id', p4))), gen_random_uuid());
  assert (select status from public.transactions where id = p3) = 'pending', 'data futura fica em aberto';
  perform public.delete_scoped('installment', p2, 'one', gen_random_uuid());
  assert (select installments from public.installment_plans where id = plano) = 5, 'compra com 5';
  assert (select installment_no from public.transactions where id = p3) = 2, 'o adiantamento começa no 2';
  assert (select array_agg((e->>'n')::int order by (e->>'n')::int)
            from public.transactions x, jsonb_array_elements(x.adiantamento->'parcelas') e where x.id = p3) = array[2, 3],
    'as cobertas acompanham';
  assert (select installment_no from public.transactions where id = p5) = 4
     and (select description from public.transactions where id = p5) = 'Fone AD (4/5)', 'a seguinte vira 4/5';
  assert (select description from public.transactions where id = p3) = 'Adiantei 3 e 4', 'título do adiantamento fica';

  -- ── 7) compra no cartão: o adiantamento entra na fatura da data, em aberto ─────────────────
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, cartao, 3000, 3, hoje, 'Tênis AD') returning id into plano2;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 1000, 'Tênis AD (1/3)', hoje, 'pending', cartao, plano2, 1) returning id into c1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 1000, 'Tênis AD (2/3)', private.add_months(hoje, 1), 'pending', cartao, plano2, 2) returning id into c2;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 1000, 'Tênis AD (3/3)', private.add_months(hoje, 2), 'pending', cartao, plano2, 3) returning id into c3;
  perform public.apply_anticipation(jsonb_build_object(
         'source', 'plan', 'ref_id', plano2, 'paid_on', hoje, 'amount_cents', 1900, 'account_id', cartao,
         'description', 'Adiantei Tênis',
         'parcelas', jsonb_build_array(jsonb_build_object('id', c3), jsonb_build_object('id', c2))), gen_random_uuid());
  select * into t from public.transactions where id = c2;
  assert t.status = 'pending' and t.invoice_id = (select invoice_id from public.transactions where id = c1),
    'no cartão, em aberto e na fatura da data (a mesma da 1ª)';

  -- ── 8) financiamento: as últimas encurtam, apagar devolve ─────────────────────────────────
  select x into item from jsonb_array_elements(public.anticipation_candidates(hoje)) x where x->>'ref_id' = divida::text;
  assert (select count(*) from jsonb_array_elements(item->'events')) = 8, format('3ª a 10ª: %s', item);
  begin
    perform public.apply_anticipation(jsonb_build_object(
           'source', 'debt', 'ref_id', divida, 'paid_on', hoje, 'amount_cents', 19000, 'account_id', cartao,
           'description', 'x', 'parcelas', jsonb_build_array(jsonb_build_object('n', 10))), gen_random_uuid());
    assert false, 'dívida não sai de cartão';
  exception when sqlstate 'P0001' then null;
  end;
  r := public.apply_anticipation(jsonb_build_object(
         'source', 'debt', 'ref_id', divida, 'paid_on', hoje, 'amount_cents', 19000, 'account_id', conta,
         'description', 'Adiantei 2 da moto',
         'parcelas', jsonb_build_array(jsonb_build_object('n', 9), jsonb_build_object('n', 10))), gen_random_uuid());
  assert (select installments from public.debts where id = divida) = 8
     and (select principal_cents from public.debts where id = divida) = 80000
     and (select remaining_cents from public.debts where id = divida) = 60000, 'prazo encurtou e o saldo caiu 2 parcelas';
  select * into t from public.transactions where id = (r->>'id')::uuid;
  assert t.amount_cents = 19000 and t.expected_amount_cents = 20000 and t.status = 'cleared'
     and t.adiantamento->>'modo' = 'ultimas', format('pagamento único: %s', row_to_json(t));
  delete from public.transactions where id = (r->>'id')::uuid;
  assert (select installments from public.debts where id = divida) = 10
     and (select remaining_cents from public.debts where id = divida) = 80000, 'apagar devolveu o contrato';

  -- as próximas contam pagas; a dívida que mudou depois recusa o desfazer
  r := public.apply_anticipation(jsonb_build_object(
         'source', 'debt', 'ref_id', divida, 'paid_on', hoje, 'amount_cents', 20000, 'account_id', conta,
         'description', 'Adiantei a 3 e a 4',
         'parcelas', jsonb_build_array(jsonb_build_object('n', 3), jsonb_build_object('n', 4))), gen_random_uuid());
  assert (select installments_paid from public.debts where id = divida) = 4
     and (select remaining_cents from public.debts where id = divida) = 60000, 'próximas: 4 pagas';
  update public.debts set remaining_cents = 50000, installments_paid = 5 where id = divida;
  begin
    delete from public.transactions where id = (r->>'id')::uuid;
    assert false, 'dívida mudou: recusa';
  exception when sqlstate 'P0001' then null;
  end;
  update public.debts set remaining_cents = 60000, installments_paid = 4 where id = divida;
  delete from public.transactions where id = (r->>'id')::uuid;
  assert (select installments_paid from public.debts where id = divida) = 2, 'desfeito';

  -- ── 9) recorrente: geradas e só previstas saem, apagar devolve ─────────────────────────────
  r := public.apply_anticipation(jsonb_build_object(
         'source', 'recurring', 'ref_id', serie, 'paid_on', hoje, 'amount_cents', 14000, 'account_id', conta,
         'description', 'Adiantei 3 meses de academia',
         'parcelas', jsonb_build_array(jsonb_build_object('id', o1), jsonb_build_object('id', o2),
                                       jsonb_build_object('on', d3))), gen_random_uuid());
  assert not exists (select 1 from public.transactions where id in (o1, o2)), 'as geradas saíram';
  assert (select count(*) from private.recurring_moved_occurrences where recurring_id = serie) = 3, 'três datas puladas';
  assert not exists (select 1 from private.recurring_projection_all_for(array[ws], hoje, d3 + 5) p
                      where p.recurring_id = serie and p.due_date = d3), 'a regra não traz o mês adiantado';
  select * into t from public.transactions where id = (r->>'id')::uuid;
  assert t.category = 'saúde' and t.expected_amount_cents = 15000 and t.recurring_id is null, 'lançamento avulso da série';
  delete from public.transactions where id = (r->>'id')::uuid;
  assert (select count(*) from public.transactions where id in (o1, o2)) = 2, 'as geradas voltaram com o mesmo id';
  assert not exists (select 1 from private.recurring_moved_occurrences where recurring_id = serie), 'as marcas saíram';

  -- ── 10) a estrutura não muda por tabela; a conta apagada passa (20261010130200) ────────────
  insert into public.accounts (workspace_id, user_id, name, type) values (ws, u, 'Conta AD 2', 'checking') returning id into c4;
  r := public.apply_anticipation(jsonb_build_object(
         'source', 'recurring', 'ref_id', serie, 'paid_on', hoje, 'amount_cents', 5000, 'account_id', c4,
         'description', 'Adiantei academia', 'parcelas', jsonb_build_array(jsonb_build_object('id', o1))), gen_random_uuid());
  begin
    update public.transactions set installment_plan_id = plano, installment_no = 9 where id = (r->>'id')::uuid;
    assert false, 'virar parcela de uma compra é recusa, não silêncio';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    update public.transactions set kind = 'income' where id = (r->>'id')::uuid;
    assert false, 'trocar o tipo é recusa';
  exception when sqlstate 'P0001' then null;
  end;
  delete from public.accounts where id = c4;
  select * into t from public.transactions where id = (r->>'id')::uuid;
  assert t.account_id is null and t.adiantamento is not null and t.amount_cents = 5000,
    format('apagar a conta deixa o adiantamento sem conta: %s', row_to_json(t));
end $$;

rollback;
