-- `_tx_summary` acompanha a `transactions_summary`.
--
-- A `20260909160000` deu `pending_cents` à pública e deixou a INTERNA para trás — elas têm nomes
-- diferentes (`transactions_summary` × `_tx_summary`), então a busca por "a interna" não achou
-- nada e a correção passou por cima. Consequência: o app parou de contar previsto no "entrou" e
-- o **WhatsApp continuou contando**, no mesmo mês, para o mesmo usuário.
--
-- Achado varrendo TODA função que soma `amount_cents` e checando se filtra `status` — não por
-- alguém notar o número errado. Duas funções com o mesmo papel e nomes diferentes é a forma que
-- esse tipo de defeito tem de sobreviver a uma correção.

drop function if exists public._tx_summary(uuid, date, date);

create function public._tx_summary(uid uuid, from_date date, to_date date)
returns table(kind text, category text, total_cents bigint, tx_count bigint, pending_cents bigint)
language sql
stable security definer
set search_path to 'public'
as $fn$
  select t.kind, coalesce(t.category, 'outros') as category,
         sum(t.amount_cents)::bigint as total_cents,
         count(*)::bigint as tx_count,
         coalesce(sum(t.amount_cents) filter (where t.status = 'pending'), 0)::bigint as pending_cents
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.kind <> 'transfer'
    and t.occurred_at between from_date and to_date
  group by 1, 2
  order by 3 desc;
$fn$;
revoke execute on function public._tx_summary(uuid, date, date) from public, anon, authenticated;
