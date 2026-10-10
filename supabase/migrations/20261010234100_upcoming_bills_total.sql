-- `upcoming_bills` ganha `total_cents` NO FIM: o total BRUTO da fatura (a soma das linhas dela, a
-- mesma do `invoice_total_cents` do `card_summary`), só na linha de fatura. `amount_cents` é o EM
-- ABERTO (líquido do pagamento parcial); a Hoje precisa do bruto para decidir se "X ainda vai
-- entrar" repete o número grande (fatura inteira à frente) ou não — comparar o futuro bruto com o
-- líquido escondia a frase numa fatura paga em parte. Resto idêntico à `20261010233000`.

drop function if exists public._upcoming_bills(uuid, integer);
drop function if exists public.upcoming_bills(integer);
CREATE FUNCTION public._upcoming_bills(uid uuid, days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean, future_cents bigint, total_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date,
         private.invoice_future_cents(ci.id),
         sum(t.amount_cents)::bigint
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
         null::bigint, null::bigint
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  union all
  -- prestação de dívida/financiamento: vence e sai da conta como qualquer conta
  select 'debt', d.id, coalesce(d.payment_description, 'Parcela ' || d.name), s.payment_cents, s.due_date,
         s.due_date < current_date,
         null::bigint, null::bigint
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id in (select public._workspace_ids(uid))
    and not d.archived and d.remaining_cents > 0
    and s.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$function$;
CREATE FUNCTION public.upcoming_bills(days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean, future_cents bigint, total_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date,
         private.invoice_future_cents(ci.id),
         sum(t.amount_cents)::bigint
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
         null::bigint, null::bigint
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  union all
  -- prestação de dívida/financiamento: vence e sai da conta como qualquer conta
  select 'debt', d.id, coalesce(d.payment_description, 'Parcela ' || d.name), s.payment_cents, s.due_date,
         s.due_date < current_date,
         null::bigint, null::bigint
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id in (select private.my_workspace_ids())
    and not d.archived and d.remaining_cents > 0
    and s.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$function$;


revoke all on function public._upcoming_bills(uuid, integer) from public, anon, authenticated;
revoke all on function public.upcoming_bills(integer) from public, anon;
grant execute on function public._upcoming_bills(uuid, integer) to service_role;
grant execute on function public.upcoming_bills(integer) to authenticated, service_role;
