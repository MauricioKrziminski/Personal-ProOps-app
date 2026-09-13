-- O ciclo conta o dinheiro pelo dia em que ele SAIU DA CONTA — de verdade, não pelo vencimento.
--
-- A `20260913140000` tentou corrigir "fatura paga datava pelo vencimento" datando pelo `paid_at`,
-- e isso estava errado por um motivo que só os dados reais mostram: **15 faturas de janeiro a
-- agosto de 2026 têm `paid_at = 2026-09-08`** — o dia em que o dono do produto cadastrou o app e
-- marcou o histórico como quitado (`settle_invoice`, que NÃO move dinheiro). Datar por `paid_at`
-- despejava R$ 5.007,45 de fatura histórica dentro do ciclo de setembro.
--
-- O modelo certo separa as duas coisas que a fatura é:
--
-- | evento | quando sai da conta |
-- |---|---|
-- | **pagamento REALIZADO** | o `transfer` para a conta de cartão, no dia em que ele aconteceu |
-- | **o que ainda falta pagar** | `invoice_open_cents` em `greatest(vencimento, hoje)` |
--
-- `settle_invoice` não gera transfer, então fatura quitada fora do app não inventa saída — e é
-- exatamente o caso das 15. Transferência entre duas contas que não são cartão (o "Pix para a
-- conta do BB") continua fora: ela não muda o caixa total.
--
-- ⚠️ **`faltou_pagar` deixou de ser resíduo e passou a ser MEDIDO** (`invoice_open_cents` das
-- faturas vencidas até o fim do ciclo). Como resíduo ele absorvia, com sinais opostos, tudo que
-- o modelo não explicava — fatura em aberto, receita que não caiu, parcela sem lançamento — sob
-- um rótulo que promete uma coisa só.
--
-- ⚠️ **E a coluna `confere` é a prova.** Num ciclo FECHADO a soma dos eventos tem que reproduzir
-- `cash_total` no centavo; se der falso, um movimento está sendo contado duas vezes ou nenhuma.
-- Medido em julho, agosto e setembro de 2026 com os dados reais: `true` nos três, e setembro
-- fecha em 0,72, que é o `LEDGERBAL` do extrato do Nubank mais os 0,11 do BB.

drop function if exists public.cycle_series(date, date, text);
drop function if exists public._cycle_series(uuid, date, date, text);
drop function if exists private.cycle_series_for(uuid[], date, date, text);

create or replace function private.cash_events(ws_ids uuid[], ini date, fim date)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  -- 1. PAGAMENTO REALIZADO de fatura: o transfer para uma conta de cartão. É o instante em que o
  -- dinheiro sai da conta de verdade.
  select case when t.status = 'cleared' then coalesce(t.paid_at, t.occurred_at) else t.occurred_at end,
         0::bigint, t.amount_cents,
         coalesce(nullif(t.description,''), 'Pagamento de fatura'), 'invoice_payment', t.id,
         coalesce(d.name, 'Cartão')
  from public.transactions t
  join public.accounts d on d.id = t.counterparty_account_id and d.type = 'credit_card'
  left join public.accounts o on o.id = t.account_id
  where t.workspace_id = any(ws_ids) and t.kind = 'transfer'
    and coalesce(o.type, 'x') <> 'credit_card'
    and (case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at) else t.occurred_at end)
        between ini and fim
  union all
  -- 2. O que AINDA falta pagar de uma fatura: sai no vencimento, ou hoje se já venceu.
  select greatest(ci.due_date, current_date), 0::bigint, private.invoice_open_cents(ci.id),
         'Fatura ' || coalesce(a.name,'cartão') ||
           case when ci.due_date < current_date then ' (atrasada)' else '' end,
         'invoice', ci.id, coalesce(a.name,'Cartão')
  from public.card_invoices ci join public.accounts a on a.id = ci.account_id
  where ci.workspace_id = any(ws_ids) and ci.status not in ('paid','rolled')
    and greatest(ci.due_date, current_date) between ini and fim
    and private.invoice_open_cents(ci.id) > 0
  union all
  select case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at)
              else coalesce(t.due_at,t.occurred_at) end,
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
  select current_date,
         case when t.kind='income' then t.amount_cents else 0 end::bigint,
         case when t.kind='expense' then t.amount_cents else 0 end::bigint,
         coalesce(nullif(t.description,''), nullif(t.merchant,''), t.category, 'Lançamento') || ' (atrasado)',
         'transaction_overdue', t.id, coalesce(a.name,'Sem conta')
  from public.transactions t left join public.accounts a on a.id = t.account_id
  where t.workspace_id = any(ws_ids) and t.status='pending'
    and t.kind <> 'transfer' and t.invoice_id is null and t.rollover_of_invoice_id is null
    and coalesce(t.due_at,t.occurred_at) < ini and current_date between ini and fim
    and (t.kind <> 'income' or coalesce(t.due_at,t.occurred_at) >= current_date - 3)
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
               caixa_no_fim bigint, faltou_pagar bigint, confere boolean)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with recursive limites as (
    select private.cycle_close_day(ws_ids, p_view) dia,
           least(de, private.cycle_month_of(private.cycle_close_day(ws_ids, p_view), current_date)) inicio
  ),
  meses as (select generate_series((select inicio from limites), ate, interval '1 month')::date m),
  janela as (
    select m.m, c.ini, c.fim, row_number() over (order by c.ini) rn
    from meses m cross join lateral private.cycle_bounds((select dia from limites), m.m) c
  ),
  fluxo as (
    select j.m, j.ini, j.fim, j.rn,
           coalesce(sum(x.in_cents),0)::bigint entrou, coalesce(sum(x.out_cents),0)::bigint saiu,
           private.cash_total(ws_ids, j.ini - 1) caixa_antes,
           private.cash_total(ws_ids, j.fim) caixa_depois,
           coalesce((select sum(private.invoice_open_cents(ci.id)) from public.card_invoices ci
                     where ci.workspace_id = any(ws_ids) and ci.status not in ('paid','rolled')
                       and ci.due_date <= j.fim), 0)::bigint em_aberto
    from janela j left join lateral private.cash_events(ws_ids, j.ini, j.fim) x on true
    group by j.m, j.ini, j.fim, j.rn
  ),
  corrente as (
    select f.*, f.caixa_antes comecei, (f.caixa_antes + f.entrou - f.saiu)::bigint resultado
    from fluxo f where f.rn = 1
    union all
    select f.*,
           case when f.ini <= current_date then f.caixa_antes else c.resultado end,
           (case when f.ini <= current_date then f.caixa_antes else c.resultado end
            + f.entrou - f.saiu)::bigint
    from fluxo f join corrente c on f.rn = c.rn + 1
  )
  select c.m, c.ini, c.fim,
         case when c.fim < current_date then 'fechado'
              when c.ini > current_date then 'previsto' else 'aberto' end,
         c.comecei, c.entrou, c.saiu, c.resultado,
         case when c.fim < current_date then c.caixa_depois end,
         case when c.fim < current_date then c.em_aberto end,
         -- A invariante: num ciclo FECHADO, a soma dos eventos tem que reproduzir o caixa real.
         -- Se der falso, um movimento de dinheiro está sendo contado duas vezes ou nenhuma.
         case when c.fim < current_date then c.caixa_depois = c.resultado end
  from corrente c where c.m >= de order by c.ini;
