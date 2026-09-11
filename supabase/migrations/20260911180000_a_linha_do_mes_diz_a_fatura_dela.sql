-- A linha do mês passa a dizer EM QUAL FATURA ela cai.
--
-- Duas coisas que o dono do produto pediu saem do mesmo dado: *"ao invés de mostrar os últimos
-- lançamentos do cartão de forma individual, mostrar a fatura e se ele quiser ver os últimos
-- lançamentos daquela fatura ele clica nela"*, e a etiqueta que diz para onde a compra vai.
--
-- ⚠️ **Isto NÃO muda número nenhum.** As colunas são informativas: a tela agrupa as compras de
-- cartão pela fatura que vai pagá-las e a soma continua a mesma. O período continua sendo
-- competência (`occurred_at`), porque é ele que alimenta orçamento e categoria — mover a compra
-- para o mês da fatura faria agosto fechar folgado e setembro estourar por uma compra que a
-- pessoa não lembra de ter feito ali. Quem responde caixa é a Projeção, e lá a fatura já sai
-- inteira no vencimento.
--
-- ⚠️ **As três definições se alinham por POSIÇÃO** (`select *` nos dois wrappers). Coluna nova
-- entra no FIM das três, no mesmo lugar, ou a tela mostra uma coluna no lugar da outra sem erro
-- nenhum — é a armadilha que o `finance.md` registra para `month_summary`.

drop function if exists private.month_lines_for(uuid[], date, text);
CREATE OR REPLACE FUNCTION private.month_lines_for(ws_ids uuid[], p_month date, p_view text DEFAULT NULL)
 RETURNS TABLE(bucket text, origin text, ref_id uuid, title text, category text, method_id uuid, method_label text, due_date date, due_day integer, installment_no integer, installments_total integer, kind text, amount_cents bigint, settled boolean, projected boolean, invoice_id uuid, invoice_due date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with mes as (
    select b.ini, b.fim
    from private.cycle_bounds(private.cycle_close_day(ws_ids, p_view), p_month) b
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
    false,
    t.invoice_id,
    ci.due_date
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
         'expense', s.payment_cents, false, true, null::uuid, null::date
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
         p.kind, p.amount_cents, false, true, null::uuid, null::date
  from private.recurring_projection_for(ws_ids, (select ini from mes), (select fim from mes)) p
  left join public.accounts a on a.id = p.account_id;
$function$;

drop function if exists public.month_lines(date, text);
CREATE OR REPLACE FUNCTION public.month_lines(p_month date, p_view text DEFAULT NULL)
 RETURNS TABLE(bucket text, origin text, ref_id uuid, title text, category text, method_id uuid, method_label text, due_date date, due_day integer, installment_no integer, installments_total integer, kind text, amount_cents bigint, settled boolean, projected boolean, invoice_id uuid, invoice_due date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select * from private.month_lines_for(array(select private.my_workspace_ids()), p_month, p_view)
  order by bucket, due_date, title;
$function$;

drop function if exists public._month_lines(uuid, date, text);
CREATE OR REPLACE FUNCTION public._month_lines(uid uuid, p_month date, p_view text DEFAULT NULL)
 RETURNS TABLE(bucket text, origin text, ref_id uuid, title text, category text, method_id uuid, method_label text, due_date date, due_day integer, installment_no integer, installments_total integer, kind text, amount_cents bigint, settled boolean, projected boolean, invoice_id uuid, invoice_due date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from private.month_lines_for(array(select public._workspace_ids(uid)), p_month, p_view)
  order by bucket, due_date, title;
$function$;
revoke execute on function public._month_lines(uuid, date, text) from public, anon, authenticated;
