-- O saldo da tela Contas para de contar o que ainda não caiu.
--
-- `account_balances` **não filtrava status**, então a tela Contas somava no "caixa" o Pix que o
-- Winicius ainda não mandou — enquanto `private.cash_total` (usado por Patrimônio e pela projeção)
-- filtra `status='cleared'`. **Dois números diferentes para o mesmo dinheiro**, e o do caixa era
-- o errado.
--
-- ⚠️ **Filtrar `cleared` no atacado estragaria o cartão.** Numa conta `credit_card` a parcela
-- futura `pending` É dívida já assumida — é o que faz a fatura futura aparecer. Por isso
-- `balance_cents` fica INTOCADA (back-compat: `process-jobs/index.ts:947` e `queries.py` somam
-- ela) e as três colunas novas são opt-in:
--
--   balance_cents      tudo, pending incluído — o que já era
--   cleared_cents      só `cleared` + saldo inicial — é o que `cash_total` diz
--   pending_in_cents   receita pending a crédito, positivo
--   pending_out_cents  despesa/transferência pending a débito, positivo
--
-- Assim cada linha da tela escolhe a sua e **não existe `case` de `credit_card` dentro da soma**:
-- a regra de produto fica na tela, não no agregado. `in` e `out` separados porque uma conta com
-- Pix a receber E boleto a pagar tem líquido enganoso — escrever "R$ 730,50 a receber" seria uma
-- mentira nova para consertar a antiga.
--
-- Invariante que o teste trava:
--   balance_cents = cleared_cents + pending_in_cents - pending_out_cents

drop function if exists public.account_balances();
drop function if exists public._account_balances(uuid);

create function public._account_balances(uid uuid)
returns table(account_id uuid, name text, type text, balance_cents bigint,
              cleared_cents bigint, pending_in_cents bigint, pending_out_cents bigint)
language sql stable security definer
set search_path = public
as $$
  select a.id as account_id, a.name, a.type,
         (a.initial_balance_cents + coalesce(sum(s.sinal), 0))::bigint,
         (a.initial_balance_cents
          + coalesce(sum(s.sinal) filter (where t.status = 'cleared'), 0))::bigint,
         coalesce( sum(s.sinal) filter (where t.status = 'pending' and s.sinal > 0), 0)::bigint,
         coalesce(-sum(s.sinal) filter (where t.status = 'pending' and s.sinal < 0), 0)::bigint
  from public.accounts a
  left join public.transactions t
    on t.workspace_id = a.workspace_id
   and (t.account_id = a.id or t.counterparty_account_id = a.id)
   and not exists (
     select 1 from public.card_invoices ci
     where ci.id = t.invoice_id and ci.settled_manually
   )
  left join lateral (
    select case
      when t.kind = 'income'   and t.account_id = a.id then  t.amount_cents
      when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
      when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
      when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
      else 0 end as sinal
  ) s on true
  where a.workspace_id in (select public._workspace_ids(uid)) and not a.archived
  group by a.id
  union all
  select null::uuid, 'Sem conta', 'none',
         sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)::bigint,
         coalesce(sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)
                  filter (where t.status = 'cleared'), 0)::bigint,
         coalesce(sum(t.amount_cents) filter (where t.status = 'pending' and t.kind = 'income'), 0)::bigint,
         coalesce(sum(t.amount_cents) filter (where t.status = 'pending' and t.kind = 'expense'), 0)::bigint
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.account_id is null and t.kind <> 'transfer'
  having count(*) > 0;
$$;
revoke execute on function public._account_balances(uuid) from public, anon, authenticated;

create function public.account_balances()
returns table(account_id uuid, name text, type text, balance_cents bigint,
              cleared_cents bigint, pending_in_cents bigint, pending_out_cents bigint)
language sql stable
set search_path = public
as $$
  select a.id as account_id, a.name, a.type,
         (a.initial_balance_cents + coalesce(sum(s.sinal), 0))::bigint,
         (a.initial_balance_cents
          + coalesce(sum(s.sinal) filter (where t.status = 'cleared'), 0))::bigint,
         coalesce( sum(s.sinal) filter (where t.status = 'pending' and s.sinal > 0), 0)::bigint,
         coalesce(-sum(s.sinal) filter (where t.status = 'pending' and s.sinal < 0), 0)::bigint
  from public.accounts a
  left join public.transactions t
    on t.workspace_id = a.workspace_id
   and (t.account_id = a.id or t.counterparty_account_id = a.id)
   and not exists (
     select 1 from public.card_invoices ci
     where ci.id = t.invoice_id and ci.settled_manually
   )
  left join lateral (
    select case
      when t.kind = 'income'   and t.account_id = a.id then  t.amount_cents
      when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
      when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
      when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
      else 0 end as sinal
  ) s on true
  where a.workspace_id in (select private.my_workspace_ids()) and not a.archived
  group by a.id
  union all
  select null::uuid, 'Sem conta', 'none',
         sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)::bigint,
         coalesce(sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)
                  filter (where t.status = 'cleared'), 0)::bigint,
         coalesce(sum(t.amount_cents) filter (where t.status = 'pending' and t.kind = 'income'), 0)::bigint,
         coalesce(sum(t.amount_cents) filter (where t.status = 'pending' and t.kind = 'expense'), 0)::bigint
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.account_id is null and t.kind <> 'transfer'
  having count(*) > 0;
$$;