$$;

revoke execute on function private.cash_events(uuid[], date, date) from public, anon;
revoke execute on function private.cycle_series_for(uuid[], date, date, text) from public, anon;
grant execute on function private.cash_events(uuid[], date, date) to authenticated, service_role;
grant execute on function private.cycle_series_for(uuid[], date, date, text) to authenticated, service_role;

create or replace function public.cycle_series(de date, ate date, p_view text default null)
returns table (mes date, ini date, fim date, estado text, comecei_com bigint,
               entrou bigint, saiu bigint, resultado bigint,
               caixa_no_fim bigint, faltou_pagar bigint, confere boolean)
language sql stable security invoker set search_path = public
as $$
  select * from private.cycle_series_for(array(select private.my_workspace_ids()), de, ate, p_view);
$$;

create or replace function public._cycle_series(uid uuid, de date, ate date, p_view text default null)
returns table (mes date, ini date, fim date, estado text, comecei_com bigint,
               entrou bigint, saiu bigint, resultado bigint,
               caixa_no_fim bigint, faltou_pagar bigint, confere boolean)
language sql stable security definer set search_path = public
as $$
  select * from private.cycle_series_for(array(select public._workspace_ids(uid)), de, ate, p_view);
$$;
revoke execute on function public._cycle_series(uuid, date, date, text) from public, anon, authenticated;
