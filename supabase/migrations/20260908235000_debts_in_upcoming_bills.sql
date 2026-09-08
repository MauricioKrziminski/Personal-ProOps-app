-- "O que vence" não mostrava a prestação do financiamento.
--
-- Mesma metade do defeito da projeção: a parcela de uma dívida vence numa data,
-- sai da conta e é exatamente o tipo de compromisso que a tela Hoje existe para
-- lembrar — e ela era a única saída futura que não aparecia ali.
--
-- `kind = 'debt'` é NOVO no retorno. A tela não pode tratá-lo como transação:
-- `ref_id` é o id da DÍVIDA, não de um lançamento, e chamar a baixa de
-- lançamento nele não acharia nada. Quem consome roteia para a dívida, igual já
-- faz com `invoice`. `today/index.tsx` e `forecast.tsx` foram ajustados junto.

CREATE OR REPLACE FUNCTION public._upcoming_bills(uid uuid, days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         coalesce(sum(t.amount_cents), 0)::bigint, ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id in (select public._workspace_ids(uid))
    and ci.status <> 'paid'
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select 'transaction', t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.status = 'pending' and t.invoice_id is null and t.kind = 'expense'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  union all
  -- prestação de dívida/financiamento: vence e sai da conta como qualquer conta
  select 'debt', d.id, 'Parcela ' || d.name, s.payment_cents, s.due_date,
         s.due_date < current_date
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id in (select public._workspace_ids(uid))
    and not d.archived and d.remaining_cents > 0
    and s.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$function$

;

CREATE OR REPLACE FUNCTION public.upcoming_bills(days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         coalesce(sum(t.amount_cents), 0)::bigint, ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id in (select private.my_workspace_ids())
    and ci.status <> 'paid'
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select 'transaction', t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.status = 'pending' and t.invoice_id is null and t.kind = 'expense'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  union all
  -- prestação de dívida/financiamento: vence e sai da conta como qualquer conta
  select 'debt', d.id, 'Parcela ' || d.name, s.payment_cents, s.due_date,
         s.due_date < current_date
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id in (select private.my_workspace_ids())
    and not d.archived and d.remaining_cents > 0
    and s.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$function$

;

