-- "E se… adiantar": conta fixa até o teto da Projeção (22/09/2026)
--
-- A `20260921120000` expandia a recorrente só DOIS anos à frente, e a tela oferecia a quantidade
-- em atalhos fixos (1, 2, 3, 6, 12). O dono do produto pediu a quantidade ABERTA (*"essas coisas
-- nunca devem ser fixadas"*) — e com o campo aberto o corte de 24 meses viraria um limite que
-- ninguém vê: "adiantar 36 meses de aluguel" tiraria só 24. A janela passa a ser a mesma da
-- Projeção (10 anos). Só isso muda; o resto da função é a mesma definição da `20260921120000`.

create or replace function public.anticipation_candidates(p_pay_on date default null)
returns jsonb
language sql
stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  with ws as (select array(select private.my_workspace_ids()) as ids),
  pagar as (select greatest(coalesce(p_pay_on, current_date), current_date) as dia),
  -- Parcela ainda adiantável: pendente, sem trava (`parcela_travada`: fatura paga, adiada ou paga
  -- em parte), e ainda não cobrada — no cartão, a fatura dela não fechou; fora dele, a data não
  -- passou (o que venceu é atraso, não adiantamento).
  linhas as (
    select t.*, ci.due_date as fatura_vence
    from public.transactions t
    left join public.card_invoices ci on ci.id = t.invoice_id
    where t.workspace_id in (select private.my_workspace_ids())
      and t.kind = 'expense' and t.status = 'pending'
      and not private.parcela_travada(t.status, t.invoice_id)
      and case when t.invoice_id is null
               then coalesce(t.due_at, t.occurred_at) >= current_date
               else ci.status = 'open' and ci.closing_date > current_date end
  ),
  eventos as (
    select 'plan'::text as source, p.id as ref_id,
           coalesce(nullif(p.description, ''), nullif(p.merchant, ''), 'Compra parcelada') as title,
           a.name as account_name, l.installment_no as n, p.installments as total_n,
           -- o dia da base (`cash_flow_forecast`): a fatura no vencimento, o resto na data
           case when l.invoice_id is null then greatest(coalesce(l.due_at, l.occurred_at), current_date)
                else greatest(l.fatura_vence, current_date) end as dia,
           l.amount_cents as cents, null::numeric as taxa
    from linhas l
    join public.installment_plans p on p.id = l.installment_plan_id and p.workspace_id = l.workspace_id
    left join public.accounts a on a.id = p.account_id

    union all

    select 'debt', d.id, d.name, a.name, s.installment_no, d.installments,
           greatest(s.due_date, current_date), s.payment_cents, d.interest_rate_monthly
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    left join public.accounts a on a.id = d.account_id
    where d.workspace_id in (select private.my_workspace_ids())
      and not d.archived and d.remaining_cents > 0
      and s.due_date >= current_date

    union all

    -- recorrente já materializada (linha real, até um ano)…
    select 'recurring', r.id, coalesce(nullif(r.description, ''), r.category, 'Recorrente'),
           a.name, null::int, null::int,
           case when l.invoice_id is null then greatest(coalesce(l.due_at, l.occurred_at), current_date)
                else greatest(l.fatura_vence, current_date) end,
           l.amount_cents, null
    from linhas l
    join public.recurring_transactions r on r.id = l.recurring_id and r.workspace_id = l.workspace_id
    left join public.accounts a on a.id = r.account_id
    -- sem `r.active`: a ocorrência já criada de uma série desligada continua na projeção

    union all

    -- …e além dela, expandida da regra, no dia da ocorrência — o mesmo que `cash_flow_forecast`
    -- usa para ela. Até o TETO da Projeção (`private.clamp_forecast_days`, 10 anos): conta fixa
    -- não tem fim, e a quantidade a adiantar é campo aberto — um corte menor que a projeção
    -- cortaria em silêncio quem pede 36 meses de aluguel.
    select 'recurring', pr.recurring_id, pr.description, a.name, null, null,
           pr.due_date, pr.amount_cents, null
    from private.recurring_projection_for((select ids from ws), current_date,
           current_date + private.clamp_forecast_days(3650)) pr
    left join public.accounts a on a.id = pr.account_id
    where pr.kind = 'expense'
  ),
  com_valor as (
    select e.*,
           case when coalesce(e.taxa, 0) > 0 and e.dia > (select dia from pagar)
                then round(e.cents / power(1 + e.taxa,
                       extract(year from age(e.dia, (select dia from pagar))) * 12
                       + extract(month from age(e.dia, (select dia from pagar)))))::bigint
                else e.cents end as pv_cents
    from eventos e
    -- Só o que vence DEPOIS do pagamento: "adiantar" uma parcela que sairia antes dele é ADIAR,
    -- e a projeção ficaria otimista sem erro nenhum na tela.
    where e.dia > (select dia from pagar)
  ),
  itens as (
    select jsonb_build_object(
             'source', source, 'ref_id', ref_id, 'title', title, 'account_name', account_name,
             'total_n', max(total_n), 'taxa', max(taxa),
             'events', jsonb_agg(jsonb_build_object(
                         'n', n, 'day', dia, 'cents', cents, 'pv_cents', pv_cents)
                       order by dia, n)
           ) as item,
           min(dia) as primeiro
    from com_valor
    group by source, ref_id, title, account_name
  )
  select coalesce(jsonb_agg(item order by primeiro), '[]'::jsonb) from itens;
$$;

revoke execute on function public.anticipation_candidates(date) from public, anon;
grant execute on function public.anticipation_candidates(date) to authenticated;
