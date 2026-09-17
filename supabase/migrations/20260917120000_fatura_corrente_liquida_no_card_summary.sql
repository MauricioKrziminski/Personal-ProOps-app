-- O que falta na fatura CORRENTE, líquido do pagamento parcial.
--
-- `invoice_total_cents` é BRUTO (a soma das compras) e `unpaid_total_cents` é LÍQUIDO (a soma do
-- que falta em todas as faturas não pagas, já descontando `paid_cents`). A tela de Cartões escreve
-- "inclui R$ X de outras faturas" subtraindo a corrente do total usado — com um pagamento parcial
-- na corrente, o bruto é maior que o líquido e esse X saía menor que o real (medido em
-- 17/09/2026). Não dava para corrigir no app: o quanto foi pago não chegava lá.
--
-- `invoice_open_cents` entra no FIM das duas assinaturas — o agente lê estas linhas por NOME
-- (`select * from public._card_summary(...)`), e coluna nova no meio trocaria a leitura de quem
-- lesse por posição.
--
-- Mudar o tipo de retorno exige `drop` + `create`: `create or replace` recusa com "cannot change
-- return type of existing function".

drop function if exists public._card_summary(uuid);
drop function if exists public.card_summary();

create function public._card_summary(uid uuid)
returns table(
  account_id uuid, name text, credit_limit_cents bigint,
  closing_day int, due_day int,
  invoice_id uuid, reference_month date, closing_date date, due_date date,
  invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint,
  overdue_count int, overdue_total_cents bigint, oldest_overdue_invoice_id uuid,
  invoice_open_cents bigint
)
language sql stable security definer
set search_path = public
set "TimeZone" = 'America/Sao_Paulo'
as $$
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
    left join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status not in ('paid','rolled')
    order by ci.account_id,
             -- corrente e futuras primeiro, da mais próxima para a mais distante
             (ci.reference_month < date_trunc('month', current_date)::date),
             case when ci.reference_month >= date_trunc('month', current_date)::date
                  then ci.reference_month end asc,
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
         coalesce(tt.open_cents, 0)::bigint
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$$;
revoke execute on function public._card_summary(uuid) from public, anon, authenticated;

-- Wrapper security invoker: query INLINE sob RLS, não chamada à interna (o EXECUTE da interna é
-- revogado para `authenticated`). Padrão duplo de `supabase.md` — a duplicação é intencional.
create function public.card_summary()
returns table(
  account_id uuid, name text, credit_limit_cents bigint,
  closing_day int, due_day int,
  invoice_id uuid, reference_month date, closing_date date, due_date date,
  invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint,
  overdue_count int, overdue_total_cents bigint, oldest_overdue_invoice_id uuid,
  invoice_open_cents bigint
)
language sql stable
set search_path = public
set "TimeZone" = 'America/Sao_Paulo'
as $$
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
    left join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status not in ('paid','rolled')
    order by ci.account_id,
             (ci.reference_month < date_trunc('month', current_date)::date),
             case when ci.reference_month >= date_trunc('month', current_date)::date
                  then ci.reference_month end asc,
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
         coalesce(tt.open_cents, 0)::bigint
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$$;
