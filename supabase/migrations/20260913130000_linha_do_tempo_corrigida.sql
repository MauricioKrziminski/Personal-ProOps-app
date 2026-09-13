-- A linha do tempo de ciclos, corrigida — a `20260913120000` foi aplicada só no staging e tinha
-- dois defeitos MEDIDOS contra os dados reais:
--
-- 1. **Transação `cleared` datava por `due_at`.** O `Fundacred` de setembro tem `due_at` 30/09 e
--    foi PAGO em 04/09 (provado no extrato do Nubank). Ele saía do ciclo de setembro e aparecia
--    no de outubro — a MESMA despesa contada no ciclo errado, R$ 1.198,85, sem erro nenhum na
--    tela. Quem já aconteceu data pelo dia em que o dinheiro saiu (`paid_at`).
-- 2. **Fatura vencida e ainda aberta sumia.** Ela venceu num ciclo passado mas o dinheiro ainda
--    vai sair — e sai hoje. É a mesma regra que `_cash_flow_forecast` já tinha
--    (`greatest(due_date, current_date)`), e faltava aqui.
--
-- E o resumo de UM ciclo virou uma SÉRIE: `comecei_com` de um ciclo futuro é o `resultado` do
-- anterior, e isso não cabe numa função que enxerga um mês só. Ciclo cujo início já passou usa o
-- caixa REAL (`cash_total`), porque saldo em conta é fato; só o futuro encadeia.
--
-- Verificado contra os dados reais clonados no staging:
--   Setembro (11/08–10/09, fechado) : −370,92  · sobrou 0,72 · faltou pagar 371,64
--   Outubro  (11/09–10/10, aberto)  : −615,87
--   Novembro (11/10–10/11, previsto): +105,49
-- Os três são os números que a Hoje, a Projeção e a planilha do dono do produto já mostravam,
-- agora saindo de uma fonte só.

drop function if exists public.cycle_summary(date, text);
drop function if exists public._cycle_summary(uuid, date, text);
drop function if exists private.cycle_summary_for(uuid[], date, text);

create or replace function private.cash_events(ws_ids uuid[], ini date, fim date)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text)
language sql stable security definer set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  select ci.due_date, 0::bigint, coalesce(sum(t.amount_cents),0)::bigint,
         'Fatura ' || coalesce(a.name,'cartão'), 'invoice', ci.id, coalesce(a.name,'Cartão')
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id = any(ws_ids) and ci.status <> 'rolled'
    and ci.due_date between ini and fim
  group by ci.id, ci.due_date, a.name
  union all
  -- fatura que venceu ANTES desta janela e continua aberta: ela ainda vai sair da conta, e sai
  -- hoje. `greatest(due, hoje)` se auto-seleciona — em ciclo passado cai fora da janela, em
  -- ciclo futuro hoje é anterior ao início. Só o ABERTO entra: o que já foi pago está no caixa.
  select greatest(ci.due_date, current_date), 0::bigint, private.invoice_open_cents(ci.id),
         'Fatura ' || coalesce(a.name,'cartão') || ' (atrasada)', 'invoice_overdue', ci.id,
         coalesce(a.name,'Cartão')
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  where ci.workspace_id = any(ws_ids) and ci.status not in ('paid','rolled')
    and ci.due_date < ini
    and greatest(ci.due_date, current_date) between ini and fim
    and private.invoice_open_cents(ci.id) > 0
  union all
  select case when t.status = 'cleared' then coalesce(t.paid_at, t.occurred_at)
              else coalesce(t.due_at, t.occurred_at) end,
         case when t.kind='income' then t.amount_cents else 0 end::bigint,
         case when t.kind='expense' then t.amount_cents else 0 end::bigint,
         coalesce(nullif(t.description,''), nullif(t.merchant,''), t.category, 'Lançamento'),
         'transaction', t.id, coalesce(a.name,'Sem conta')
  from public.transactions t left join public.accounts a on a.id = t.account_id
  where t.workspace_id = any(ws_ids) and t.kind <> 'transfer'
    and t.invoice_id is null and t.rollover_of_invoice_id is null
    and (case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at)
              else coalesce(t.due_at,t.occurred_at) end) between ini and fim
  union all
  select s.due_date, 0::bigint, s.payment_cents, 'Parcela ' || d.name, 'debt_schedule', d.id,
         coalesce(a.name,'Financiamento')
  from public.debts d cross join lateral private.debt_schedule_for(d.id) s
  left join public.accounts a on a.id = d.account_id
  where d.workspace_id = any(ws_ids) and not d.archived and d.remaining_cents > 0
    and s.due_date between ini and fim and not private.debt_paid_in_month(d.id, s.due_date)
  union all
  select p.due_date,
         case when p.kind='income' then p.amount_cents else 0 end::bigint,
         case when p.kind='expense' then p.amount_cents else 0 end::bigint,
         p.description, 'recurring_projection', p.recurring_id, coalesce(a.name,'Sem conta')
  from private.recurring_projection_for(ws_ids, ini, fim) p
  left join public.accounts a on a.id = p.account_id;
