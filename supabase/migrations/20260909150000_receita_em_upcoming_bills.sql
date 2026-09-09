-- A receita prevista aparece onde a despesa já aparecia.
--
-- `upcoming_bills` tinha `and t.kind = 'expense'` cravado no ramo de lançamento avulso — é por
-- isso que a Hoje e a Projeção mostravam o que vai SAIR e nunca o que vai ENTRAR. O dono do
-- produto: *"analise em todos os lugares que faria sentido isso"*.
--
-- **Quarto valor de `kind`, não coluna nova.** O `RETURNS TABLE` não muda, então nenhuma tela
-- quebra por assinatura — mas a união fechada em `use-finance.ts` ganha `| 'income'` e o
-- TypeScript OBRIGA as duas telas a tratar o caso. Foi assim que `'debt'` entrou.
-- `settleLabel('income')` já devolve "Recebi", sem adaptador.
--
-- ⚠️ As outras ocorrências de `kind = 'expense'` no arquivo NÃO mudam: são cálculo de fatura,
-- onde receita não existe.
--
-- ⚠️ **A Edge Function legada precisa acompanhar, e não é opcional.**
-- `supabase/functions/process-jobs/index.ts:563` chama `_upcoming_bills` e escreve "📅 A pagar:"
-- por cima do resultado — sem um filtro lá, o salário apareceria no WhatsApp como conta a pagar.
-- Auditado: os únicos consumidores são o app e essa function; nenhuma função SQL chama a RPC.

CREATE OR REPLACE FUNCTION public._upcoming_bills(uid uuid, days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id in (select public._workspace_ids(uid))
    and ci.status <> 'paid'
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select case when t.kind = 'income' then 'income' else 'transaction' end, t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
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
$function$;

revoke execute on function public._upcoming_bills(uuid, integer) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.upcoming_bills(days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id in (select private.my_workspace_ids())
    and ci.status <> 'paid'
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select case when t.kind = 'income' then 'income' else 'transaction' end, t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
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
$function$;
