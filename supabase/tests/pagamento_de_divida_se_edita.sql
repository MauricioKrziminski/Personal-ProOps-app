-- O pagamento de dívida se edita e se apaga, qualquer um (`20260926140000`).
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/pagamento_de_divida_se_edita.sql
--
-- 1. Parcela fixa: pagamento com data ANTERIOR a um já lançado entra, e a data de um pagamento
--    muda mesmo trocando a ordem.
-- 2. Com juros: apagar o pagamento ANTIGO devolve o principal dele ao saldo da dívida e ao saldo
--    depois do seguinte, e o seguinte vira o nº 1.
-- 3. Pagamento antigo sem histórico de amortização continua recusado — não há de onde refazer.
-- Roda numa transação e dá rollback.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000003a1';
  w uuid := '00000000-0000-0000-0000-0000000003b1';
  cc uuid := '00000000-0000-0000-0000-0000000003c1';
  fixa uuid := '00000000-0000-0000-0000-0000000003d1';
  juros uuid := '00000000-0000-0000-0000-0000000003d2';
  p1 uuid;
  p2 uuid;
  l record;
  hoje date := current_date;
begin
  insert into auth.users (id, email) values (u, 'teste-pagto-divida@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste pagamento');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta', 'checking', 1000000);

  -- ── 1. parcela fixa: data fora de ordem ────────────────────────────────────────────────
  insert into public.debts (id, workspace_id, user_id, name, kind, calculation_mode, principal_cents, remaining_cents,
                            interest_rate_monthly, installments, installments_paid, installment_cents, due_day)
    values (fixa, w, u, 'Carro', 'financing', 'fixed_installments', 100000, 100000, 0, 10, 0, 10000, 5);
  perform public.pay_debt_installment(fixa, 10000, cc, hoje);
  -- esqueceu de lançar a de 30 dias atrás: entra depois
  perform public.pay_debt_installment(fixa, 10000, cc, hoje - 30);
  select installments_paid, remaining_cents into l from public.debts where id = fixa;
  if l.installments_paid <> 2 or l.remaining_cents <> 80000 then
    raise exception '1: pagas % saldo % (2 / 80000)', l.installments_paid, l.remaining_cents;
  end if;
  -- e a data de um pagamento muda, mesmo passando o outro
  update public.transactions set occurred_at = hoje - 60 where debt_id = fixa and occurred_at = hoje;
  select count(*) as n into l from public.transactions where debt_id = fixa and occurred_at = hoje - 60;
  if l.n <> 1 then raise exception '1: a data não mudou (%)', l.n; end if;

  -- ── 2. com juros: apagar o ANTIGO ──────────────────────────────────────────────────────
  insert into public.debts (id, workspace_id, user_id, name, kind, calculation_mode, principal_cents, remaining_cents,
                            interest_rate_monthly, installments, installments_paid, due_day)
    values (juros, w, u, 'Empréstimo', 'loan', 'amortized', 100000, 100000, 0.01, 12, 0, 10);
  perform public.pay_debt_installment(juros, 20000, cc, hoje - 30);  -- juros 1000, principal 19000 → 81000
  perform public.pay_debt_installment(juros, 20000, cc, hoje);       -- juros 810, principal 19190 → 61810
  select id into p1 from public.transactions where debt_id = juros and debt_payment_no = 1;
  select id into p2 from public.transactions where debt_id = juros and debt_payment_no = 2;
  delete from public.transactions where id = p1;
  select remaining_cents, installments_paid into l from public.debts where id = juros;
  if l.remaining_cents <> 80810 or l.installments_paid <> 1 then
    raise exception '2: dívida saldo % pagas % (80810 / 1)', l.remaining_cents, l.installments_paid;
  end if;
  select debt_payment_no, debt_balance_after_cents, debt_interest_cents into l from public.transactions where id = p2;
  if l.debt_payment_no <> 1 or l.debt_balance_after_cents <> 80810 or l.debt_interest_cents <> 810 then
    raise exception '2: o seguinte ficou nº % saldo % juros % (1 / 80810 / 810)', l.debt_payment_no, l.debt_balance_after_cents, l.debt_interest_cents;
  end if;

  -- ── 3. sem histórico de amortização: recusado ──────────────────────────────────────────
  perform set_config('proops.apagando_divida', juros::text, true);
  update public.transactions set debt_principal_cents = null where id = p2;
  perform set_config('proops.apagando_divida', '', true);
  begin
    delete from public.transactions where id = p2;
    raise exception 'FALHOU: pagamento sem histórico apagado';
  exception when others then
    if sqlerrm not like 'Pagamento antigo sem histórico%' then raise exception '3: recusa errada: %', sqlerrm; end if;
  end;
end $$;

rollback;
