-- A fatura mostra o total (o que o banco cobra no fechamento e o que a Projeção tira do caixa), e
-- agora diz QUANTO desse total ainda tem data à frente: `private.invoice_future_cents`, a única
-- regra (linhas da fatura por `conta_na_fatura` com `occurred_at` depois de hoje, no dia do Brasil).
-- O corte é a DATA, nunca o `status` (compra de cartão fica `pending` até a fatura ser paga).
--
-- `card_summary` ganha `invoice_future_cents` e `upcoming_bills` ganha `future_cents`, os dois NO
-- FIM (quem lê por posição não muda). `drop` antes de `create` porque o tipo de retorno muda; o
-- `drop` leva as permissões, então elas são refeitas aqui (o `grant` dos wrappers é o que existe
-- no staging: authenticated + service_role; as internas só para service_role). Corpos copiados da
-- 20261005220000 (`_card_summary`/`card_summary`) e da 20260928230000 (`_upcoming_bills`/`upcoming_bills`).

create or replace function private.invoice_future_cents(p_invoice_id uuid)
returns bigint
language sql stable
set search_path to 'public'
set timezone to 'America/Sao_Paulo'
as $fn$
  select coalesce(sum(t.amount_cents), 0)::bigint
  from public.transactions t
  where t.invoice_id = p_invoice_id and private.conta_na_fatura(t.kind)
    and t.occurred_at > current_date;
$fn$;

revoke execute on function private.invoice_future_cents(uuid) from public, anon;
grant execute on function private.invoice_future_cents(uuid) to authenticated, service_role;

drop function if exists public._card_summary(uuid);
drop function if exists public.card_summary();
drop function if exists public._upcoming_bills(uuid, integer);
drop function if exists public.upcoming_bills(integer);

