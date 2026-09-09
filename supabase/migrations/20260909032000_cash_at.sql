-- "Quanto eu tinha na conta no último dia de agosto?"
--
-- A planilha responde isso encadeando: `Saldo(M) = Entradas(M) − Saídas(M)`, com `Saldo(M−1)`
-- dentro das Entradas. Expandido, é uma soma acumulada desde a origem — e no app essa soma
-- DERIVA do caixa real e nunca volta a se ancorar:
--
--   1. compra no cartão conta em M e o dinheiro sai em M+1: a corrente fica um ciclo adiantada;
--   2. `initial_balance_cents` não tem data — não pertence a mês nenhum;
--   3. não existe história pré-app do outro lado da primeira entrada;
--   4. parcela de financiamento não registrada nunca vira saída, e o erro não é corrigido depois;
--   5. `pending` entra em `transactions_summary` e não entra no caixa;
--   6. aporte de meta não é transação, então poupar é invisível dos dois lados.
--
-- Em soma acumulada, cada um desses é um desvio PERMANENTE. Por isso o saldo de qualquer data é
-- re-derivado das linhas `cleared`, e não encadeado: ele se autocorrige.
--
-- Isto não é regra nova: é `private.cash_total` — a fonte única de caixa, usada pelo patrimônio
-- e pela projeção — ganhando um corte no tempo. Escrever uma quarta cópia da conta de saldo
-- repetiria o defeito que `year_end_balances` (`0027`) já tem: ele usa `occurred_at` onde deveria
-- usar `paid_at`, e por isso discorda dos outros na virada de ano.
--
-- `paid_at` é a data em que o dinheiro passou, e nunca é nula em linha `cleared` — o trigger
-- `private.set_paid_at` (`0046`) fecha isso na origem.
--
-- `drop` e não `create or replace`: mudar a aridade criaria uma SEGUNDA função, e
-- `cash_total(x)` passaria a ser ambígua. Os chamadores atuais (`net_worth_now`,
-- `_cash_flow_forecast`, `cash_flow_forecast`) passam um argumento só e caem no default.
drop function if exists private.cash_total(uuid[]);

create function private.cash_total(ws_ids uuid[], as_of date default null)
returns bigint
language sql stable
set search_path = public
as $$
  select (
    coalesce((
      select sum(
        a.initial_balance_cents + coalesce((
          select sum(case
            when t.kind = 'income'   and t.account_id = a.id then t.amount_cents
            when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
            when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
            when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
            else 0 end)
          from public.transactions t
          where t.status = 'cleared'
            and (as_of is null or t.paid_at <= as_of)
            and (t.account_id = a.id or t.counterparty_account_id = a.id)
        ), 0))
      from public.accounts a
      where a.workspace_id = any(ws_ids) and not a.archived and a.type <> 'credit_card'
    ), 0)
    -- lançamento do WhatsApp costuma vir sem conta; ignorá-lo zerava o caixa de quem só usa o
    -- WhatsApp (o bug que a `0028` corrigiu)
    + coalesce((
      select sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)
      from public.transactions t
      where t.workspace_id = any(ws_ids)
        and t.status = 'cleared'
        and (as_of is null or t.paid_at <= as_of)
        and t.account_id is null
        and t.kind <> 'transfer'
    ), 0)
  )::bigint;
$$;

-- `drop` levou os grants junto
grant execute on function private.cash_total(uuid[], date) to authenticated, service_role;

-- ── o par público ──────────────────────────────────────────────────────────
-- A interna é para o serviço Python, que conecta com papel sem `auth.uid()`.
create or replace function public._cash_at(uid uuid, as_of date default null)
returns bigint
language sql stable security definer
set search_path = public
as $$
  select private.cash_total(array(select public._workspace_ids(uid)), as_of);
$$;
revoke execute on function public._cash_at(uuid, date) from public, anon, authenticated;

-- O wrapper roda sob RLS, com o escopo resolvido pelo próprio `auth.uid()`.
create or replace function public.cash_at(as_of date default null)
returns bigint
language sql stable
set search_path = public
as $$
  select private.cash_total(array(select private.my_workspace_ids()), as_of);
$$;

comment on function public.cash_at(date) is
  'Caixa nas contas que guardam dinheiro (cartão fora) até a data, contando só o que já foi pago. Sem data, é hoje.';
