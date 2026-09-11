-- Fatura vencida que não foi paga: jogar o saldo para a próxima ("rotativo").
--
-- É o que o Nubank faz e o que o dono do produto já modelava à mão na planilha — a aba de
-- setembro tem três linhas escritas por ele: `Saldo em rotativo de Agosto` 333,75,
-- `Juros de pagamento parcial da fatura (rotativo)` 54,07 e `IOF ... (rotativo)` 2,13. Sem isto
-- no app a única saída era marcar como PAGA uma fatura que não foi paga, e aí o saldo e a
-- projeção inteira mentem.
--
-- ## O que a lei decide por nós
--
-- * **IOF é exato, não estimativa**: 0,38% fixo + 0,0082% ao dia sobre o principal, teto de
--   3,38% (Decretos 12.466/2025 e 12.499/2025, mantidos pelo STF). O app calcula.
-- * **Juros são do cartão** e variam — vêm impressos na fatura. Ficam em
--   `accounts.rotativo_rate_monthly`. Sem taxa, o app NÃO inventa: rola só o principal e a tela
--   diz que os juros não entraram (projeção otimista por esse valor).
-- * **O rotativo dura UM ciclo** (Resolução CMN 4.549/2017): depois do vencimento seguinte o
--   banco é obrigado a converter em parcelamento. Por isso `roll_invoice` RECUSA adiar uma
--   fatura que já é destino de outra — quem precisa de mais prazo usa
--   `create_installment_plan`, que já existe.
--
-- ## ⚠️ O erro que esta migration existe para evitar
--
-- Uma fatura adiada continua `status <> 'paid'`. Sem mexer em mais nada, ela seguiria pesando
-- no caixa na data de vencimento **e** o principal entraria de novo na fatura seguinte: o mesmo
-- dinheiro cobrado duas vezes, sem erro nenhum na tela. São 15 ocorrências em 9 funções, e as
-- 15 estão abaixo. `supabase/tests/roll_invoice.sql` prende o "exatamente uma vez".

alter table public.accounts
  add column if not exists rotativo_auto boolean not null default false,
  add column if not exists rotativo_rate_monthly numeric
    check (rotativo_rate_monthly is null or (rotativo_rate_monthly >= 0 and rotativo_rate_monthly <= 1));

comment on column public.accounts.rotativo_auto is
  'Cartão rola sozinho a fatura não paga no dia seguinte ao vencimento. Escolha do usuário no '
  'cadastro do cartão — não é padrão, porque cartão pago em dia nunca mais apareceria atrasado.';
comment on column public.accounts.rotativo_rate_monthly is
  'Juros do rotativo em fração mensal (15,5% a.m. = 0.155), como `debts.interest_rate_monthly`. '
  'Null = não estimar juros; o app rola só o principal e diz isso na tela.';

alter table public.card_invoices
  add column if not exists rolled_into_invoice_id uuid references public.card_invoices(id);

comment on column public.card_invoices.rolled_into_invoice_id is
  'Para qual fatura o saldo em aberto foi. A INTERFACE nunca escreve "rolada" — ela escreve '
  '"Foi para a fatura de 10/11", que é o que aconteceu. O usuário recusou o jargão.';

do $$
begin
  alter table public.card_invoices drop constraint if exists card_invoices_status_check;
  alter table public.card_invoices add constraint card_invoices_status_check
    check (status in ('open','closed','paid','rolled'));
end $$;

