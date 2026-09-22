-- "E se…": adiantar parcelas (21/09/2026)
--
-- Spec: docs/superpowers/specs/2026-09-21-e-se-adiantar-parcelas-design.md
--
-- O rascunho só sabia supor dinheiro NOVO (entra/sai, uma vez, parcelado, todo mês). Adiantar é
-- MOVER dinheiro que já existe: as parcelas escolhidas deixam de sair no dia delas e saem juntas
-- numa data escolhida. Duas peças, e nenhuma segunda aritmética de caixa:
--
-- 1. `private.draft_ocorrencias` ganha `mode = 'cancel'`: UMA ocorrência, no dia dado, com o valor
--    NEGATIVO. É o "desfazer" de uma saída que a base já tem. Todas as portas (`draft_effect`,
--    `forecast_with_drafts`, `_forecast_with_drafts`, `forecast_json`, `month_forecast_json`)
--    somam `cents` por `kind`, então a saída do dia cai sem que nenhuma delas mude.
--
-- 2. `public.anticipation_candidates(p_pay_on)` lista o que dá para adiantar — compra parcelada,
--    financiamento e recorrente — com o DIA EM QUE CADA PARCELA SAI DO CAIXA pela mesma régua de
--    `cash_flow_forecast`: parcela de cartão sai no vencimento da fatura dela, o resto na data
--    dela, tudo com o piso de hoje. Cancelar num dia diferente do que a base usou criaria uma saída
--    fantasma num dia e deixaria a verdadeira no outro — por isso o dia vem do banco, nunca do app.

-- ---------------------------------------------------------------------------------------------
-- 1. `cancel` no motor do rascunho
--
-- ⚠️ O fuso vai no CABEÇALHO: a `20260911030000` o pendurou por `alter function`, e
-- `create or replace` apaga toda cláusula que a definição nova não repetir (finance.md).
create or replace function private.draft_ocorrencias(drafts jsonb, ate date)
returns table (kind text, vence date, cents bigint)
language sql
stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  with h as (
    select
      coalesce(x->>'kind', 'expense') as kind,
      coalesce(x->>'mode', 'total') as mode,
      greatest(coalesce((x->>'amount_cents')::bigint, 0), 0) as total,
      least(greatest(coalesce((x->>'installments')::int, 1), 1), 72) as parcelas,
      -- Ausente = HOJE, que é o dia 0 da série. O `greatest` é o piso da `20260910233000`:
      -- parcela datada antes do dia 0 mexeria no saldo sem ter dia na janela para aparecer
      -- em "entra/sai".
      greatest(coalesce((x->>'start')::date, current_date), current_date) as inicio
    from jsonb_array_elements(coalesce(drafts, '[]'::jsonb)) x
  ),
  p as (
    select kind, mode, inicio, total, parcelas,
           case when mode = 'monthly'
                then greatest(
                       (extract(year from age(ate, inicio)) * 12
                        + extract(month from age(ate, inicio)))::int + 1, 0)
                -- `cancel` desfaz UMA saída, num dia só: parcelas não se aplicam
                when mode = 'cancel' then 1
                else parcelas end as vezes,
           case when mode = 'monthly' or mode = 'cancel' then total
                else (total / parcelas)::bigint end as valor,
           case when mode in ('monthly', 'cancel') then 0::bigint
                else (total - (total / parcelas)::bigint * parcelas)::bigint end as resto
    from h
  )
  select p.kind,
         private.add_months(p.inicio, i)::date,
         ((p.valor + case when p.mode not in ('monthly', 'cancel') and i = p.parcelas - 1
                          then p.resto else 0 end)
           * case when p.mode = 'cancel' then -1 else 1 end)::bigint
  from p cross join lateral generate_series(0, greatest(p.vezes - 1, -1)) i
  where p.vezes > 0;
$$;

revoke execute on function private.draft_ocorrencias(jsonb, date) from public, anon;
grant execute on function private.draft_ocorrencias(jsonb, date) to authenticated, service_role;


-- ---------------------------------------------------------------------------------------------
-- 2. O que dá para adiantar
--
-- JSON, não `setof`: um financiamento de 48 parcelas e duas recorrentes em dois anos já passam
-- das 1000 linhas que o PostgREST corta EM SILÊNCIO (finance.md, "Projeção").
--
-- `security invoker` sob RLS e sem par `_interno`: quem simula é o app; o agente não adianta
-- parcela nenhuma. Se um dia adiantar, a interna nasce com `ws_ids` como as outras.
--
-- `pv_cents` é a sugestão do valor a pagar: financiamento com taxa traz cada parcela a valor
-- presente no dia do pagamento (CDC art. 52 §2º: quitação antecipada com redução proporcional dos
-- juros), por meses inteiros. É ESTIMATIVA — o app deixa editar, porque o número exato é o que o
-- banco informar. Compra no cartão e recorrente não têm juros para descontar.
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
    -- usa para ela. ponytail: dois anos à frente; adiantar mais de 24 meses de uma assinatura
    -- não é caso que exista, e a janela é o custo da expansão.
    select 'recurring', pr.recurring_id, pr.description, a.name, null, null,
           pr.due_date, pr.amount_cents, null
    from private.recurring_projection_for((select ids from ws), current_date, current_date + 730) pr
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
