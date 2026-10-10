-- `transactions_summary` ganha `realizado_cents` e `realizado_count` NO FIM: o que JÁ ACONTECEU
-- na régua da DATA da lista de Lançamentos (chip "Aconteceu", `filtroDoEstado('cleared')`):
-- efetivado, OU compra com fatura e data de hoje para trás.
--
-- `pending_cents` (status) segue como está — três telas leem — mas ele conta como previsto a
-- compra de cartão de ontem, que a lista já mostra como "aconteceu". O card do topo precisa somar
-- o que a lista de baixo soma; o realizado por status não dá esse número.
--
-- O "hoje" é o do Brasil, fixado no cabeçalho (`set timezone`), nunca um default de parâmetro.
-- `drop` antes de `create` porque o tipo de retorno muda; o `drop` leva as permissões junto.

drop function if exists public.transactions_summary(date, date);

create function public.transactions_summary(from_date date, to_date date)
returns table(kind text, category text, total_cents bigint, tx_count bigint, pending_cents bigint,
              realizado_cents bigint, realizado_count bigint)
language sql stable
set search_path to 'public'
set timezone to 'America/Sao_Paulo'
as $fn$
  select t.kind, coalesce(t.category, 'outros') as category,
         sum(t.amount_cents)::bigint as total_cents,
         count(*)::bigint as tx_count,
         coalesce(sum(t.amount_cents) filter (where t.status = 'pending'), 0)::bigint as pending_cents,
         coalesce(sum(t.amount_cents) filter (where aconteceu), 0)::bigint as realizado_cents,
         (count(*) filter (where aconteceu))::bigint as realizado_count
  from public.transactions t
  cross join lateral (select t.status = 'cleared'
                             or (t.invoice_id is not null and t.occurred_at <= current_date)) as r(aconteceu)
  where t.workspace_id in (select private.my_workspace_ids())
    and t.kind <> 'transfer'
    and t.occurred_at between from_date and to_date
  group by 1, 2
  order by 3 desc;
$fn$;

revoke execute on function public.transactions_summary(date, date) from public, anon;
grant execute on function public.transactions_summary(date, date) to authenticated, service_role;
