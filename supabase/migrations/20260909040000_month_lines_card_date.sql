-- A data que a linha do mês mostra é a do MÊS dela.
--
-- `month_lines_for` mostrava `coalesce(due_at, occurred_at)`. Para item de cartão o trigger
-- `set_invoice` grava em `due_at` o VENCIMENTO DA FATURA — que pode cair em outro mês. Achado
-- com dado real: `Apple iCloud` aconteceu em 05/09, entrou (corretamente) no mês de setembro
-- por `occurred_at`, e a tela escrevia "dia 10" — o vencimento da fatura de OUTUBRO. A linha
-- estava num mês e a data em outro.
--
-- A regra passa a ser explícita:
--   · item de cartão (`invoice_id not null`) → o dia da COMPRA. É o que a pessoa reconhece, e é
--     o que a planilha dela sempre escreveu. Quando a fatura vence é assunto da tela de Cartões,
--     que existe para isso.
--   · conta a pagar avulsa → `due_at`, que ali é vencimento de verdade ("DAS, dia 20").
--   · o resto → `occurred_at`.
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
           -- a data da linha, pela regra acima
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
    and not private.debt_paid_in_month(d.id, s.due_date);
$$;