$$;

create or replace function private.cycle_series_for(ws_ids uuid[], de date, ate date, p_view text default null)
returns table (mes date, ini date, fim date, estado text, comecei_com bigint,
               entrou bigint, saiu bigint, resultado bigint,
               caixa_no_fim bigint, faltou_pagar bigint)
language sql stable security definer set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with recursive meses as (select generate_series(de, ate, interval '1 month')::date m),
  janela as (
    select m.m, c.ini, c.fim, row_number() over (order by c.ini) rn
    from meses m cross join lateral
         private.cycle_bounds(private.cycle_close_day(ws_ids, p_view), m.m) c
  ),
  fluxo as (
    select j.*, coalesce(sum(x.in_cents),0)::bigint entrou, coalesce(sum(x.out_cents),0)::bigint saiu
    from janela j left join lateral private.cash_events(ws_ids, j.ini, j.fim) x on true
    group by j.m, j.ini, j.fim, j.rn
  ),
  corrente as (
    select f.*, private.cash_total(ws_ids, f.ini - 1) as comecei,
           (private.cash_total(ws_ids, f.ini - 1) + f.entrou - f.saiu)::bigint as resultado
    from fluxo f where f.rn = 1
    union all
    select f.*,
           case when f.ini <= current_date then private.cash_total(ws_ids, f.ini - 1) else c.resultado end,
           (case when f.ini <= current_date then private.cash_total(ws_ids, f.ini - 1) else c.resultado end
            + f.entrou - f.saiu)::bigint
    from fluxo f join corrente c on f.rn = c.rn + 1
  )
  select c.m, c.ini, c.fim,
         case when c.fim < current_date then 'fechado'
              when c.ini > current_date then 'previsto' else 'aberto' end,
         c.comecei, c.entrou, c.saiu, c.resultado,
         case when c.fim < current_date then private.cash_total(ws_ids, c.fim) end,
         case when c.fim < current_date
              then (private.cash_total(ws_ids, c.fim) - c.resultado)::bigint end
  from corrente c order by c.ini;
$$;

revoke execute on function private.cash_events(uuid[], date, date) from public, anon;
revoke execute on function private.cycle_series_for(uuid[], date, date, text) from public, anon;

-- ⚠️ O `execute` para `authenticated` é OBRIGATÓRIO e não é descuido de escopo: os wrappers são
-- `security invoker`, então a chamada aninhada roda com o privilégio de quem chamou. Revogar
-- sem devolver foi o que derrubou a Hoje e a Projeção com `42501 permission denied` no par de
-- migrations 20260911200000/220000.
grant execute on function private.cash_events(uuid[], date, date) to authenticated;
grant execute on function private.cycle_series_for(uuid[], date, date, text) to authenticated;

-- Portas: wrapper `security invoker` para o app (sob RLS) e interna para o agente, que conecta
-- com papel que ignora RLS e passa o uid resolvido. Padrão duplo de `.claude/rules/supabase.md`
-- — o wrapper NÃO chama a interna, porque EXECUTE é checado contra o role do chamador.
create or replace function public.cycle_series(de date, ate date, p_view text default null)
returns table (mes date, ini date, fim date, estado text, comecei_com bigint,
               entrou bigint, saiu bigint, resultado bigint, caixa_no_fim bigint, faltou_pagar bigint)
language sql stable security invoker set search_path = public
as $$
  select * from private.cycle_series_for(array(select private.my_workspace_ids()), de, ate, p_view);
$$;

create or replace function public._cycle_series(uid uuid, de date, ate date, p_view text default null)
returns table (mes date, ini date, fim date, estado text, comecei_com bigint,
               entrou bigint, saiu bigint, resultado bigint, caixa_no_fim bigint, faltou_pagar bigint)
language sql stable security definer set search_path = public
as $$
  select * from private.cycle_series_for(array(select public._workspace_ids(uid)), de, ate, p_view);
$$;
revoke execute on function public._cycle_series(uuid, date, date, text) from public, anon, authenticated;
