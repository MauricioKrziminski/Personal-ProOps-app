-- "Dá para gastar" é dinheiro do dia a dia (20261010170000/170100/170200): investimento fica fora,
-- poupança entra por padrão, cada conta tem a sua chave — e nenhuma leitura discorda da outra.
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/dinheiro_para_gastar.sql
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, instance_id, aud, role, phone, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-0000000d1a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999993101', '{}', '{}');

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000d1a01';
  ws uuid; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  corrente uuid; poupanca uuid; invest uuid; cartao uuid; cartao_inv uuid;
begin
  select id into ws from public.workspaces where owner_id = u;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, u, 'Corrente DG', 'checking', 100000) returning id into corrente;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, u, 'Poupança DG', 'savings', 20000) returning id into poupanca;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, u, 'CDB DG', 'investment', 50000) returning id into invest;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, payment_account_id)
    values (ws, u, 'Cartão DG', 'credit_card', 3, 10, corrente) returning id into cartao;
  -- cartão pago pela conta de investimento: a fatura dele não sai do que dá para gastar
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, payment_account_id)
    values (ws, u, 'Cartão pago pelo CDB', 'credit_card', 3, 10, invest) returning id into cartao_inv;
  -- duas aplicações do mês retrasado, já feitas: entram em ciclos FECHADOS e eles têm que fechar
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   counterparty_account_id, occurred_at, paid_at, status)
    values (ws, u, 'transfer', 15000, 'Aplicação antiga', corrente, invest, hoje - 40, hoje - 40, 'cleared'),
           (ws, u, 'transfer', 15000, 'Aplicação antiga', corrente, invest, hoje - 40, hoje - 40, 'cleared');
  insert into ids values ('ws', ws), ('corrente', corrente), ('poupanca', poupanca), ('invest', invest),
                         ('cartao', cartao), ('cartao_inv', cartao_inv);
end $$;

-- 1. A regra, sozinha
do $$
begin
  assert private.conta_no_disponivel('checking', null), 'corrente entra';
  assert private.conta_no_disponivel('savings', null), 'poupança entra por padrão';
  assert private.conta_no_disponivel('cash', null), 'dinheiro entra';
  assert not private.conta_no_disponivel('investment', null), 'investimento fica fora';
  assert private.conta_no_disponivel('investment', true), 'a pessoa pode pôr o investimento';
  assert not private.conta_no_disponivel('savings', false), 'a pessoa pode tirar a poupança';
  assert not private.conta_no_disponivel('credit_card', null), 'cartão nunca';
  assert private.conta_no_disponivel(null, null), '"sem conta" entra';
end $$;

-- 2. Cartão não aceita a chave
do $$
begin
  begin
    update public.accounts set spendable = true where id = (select v from ids where k = 'cartao');
    raise exception 'cartão aceitou spendable';
  exception when check_violation then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000d1a01', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000d1a01","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  ws uuid := (select v from ids where k = 'ws');
  corrente uuid := (select v from ids where k = 'corrente');
  poupanca uuid := (select v from ids where k = 'poupanca');
  invest uuid := (select v from ids where k = 'invest');
  cartao_inv uuid := (select v from ids where k = 'cartao_inv');
  hoje date := current_date;
  caixa0 bigint; caixa bigint; nw0 record; nw record; fim0 bigint; fim1 bigint; n int; r record;
  b jsonb; mes_prox date; t_pend uuid; pt jsonb; esperado numeric;
  cartao uuid := (select v from ids where k = 'cartao');
