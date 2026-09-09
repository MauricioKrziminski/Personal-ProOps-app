-- "entrou R$ 10.200,00" para de contar o que não entrou.
--
-- `transactions_summary` e `monthly_cashflow` agregavam sem olhar `status`, então o Financeiro
-- escrevia `entrou` (verbo no passado) somando o Pix que o Winicius ainda não mandou, e as barras
-- da Tendência mensal misturavam previsto com recebido na MESMA barra, sem distinção visual.
--
-- **Coluna nova, não mudança de significado.** `total_cents`, `income_cents` e `expense_cents`
-- continuam sendo o total — três telas e o agente somam elas, e trocar o que uma coluna existente
-- quer dizer é o tipo de quebra que não dá erro, só número errado. O realizado sai por subtração:
-- `total_cents - pending_cents`.
--
-- `drop` antes de `create` porque o tipo de retorno muda (42P13); o `drop` leva o `revoke` junto,
-- então ele é reemitido no fim da interna.

drop function if exists public.transactions_summary(date, date);

create function public.transactions_summary(from_date date, to_date date)
returns table(kind text, category text, total_cents bigint, tx_count bigint, pending_cents bigint)
language sql stable
set search_path to 'public'
as $fn$
  select t.kind, coalesce(t.category, 'outros') as category,
         sum(t.amount_cents)::bigint as total_cents,
         count(*)::bigint as tx_count,
         coalesce(sum(t.amount_cents) filter (where t.status = 'pending'), 0)::bigint as pending_cents
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.kind <> 'transfer'
    and t.occurred_at between from_date and to_date
  group by 1, 2
  order by 3 desc;
$fn$;

drop function if exists public._monthly_cashflow(uuid, integer);

create function public._monthly_cashflow(uid uuid, months_back integer DEFAULT 6)
 RETURNS TABLE(month date, income_cents bigint, expense_cents bigint,
              income_pending_cents bigint, expense_pending_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select date_trunc('month', t.occurred_at)::date as month,
         sum(case when t.kind = 'income' then t.amount_cents else 0 end)::bigint as income_cents,
         sum(case when t.kind = 'expense' then t.amount_cents else 0 end)::bigint as expense_cents,
         coalesce(sum(t.amount_cents) filter (where t.kind = 'income'  and t.status = 'pending'), 0)::bigint,
         coalesce(sum(t.amount_cents) filter (where t.kind = 'expense' and t.status = 'pending'), 0)::bigint
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.kind <> 'transfer'
    and t.occurred_at >= (date_trunc('month', current_date)
                          - make_interval(months => least(greatest(coalesce(months_back, 6), 1), 60)))::date
    -- Fecha a janela no fim do mês CORRENTE: parcela de 2027 não é "os últimos N meses".
    and t.occurred_at < (date_trunc('month', current_date) + interval '1 month')::date
  group by 1
  order by 1;
$function$;
revoke execute on function public._monthly_cashflow(uuid, integer) from public, anon, authenticated;

drop function if exists public.monthly_cashflow(integer);

create function public.monthly_cashflow(months_back integer DEFAULT 6)
 RETURNS TABLE(month date, income_cents bigint, expense_cents bigint,
              income_pending_cents bigint, expense_pending_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select date_trunc('month', t.occurred_at)::date as month,
         sum(case when t.kind = 'income' then t.amount_cents else 0 end)::bigint as income_cents,
         sum(case when t.kind = 'expense' then t.amount_cents else 0 end)::bigint as expense_cents,
         coalesce(sum(t.amount_cents) filter (where t.kind = 'income'  and t.status = 'pending'), 0)::bigint,
         coalesce(sum(t.amount_cents) filter (where t.kind = 'expense' and t.status = 'pending'), 0)::bigint
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.kind <> 'transfer'
    and t.occurred_at >= (date_trunc('month', current_date)
                          - make_interval(months => least(greatest(coalesce(months_back, 6), 1), 60)))::date
    and t.occurred_at < (date_trunc('month', current_date) + interval '1 month')::date
  group by 1
  order by 1;
$function$;
