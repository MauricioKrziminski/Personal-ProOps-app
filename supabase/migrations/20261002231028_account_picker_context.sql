-- F03: retain canonical invoice exposure, but never present incomplete legacy data as available credit.
-- This read model does not rewrite invoices, account seeds, transactions or payment history.
create function public.card_limit_context()
returns table(account_id uuid, credit_limit_cents bigint, available_limit_cents bigint, limit_status text)
language sql stable security invoker
set search_path = public
set timezone = 'America/Sao_Paulo'
as $$
  with cards as materialized (
    select a.id, a.credit_limit_cents, a.initial_balance_cents
    from public.accounts a
    where a.workspace_id in (select private.my_workspace_ids())
      and a.type = 'credit_card' and not a.archived
  ),
  incomplete as (
    select t.account_id from public.transactions t join cards c on c.id = t.account_id
    where t.kind = 'income' or (t.kind in ('expense','transfer') and t.invoice_id is null)
    union
    select t.counterparty_account_id from public.transactions t join cards c on c.id = t.counterparty_account_id
    where t.kind = 'transfer' and t.pays_invoice_id is null
  ),
  limits as (
    select c.id, c.credit_limit_cents, s.available_limit_cents,
      case when c.credit_limit_cents is null then 'not_set'
           when c.initial_balance_cents <> 0 or i.account_id is not null then 'needs_review'
           else 'available' end as quality
    from cards c join public.card_summary() s on s.account_id = c.id
    left join incomplete i on i.account_id = c.id
  )
  select l.id, l.credit_limit_cents,
         case when l.quality = 'available' then l.available_limit_cents else null::bigint end,
         l.quality
  from limits l;
$$;
revoke execute on function public.card_limit_context() from public, anon;
grant execute on function public.card_limit_context() to authenticated;
