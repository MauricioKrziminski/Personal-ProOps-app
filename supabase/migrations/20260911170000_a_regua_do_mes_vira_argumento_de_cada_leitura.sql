-- A régua do mês deixa de ser preferência GRAVADA e passa a ser argumento de cada leitura.
--
-- A `20260911130000` criou `workspaces.cycle_view` e aplicou num ponto só: `cycle_close_day()`
-- devolvia null no modo civil. Funcionava, mas fixava a régua para o app inteiro — e o pedido do
-- dono do produto era o contrário: *"eu pedi para dar a opção do usuário escolher não de forma
-- global entre ciclo e mês, e sim individualmente em cada tela"*.
--
-- Agora toda leitura de mês aceita `p_view` (`'cycle'` | `'civil'` | null). **`null` mantém o
-- comportamento de hoje**: cai no `workspaces.cycle_view`, que continua sendo o PADRÃO que o
-- Perfil grava. A tela manda o que ela está mostrando; quem não manda nada segue o padrão — o
-- agente e qualquer APK antigo continuam funcionando sem tocar em nada.
--
-- ⚠️ **Argumento novo com default NÃO substitui a função: ele cria uma SOBRECARGA**, e aí a
-- chamada com a aridade antiga fica ambígua e o Postgres recusa. Por isso cada função é dropada
-- antes de ser recriada.
--
-- ⚠️ **E `drop` + `create` PERDE o `revoke`** — a função nova nasce com EXECUTE para `public`.
-- As cinco `security definer` internas (`_month_lines`, `_month_summary`, `_month_breakdown`,
-- `_budgets_status`, `_monthly_cashflow`) e a `private.cycle_close_day` têm o `revoke`/`grant`
-- reemitido logo abaixo de cada uma. É a mesma armadilha da `20260911160000`, de outro ângulo:
-- lá o `create or replace` apagou o `security definer`, aqui o `drop` apagaria a ACL.
--
-- Por que não uma régua por tela GRAVADA: a escolha de "como estou olhando agora" é estado de
-- tela, não configuração. Gravar as sete telas viraria sete colunas, e o usuário que trocou a
-- régua na Projeção em março abriria o app em junho sem lembrar por que aquela tela discorda das
-- outras. O que fica gravado é o PADRÃO, num lugar só.

drop function if exists private.cycle_close_day(uuid[]);
CREATE OR REPLACE FUNCTION private.cycle_close_day(ws_ids uuid[], p_view text DEFAULT NULL)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case when coalesce(p_view, w.cycle_view) = 'civil' then null else w.cycle_close_day end
  from public.workspaces w
  where w.id = any(ws_ids) order by w.id limit 1;
$function$;

revoke execute on function private.cycle_close_day(uuid[], text) from public, anon;
grant execute on function private.cycle_close_day(uuid[], text) to authenticated, service_role;

drop function if exists private.month_lines_for(uuid[], date);
CREATE OR REPLACE FUNCTION private.month_lines_for(ws_ids uuid[], p_month date, p_view text DEFAULT NULL)
 RETURNS TABLE(bucket text, origin text, ref_id uuid, title text, category text, method_id uuid, method_label text, due_date date, due_day integer, installment_no integer, installments_total integer, kind text, amount_cents bigint, settled boolean, projected boolean)
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
$function$;