begin
  -- 3. O caixa que dá para gastar: corrente (100000 − 30000 aplicados) + poupança, sem o CDB
  caixa0 := private.cash_total(array[ws], hoje);
  assert caixa0 = 70000 + 20000, format('cash_total sem o investimento: %s', caixa0);
  assert (select cents from private.caixa_das_contas(array[ws], hoje) where account_id = invest) = 80000,
    'a conta de investimento continua inteira no caixa POR CONTA';

  -- 4. account_balances diz quem entra (o app e o agente leem a coluna, não o tipo)
  select count(*) into n from public.account_balances() x
   where (x.account_id = corrente and x.disponivel) or (x.account_id = poupanca and x.disponivel)
      or (x.account_id = invest and not x.disponivel) or (x.account_id = cartao_inv and not x.disponivel);
  assert n = 4, format('account_balances.disponivel: %s', n);

  -- 5. Aplicar hoje (feito): o livre cai, o patrimônio não muda
  select * into nw0 from private.net_worth_now(ws);
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   counterparty_account_id, occurred_at, status)
    values (ws, auth.uid(), 'transfer', 10000, 'Aplico hoje', corrente, invest, hoje, 'cleared');
  caixa := private.cash_total(array[ws], hoje);
  assert caixa = caixa0 - 10000, format('aplicar tira do que dá para gastar: %s → %s', caixa0, caixa);
  select * into nw from private.net_worth_now(ws);
  assert nw.net_cents = nw0.net_cents, format('aplicar não muda o patrimônio: %s → %s', nw0.net_cents, nw.net_cents);
  assert (select s.caixa from private.spendable_for(array[ws], 'civil') s) = caixa, 'o livre parte do mesmo caixa';

  -- 6. Resgatar hoje: volta ao que dá para gastar
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   counterparty_account_id, occurred_at, status)
    values (ws, auth.uid(), 'transfer', 4000, 'Resgato hoje', invest, corrente, hoje, 'cleared');
  assert private.cash_total(array[ws], hoje) = caixa + 4000, 'resgatar volta ao que dá para gastar';
  caixa := caixa + 4000;

  -- 7. Rendimento recebido NA conta de investimento não é dinheiro para gastar
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status)
    values (ws, auth.uid(), 'income', 700, 'Rendimento CDB', invest, hoje, 'cleared');
  assert private.cash_total(array[ws], hoje) = caixa, 'rendimento dentro do investimento fica fora';
  select * into nw from private.net_worth_now(ws);
  assert nw.net_cents = nw0.net_cents + 700, 'mas o patrimônio sobe';

  -- 8. Projeção: aporte agendado SAI no dia; transferência corrente → poupança não muda nada
  select balance_cents into fim0 from public.cash_flow_forecast(60) order by day desc limit 1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   counterparty_account_id, occurred_at, status)
    values (ws, auth.uid(), 'transfer', 5000, 'Aporte agendado', corrente, invest, hoje + 10, 'pending') returning id into t_pend;
  select balance_cents into fim1 from public.cash_flow_forecast(60) order by day desc limit 1;
  assert fim1 = fim0 - 5000, format('aporte agendado sai da projeção: %s → %s', fim0, fim1);
  assert (select out_cents from public.cash_flow_forecast(60) where day = hoje + 10) >= 5000, 'no dia dele';
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   counterparty_account_id, occurred_at, status)
    values (ws, auth.uid(), 'transfer', 3000, 'Corrente para poupança', corrente, poupanca, hoje + 12, 'pending');
  select balance_cents into fim0 from public.cash_flow_forecast(60) order by day desc limit 1;
  assert fim0 = fim1, 'entre duas contas de dentro, nada muda';
  assert exists (select 1 from private.cash_events(array[ws], hoje, hoje + 30) e
                  where e.ref_id = t_pend and e.origin = 'guardar' and e.out_cents = 5000 and not e.realizado),
    'o aporte agendado aparece no ciclo';
  assert not exists (select 1 from private.cash_events(array[ws], hoje, hoje + 30) e where e.title = 'Corrente para poupança'),
    'a transferência entre contas de dentro continua sem aparecer';

  -- 9. Aporte ATRASADO: clampado para hoje, como conta atrasada
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   counterparty_account_id, occurred_at, status)
    values (ws, auth.uid(), 'transfer', 1100, 'Aporte esquecido', corrente, invest, date_trunc('month', hoje)::date - 5, 'pending');
  assert exists (select 1 from private.cash_events(array[ws], date_trunc('month', hoje)::date,
                                                   (date_trunc('month', hoje) + interval '1 month - 1 day')::date) e
                  where e.title = 'Aporte esquecido (atrasada)' and e.day = hoje and e.out_cents = 1100 and e.atrasada),
    'aporte atrasado aparece hoje no ciclo';

  -- 10. Aporte mensal pela REGRA (série que o agendador ainda não gerou): sai na projeção e no ciclo
  mes_prox := (date_trunc('month', hoje) + interval '1 month')::date + 4;
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                             counterparty_account_id, rrule, next_run_at, dtstart)
    values (ws, auth.uid(), 'transfer', 2500, 'Aporte mensal', corrente, invest, 'FREQ=MONTHLY;BYMONTHDAY=5',
            (mes_prox + time '12:00') at time zone 'America/Sao_Paulo', (mes_prox + time '12:00') at time zone 'America/Sao_Paulo');
  select balance_cents into fim1 from public.cash_flow_forecast(60) order by day desc limit 1;
  assert fim1 < fim0, format('aporte mensal da regra sai da projeção: %s → %s', fim0, fim1);
  assert (select coalesce(sum(e.out_cents), 0) from private.cash_events(array[ws], mes_prox, mes_prox) e
           where e.origin = 'guardar_previsto') = 2500, 'aporte mensal previsto no ciclo';

  -- 11. Lançamento pendente, dívida e fatura de quem é de FORA não saem do que dá para gastar
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status)
    values (ws, auth.uid(), 'expense', 900, 'Taxa do CDB', invest, hoje + 3, 'pending');
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents, remaining_cents,
                            interest_rate_monthly, installments, installments_paid, installment_cents, account_id, due_day, first_due_date)
    values (ws, auth.uid(), 'Empréstimo pago pelo CDB', 'financing', 'fixed_installments', 6000, 6000, 0, 5, 0, 1200, invest,
            extract(day from hoje + 7)::int, hoje + 7);
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status)
    values (ws, auth.uid(), 'expense', 3300, 'Compra no cartão do CDB', cartao_inv, hoje, 'pending');
  select balance_cents into fim0 from public.cash_flow_forecast(60) order by day desc limit 1;
  assert fim0 = fim1, format('nada de fora mexe na projeção: %s → %s', fim1, fim0);
  assert exists (select 1 from private.eventos_de_caixa(array[ws], hoje + 60) e where e.account_id = invest),
    'mas os eventos POR CONTA continuam vendo o CDB';
  assert not exists (select 1 from private.cash_events(array[ws], hoje, hoje + 60) e
                      where e.title = 'Taxa do CDB'
                         or e.ref_id in (select id from public.debts where name = 'Empréstimo pago pelo CDB')
                         or e.title like 'Fatura Cartão pago pelo CDB%'),
    'nem o ciclo';

  -- 11b. Os outros caminhos de quem é de FORA também não aparecem no ciclo: pagar a fatura PELO
  -- CDB (ramo 1), Pix no crédito PARA o CDB (1b), taxa atrasada no CDB (4), série no CDB (6)
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                   counterparty_account_id, occurred_at, status)
    values (ws, auth.uid(), 'transfer', 800, 'Fatura paga pelo CDB', invest, cartao, hoje, 'cleared'),
           (ws, auth.uid(), 'transfer', 600, 'Pix no crédito para o CDB', cartao, invest, hoje, 'cleared');
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status)
    values (ws, auth.uid(), 'expense', 450, 'Taxa atrasada CDB', invest, date_trunc('month', hoje)::date - 3, 'pending');
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                             rrule, next_run_at, dtstart)
    values (ws, auth.uid(), 'expense', 350, 'Custódia CDB', invest, 'FREQ=MONTHLY;BYMONTHDAY=5',
            (mes_prox + time '12:00') at time zone 'America/Sao_Paulo', (mes_prox + time '12:00') at time zone 'America/Sao_Paulo');
  assert not exists (select 1 from private.cash_events(array[ws], date_trunc('month', hoje)::date, mes_prox + 40) e
                      where e.title in ('Fatura paga pelo CDB', 'Pix no crédito para o CDB', 'Custódia CDB')
                         or e.title like 'Taxa atrasada CDB%'),
    'nenhum caminho do CDB aparece no ciclo';

  -- 11c. Metas: o planejamento projeta o MESMO caixa da Projeção (as contas da regra)
  b := public.goal_planning_state(ws, 60, 'civil', 'day');
  assert jsonb_array_length(b->'points') > 0, 'planejamento sem pontos';
  for pt in select p from jsonb_array_elements(b->'points') p loop
    select private.cash_total(array[ws]) + coalesce(sum(e.in_cents::numeric - e.out_cents::numeric), 0)
      into esperado from private.eventos_disponiveis(array[ws], hoje + 60) e where e.day <= (pt->>'day')::date;
    assert (pt->>'cash_cents')::numeric = esperado,
      format('metas divergem da Projeção em %s: %s vs %s', pt->>'day', pt->>'cash_cents', esperado);
  end loop;

  -- 11d. Série no CARTÃO que o agendador ainda não gerou (ramo 6, 20261010170200): é dinheiro da
  -- conta que PAGA a fatura. Paga pela corrente (ou sem pagadora) aparece no ciclo; pelo CDB, não.
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
    values (ws, auth.uid(), 'Cartão sem pagadora DG', 'credit_card', 3, 10);
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
                                             rrule, next_run_at, dtstart)
    values (ws, auth.uid(), 'expense', 4100, 'Streaming no cartão', cartao, 'FREQ=MONTHLY;BYMONTHDAY=5',
            (mes_prox + time '12:00') at time zone 'America/Sao_Paulo', (mes_prox + time '12:00') at time zone 'America/Sao_Paulo'),
           (ws, auth.uid(), 'expense', 4200, 'Streaming no cartão do CDB', cartao_inv, 'FREQ=MONTHLY;BYMONTHDAY=5',
            (mes_prox + time '12:00') at time zone 'America/Sao_Paulo', (mes_prox + time '12:00') at time zone 'America/Sao_Paulo'),
           (ws, auth.uid(), 'expense', 4300, 'Streaming sem pagadora', (select id from public.accounts where name = 'Cartão sem pagadora DG'),
            'FREQ=MONTHLY;BYMONTHDAY=5',
            (mes_prox + time '12:00') at time zone 'America/Sao_Paulo', (mes_prox + time '12:00') at time zone 'America/Sao_Paulo');
  assert (select count(*) from private.cash_events(array[ws], mes_prox, mes_prox) e
           where e.title = 'Streaming no cartão' and e.out_cents = 4100) = 1, 'série no cartão da corrente aparece no ciclo';
  assert (select count(*) from private.cash_events(array[ws], mes_prox, mes_prox) e
           where e.title = 'Streaming sem pagadora' and e.out_cents = 4300) = 1, 'cartão sem pagadora continua dentro';
  assert not exists (select 1 from private.cash_events(array[ws], date_trunc('month', hoje)::date, mes_prox + 40) e
                      where e.title = 'Streaming no cartão do CDB'), 'série no cartão pago pelo CDB fica fora';

  -- 12. A poupança que a pessoa tira: sai do caixa, e corrente → poupança passa a ser "guardar"
  update public.accounts set spendable = false where id = poupanca;
  assert private.cash_total(array[ws], hoje) =
           (select sum(cents) from private.caixa_das_contas(array[ws], hoje) where account_id = corrente or account_id is null),
    'poupança tirada sai do caixa';
  assert exists (select 1 from private.cash_events(array[ws], hoje, hoje + 30) e
                  where e.title = 'Corrente para poupança' and e.origin = 'guardar' and e.out_cents = 3000),
    'corrente → poupança tirada vira guardar';
  update public.accounts set spendable = null where id = poupanca;
  assert not exists (select 1 from private.cash_events(array[ws], hoje, hoje + 30) e where e.title = 'Corrente para poupança'),
    'devolvida ao padrão, a poupança volta a ser de dentro';

  -- 13. Detalhe do ciclo: as contas de dentro somam a partida; o CDB vem à parte
  b := private.cycle_breakdown_for(array[ws], date_trunc('month', hoje)::date, 'civil');
  assert (b->'partida'->>'cents')::bigint = private.cash_total(array[ws], hoje), 'partida = caixa';
  assert (select sum((x->>'cents')::bigint) from jsonb_array_elements(b->'partida'->'contas') x)
         = (b->'partida'->>'cents')::bigint, 'as contas somam a partida';
  assert exists (select 1 from jsonb_array_elements(b->'fora') x where (x->>'account_id')::uuid = invest),
    format('o CDB aparece fora da soma: %s', b->'fora');
  assert not exists (select 1 from jsonb_array_elements(b->'partida'->'contas') x where (x->>'account_id')::uuid = invest),
    'e não dentro dela';

  -- 14. Horizonte por conta: o CDB vem com disponivel = false
  assert exists (select 1 from jsonb_array_elements(private.contas_no_horizonte(array[ws], hoje + 30)) x
                  where (x->>'account_id')::uuid = invest and not (x->>'disponivel')::boolean), 'horizonte marca o CDB';

  -- 15. Ciclos fechados continuam fechando no centavo, com as aplicações antigas dentro
  for r in select * from private.cycle_series_for(array[ws], (hoje - interval '3 months')::date, hoje, 'civil') loop
    if r.estado = 'fechado' then
      assert r.confere, format('ciclo %s não fecha: eventos %s, caixa %s', r.mes, r.resultado, r.caixa_no_fim);
    end if;
  end loop;
  assert (select sum(e.out_cents) from private.cash_events(array[ws], hoje - 45, hoje - 35) e
           where e.title = 'Aplicação antiga' and e.realizado) = 30000, 'as aplicações antigas saíram no ciclo delas';
end $$;

-- 16. create_account aceita a chave e recusa no cartão
do $$
declare r jsonb;
begin
  r := public.create_account('{"name":"Tesouro DG","type":"investment","initial_balance_cents":0,"spendable":true}', gen_random_uuid());
  assert (select spendable from public.accounts where id = (r->>'id')::uuid), 'create_account grava a escolha';
  r := public.create_account('{"name":"Corrente 2 DG","type":"checking","initial_balance_cents":0}', gen_random_uuid());
  assert (select spendable is null from public.accounts where id = (r->>'id')::uuid), 'sem a chave, o padrão do tipo';
  begin
    perform public.create_account('{"name":"Cartão 2 DG","type":"credit_card","initial_balance_cents":0,"closing_day":3,"due_day":10,"spendable":true}', gen_random_uuid());
    raise exception 'cartão aceitou spendable';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.create_account('{"name":"Errada DG","type":"checking","initial_balance_cents":0,"spendable":"sim"}', gen_random_uuid());
    raise exception 'aceitou spendable que não é booleano';
  exception when sqlstate '22023' then null;
  end;
end $$;

rollback;
