-- Pagamento parcial de fatura (`20260909060000`) contra um Postgres de verdade.
--
--   npx supabase start
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/partial_invoice_payment.sql
--
-- O que este arquivo protege é a invariante da `0046 §4`: "o que a fatura ainda deve" é calculado
-- por OITO funções, e o saldo do cartão é calculado por outra, que não sabe o que é fatura. Um
-- leitor que esqueça de descontar `paid_cents` faz as duas discordarem — a tela de Cartões diz um
-- número e o saldo diz outro. Aqui elas são comparadas.
--
-- Roda inteiro dentro de uma transação e dá rollback: não suja o banco.

\set ON_ERROR_STOP on
begin;

set local timezone to 'America/Sao_Paulo';
-- ⚠️ O relógio do teste tem que ser o MESMO do negócio.
-- Desde a `20260911030000` as funções financeiras avaliam `current_date` em BRT
-- (`alter function ... set timezone`), enquanto a sessão continua em UTC. Das 21h à meia-noite
-- as duas datas diferem, e um teste que compara "o dia 0 da projeção" com o `current_date` da
-- SESSÃO falha por um dia — sem nada de errado no código. Foi o que aconteceu com
-- `draft_scenario`, `agent_migrations` e `alert_channels` em 10/09/2026 às 21h.

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000aa';
  w uuid := '00000000-0000-0000-0000-0000000000bb';
  cc uuid := '00000000-0000-0000-0000-0000000000cc';
  card uuid := '00000000-0000-0000-0000-0000000000dd';
  fat uuid;
  aberto bigint;
  saldo bigint;
  v bigint;
begin
  insert into auth.users (id, email) values (u, 'teste-parcial@example.invalid')
    on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste parcial');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta teste', 'checking', 500000);
  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (card, w, u, 'Cartão teste', 'credit_card', 3, 10, 1000000);

  -- duas compras: 1.000,00 + 500,00. O trigger set_invoice cria a fatura.
  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, source, status)
    values (w, u, card, 'expense', 100000, 'Compra A', '2026-08-10', 'app', 'cleared'),
           (w, u, card, 'expense',  50000, 'Compra B', '2026-08-20', 'app', 'pending');
  select invoice_id into fat from public.transactions where account_id = card limit 1;

  assert private.invoice_open_cents(fat) = 150000,
    format('fatura nova deveria dever 150000, deve %s', private.invoice_open_cents(fat));

  -- ── pagamento parcial ────────────────────────────────────────────────────
  perform public.pay_invoice(fat, cc, date '2026-09-05', 40000);
  assert private.invoice_open_cents(fat) = 110000,
    format('depois de 400,00 deveria faltar 110000, falta %s', private.invoice_open_cents(fat));
  assert (select status from public.card_invoices where id = fat) <> 'paid',
    'pagamento parcial não pode marcar a fatura como paga';
  assert exists (select 1 from public.transactions where invoice_id = fat and status = 'pending'),
    'pagamento parcial não pode dar baixa nas compras';

  -- ── os dois caminhos independentes têm que concordar ─────────────────────
  aberto := (select sum(private.invoice_open_cents(ci.id)) from public.card_invoices ci
             where ci.account_id = card and ci.status <> 'paid');

  select unpaid_total_cents into v from public._card_summary(u) where account_id = card;
  assert v = aberto, format('card_summary diz %s, as faturas em aberto somam %s', v, aberto);

  select amount_cents into v from public._upcoming_bills(u, 365) where ref_id = fat;
  assert v = aberto, format('upcoming_bills diz %s, deveria dizer %s', v, aberto);

  -- o saldo sai da partida dobrada e não sabe o que é fatura: é o cruzamento que vale
  select balance_cents into saldo from public._account_balances(u) where account_id = card;
  assert saldo = -aberto, format('saldo do cartão (%s) discorda das faturas em aberto (%s)', saldo, -aberto);

  -- ── segundo parcial, depois a quitação ───────────────────────────────────
  perform public.pay_invoice(fat, cc, date '2026-09-06', 10000);
  assert private.invoice_open_cents(fat) = 100000,
    format('depois de mais 100,00 deveria faltar 100000, falta %s', private.invoice_open_cents(fat));

  -- sem valor, paga o que falta
  perform public.pay_invoice(fat, cc, date '2026-09-07');
  assert (select status from public.card_invoices where id = fat) = 'paid', 'deveria ter quitado';
  assert private.invoice_open_cents(fat) = 0, 'fatura quitada deveria ter zero em aberto';
  assert not exists (select 1 from public.transactions where invoice_id = fat and status = 'pending'),
    'quitar tem que dar baixa nas compras da fatura';
  assert (select balance_cents from public._account_balances(u) where account_id = card) = 0,
    'cartão quitado deveria ter saldo zero';

  raise notice 'pagamento parcial: todas as asserções passaram';
end $$;

-- Recusas. Cada uma protege um jeito diferente de gravar dinheiro errado.
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000a1';
  w uuid := '00000000-0000-0000-0000-0000000000b1';
  cc uuid := '00000000-0000-0000-0000-0000000000c1';
  card uuid := '00000000-0000-0000-0000-0000000000d1';
  fat uuid;
begin
  insert into auth.users (id, email) values (u, 'teste-recusa@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste recusa');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta teste', 'checking', 0);
  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (card, w, u, 'Cartão teste', 'credit_card', 3, 10, 100000);
  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, source, status)
    values (w, u, card, 'expense', 10000, 'Compra', '2026-08-10', 'app', 'cleared');
  select invoice_id into fat from public.transactions where account_id = card limit 1;

  begin
    perform public.pay_invoice(fat, cc, current_date, 20000);
    raise exception 'aceitou pagar mais do que a fatura deve';
  exception when others then
    assert sqlerrm like '%maior que o valor em aberto%', format('erro inesperado: %s', sqlerrm);
  end;

  begin
    perform public.pay_invoice(fat, cc, current_date, 0);
    raise exception 'aceitou pagamento de zero';
  exception when others then
    assert sqlerrm like '%maior que zero%', format('erro inesperado: %s', sqlerrm);
  end;

  begin
    perform public.pay_invoice(fat, card, current_date, 5000);
    raise exception 'aceitou o cartão pagando a si mesmo';
  exception when others then
    -- acentuado de propósito: é o texto que `mensagemDoErro` procura na tela
    assert sqlerrm like '%próprio cartão%', format('erro inesperado: %s', sqlerrm);
  end;

  raise notice 'recusas: todas as asserções passaram';
end $$;

rollback;