drop function if exists private.month_summary_for(uuid[], date);
CREATE OR REPLACE FUNCTION private.month_summary_for(ws_ids uuid[], p_month date, p_view text DEFAULT NULL)
 RETURNS TABLE(income_cents bigint, income_unsettled_cents bigint, expense_cents bigint, result_cents bigint, fixas_cents bigint, fixas_unsettled_cents bigint, parcelas_cents bigint, parcelas_unsettled_cents bigint, variaveis_cents bigint, variaveis_unsettled_cents bigint, opening_cash_cents bigint, closing_cash_cents bigint, recurring_covered_until date, beyond_recurring_horizon boolean, debt_installments_undocumented integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with mes as (
    select b.ini, b.fim
    from private.cycle_bounds(private.cycle_close_day(ws_ids, p_view), p_month) b
  ),
  l as (select * from private.month_lines_for(ws_ids, p_month, p_view)),
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
$function$;

drop function if exists private.monthly_lines_range(uuid[], integer);
CREATE OR REPLACE FUNCTION private.monthly_lines_range(ws_ids uuid[], meses integer, p_view text DEFAULT NULL)
 RETURNS TABLE(month date, income_cents bigint, expense_cents bigint, income_pending_cents bigint, expense_pending_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with atual as (
    select private.cycle_month_of(private.cycle_close_day(ws_ids, p_view), current_date) as m
  ),
  janela as (
    select generate_series(
             (select m from atual) - make_interval(months => least(greatest(coalesce(meses, 6), 1), 60)),
             (select m from atual),
             interval '1 month')::date as ini
  ),
  linhas as (
    select j.ini as month, l.*
    from janela j cross join lateral private.month_lines_for(ws_ids, j.ini, p_view) l
  )
  select month,
         coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::bigint,
         coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::bigint,
         coalesce(sum(amount_cents) filter (where kind = 'income'  and not settled), 0)::bigint,
         coalesce(sum(amount_cents) filter (where kind = 'expense' and not settled), 0)::bigint
  from linhas
  group by month
  order by month;
$function$;

drop function if exists private.budgets_status_for(uuid[], date);
CREATE OR REPLACE FUNCTION private.budgets_status_for(ws_ids uuid[], ref_month date, p_view text DEFAULT NULL)
 RETURNS TABLE(category text, limit_cents bigint, spent_cents bigint, committed_cents bigint, base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with regua as (
    select private.cycle_close_day(ws_ids, p_view) as close_day
  ),
  rotulos as (
    select r.close_day,
           private.cycle_month_of(r.close_day, ref_month) as rotulo,
           (private.cycle_month_of(r.close_day, ref_month) - interval '1 month')::date as rotulo_anterior
    from regua r
  ),
  mes as (
    select t.rotulo,
           t.rotulo_anterior,
           b.ini as inicio,
           (b.fim + 1) as fim,          -- exclusivo, como era com `+ interval '1 month'`
           a.ini as anterior             -- ciclos são contíguos: o anterior termina em `inicio`
    from rotulos t
    cross join lateral private.cycle_bounds(t.close_day, t.rotulo) b
    cross join lateral private.cycle_bounds(t.close_day, t.rotulo_anterior) a
  ),
  efetivos as (
    select distinct on (b.category)
           b.category, b.limit_cents, b.rollover, b.month
    from public.budgets b, mes m
    where b.workspace_id = any(ws_ids)
      and (b.month is null or b.month = m.rotulo)
    order by b.category, b.month nulls last
  ),
  gasto as (
    select coalesce(t.category, 'outros') as category,
           -- JÁ ACONTECEU: efetivado, ou parcela de cartão (a compra foi feita)
           coalesce(sum(t.amount_cents) filter (
             where t.status = 'cleared' or t.invoice_id is not null), 0)::bigint as cents,
           -- AINDA PODE NÃO ACONTECER: previsto fora de fatura
           coalesce(sum(t.amount_cents) filter (
             where t.status = 'pending' and t.invoice_id is null), 0)::bigint as previsto
    from public.transactions t, mes m
    where t.workspace_id = any(ws_ids)
      and t.kind = 'expense'
      -- dívida que mudou de fatura já comeu o orçamento no mês da compra
      and t.rollover_of_invoice_id is null
      and t.occurred_at >= m.inicio and t.occurred_at < m.fim
    group by 1
  ),
  gasto_anterior as (
    -- O rollover olha o ciclo FECHADO, e ali "já aconteceu" é a mesma régua: um boleto de agosto
    -- que nunca foi pago não pode consumir a sobra que vai para setembro.
    select coalesce(t.category, 'outros') as category,
           coalesce(sum(t.amount_cents) filter (
             where t.status = 'cleared' or t.invoice_id is not null), 0)::bigint as cents
    from public.transactions t, mes m
    where t.workspace_id = any(ws_ids)
      and t.kind = 'expense'
      and t.rollover_of_invoice_id is null
      and t.occurred_at >= m.anterior and t.occurred_at < m.inicio
    group by 1
  ),
  limite_anterior as (
    select distinct on (b.category) b.category, b.limit_cents
    from public.budgets b, mes m
    where b.workspace_id = any(ws_ids)
      and (
        -- override daquele mes: existia por definicao
        b.month = m.rotulo_anterior
        -- limite padrao: so vale se ja existia antes deste ciclo comecar
        or (b.month is null and b.created_at < m.inicio)
      )
    order by b.category, b.month nulls last
  )
  select e.category,
         (e.limit_cents + case
            when e.rollover then greatest(
              coalesce(la.limit_cents, 0) - coalesce(ga.cents, 0), 0)
            else 0 end)::bigint as limit_cents,
         coalesce(g.cents, 0)::bigint as spent_cents,
         coalesce(g.previsto, 0)::bigint as committed_cents,
         e.limit_cents as base_limit_cents,
         (case when e.rollover then greatest(
            coalesce(la.limit_cents, 0) - coalesce(ga.cents, 0), 0)
         else 0 end)::bigint as rollover_cents,
         e.rollover,
         e.month
  from efetivos e
  left join gasto g on g.category = e.category
  left join gasto_anterior ga on ga.category = e.category
  left join limite_anterior la on la.category = e.category
  order by 3 desc;
$function$;

drop function if exists private.month_breakdown_for(uuid[], date, text);
CREATE OR REPLACE FUNCTION private.month_breakdown_for(ws_ids uuid[], p_month date, p_group_by text, p_view text DEFAULT NULL)
 RETURNS TABLE(group_key text, group_label text, total_cents bigint, unsettled_cents bigint, line_count bigint, share_bp integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- só saída: "para onde o dinheiro foi" é sobre o que saiu
  with l as (
    select * from private.month_lines_for(ws_ids, p_month, p_view) where kind = 'expense'
  ),
  total as (select coalesce(sum(amount_cents), 0)::bigint as cents from l),
  g as (
    select case p_group_by
             when 'meio' then coalesce(l.method_id::text, l.method_label)
             when 'categoria' then l.category
             else l.bucket
           end as chave,
           case p_group_by
             when 'meio' then l.method_label
             when 'categoria' then l.category
             else l.bucket
           end as rotulo,
           sum(l.amount_cents)::bigint as cents,
           coalesce(sum(l.amount_cents) filter (where not l.settled), 0)::bigint as falta,
           count(*)::bigint as n
    from l group by 1, 2
  )
  select g.chave, g.rotulo, g.cents, g.falta, g.n,
         case when (select cents from total) = 0 then 0
              else round(g.cents::numeric * 10000 / (select cents from total))::int end
  from g order by g.cents desc;
$function$;

drop function if exists public.cycle_now();
CREATE OR REPLACE FUNCTION public.cycle_now(p_view text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with ws as (select array(select private.my_workspace_ids()) as ids),
  cru as (
    -- `in (select ...)` e não `any((select ids from ws))`: aquele compara uuid com uuid[] e o
    -- Postgres recusa com 42883 — a CTE devolve UMA LINHA cujo valor é o array, não um conjunto.
    select w.cycle_close_day as dia, coalesce(p_view, w.cycle_view) as modo
    from public.workspaces w
    where w.id in (select private.my_workspace_ids()) order by w.id limit 1
  ),
  cfg as (select private.cycle_close_day((select ids from ws), p_view) as dia),
  atual as (
    select private.cycle_month_of((select dia from cfg), current_date) as mes
  ),
  b as (
    select * from private.cycle_bounds((select dia from cfg), (select mes from atual))
  )
  select jsonb_build_object(
    'closeDay', (select dia from cru),
    'view', coalesce((select modo from cru), 'cycle'),
    'mes', to_char((select mes from atual), 'YYYY-MM'),
    'de', (select ini from b),
    'ate', (select fim from b),
    -- piso 1: no ÚLTIMO dia do ciclo a projeção ainda precisa de uma janela para existir, e
    -- pedir 0 dias devolveria a série vazia e um painel sem número.
    'diasAteOFim', greatest(1, (select fim from b) - current_date)
  );
$function$;

drop function if exists public.cycle_range(date);
CREATE OR REPLACE FUNCTION public.cycle_range(p_month date, p_view text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('de', b.ini, 'ate', b.fim)
  from private.cycle_bounds(
         private.cycle_close_day(array(select private.my_workspace_ids()), p_view),
         date_trunc('month', p_month)::date) b;
$function$;

drop function if exists public.month_lines(date);
CREATE OR REPLACE FUNCTION public.month_lines(p_month date, p_view text DEFAULT NULL)
 RETURNS TABLE(bucket text, origin text, ref_id uuid, title text, category text, method_id uuid, method_label text, due_date date, due_day integer, installment_no integer, installments_total integer, kind text, amount_cents bigint, settled boolean, projected boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select * from private.month_lines_for(array(select private.my_workspace_ids()), p_month, p_view)
  order by bucket, due_date, title;
$function$;

drop function if exists public._month_lines(uuid, date);
CREATE OR REPLACE FUNCTION public._month_lines(uid uuid, p_month date, p_view text DEFAULT NULL)
 RETURNS TABLE(bucket text, origin text, ref_id uuid, title text, category text, method_id uuid, method_label text, due_date date, due_day integer, installment_no integer, installments_total integer, kind text, amount_cents bigint, settled boolean, projected boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from private.month_lines_for(array(select public._workspace_ids(uid)), p_month, p_view)
  order by bucket, due_date, title;
$function$;

revoke execute on function public._month_lines(uuid, date, text) from public, anon, authenticated;

drop function if exists public.month_summary(date);
CREATE OR REPLACE FUNCTION public.month_summary(p_month date, p_view text DEFAULT NULL)
 RETURNS TABLE(income_cents bigint, income_unsettled_cents bigint, expense_cents bigint, result_cents bigint, fixas_cents bigint, fixas_unsettled_cents bigint, parcelas_cents bigint, parcelas_unsettled_cents bigint, variaveis_cents bigint, variaveis_unsettled_cents bigint, opening_cash_cents bigint, closing_cash_cents bigint, recurring_covered_until date, beyond_recurring_horizon boolean, debt_installments_undocumented integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select * from private.month_summary_for(array(select private.my_workspace_ids()), p_month, p_view);
$function$;

drop function if exists public._month_summary(uuid, date);
CREATE OR REPLACE FUNCTION public._month_summary(uid uuid, p_month date, p_view text DEFAULT NULL)
 RETURNS TABLE(income_cents bigint, income_unsettled_cents bigint, expense_cents bigint, result_cents bigint, fixas_cents bigint, fixas_unsettled_cents bigint, parcelas_cents bigint, parcelas_unsettled_cents bigint, variaveis_cents bigint, variaveis_unsettled_cents bigint, opening_cash_cents bigint, closing_cash_cents bigint, recurring_covered_until date, beyond_recurring_horizon boolean, debt_installments_undocumented integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from private.month_summary_for(array(select public._workspace_ids(uid)), p_month, p_view);
$function$;

revoke execute on function public._month_summary(uuid, date, text) from public, anon, authenticated;

drop function if exists public.month_breakdown(date, text);
CREATE OR REPLACE FUNCTION public.month_breakdown(p_month date, p_group_by text DEFAULT 'natureza'::text, p_view text DEFAULT NULL)
 RETURNS TABLE(group_key text, group_label text, total_cents bigint, unsettled_cents bigint, line_count bigint, share_bp integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- allowlist literal: o agrupamento vem da tela, e um valor fora da lista cai no padrão em vez
  -- de devolver vazio em silêncio
  select * from private.month_breakdown_for(
    array(select private.my_workspace_ids()), p_month,
    case when p_group_by in ('meio','categoria','natureza') then p_group_by else 'natureza' end, p_view);
$function$;

drop function if exists public._month_breakdown(uuid, date, text);
CREATE OR REPLACE FUNCTION public._month_breakdown(uid uuid, p_month date, p_group_by text DEFAULT 'natureza'::text, p_view text DEFAULT NULL)
 RETURNS TABLE(group_key text, group_label text, total_cents bigint, unsettled_cents bigint, line_count bigint, share_bp integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from private.month_breakdown_for(
    array(select public._workspace_ids(uid)), p_month,
    case when p_group_by in ('meio','categoria','natureza') then p_group_by else 'natureza' end, p_view);
$function$;

revoke execute on function public._month_breakdown(uuid, date, text, text) from public, anon, authenticated;

drop function if exists public.budgets_status(date);
CREATE OR REPLACE FUNCTION public.budgets_status(ref_month date DEFAULT CURRENT_DATE, p_view text DEFAULT NULL)
 RETURNS TABLE(category text, limit_cents bigint, spent_cents bigint, committed_cents bigint, base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select * from private.budgets_status_for(
    array(select private.my_workspace_ids()), ref_month, p_view);
$function$;

drop function if exists public._budgets_status(uuid, date);
CREATE OR REPLACE FUNCTION public._budgets_status(uid uuid, ref_month date DEFAULT CURRENT_DATE, p_view text DEFAULT NULL)
 RETURNS TABLE(category text, limit_cents bigint, spent_cents bigint, committed_cents bigint, base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from private.budgets_status_for(
    array(select public._workspace_ids(uid)), ref_month, p_view);
$function$;

revoke execute on function public._budgets_status(uuid, date, text) from public, anon, authenticated;

drop function if exists public.monthly_cashflow(integer);
CREATE OR REPLACE FUNCTION public.monthly_cashflow(months_back integer DEFAULT 6, p_view text DEFAULT NULL)
 RETURNS TABLE(month date, income_cents bigint, expense_cents bigint, income_pending_cents bigint, expense_pending_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select * from private.monthly_lines_range(
    array(select private.my_workspace_ids()), months_back, p_view);
$function$;

drop function if exists public._monthly_cashflow(uuid, integer);
CREATE OR REPLACE FUNCTION public._monthly_cashflow(uid uuid, months_back integer DEFAULT 6, p_view text DEFAULT NULL)
 RETURNS TABLE(month date, income_cents bigint, expense_cents bigint, income_pending_cents bigint, expense_pending_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from private.monthly_lines_range(
    array(select public._workspace_ids(uid)), months_back, p_view);
$function$;

revoke execute on function public._monthly_cashflow(uuid, integer, text) from public, anon, authenticated;

drop function if exists public.month_forecast_json(integer, jsonb);
CREATE OR REPLACE FUNCTION public.month_forecast_json(days integer, drafts jsonb DEFAULT '[]'::jsonb, p_view text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select private.month_group(
           public.forecast_json(days, drafts),
           private.cycle_close_day(array(select private.my_workspace_ids()), p_view));
$function$;