CREATE OR REPLACE FUNCTION public._upcoming_bills(uid uuid, days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id in (select public._workspace_ids(uid))
    and ci.status not in ('paid','rolled')
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

CREATE OR REPLACE FUNCTION public.upcoming_bills(days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id in (select private.my_workspace_ids())
    and ci.status not in ('paid','rolled')
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

CREATE OR REPLACE FUNCTION public._card_summary(uid uuid)
 RETURNS TABLE(account_id uuid, name text, credit_limit_cents bigint, closing_day integer, due_day integer, invoice_id uuid, reference_month date, closing_date date, due_date date, invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint, overdue_count integer, overdue_total_cents bigint, oldest_overdue_invoice_id uuid)
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
         atr.oldest_id
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$function$;

CREATE OR REPLACE FUNCTION public.card_summary()
 RETURNS TABLE(account_id uuid, name text, credit_limit_cents bigint, closing_day integer, due_day integer, invoice_id uuid, reference_month date, closing_date date, due_date date, invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint, overdue_count integer, overdue_total_cents bigint, oldest_overdue_invoice_id uuid)
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
         atr.oldest_id
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$function$;

CREATE OR REPLACE FUNCTION public._cash_flow_forecast(uid uuid, days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with horizonte as (select private.clamp_forecast_days(days) as dias),
  saldo_inicial as (select private.cash_total(array(select public._workspace_ids(uid))) as cents),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select public._workspace_ids(uid)) and ci.status not in ('paid','rolled')
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select public._workspace_ids(uid))
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
      and (t.kind <> 'income' or coalesce(t.due_at, t.occurred_at) >= current_date - 3)
    union all
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select public._workspace_ids(uid))
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
    union all
    -- NOVO: recorrente além do horizonte materializado
    select p.due_date,
           case when p.kind = 'income'  then p.amount_cents else 0 end::bigint,
           case when p.kind = 'expense' then p.amount_cents else 0 end::bigint
    from private.recurring_projection_for(
           array(select public._workspace_ids(uid)), current_date,
           current_date + (select dias from horizonte)) p
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;

CREATE OR REPLACE FUNCTION public.cash_flow_forecast(days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with horizonte as (select private.clamp_forecast_days(days) as dias),
  saldo_inicial as (select private.cash_total(array(select private.my_workspace_ids())) as cents),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select private.my_workspace_ids()) and ci.status not in ('paid','rolled')
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select private.my_workspace_ids())
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
      and (t.kind <> 'income' or coalesce(t.due_at, t.occurred_at) >= current_date - 3)
    union all
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select private.my_workspace_ids())
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
    union all
    select p.due_date,
           case when p.kind = 'income'  then p.amount_cents else 0 end::bigint,
           case when p.kind = 'expense' then p.amount_cents else 0 end::bigint
    from private.recurring_projection_for(
           array(select private.my_workspace_ids()), current_date,
           current_date + (select dias from horizonte)) p
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;

