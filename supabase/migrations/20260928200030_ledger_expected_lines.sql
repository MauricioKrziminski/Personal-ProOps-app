-- One bounded read for unrecorded occurrences in Lançamentos / Ver ocorrências.
-- It deliberately does not feed cash/cycle totals or create ledger transactions.
create index if not exists debt_declared_due_dates_period_idx
  on public.debt_declared_due_dates (due_date, debt_id);

create or replace function public.ledger_expected_lines(
  p_from date, p_to date, p_recurring_id uuid default null
)
returns table (
  origin text, ref_id uuid, due_date date, amount_cents bigint, kind text,
  description text, category text, account_id uuid,
  installment_no integer, installments_total integer, inferred_start boolean
)
language plpgsql stable security invoker
set search_path = public
set "TimeZone" = 'America/Sao_Paulo'
as $$
declare
  ws_ids uuid[] := array(select private.my_workspace_ids());
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 61 then
    raise exception 'Consulte um período válido de até 62 dias';
  end if;

  return query
  select 'recurring'::text, r.recurring_id, r.due_date, r.amount_cents,
         r.kind, r.description, r.category, r.account_id,
         null::integer, null::integer, r.inferred_start
  from public.expected_recurring_occurrences(p_from,p_to,p_recurring_id) r

  union all

  select 'debt_schedule'::text, d.id, s.due_date, s.payment_cents,
         'expense'::text, coalesce(d.payment_description,'Parcela ' || d.name),
         coalesce(d.payment_category,'contas'), d.account_id,
         s.installment_no, d.installments, false
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where p_recurring_id is null
    and d.workspace_id = any(ws_ids) and not d.archived
    and s.due_date between p_from and p_to

  union all

  select 'debt_estimate'::text, d.id, h.due_date,
         coalesce(a.amount_cents,d.installment_cents,
                  private.price_installment(d.principal_cents,d.interest_rate_monthly,d.installments)),
         'expense'::text, coalesce(d.payment_description,'Parcela ' || d.name),
         coalesce(d.payment_category,'contas'), d.account_id,
         h.installment_no, d.installments, true
  from public.debt_declared_due_dates h
  join public.debts d on d.id=h.debt_id
  left join public.debt_declared_estimates a
    on a.debt_id=h.debt_id and a.installment_no=h.installment_no
  where p_recurring_id is null
    and d.workspace_id = any(ws_ids)
    and h.installment_no <= d.installments_paid
    and h.due_date between p_from and p_to
    and not exists (
      select 1 from public.transactions t
      where t.debt_id=d.id and t.debt_payment_no=h.installment_no
    );
end;
$$;
revoke execute on function public.ledger_expected_lines(date,date,uuid) from public, anon;
grant execute on function public.ledger_expected_lines(date,date,uuid) to authenticated;
