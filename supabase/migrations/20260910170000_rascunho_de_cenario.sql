-- Rascunho de cenário: um motor, duas portas (10/09/2026)
--
-- ## O que existia
--
-- `affordability(valor, parcelas)` responde "posso comprar isso?" pegando a projeção REAL —
-- que já conta saldo, fatura de cartão, parcela, financiamento e recorrente — e descontando a
-- hipótese de forma acumulada. É a mecânica certa, fechada em duas limitações:
--
--   • **só GASTO.** A conta é `balance_cents - parcela * n`, sempre menos. Não existe jeito de
--     perguntar "e se eu receber 1.500 em novembro?".
--   • **só o veredito.** Devolve `can_afford` e o pior dia; não dá para VER os meses.
--
-- ## O que muda
--
-- A aritmética da hipótese sai de dentro do `affordability` e vira `private.draft_effect`, com
-- `kind` — receita SOMA, gasto SUBTRAI. Aí:
--
--   private.draft_effect(drafts, dia)          ← a conta, num lugar só
--        ├── public.forecast_with_drafts(...)  ← o Rascunho (novo): a série inteira
--        └── public.affordability(...)         ← "Posso comprar isso?": 1 hipótese de gasto
--
-- `affordability` mantém assinatura e retorno IDÊNTICOS — nenhuma tela dele muda —, e
-- `supabase/tests/draft_scenario.sql` prova que ele devolve o mesmo de antes. Substituir o
-- motor de uma feature que funciona sem provar equivalência é como se quebra em silêncio.
--
-- ⚠️ **O rascunho move o CAIXA, e só.** Ele não remonta fatura (`set_invoice`), não recalcula
-- orçamento (`_budgets_status`) nem cronograma de dívida (`debt_schedule_for`) — essas regras
-- moram no banco e reproduzi-las aqui seria a segunda cópia. A tela diz isso ao usuário.

create or replace function private.draft_effect(drafts jsonb, d date)
returns table (in_cents bigint, out_cents bigint, delta_cents bigint)
language sql
immutable
set search_path = public
as $$
  with h as (
    select
      coalesce(x->>'kind', 'expense') as kind,
      greatest(coalesce((x->>'amount_cents')::bigint, 0), 0) as total,
      -- 72 é o mesmo teto do `affordability`; 1 é o piso (nada de divisão por zero)
      least(greatest(coalesce((x->>'installments')::int, 1), 1), 72) as parcelas,
      coalesce((x->>'start')::date, d) as inicio
    from jsonb_array_elements(coalesce(drafts, '[]'::jsonb)) x
  ),
  p as (
    select kind, inicio, parcelas,
           (total / parcelas)::bigint as parcela,
           -- o resto da divisão inteira vai na ÚLTIMA parcela, como em `create_installment_plan`:
           -- sem isso, 100 em 3x soma 99 e o rascunho "economiza" um centavo do nada
           (total - (total / parcelas)::bigint * parcelas)::bigint as resto
    from h
  ),
  -- uma linha por parcela, com a data em que ela cai
  ocorrencias as (
    select p.kind,
           private.add_months(p.inicio, i)::date as vence,
           p.parcela + case when i = p.parcelas - 1 then p.resto else 0 end as cents
    from p cross join generate_series(0, p.parcelas - 1) i
  )
  select
    coalesce(sum(cents) filter (where kind = 'income'  and vence = d), 0)::bigint,
    coalesce(sum(cents) filter (where kind <> 'income' and vence = d), 0)::bigint,
    coalesce(sum(case when kind = 'income' then cents else -cents end)
             filter (where vence <= d), 0)::bigint
  from ocorrencias;
$$;

revoke execute on function private.draft_effect(jsonb, date) from public, anon;
grant execute on function private.draft_effect(jsonb, date) to authenticated, service_role;


-- A série com as hipóteses aplicadas. Padrão duplo de `supabase.md`: interna por uid (agente),
-- wrapper invoker (app).
create or replace function public._forecast_with_drafts(uid uuid, days integer, drafts jsonb)
returns table (day date, in_cents bigint, out_cents bigint, balance_cents bigint)
language sql stable security definer
set search_path = public
as $$
  select f.day,
         (f.in_cents + e.in_cents)::bigint,
         (f.out_cents + e.out_cents)::bigint,
         (f.balance_cents + e.delta_cents)::bigint
  from public._cash_flow_forecast(uid, days) f
  cross join lateral private.draft_effect(drafts, f.day) e
  order by f.day;
$$;
revoke execute on function public._forecast_with_drafts(uuid, integer, jsonb) from public, anon, authenticated;

create or replace function public.forecast_with_drafts(days integer, drafts jsonb)
returns table (day date, in_cents bigint, out_cents bigint, balance_cents bigint)
language sql stable
set search_path = public
as $$
  select f.day,
         (f.in_cents + e.in_cents)::bigint,
         (f.out_cents + e.out_cents)::bigint,
         (f.balance_cents + e.delta_cents)::bigint
  from public.cash_flow_forecast(days) f
  cross join lateral private.draft_effect(drafts, f.day) e
  order by f.day;
$$;


-- `affordability` passa a ser UMA hipótese de gasto sobre o mesmo motor.
-- Assinatura e colunas idênticas: nenhuma tela muda.
create or replace function public.affordability(amount_cents bigint, installments integer default 1)
returns table (can_afford boolean, worst_day date, worst_balance_cents bigint, installment_cents bigint)
language sql stable
set search_path = public
as $$
  with n as (select least(greatest(coalesce(installments, 1), 1), 72) as parcelas),
  rascunho as (
    select jsonb_build_array(jsonb_build_object(
             'kind', 'expense',
             'amount_cents', coalesce(amount_cents, 0),
             'installments', (select parcelas from n),
             'start', current_date
           )) as j
  ),
  simulado as (
    select f.day, f.balance_cents
    from public.forecast_with_drafts(370, (select j from rascunho)) f
    where f.day <= private.add_months(current_date, (select parcelas from n))
  ),
  pior as (select day, balance_cents from simulado order by balance_cents, day limit 1)
  select (select balance_cents from pior) >= 0,
         (select day from pior),
         (select balance_cents from pior),
         (coalesce(amount_cents, 0) / (select parcelas from n))::bigint;
$$;

create or replace function public._affordability(uid uuid, amount_cents bigint, installments integer default 1)
returns table (can_afford boolean, worst_day date, worst_balance_cents bigint, installment_cents bigint)
language sql stable security definer
set search_path = public
as $$
  with n as (select least(greatest(coalesce(installments, 1), 1), 72) as parcelas),
  rascunho as (
    select jsonb_build_array(jsonb_build_object(
             'kind', 'expense',
             'amount_cents', coalesce(amount_cents, 0),
             'installments', (select parcelas from n),
             'start', current_date
           )) as j
  ),
  simulado as (
    select f.day, f.balance_cents
    from public._forecast_with_drafts(uid, 370, (select j from rascunho)) f
    where f.day <= private.add_months(current_date, (select parcelas from n))
  ),
  pior as (select day, balance_cents from simulado order by balance_cents, day limit 1)
  select (select balance_cents from pior) >= 0,
         (select day from pior),
         (select balance_cents from pior),
         (coalesce(amount_cents, 0) / (select parcelas from n))::bigint;
$$;
revoke execute on function public._affordability(uuid, bigint, integer) from public, anon, authenticated;