CREATE FUNCTION public._card_summary(uid uuid)
 RETURNS TABLE(account_id uuid, name text, credit_limit_cents bigint, closing_day integer, due_day integer, invoice_id uuid, reference_month date, closing_date date, due_date date, invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint, overdue_count integer, overdue_total_cents bigint, oldest_overdue_invoice_id uuid, invoice_open_cents bigint, invoice_future_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with cards as (
    select a.* from public.accounts a
    where a.workspace_id in (select public._workspace_ids(uid))
      and a.type = 'credit_card' and not a.archived
  ),
  totals as (
    select ci.id as invoice_id, coalesce(sum(t.amount_cents), 0)::bigint as total_cents,
           private.invoice_open_cents(ci.id) as open_cents
    from public.card_invoices ci
    -- escopo no workspace: sem este join a CTE varria card_invoices de TODOS os
    -- usuarios a cada chamada (herdado da 0013). Nao vazava, porque o resultado e
    -- filtrado depois, mas custava O(faturas do banco inteiro).
    join cards c on c.id = ci.account_id
    left join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status not in ('paid','rolled')
    order by ci.account_id,
             -- corrente e futuras primeiro, da mais próxima para a mais distante
             -- a que vem a seguir para pagar (vencimento a partir de hoje), a mais próxima;
             -- sem nenhuma, a mais recente. `reference_month` é o mês do FECHAMENTO.
             (ci.due_date < current_date),
             case when ci.due_date >= current_date then ci.due_date end asc,
             ci.reference_month desc
  ),
  atrasadas as (
    select ci.account_id,
           count(*)::int as overdue_count,
           coalesce(sum(tt.open_cents), 0)::bigint as overdue_total_cents,
           (array_agg(ci.id order by ci.reference_month))[1] as oldest_id
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    left join totals tt on tt.invoice_id = ci.id
    where ci.status not in ('paid','rolled') and ci.due_date < current_date
    group by ci.account_id
  )
  select c.id, c.name, c.credit_limit_cents, c.closing_day, c.due_day,
         ab.id, ab.reference_month, ab.closing_date, ab.due_date,
         coalesce(tt.total_cents, 0)::bigint,
         coalesce((select sum(t2.open_cents) from totals t2
                   join public.card_invoices ci2 on ci2.id = t2.invoice_id
                   where ci2.account_id = c.id and ci2.status not in ('paid','rolled')), 0)::bigint,
         (coalesce(c.credit_limit_cents, 0)
          - coalesce((select sum(t3.open_cents) from totals t3
                      join public.card_invoices ci3 on ci3.id = t3.invoice_id
                      where ci3.account_id = c.id and ci3.status not in ('paid','rolled')), 0))::bigint,
         coalesce(atr.overdue_count, 0),
         coalesce(atr.overdue_total_cents, 0)::bigint,
         atr.oldest_id,
         coalesce(tt.open_cents, 0)::bigint,
         private.invoice_future_cents(ab.id)
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$function$;
CREATE FUNCTION public.card_summary()
 RETURNS TABLE(account_id uuid, name text, credit_limit_cents bigint, closing_day integer, due_day integer, invoice_id uuid, reference_month date, closing_date date, due_date date, invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint, overdue_count integer, overdue_total_cents bigint, oldest_overdue_invoice_id uuid, invoice_open_cents bigint, invoice_future_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with cards as (
    select a.* from public.accounts a
    where a.workspace_id in (select private.my_workspace_ids())
      and a.type = 'credit_card' and not a.archived
  ),
  totals as (
    select ci.id as invoice_id, coalesce(sum(t.amount_cents), 0)::bigint as total_cents,
           private.invoice_open_cents(ci.id) as open_cents
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    left join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status not in ('paid','rolled')
    order by ci.account_id,
             -- a que vem a seguir para pagar (vencimento a partir de hoje), a mais próxima;
             -- sem nenhuma, a mais recente. `reference_month` é o mês do FECHAMENTO.
             (ci.due_date < current_date),
             case when ci.due_date >= current_date then ci.due_date end asc,
             ci.reference_month desc
  ),
  atrasadas as (
    select ci.account_id,
           count(*)::int as overdue_count,
           coalesce(sum(tt.open_cents), 0)::bigint as overdue_total_cents,
           (array_agg(ci.id order by ci.reference_month))[1] as oldest_id
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    left join totals tt on tt.invoice_id = ci.id
    where ci.status not in ('paid','rolled') and ci.due_date < current_date
    group by ci.account_id
  )
  select c.id, c.name, c.credit_limit_cents, c.closing_day, c.due_day,
         ab.id, ab.reference_month, ab.closing_date, ab.due_date,
         coalesce(tt.total_cents, 0)::bigint,
         coalesce((select sum(t2.open_cents) from totals t2
                   join public.card_invoices ci2 on ci2.id = t2.invoice_id
                   where ci2.account_id = c.id and ci2.status not in ('paid','rolled')), 0)::bigint,
         (coalesce(c.credit_limit_cents, 0)
          - coalesce((select sum(t3.open_cents) from totals t3
                      join public.card_invoices ci3 on ci3.id = t3.invoice_id
                      where ci3.account_id = c.id and ci3.status not in ('paid','rolled')), 0))::bigint,
         coalesce(atr.overdue_count, 0),
         coalesce(atr.overdue_total_cents, 0)::bigint,
         atr.oldest_id,
         coalesce(tt.open_cents, 0)::bigint,
         private.invoice_future_cents(ab.id)
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$function$;
CREATE FUNCTION public._upcoming_bills(uid uuid, days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean, future_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date,
         private.invoice_future_cents(ci.id)
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
  where ci.workspace_id in (select public._workspace_ids(uid))
    and ci.status not in ('paid','rolled')
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select case when t.kind = 'income' then 'income' else 'transaction' end, t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date,
         null::bigint
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  union all
  -- prestação de dívida/financiamento: vence e sai da conta como qualquer conta
  select 'debt', d.id, coalesce(d.payment_description, 'Parcela ' || d.name), s.payment_cents, s.due_date,
         s.due_date < current_date,
         null::bigint
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id in (select public._workspace_ids(uid))
    and not d.archived and d.remaining_cents > 0
    and s.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$function$;
CREATE FUNCTION public.upcoming_bills(days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean, future_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date,
         private.invoice_future_cents(ci.id)
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
  where ci.workspace_id in (select private.my_workspace_ids())
    and ci.status not in ('paid','rolled')
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select case when t.kind = 'income' then 'income' else 'transaction' end, t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date,
         null::bigint
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  union all
  -- prestação de dívida/financiamento: vence e sai da conta como qualquer conta
  select 'debt', d.id, coalesce(d.payment_description, 'Parcela ' || d.name), s.payment_cents, s.due_date,
         s.due_date < current_date,
         null::bigint
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id in (select private.my_workspace_ids())
    and not d.archived and d.remaining_cents > 0
    and s.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$function$;

revoke all on function public._card_summary(uuid) from public, anon, authenticated;
revoke all on function public._upcoming_bills(uuid, integer) from public, anon, authenticated;
revoke all on function public.card_summary() from public, anon;
revoke all on function public.upcoming_bills(integer) from public, anon;
grant execute on function public._card_summary(uuid) to service_role;
grant execute on function public._upcoming_bills(uuid, integer) to service_role;
grant execute on function public.card_summary() to authenticated, service_role;
grant execute on function public.upcoming_bills(integer) to authenticated, service_role;
