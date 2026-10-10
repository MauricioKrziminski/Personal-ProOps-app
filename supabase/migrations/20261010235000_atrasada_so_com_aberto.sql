-- Fatura vencida sem nada em aberto (`invoice_open_cents <= 0`) não é atrasada: `card_summary`
-- contava a fatura vencida e não paga pelo STATUS, então uma fatura que ficou vazia (compras
-- apagadas) virava "Fatura atrasada · R$ 0,00" e acendia o "Atrasada" na face do cartão. Só a
-- CTE `atrasadas` muda (contagem, total e a mais antiga olham só quem tem aberto > 0). Corpos
-- copiados da 20261010233000, com o drop porque `create or replace` não troca o tipo de retorno
-- aqui por segurança de permissões; as permissões são refeitas como lá.

drop function if exists public._card_summary(uuid);
drop function if exists public.card_summary();

CREATE FUNCTION public._card_summary(uid uuid)
 RETURNS TABLE(account_id uuid, name text, credit_limit_cents bigint, closing_day integer, due_day integer, invoice_id uuid, reference_month date, closing_date date, due_date date, invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint, overdue_count integer, overdue_total_cents bigint, oldest_overdue_invoice_id uuid, invoice_open_cents bigint, invoice_future_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
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
    left join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status not in ('paid','rolled')
    order by ci.account_id,
             -- corrente e futuras primeiro, da mais próxima para a mais distante
             -- a que vem a seguir para pagar (vencimento a partir de hoje), a mais próxima;
             -- sem nenhuma, a mais recente. `reference_month` é o mês do FECHAMENTO.
             (ci.due_date < current_date),
             case when ci.due_date >= current_date then ci.due_date end asc,
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
      -- fatura vencida SEM nada em aberto não é dívida (compras apagadas, tudo pago): não conta
      and coalesce(tt.open_cents, 0) > 0
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
         coalesce(tt.open_cents, 0)::bigint,
         private.invoice_future_cents(ab.id)
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$function$;
CREATE FUNCTION public.card_summary()
 RETURNS TABLE(account_id uuid, name text, credit_limit_cents bigint, closing_day integer, due_day integer, invoice_id uuid, reference_month date, closing_date date, due_date date, invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint, overdue_count integer, overdue_total_cents bigint, oldest_overdue_invoice_id uuid, invoice_open_cents bigint, invoice_future_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
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
    left join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status not in ('paid','rolled')
    order by ci.account_id,
             -- a que vem a seguir para pagar (vencimento a partir de hoje), a mais próxima;
             -- sem nenhuma, a mais recente. `reference_month` é o mês do FECHAMENTO.
             (ci.due_date < current_date),
             case when ci.due_date >= current_date then ci.due_date end asc,
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
      -- fatura vencida SEM nada em aberto não é dívida (compras apagadas, tudo pago): não conta
      and coalesce(tt.open_cents, 0) > 0
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
         coalesce(tt.open_cents, 0)::bigint,
         private.invoice_future_cents(ab.id)
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$function$;

revoke all on function public._card_summary(uuid) from public, anon, authenticated;
revoke all on function public.card_summary() from public, anon;
grant execute on function public._card_summary(uuid) to service_role;
grant execute on function public.card_summary() to authenticated, service_role;
