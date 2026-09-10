-- Recorrente projeta ALÉM do horizonte materializado (10/09/2026)
--
-- ## O defeito
--
-- Três coisas alimentam o futuro do app, e só uma tinha penhasco:
--
-- | o quê | como chega no futuro | até quando |
-- |---|---|---|
-- | parcelamento | linhas REAIS criadas de uma vez por `create_installment_plan` | fim do plano (Mac 12/12 → 07/2027) |
-- | dívida | expandida na hora por `private.debt_schedule_for` | fim do contrato (Carro 48x → 2030) |
-- | **recorrente** | **só o que o cron materializou** | **o horizonte, e nada depois** |
--
-- O efeito não era a projeção "acabar" — era ela MENTIR. Abrir um mês além do horizonte
-- mostrava a prestação do financiamento (linha real ou expandida) e **nenhum salário**, porque
-- a receita recorrente simplesmente não existia ali. O saldo despencava para um número que
-- nunca aconteceria. Medido em produção em 10/09/2026: a projeção terminava em −8.893,32.
--
-- Subir `HORIZON_DAYS` (90 → 365) melhora e não resolve: só move o penhasco. Com um ano de
-- janela, "outubro de 2027" — o exemplo que o dono do produto deu — cai três semanas FORA.
--
-- ## O padrão, e por que ele já estava aqui
--
-- Recorrência em software sério é híbrida: a REGRA é a fonte da verdade, uma janela próxima
-- vira linha de verdade (editável, conciliável, com fatura e lembrete) e o resto é expandido
-- da regra, marcado como projeção. O Google Calendar pré-computa ~1 ano e gera o resto sob
-- demanda; o Asana materializa 30 dias.
--
-- **Este banco já fazia isso — para dívida.** `month_lines_for` e `cash_flow_forecast` já
-- expandem `debt_schedule_for` num `union all` com `projected = true`. Esta migration faz para
-- recorrente o que já era feito para dívida, no mesmo lugar e com a mesma marca.
--
-- ## Por que não é "a segunda cópia da regra"
--
-- A aritmética de recorrência da ESCRITA mora em `agent/app/jobs/scheduler.py`. Aqui é LEITURA:
-- a projeção começa estritamente DEPOIS de `materialized_until`, então as duas nunca produzem a
-- mesma linha, e o dia sai de `private.day_in_month` — a mesma função que a dívida e o ciclo de
-- fatura usam para não estourar em mês curto.
--
-- ⚠️ **Falha FECHADA.** Só `FREQ=MONTHLY;BYMONTHDAY=N` é expandido — que é 100% do que existe
-- em produção (15 séries). Qualquer outra forma de RRULE não projeta nada, em vez de projetar
-- errado: um número faltando é visível, um número errado não.

create or replace function private.recurring_projection_for(
  ws_ids uuid[], from_date date, to_date date
)
returns table (
  recurring_id uuid, kind text, amount_cents bigint, category text,
  description text, account_id uuid, due_date date
)
language sql stable
set search_path = public
as $$
  select r.id, r.kind, r.amount_cents, coalesce(r.category, 'outros'),
         coalesce(nullif(r.description, ''), r.category, 'Recorrente'),
         r.account_id, d.due_date
  from public.recurring_transactions r
  cross join lateral (
    select private.day_in_month(
             m::date,
             ((regexp_match(r.rrule, 'BYMONTHDAY=([0-9]+)'))[1])::int
           ) as due_date
    from generate_series(
           date_trunc('month', from_date),
           date_trunc('month', to_date),
           interval '1 month'
         ) m
  ) d
  where r.workspace_id = any(ws_ids)
    and r.active
    -- fail closed: só a forma que existe de verdade
    and r.rrule ~ '^FREQ=MONTHLY;BYMONTHDAY=[0-9]+$'
    and d.due_date between from_date and to_date
    -- estritamente DEPOIS do que o cron já criou como linha real — é o que impede
    -- a projeção de duplicar uma ocorrência que já existe em `transactions`
    and d.due_date > coalesce(r.materialized_until::date, date '1900-01-01')
    and (r.end_date is null or d.due_date <= r.end_date)
    and (r.dtstart is null or d.due_date >= r.dtstart::date);
$$;

revoke execute on function private.recurring_projection_for(uuid[], date, date) from public, anon;
grant execute on function private.recurring_projection_for(uuid[], date, date) to authenticated, service_role;


-- `month_lines_for` ganha o terceiro ramo. Os dois primeiros são cópia literal de
-- `20260909040000_month_lines_card_date.sql` — só o `union all` do fim é novo.
create or replace function private.month_lines_for(ws_ids uuid[], p_month date)
returns table (
  bucket text, origin text, ref_id uuid, title text, category text,
  method_id uuid, method_label text, due_date date, due_day int,
  installment_no int, installments_total int, kind text,
  amount_cents bigint, settled boolean, projected boolean
)
language sql stable
set search_path = public
as $$
  with mes as (
    select date_trunc('month', p_month)::date as ini,
           (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date as fim
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

  -- NOVO: a recorrente além do horizonte materializado, expandida da regra.
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


-- A projeção de caixa: mesmo ramo, nos DOIS wrappers (interno para o agente, invoker para o app).
create or replace function public._cash_flow_forecast(uid uuid, days integer DEFAULT 90)
returns table(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
language sql stable security definer
set search_path = public
as $$
  with horizonte as (select least(greatest(coalesce(days, 90), 1), 365) as dias),
  saldo_inicial as (select private.cash_total(array(select public._workspace_ids(uid))) as cents),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select public._workspace_ids(uid)) and ci.status <> 'paid'
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
$$;
revoke execute on function public._cash_flow_forecast(uuid, integer) from public, anon, authenticated;


create or replace function public.cash_flow_forecast(days integer DEFAULT 90)
returns table(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
language sql stable
set search_path = public
as $$
  with horizonte as (select least(greatest(coalesce(days, 90), 1), 365) as dias),
  saldo_inicial as (select private.cash_total(array(select private.my_workspace_ids())) as cents),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select private.my_workspace_ids()) and ci.status <> 'paid'
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
$$;
