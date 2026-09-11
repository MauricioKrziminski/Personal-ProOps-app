-- Duas regras que vieram de pesquisa de mercado, não de gosto (`20260909180000`, `20260909200000`).
--
-- **Orçamento** (padrão YNAB): agendado não é gasto, mas o AVISO conta com ele.
--   ⚠️ A régua não é `status`, é "já aconteceu": parcela de CARTÃO pendente É gasto — a compra
--   foi feita. Filtrar `cleared` no atacado subestimaria justamente o cartão.
--
-- **Projeção** (prática de contas a receber): receita atrasada para de ser projetada depois de
--   três dias; DESPESA atrasada continua. A assimetria é o ponto — você ainda deve o boleto,
--   mas não manda no Pix dos outros.

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
  u uuid := '00000000-0000-0000-0000-0000000000a4';
  w uuid := '00000000-0000-0000-0000-0000000000b4';
  cc uuid := '00000000-0000-0000-0000-0000000000c4';
  card uuid := '00000000-0000-0000-0000-0000000000d4';
  gasto bigint; comprometido bigint;
  saldo_com bigint; saldo_sem bigint;
begin
  insert into auth.users (id, email) values (u, 'teste-orc@example.invalid') on conflict do nothing;
  insert into public.profiles (id) values (u) on conflict do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste orçamento');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta', 'checking', 1000000);
  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (card, w, u, 'Cartão', 'credit_card', 3, 10, 5000000);
  insert into public.budgets (workspace_id, user_id, category, limit_cents, month)
    values (w, u, 'casa', 50000, null);

  -- três despesas de 'casa' no mês, uma de cada natureza
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, source, status)
  values
    (w, u, cc, 'expense', 20000, 'Mercado (pago)',  current_date, 'app', 'cleared'),
    (w, u, cc, 'expense', 15000, 'Boleto agendado', current_date, 'app', 'pending');
  update public.transactions set category = 'casa' where workspace_id = w;

  -- parcela de CARTÃO pendente: a compra aconteceu, o pagamento é que não
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category, occurred_at,
     source, status)
    values (w, u, card, 'expense', 10000, 'Ferramenta 2/6', 'casa', current_date, 'app', 'pending');

  select b.spent_cents, b.committed_cents into gasto, comprometido
    from private.budgets_status_for(array[w], current_date) b where b.category = 'casa';

  assert gasto = 30000,
    format('gasto = pago (20000) + parcela de cartão (10000); veio %s', gasto);
  assert comprometido = 15000,
    format('só o boleto agendado é comprometido; veio %s', comprometido);
  -- o defeito antigo somava tudo em `spent_cents`
  assert gasto <> 45000, 'voltou a contar o boleto agendado como gasto';
  -- e o filtro ingênuo (só `cleared`) daria 20000, escondendo a parcela do cartão
  assert gasto <> 20000, 'a parcela de cartão sumiu do gasto — a compra ACONTECEU';

  -- ── projeção: a assimetria ────────────────────────────────────────────────
  --
  -- Uma receita e uma despesa, ambas previstas para 10 dias atrás (muito além da graça de 3).
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, due_at,
     source, status, auto_confirm)
  values
    (w, u, cc, 'income',  42000, 'Pix que não chegou', current_date - 10, current_date - 10,
     'recurring', 'pending', false),
    (w, u, cc, 'expense', 30000, 'Boleto atrasado',    current_date - 10, current_date - 10,
     'app', 'pending', false);

  select sum(f.in_cents), sum(f.out_cents) into saldo_com, saldo_sem
    from public._cash_flow_forecast(u, 30) f;

  assert saldo_com = 0,
    format('receita vencida há 10 dias não pode entrar na projeção; entraram %s', saldo_com);
  assert saldo_sem >= 30000,
    format('DESPESA vencida continua saindo — você ainda deve; saiu %s', saldo_sem);

  -- dentro da janela de graça ela ainda conta (o alerta ainda está cutucando)
  update public.transactions
     set occurred_at = current_date - 1, due_at = current_date - 1
   where description = 'Pix que não chegou';
  select sum(f.in_cents) into saldo_com from public._cash_flow_forecast(u, 30) f;
  assert saldo_com = 42000,
    format('dentro dos 3 dias a receita ainda conta; veio %s', saldo_com);

  raise notice 'ok — orçamento separa, e a projeção desiste da receita mas não da dívida';
end $$;

rollback;
