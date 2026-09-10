-- As cinco leituras que diziam "mês" passam a perguntar onde o mês FECHA.
--
-- `private.cycle_bounds` / `private.cycle_month_of` (migration anterior) são as únicas que sabem
-- a regra; aqui elas substituem os cinco `date_trunc('month', ...)` espalhados. Com
-- `cycle_close_day = null` (o default) o resultado é IDÊNTICO ao de antes — é o mesmo
-- `date_trunc`, escrito num lugar só.

-- 1. As linhas do mês -----------------------------------------------------------------------
create or replace function private.month_lines_for(ws_ids uuid[], p_month date)
returns table (
  bucket text, origin text, ref_id uuid, title text, category text,
  method_id uuid, method_label text, due_date date, due_day int,
  installment_no int, installments_total int,
  kind text, amount_cents bigint, settled boolean, projected boolean
)
language sql stable set search_path = public as $$
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
$$;

-- 2. O resumo do mês ------------------------------------------------------------------------
create or replace function private.month_summary_for(ws_ids uuid[], p_month date)
returns table (
  income_cents bigint, income_unsettled_cents bigint, expense_cents bigint, result_cents bigint,
  fixas_cents bigint, fixas_unsettled_cents bigint,
  parcelas_cents bigint, parcelas_unsettled_cents bigint,
  variaveis_cents bigint, variaveis_unsettled_cents bigint,
  opening_cash_cents bigint, closing_cash_cents bigint,
  recurring_covered_until date, beyond_recurring_horizon boolean,
  debt_installments_undocumented int
)
language sql stable set search_path = public as $$
  with mes as (
    select b.ini, b.fim
    from private.cycle_bounds(private.cycle_close_day(ws_ids), p_month) b
  ),
  l as (select * from private.month_lines_for(ws_ids, p_month)),
  horizonte as (
    select min(r.materialized_until)::date as ate,
           bool_or(r.materialized_until is null
                   or r.materialized_until::date < (select fim from mes)) as falta
    from public.recurring_transactions r
    where r.workspace_id = any(ws_ids) and r.active
      and (r.end_date is null or r.end_date >= (select fim from mes))
  ),
  sem_registro as (
    select coalesce(sum(greatest(
             d.installments_paid - (select count(*) from public.transactions t where t.debt_id = d.id),
             0)), 0)::int as n
    from public.debts d
    where d.workspace_id = any(ws_ids) and not d.archived
  )
  select
    coalesce(sum(l.amount_cents) filter (where l.kind = 'income'), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.kind = 'income' and not l.settled), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.kind = 'expense'), 0)::bigint,
    (coalesce(sum(l.amount_cents) filter (where l.kind = 'income'), 0)
     - coalesce(sum(l.amount_cents) filter (where l.kind = 'expense'), 0))::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'fixa'), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'fixa' and not l.settled), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'parcela'), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'parcela' and not l.settled), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'variavel'), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'variavel' and not l.settled), 0)::bigint,
    private.cash_total(ws_ids, (select ini from mes) - 1),
    case when (select ini from mes) <= current_date
         then private.cash_total(ws_ids, least((select fim from mes), current_date)) end,
    (select ate from horizonte),
    coalesce((select falta from horizonte), false),
    (select n from sem_registro)
  from l;
$$;

-- 3. A tendência ----------------------------------------------------------------------------
-- ⚠️ O último balde é o ciclo que contém HOJE, não `date_trunc('month', current_date)`. Com
-- fechamento no dia 10, o dia 15/09 já pertence ao ciclo chamado "outubro" — ancorar no mês
-- civil deixaria o gráfico um ciclo atrasado durante 20 dias por mês.
create or replace function private.monthly_lines_range(ws_ids uuid[], meses int)
returns table (
  month date, income_cents bigint, expense_cents bigint,
  income_pending_cents bigint, expense_pending_cents bigint
)
language sql stable set search_path = public as $$
  with atual as (
    select private.cycle_month_of(private.cycle_close_day(ws_ids), current_date) as m
  ),
  janela as (
    select generate_series(
             (select m from atual) - make_interval(months => least(greatest(coalesce(meses, 6), 1), 60)),
             (select m from atual),
             interval '1 month')::date as ini
  ),
  linhas as (
    select j.ini as month, l.*
    from janela j cross join lateral private.month_lines_for(ws_ids, j.ini) l
  )
  select month,
         coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::bigint,
         coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::bigint,
         coalesce(sum(amount_cents) filter (where kind = 'income'  and not settled), 0)::bigint,
         coalesce(sum(amount_cents) filter (where kind = 'expense' and not settled), 0)::bigint
  from linhas
  group by month
  order by month;
$$;

-- 4. O agrupamento da série diária ----------------------------------------------------------
-- `parcial` deixou de ser heurística de borda: agora ele compara o que a série COBRE com as
-- bordas reais do ciclo. Era `extract(day from ini) > 1`, que com fechamento no dia 10 marcaria
-- todo ciclo como parcial — todos começam no dia 11.
create or replace function private.month_group(dias jsonb, close_day int default null)
returns jsonb
language sql immutable set search_path = public as $$
  with d as (
    select (x->>'day')::date as day,
           (x->>'in_cents')::bigint as in_cents,
           (x->>'out_cents')::bigint as out_cents,
           (x->>'balance_cents')::bigint as balance_cents
    from jsonb_array_elements(coalesce(dias, '[]'::jsonb)) x
  ),
  lim as (select min(day) as primeiro, max(day) as ultimo from d),
  m as (
    select private.cycle_month_of(close_day, day) as rotulo,
           sum(in_cents)::bigint as entra,
           sum(out_cents)::bigint as sai,
           (array_agg(balance_cents order by day desc))[1]::bigint as saldo,
           min(day) filter (where balance_cents < 0) as neg,
           min(day) as ini,
           max(day) as fim
    from d
    group by private.cycle_month_of(close_day, day)
  )
  select jsonb_build_object(
    'hoje', (select balance_cents from d order by day limit 1),
    'meses', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'mes', to_char(m.rotulo, 'YYYY-MM'),
                'entra', m.entra,
                'sai', m.sai,
                'saldo', m.saldo,
                'primeiroNegativo', m.neg,
                'de', b.ini,
                'ate', b.fim,
                'parcial', m.ini > b.ini or m.fim < b.fim
              ) order by m.rotulo)
       from m cross join lateral private.cycle_bounds(close_day, m.rotulo) b),
      '[]'::jsonb)
  );
$$;

create or replace function public.month_forecast_json(days int, drafts jsonb default '[]'::jsonb)
returns jsonb
language sql stable set search_path = public as $$
  select private.month_group(
           public.forecast_json(days, drafts),
           private.cycle_close_day(array(select private.my_workspace_ids())));
$$;
