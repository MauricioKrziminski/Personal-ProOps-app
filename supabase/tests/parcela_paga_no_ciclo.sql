-- "Já paguei esta parcela?" tem que ser perguntado na régua do CICLO.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/parcela_paga_no_ciclo.sql
--
-- A asserção que carrega a correção é a 3: **nenhuma parcela agendada cai dentro de um ciclo
-- que já foi pago**. Com o teste no mês civil, um pagamento feito depois do fechamento não era
-- visto pelo ciclo corrente, o cronograma emitia de novo uma linha dentro dele, e
-- `month_lines_for` não a suprimia — a mesma parcela somada duas vezes em "Entradas e saídas",
-- em `month_summary` e na Tendência mensal (que é onde esta MESMA parcela já produziu o erro de
-- R$ 1.485,00 corrigido pela `20260911010000`).
--
-- A asserção 4 é a outra metade e é o que torna a mudança segura: em modo CIVIL nada muda.
--
-- ⚠️ Nada de data cravada: `debt_schedule_for` lê `current_date` por dentro, então o teste
-- afirma RELAÇÕES (o pagamento de hoje pertence ao ciclo de hoje; nada é agendado dentro dele)
-- em vez de literais que só valeriam no dia em que foram escritos.

\set ON_ERROR_STOP on
begin;

do $$
declare
  ws uuid; usr uuid; conta uuid; divida uuid;
  fim_ciclo date; prox date; linhas int; dia_venc int;
begin
  select id into usr from auth.users limit 1;
  -- fechamento no dia 10: o ciclo corrente atravessa a virada do mês civil, que é justamente
  -- onde as duas réguas discordam
  insert into public.workspaces (name, owner_id, cycle_close_day)
    values ('teste ciclo parcela', usr, 10) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');

  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Conta', 'checking', 5000000) returning id into conta;

  -- o vencimento cai num dia que pode estar DENTRO do ciclo corrente — é o caso que quebrava
  dia_venc := 5;

  insert into public.debts
    (workspace_id, user_id, name, kind, remaining_cents, installments, installments_paid,
     due_day, calculation_mode, installment_cents, interest_rate_monthly, started_at,
     principal_cents)
  values
    (ws, usr, 'Parcela Carro', 'financing', 148500 * 40, 48, 8,
     dia_venc, 'fixed_installments', 148500, 0, date '2026-01-05',
     148500 * 48)
  returning id into divida;

  select b.fim into fim_ciclo
  from private.cycle_bounds(10, private.cycle_month_of(10, current_date)) b;

  -- ---------------------------------------------------------------- 1
  select due_date into prox from private.debt_schedule_for(divida) order by due_date limit 1;
  if prox is null then
    raise exception 'ok 1 FALHOU: o cronograma nasceu vazio';
  end if;
  raise notice 'ok 1 — sem pagamento o cronograma comeca em % (ciclo termina em %)', prox, fim_ciclo;

  -- o usuário paga HOJE, que por definição está dentro do ciclo corrente
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, occurred_at, account_id,
     debt_id, status)
  values (ws, usr, 'expense', 148500, 'Parcela Carro', current_date, conta, divida, 'cleared');

  -- ---------------------------------------------------------------- 2
  if not private.debt_paid_in_cycle(divida, current_date) then
    raise exception 'ok 2 FALHOU: o pagamento de hoje tem que pertencer ao ciclo de hoje';
  end if;
  raise notice 'ok 2 — o pagamento de hoje conta para o ciclo que fecha em %', fim_ciclo;

  -- ---------------------------------------------------------------- 3  (a que carrega tudo)
  select count(*) into linhas
  from private.debt_schedule_for(divida)
  where due_date <= fim_ciclo;
  if linhas <> 0 then
    raise exception 'ok 3 FALHOU: % linha(s) agendada(s) dentro do ciclo ja pago (ate %)',
      linhas, fim_ciclo;
  end if;
  raise notice 'ok 3 — nenhuma parcela agendada dentro do ciclo que ja foi pago';

  -- e quem `month_lines_for` chama concorda: ele suprime a linha pelo CICLO, nao pelo mes civil
  if not private.debt_paid_in_month(divida, fim_ciclo) then
    raise exception 'ok 3b FALHOU: month_lines_for ainda decide pelo mes civil';
  end if;
  raise notice 'ok 3b — month_lines_for suprime a linha do ciclo pago';

  -- ---------------------------------------------------------------- 4
  -- modo CIVIL: a janela volta a ser o mes do calendario. O pagamento de hoje pertence ao mes
  -- de hoje, e um dia do mes SEGUINTE volta a ser "nao pago" — o comportamento de sempre.
  update public.workspaces set cycle_close_day = null where id = ws;
  if not private.debt_paid_in_cycle(divida, current_date) then
    raise exception 'ok 4 FALHOU: em modo civil o pagamento de hoje esta no mes de hoje';
  end if;
  if private.debt_paid_in_cycle(divida, (date_trunc('month', current_date) + interval '1 month')::date) then
    raise exception 'ok 4 FALHOU: em modo civil o mes seguinte nao pode contar como pago';
  end if;
  raise notice 'ok 4 — em modo civil a regua volta a ser o mes do calendario, sem mudanca';
end $$;

rollback;
