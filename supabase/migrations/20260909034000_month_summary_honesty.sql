-- Três correções nos números do mês, encontradas medindo contra dado real no staging.
--
-- 1. **`closing_cash_cents` sumia no mês CORRENTE.** A condição era `fim <= current_date`, e o
--    fim de setembro é dia 30: no dia 9, o mês em que a pessoa está era o único sem o número de
--    caixa. Passa a ser: mês que já começou devolve o caixa até `least(fim, hoje)` — "terminei
--    com" no passado, "tenho hoje" no corrente. Só mês inteiramente futuro devolve null, porque
--    caixa não se projeta a partir de linhas pagas (para isso existe `cash_flow_forecast`).
--
-- 2. **`beyond_recurring_horizon` dava `false` para série NUNCA materializada.** `min()` de um
--    conjunto de nulos é null, e a comparação com null virava `false` pelo `coalesce` — ou seja,
--    a tela ficaria calada justamente no pior caso: recorrente cadastrada que não gerou linha
--    nenhuma. Agora quem responde é `bool_or(materialized_until is null or ... < fim)`: falta
--    cobertura se QUALQUER série ativa não chega ao fim do mês.
--
-- 3. **`recurring_covered_until`** continua sendo o menor `materialized_until`, para a frase da
--    tela ("projetado até dezembro"), e agora pode ser null com a flag em true — que é o caso
--    "nenhuma série gerou nada ainda". A tela trata os dois.
create or replace function private.month_summary_for(ws_ids uuid[], p_month date)
returns table (
  income_cents bigint,
  expense_cents bigint,
  result_cents bigint,
  fixas_cents bigint,
  fixas_unsettled_cents bigint,
  parcelas_cents bigint,
  parcelas_unsettled_cents bigint,
  variaveis_cents bigint,
  variaveis_unsettled_cents bigint,
  opening_cash_cents bigint,
  closing_cash_cents bigint,
  recurring_covered_until date,
  beyond_recurring_horizon boolean,
  debt_installments_undocumented int
)
language sql stable
set search_path = public
as $$
  with mes as (
    select date_trunc('month', p_month)::date as ini,
           (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date as fim
  ),
  l as (select * from private.month_lines_for(ws_ids, p_month)),
  horizonte as (
    -- a série que ACABOU não é "além do horizonte": ela simplesmente terminou
    select min(r.materialized_until)::date as ate,
           bool_or(r.materialized_until is null
                   or r.materialized_until::date < (select fim from mes)) as falta
    from public.recurring_transactions r
    where r.workspace_id = any(ws_ids) and r.active
      and (r.end_date is null or r.end_date >= (select fim from mes))
  ),
  sem_registro as (
    -- parcelas declaradas como pagas no cadastro que não têm lançamento nenhum por trás.
    -- É contagem do WORKSPACE, não do mês: a tela só a usa em mês passado.
    select coalesce(sum(greatest(
             d.installments_paid - (select count(*) from public.transactions t where t.debt_id = d.id),
             0)), 0)::int as n
    from public.debts d
    where d.workspace_id = any(ws_ids) and not d.archived
  )
  select
    coalesce(sum(l.amount_cents) filter (where l.kind = 'income'), 0)::bigint,
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
