-- Uma régua só para "aconteceu" (lista de Lançamentos, `filtroDoEstado`, `estadoDaLinha`):
-- linha de CARTÃO (`invoice_id` não nulo) vale pela DATA — aconteceu se `occurred_at <= hoje`,
-- mesmo nascendo `cleared`; fora do cartão vale pelo STATUS (`cleared`).
--
-- A `20261010232000` dizia `cleared OR (cartão e data até hoje)`, e a compra de cartão FUTURA,
-- nascida `cleared`, entrava em "realizado" enquanto a fatura a mostra em "Ainda vai entrar".
-- Resto idêntico: `drop` porque o tipo muda de dono, `set timezone` no cabeçalho (o "hoje" do
-- Brasil), mesmas permissões.

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
  cross join lateral (select case when t.invoice_id is not null then t.occurred_at <= current_date
                                  else t.status = 'cleared' end) as r(aconteceu)
  where t.workspace_id in (select private.my_workspace_ids())
    and t.kind <> 'transfer'
    and t.occurred_at between from_date and to_date
  group by 1, 2
  order by 3 desc;
$fn$;

revoke execute on function public.transactions_summary(date, date) from public, anon;
grant execute on function public.transactions_summary(date, date) to authenticated, service_role;
