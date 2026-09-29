-- O caixa e os eventos da projeção passam a dizer a CONTA (29/09/2026, spec "E se…? — uma
-- hipótese só e o detalhe por conta"). Uma fonte só:
--   * `private.caixa_das_contas` é o caixa de cada conta (e uma linha "sem conta"), e
--     `private.cash_total` passa a ser a SOMA dela — antes eram dois lugares com a mesma conta;
--   * `private.eventos_de_caixa` é a lista de eventos da projeção, com a conta de onde o dinheiro
--     sai ou entra — e as duas `cash_flow_forecast` passam a somar dela.
-- A soma das contas + "sem conta" É a visão geral (supabase/tests/caixa_por_conta.sql, dia a dia).
-- Onde cada evento cai:
--   * fatura em aberto → a `payment_account_id` do cartão (null quando o cartão não tem);
--   * lançamento pendente fora de cartão → a conta dele (null sem conta);
--   * transferência pendente entre contas que não são cartão → sai de uma, entra na outra (soma
--     zero: a visão geral não muda, e antes ela nem aparecia);
--   * parcela de dívida → a conta da dívida; recorrente projetada → a conta da série.

create or replace function private.caixa_das_contas(ws_ids uuid[], as_of date default null)
returns table (account_id uuid, cents bigint)
language sql stable
set search_path = public
as $$
  select a.id,
         (a.initial_balance_cents + coalesce((
           select sum(case
             when t.kind = 'income'   and t.account_id = a.id then t.amount_cents
             when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
             when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
             when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
             else 0 end)
           from public.transactions t
           where t.status = 'cleared' and (as_of is null or t.paid_at <= as_of)
             and (t.account_id = a.id or t.counterparty_account_id = a.id)
         ), 0))::bigint
  from public.accounts a
  where a.workspace_id = any(ws_ids) and not a.archived and a.type <> 'credit_card'
  union all
  -- lançamento do WhatsApp costuma vir sem conta: uma linha "sem conta" (a `0028`)
  select null::uuid,
         coalesce(sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end), 0)::bigint
  from public.transactions t
  where t.workspace_id = any(ws_ids) and t.status = 'cleared'
    and (as_of is null or t.paid_at <= as_of) and t.account_id is null and t.kind <> 'transfer';
$$;
revoke execute on function private.caixa_das_contas(uuid[], date) from public, anon;
grant execute on function private.caixa_das_contas(uuid[], date) to authenticated, service_role;

-- Mesmo cabeçalho da 20260909032000 (sem security definer, search_path public).
create or replace function private.cash_total(ws_ids uuid[], as_of date default null)
returns bigint
language sql stable
set search_path = public
as $$
  select coalesce(sum(cents), 0)::bigint from private.caixa_das_contas(ws_ids, as_of);
$$;

create or replace function private.eventos_de_caixa(ws_ids uuid[], ate date)
returns table (account_id uuid, day date, in_cents bigint, out_cents bigint)
language sql stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  -- fatura em aberto: sai da conta que paga o cartão, no vencimento (clampado a hoje)
  select c.payment_account_id, greatest(ci.due_date, current_date), 0::bigint, private.invoice_open_cents(ci.id)
  from public.card_invoices ci
  join public.accounts c on c.id = ci.account_id
  where ci.workspace_id = any(ws_ids) and ci.status not in ('paid','rolled')
    and exists (select 1 from public.transactions t where t.invoice_id = ci.id and private.conta_na_fatura(t.kind))
    and greatest(ci.due_date, current_date) <= ate
  union all
  -- lançamento pendente fora de cartão (receita atrasada há mais de 3 dias sai)
  select t.account_id, greatest(coalesce(t.due_at, t.occurred_at), current_date),
         case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
         case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
  from public.transactions t
  where t.workspace_id = any(ws_ids) and t.status = 'pending' and t.invoice_id is null
    and t.kind <> 'transfer'
    and (t.kind <> 'income' or coalesce(t.due_at, t.occurred_at) >= current_date - 3)
    and greatest(coalesce(t.due_at, t.occurred_at), current_date) <= ate
  union all
  -- transferência pendente entre contas que não são cartão: sai de uma…
  select t.account_id, greatest(coalesce(t.due_at, t.occurred_at), current_date), 0::bigint, t.amount_cents
  from public.transactions t
  join public.accounts o on o.id = t.account_id and o.type <> 'credit_card'
  join public.accounts d on d.id = t.counterparty_account_id and d.type <> 'credit_card'
  where t.workspace_id = any(ws_ids) and t.status = 'pending' and t.kind = 'transfer'
    and greatest(coalesce(t.due_at, t.occurred_at), current_date) <= ate
  union all
  -- … e entra na outra (soma zero)
  select t.counterparty_account_id, greatest(coalesce(t.due_at, t.occurred_at), current_date), t.amount_cents, 0::bigint
  from public.transactions t
  join public.accounts o on o.id = t.account_id and o.type <> 'credit_card'
  join public.accounts d on d.id = t.counterparty_account_id and d.type <> 'credit_card'
  where t.workspace_id = any(ws_ids) and t.status = 'pending' and t.kind = 'transfer'
    and greatest(coalesce(t.due_at, t.occurred_at), current_date) <= ate
  union all
  -- parcela de dívida: sai da conta da dívida
  select d.account_id, greatest(s.due_date, current_date), 0::bigint, s.payment_cents
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id = any(ws_ids) and not d.archived and d.remaining_cents > 0 and s.due_date <= ate
  union all
  -- recorrente projetada da regra: na conta da série
  select p.account_id, p.due_date,
         case when p.kind = 'income'  then p.amount_cents else 0 end::bigint,
         case when p.kind = 'expense' then p.amount_cents else 0 end::bigint
  from private.recurring_projection_for(ws_ids, current_date, ate) p;
$$;
revoke execute on function private.eventos_de_caixa(uuid[], date) from public, anon;
grant execute on function private.eventos_de_caixa(uuid[], date) to authenticated, service_role;

-- As duas projeções: cabeçalho idêntico ao da 20260928230000, eventos lidos da lista única.
CREATE OR REPLACE FUNCTION public._cash_flow_forecast(uid uuid, days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with horizonte as (select private.clamp_forecast_days(days) as dias),
  saldo_inicial as (select private.cash_total(array(select public._workspace_ids(uid))) as cents),
  eventos as (
    -- UMA lista de eventos, com a conta (20260929140000): a mesma de onde sai o horizonte por conta.
    select e.day, e.in_cents, e.out_cents
    from private.eventos_de_caixa(array(select public._workspace_ids(uid)), current_date + (select dias from horizonte)) e
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;


CREATE OR REPLACE FUNCTION public.cash_flow_forecast(days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with horizonte as (select private.clamp_forecast_days(days) as dias),
  saldo_inicial as (select private.cash_total(array(select private.my_workspace_ids())) as cents),
  eventos as (
    -- UMA lista de eventos, com a conta (20260929140000): a mesma de onde sai o horizonte por conta.
    select e.day, e.in_cents, e.out_cents
    from private.eventos_de_caixa(array(select private.my_workspace_ids()), current_date + (select dias from horizonte)) e
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;