CREATE OR REPLACE FUNCTION private.net_worth_now(ws_id uuid)
 RETURNS TABLE(cash_cents bigint, investments_cents bigint, other_assets_cents bigint, liabilities_cents bigint, net_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with dinheiro as (select private.cash_total(array[ws_id]) as cents),
  investimentos as (
    select coalesce(sum(current_value_cents), 0)::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class in ('investment','crypto','equity')
  ),
  outros as (
    select coalesce(sum(current_value_cents), 0)::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class not in ('investment','crypto','equity')
  ),
  passivos as (
    select (
      coalesce((select sum(current_value_cents) from public.assets
                where workspace_id = ws_id and not archived and is_liability), 0)
      + coalesce((select sum(remaining_cents) from public.debts
                  where workspace_id = ws_id and not archived), 0)
      + coalesce((select sum(private.invoice_open_cents(ci.id)) from public.card_invoices ci
                  where ci.workspace_id = ws_id and ci.status not in ('paid','rolled')), 0)
    )::bigint as cents
  )
  select d.cents, i.cents, o.cents, p.cents,
         (d.cents + i.cents + o.cents - p.cents)::bigint
  from dinheiro d, investimentos i, outros o, passivos p;
$function$;

CREATE OR REPLACE FUNCTION public.settle_invoice(p_invoice_id uuid, p_paid_at date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  inv record;
begin
  -- security invoker + RLS: quem não enxerga a fatura não acha a linha
  select ci.id, ci.status into inv
  from public.card_invoices ci where ci.id = p_invoice_id;
  if inv.id is null then
    raise exception 'fatura não encontrada';
  end if;

  -- Idempotente de propósito: o usuário toca duas vezes no botão antes da tela
  -- responder, e a segunda não pode virar erro nem segunda escrita.
  if inv.status in ('paid','rolled') then
    return p_invoice_id;
  end if;

  -- As parcelas de dentro TAMBÉM fecham. Sem isto o app se contradiz: fatura
  -- paga continuaria alimentando `upcoming_bills` e cada parcela continuaria
  -- oferecendo o botão "Paguei".
  --
  -- ⚠️ NÃO tocar em `occurred_at`: o trigger `set_invoice` é
  -- `before update of account_id, occurred_at` (0013:211) e remanejaria a
  -- parcela da fatura de maio para a fatura de hoje.
  update public.transactions
     set status = 'cleared', paid_at = p_paid_at
   where invoice_id = p_invoice_id and status = 'pending';

  -- `payment_transaction_id` fica NULL, e é isso que distingue esta operação de
  -- `pay_invoice`: não existe transferência, então nenhum saldo se move.
  update public.card_invoices
     set status = 'paid', paid_at = p_paid_at,
         payment_transaction_id = null, settled_manually = true
   where id = p_invoice_id;

  return p_invoice_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pay_invoice(p_invoice_id uuid, p_account_id uuid, p_paid_at date DEFAULT CURRENT_DATE, p_amount_cents bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  inv    record;
  aberto bigint;
  valor  bigint;
  tx_id  uuid;
begin
  select ci.*, a.name as card_name into inv
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  where ci.id = p_invoice_id;
  if inv.id is null then
    raise exception 'fatura não encontrada';
  end if;
  if inv.status in ('paid','rolled') then
    raise exception 'fatura já paga em %', inv.paid_at;
  end if;
  if p_account_id = inv.account_id then
    raise exception 'a conta pagadora não pode ser o próprio cartão';
  end if;

  aberto := private.invoice_open_cents(p_invoice_id);
  if aberto <= 0 then
    raise exception 'fatura sem lançamentos';
  end if;

  -- sem valor, paga o que falta: pagar tudo continua sendo um toque
  valor := coalesce(p_amount_cents, aberto);
  if valor <= 0 then
    raise exception 'o valor do pagamento precisa ser maior que zero';
  end if;
  if valor > aberto then
    raise exception 'o pagamento é maior que o valor em aberto';
  end if;

  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description,
     account_id, counterparty_account_id, occurred_at, source, status)
  values (inv.workspace_id, coalesce((select auth.uid()), inv.user_id), 'transfer',
          valor, 'Pagamento da fatura ' || inv.card_name,
          p_account_id, inv.account_id, p_paid_at, 'app', 'cleared')
  returning id into tx_id;

  update public.card_invoices set paid_cents = paid_cents + valor where id = p_invoice_id;

  -- Quitou. Enquanto não quitar, a fatura continua em aberto e as compras continuam previstas —
  -- que é a verdade: elas ainda não foram pagas.
  if valor = aberto then
    -- a baixa das linhas, pelo mesmo motivo da 20260909031000
    update public.transactions
       set status = 'cleared', paid_at = p_paid_at
     where invoice_id = p_invoice_id and status = 'pending';

    update public.card_invoices
       set status = 'paid', paid_at = p_paid_at, payment_transaction_id = tx_id
     where id = p_invoice_id;
  end if;

  return tx_id;
end;
$function$;


-- ⚠️ **O principal adiado NÃO é gasto novo — é a mesma compra, já contada.**
--
-- Ele precisa existir como lançamento para entrar no TOTAL da próxima fatura (o total de fatura
-- é a soma das transações dela, nunca coluna materializada) e para o caixa sair na data certa.
-- Mas nas visões de COMPETÊNCIA — "O mês inteiro" e orçamento — ele seria a compra de agosto
-- contada outra vez em setembro: o mesmo dinheiro inflando dois meses e comendo o orçamento
-- duas vezes. Juros e IOF, ao contrário, SÃO gasto novo e contam em todo lugar.
alter table public.transactions
  add column if not exists rollover_of_invoice_id uuid references public.card_invoices(id);

comment on column public.transactions.rollover_of_invoice_id is
  'Preenchido só no PRINCIPAL adiado de uma fatura. Marca "isto não é compra nova, é dívida que '
  'mudou de fatura" — competência exclui, caixa e total da fatura contam. Juros e IOF do '
  'rotativo são lançamentos comuns e ficam com a coluna nula de propósito.';

create index if not exists transactions_rollover_idx
  on public.transactions(rollover_of_invoice_id) where rollover_of_invoice_id is not null;

-- Adia o saldo em aberto de uma fatura vencida para a próxima.
--
-- Não calcula qual é "a próxima": insere o lançamento na data de VENCIMENTO da fatura de origem
-- e deixa o trigger `set_invoice` resolver pelo dia de fechamento do cartão. É a única regra de
-- ciclo de fatura do sistema, e duplicá-la aqui seria a segunda cópia que diverge — ela já
-- acertou o caso que engana: com fechamento no dia 3, um lançamento de 10/09 cai na fatura que
-- fecha 03/10 e vence 10/10.
create or replace function public.roll_invoice(
  p_invoice_id uuid,
  p_juros_cents bigint default null,
  p_iof_cents bigint default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  inv public.card_invoices;
  card public.accounts;
  aberto bigint;
  destino public.card_invoices;
  dias int;
  juros bigint := coalesce(p_juros_cents, 0);
  iof bigint := coalesce(p_iof_cents, 0);
  tx_id uuid;
  rotulo text;
begin
  select * into inv from public.card_invoices where id = p_invoice_id;
  if not found then
    raise exception 'Fatura não encontrada';
  end if;
  if inv.status = 'paid' then
    raise exception 'Essa fatura já está paga';
  end if;
  if inv.status = 'rolled' then
    raise exception 'Essa fatura já foi para a próxima';
  end if;

  -- Resolução CMN 4.549/2017: o rotativo dura UM ciclo. Depois do vencimento seguinte o banco é
  -- obrigado a converter em parcelamento — e o app tem `create_installment_plan` para isso.
  -- Adiar em cadeia modelaria algo que a lei não permite.
  if exists (select 1 from public.card_invoices o where o.rolled_into_invoice_id = inv.id) then
    raise exception 'Essa fatura já recebeu um saldo adiado. Pela regra do Banco Central o rotativo dura um ciclo — o caminho agora é parcelar';
  end if;

  aberto := private.invoice_open_cents(inv.id);
  if aberto <= 0 then
    raise exception 'Não há saldo em aberto nessa fatura';
  end if;

  select * into card from public.accounts where id = inv.account_id;
  rotulo := to_char(inv.reference_month, 'TMMonth');

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, currency, category,
     description, occurred_at, status, source, rollover_of_invoice_id)
  values (inv.workspace_id, inv.user_id, inv.account_id, 'expense', aberto, 'BRL', 'contas',
          'Saldo em rotativo de ' || rotulo, inv.due_date, 'pending', 'app', inv.id)
  returning id into tx_id;

  select ci.* into destino from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id where t.id = tx_id;

  -- IOF é LEI, não estimativa: 0,38% fixo + 0,0082% ao dia, teto de 3,38%
  -- (Decretos 12.466/2025 e 12.499/2025). Por isso ele sai sempre, mesmo sem taxa de juros.
  dias := greatest(1, destino.due_date - inv.due_date);
  if p_iof_cents is null then
    iof := round(aberto * least(0.0038 + 0.000082 * dias, 0.0338));
  end if;
  -- Juros são do CARTÃO e vêm impressos na fatura. Sem a taxa o app não inventa: rola só o
  -- principal, e a tela diz que a projeção está otimista por esse valor.
  if p_juros_cents is null and card.rotativo_rate_monthly is not null then
    juros := round(aberto * card.rotativo_rate_monthly);
  end if;

  if juros > 0 then
    insert into public.transactions
      (workspace_id, user_id, account_id, kind, amount_cents, currency, category,
       description, occurred_at, status, source)
    values (inv.workspace_id, inv.user_id, inv.account_id, 'expense', juros, 'BRL', 'juros',
            'Juros do rotativo' || case when p_juros_cents is null then ' (estimado)' else '' end,
            inv.due_date, 'pending', 'app');
  end if;
  if iof > 0 then
    insert into public.transactions
      (workspace_id, user_id, account_id, kind, amount_cents, currency, category,
       description, occurred_at, status, source)
    values (inv.workspace_id, inv.user_id, inv.account_id, 'expense', iof, 'BRL', 'impostos',
            'IOF do rotativo', inv.due_date, 'pending', 'app');
  end if;

  update public.card_invoices
     set status = 'rolled', rolled_into_invoice_id = destino.id
   where id = inv.id;

  return jsonb_build_object(
    'principal_cents', aberto,
    'juros_cents', juros,
    'iof_cents', iof,
    'juros_estimados', p_juros_cents is null and card.rotativo_rate_monthly is not null,
    'sem_taxa', card.rotativo_rate_monthly is null and p_juros_cents is null,
    'destino_id', destino.id,
    'destino_vence_em', destino.due_date
  );
end;
$$;

-- As duas visões de COMPETÊNCIA passam a ignorar o principal adiado.
CREATE OR REPLACE FUNCTION private.month_lines_for(ws_ids uuid[], p_month date)
 RETURNS TABLE(bucket text, origin text, ref_id uuid, title text, category text, method_id uuid, method_label text, due_date date, due_day integer, installment_no integer, installments_total integer, kind text, amount_cents bigint, settled boolean, projected boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with mes as (
    select b.ini, b.fim
    from private.cycle_bounds(private.cycle_close_day(ws_ids), p_month) b
  ),
  tx as (
    select t.*,
           case when t.invoice_id is not null then t.occurred_at
                else coalesce(t.due_at, t.occurred_at) end as data_da_linha
    from public.transactions t
    where t.workspace_id = any(ws_ids)
      and t.kind <> 'transfer'
      and t.occurred_at between (select ini from mes) and (select fim from mes)
      -- dívida que mudou de fatura, não compra nova (ver a coluna)
      and t.rollover_of_invoice_id is null
  )
  select
    case
      when t.kind = 'income' then 'entrada'
      when t.debt_id is not null or t.installment_plan_id is not null then 'parcela'
      when t.recurring_id is not null or t.source = 'recurring' then 'fixa'
      else 'variavel'
    end,
    'transaction', t.id,
    coalesce(nullif(t.description, ''), nullif(t.merchant, ''), d.name, t.category, 'Lançamento'),
    coalesce(t.category, 'outros'),
    t.account_id,
    coalesce(a.name, 'Sem conta'),
    t.data_da_linha,
    extract(day from t.data_da_linha)::int,
    coalesce(t.installment_no, t.debt_payment_no),
    coalesce(ip.installments, d.installments),
    t.kind,
    t.amount_cents,
    case
      when t.debt_id is not null then true
      when t.invoice_id is not null then coalesce(ci.status = 'paid', t.status = 'cleared')
      else t.status = 'cleared'
    end,
    false
  from tx t
  left join public.accounts a on a.id = t.account_id
  left join public.installment_plans ip on ip.id = t.installment_plan_id
  left join public.debts d on d.id = t.debt_id
  left join public.card_invoices ci on ci.id = t.invoice_id

  union all

  select 'parcela', 'debt_schedule', d.id,
         'Parcela ' || d.name, 'contas',
         d.account_id, coalesce(a.name, 'Financiamento'),
         s.due_date, extract(day from s.due_date)::int,
         s.installment_no, d.installments,
         'expense', s.payment_cents, false, true
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  left join public.accounts a on a.id = d.account_id
  where d.workspace_id = any(ws_ids)
    and not d.archived and d.remaining_cents > 0
    and s.due_date between (select ini from mes) and (select fim from mes)
    and not private.debt_paid_in_month(d.id, s.due_date)

  union all

  select case when p.kind = 'income' then 'entrada' else 'fixa' end,
         'recurring_projection', p.recurring_id,
         p.description, p.category,
         p.account_id, coalesce(a.name, 'Sem conta'),
         p.due_date, extract(day from p.due_date)::int,
         null::int, null::int,
         p.kind, p.amount_cents, false, true
  from private.recurring_projection_for(ws_ids, (select ini from mes), (select fim from mes)) p
  left join public.accounts a on a.id = p.account_id;
$function$;

