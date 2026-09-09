-- A visão de MÊS: as linhas, os totais e para onde o dinheiro foi.
--
-- O app organiza dinheiro por OBJETO — dívida, cartão, recorrente, lançamento — e nenhuma tela
-- responde "como foi setembro". Isto é a página de mês: quatro blocos (entradas, fixas, parcelas
-- e financiamentos, gastos), os totais do rodapé e os cortes de saída.
--
-- ## A regra que segura tudo: nada é contado duas vezes
--
-- * `kind <> 'transfer'` tira, de uma vez, transferência entre contas próprias E pagamento de
--   fatura. A compra no cartão já contou no dia em que foi feita; somar o total da fatura por
--   cima seria o mesmo dinheiro duas vezes (`finance.md`: "pagamento de fatura nunca é despesa
--   nova").
-- * Compra parcelada já é uma linha de `transactions` por mês (`0013`), então vem só de lá.
-- * Prestação de financiamento vira `transactions` **só quando é paga**. Enquanto não é, a única
--   fonte é `private.debt_schedule_for`. As duas origens são disjuntas por construção — e o
--   `not exists` fecha a janela em que a parcela do mês já foi paga mas o vencimento ainda não
--   chegou (o mesmo caso que a `20260909030000` corrigiu dentro do cronograma).
-- * Aporte de meta não é transação, por decisão de `finance.md`. Não aparece, e é o certo.
--
-- ## Por que um helper em `private`
--
-- A união é a mesma para a interna (serviço Python, sem `auth.uid()`) e para o wrapper (app, sob
-- RLS). Repetir o corpo seria a segunda cópia da regra anti-duplicata, que é justamente o que
-- este arquivo existe para evitar. É o padrão que `private.debt_schedule_for`,
-- `private.cash_total` e `private.payoff_strategy_for` já usam: o helper mora em `private`
-- (fora do PostgREST) e recebe o escopo já resolvido.

-- Um pagamento registrado para o contrato dentro do mês. Regra com dois chamadores — as linhas e
-- os totais —, por isso função, não expressão copiada.
create or replace function private.debt_paid_in_month(p_debt_id uuid, p_month date)
returns boolean
language sql stable
set search_path = public
as $$
  select exists (
    select 1 from public.transactions t
    where t.debt_id = p_debt_id
      and date_trunc('month', t.occurred_at) = date_trunc('month', p_month)
  );
$$;
grant execute on function private.debt_paid_in_month(uuid, date) to authenticated, service_role;


create or replace function private.month_lines_for(ws_ids uuid[], p_month date)
returns table (
  bucket text,               -- 'entrada' | 'fixa' | 'parcela' | 'variavel'
  origin text,               -- 'transaction' | 'debt_schedule'
  ref_id uuid,               -- transactions.id, ou debts.id quando origin='debt_schedule'
  title text,
  category text,
  method_id uuid,
  method_label text,         -- nome da conta | 'Sem conta' | 'Financiamento'
  due_date date,
  due_day int,
  installment_no int,
  installments_total int,
  kind text,                 -- 'income' | 'expense'
  amount_cents bigint,       -- SEMPRE positivo; a direção vem de kind
  settled boolean,           -- o "Pago? ✔/✖" da planilha
  projected boolean          -- true = não é lançamento, veio do cronograma
)
language sql stable
set search_path = public
as $$
  with mes as (
    select date_trunc('month', p_month)::date as ini,
           (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date as fim
  )
  select
    case
      -- Entrada vem PRIMEIRO de propósito: salário recorrente casa também com 'fixa', e na
      -- planilha ele está em Entradas.
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
    coalesce(t.due_at, t.occurred_at),
    extract(day from coalesce(t.due_at, t.occurred_at))::int,
    coalesce(t.installment_no, t.debt_payment_no),
    coalesce(ip.installments, d.installments),
    t.kind,
    t.amount_cents,
    -- `status` mente em dois casos: fatura quitada antes da 20260909031000 deixou as compras em
    -- `pending`, e pagamento de financiamento só existe como linha quando já foi pago.
    case
      when t.debt_id is not null then true
      when t.invoice_id is not null then coalesce(ci.status = 'paid', t.status = 'cleared')
      else t.status = 'cleared'
    end,
    false
  from public.transactions t
  left join public.accounts a on a.id = t.account_id
  left join public.installment_plans ip on ip.id = t.installment_plan_id
  left join public.debts d on d.id = t.debt_id
  left join public.card_invoices ci on ci.id = t.invoice_id
  where t.workspace_id = any(ws_ids)
    and t.kind <> 'transfer'
    and t.occurred_at between (select ini from mes) and (select fim from mes)

  union all

  select 'parcela', 'debt_schedule', d.id,
         'Parcela ' || d.name,
         -- a MESMA categoria que `pay_debt_installment` grava: o corte por categoria não pode
         -- mudar de resposta no dia em que a pessoa registra o pagamento
         'contas',
         d.account_id,
         coalesce(a.name, 'Financiamento'),
         s.due_date,
         extract(day from s.due_date)::int,
         s.installment_no,
         d.installments,
         'expense',
         s.payment_cents,
         false,
         true
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  left join public.accounts a on a.id = d.account_id
  where d.workspace_id = any(ws_ids)
    and not d.archived and d.remaining_cents > 0
    and s.due_date between (select ini from mes) and (select fim from mes)
    and not private.debt_paid_in_month(d.id, s.due_date);
$$;
grant execute on function private.month_lines_for(uuid[], date) to authenticated, service_role;


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
  closing_cash_cents bigint,      -- null em mês futuro: caixa não se projeta daqui
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
    select min(r.materialized_until)::date as ate
    from public.recurring_transactions r
    where r.workspace_id = any(ws_ids) and r.active
      and (r.end_date is null or r.end_date >= (select fim from mes))
  ),
  sem_registro as (
    -- parcelas que a pessoa DECLAROU como pagas no cadastro e que não têm lançamento nenhum
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
    case when (select fim from mes) <= current_date
         then private.cash_total(ws_ids, (select fim from mes)) end,
    (select ate from horizonte),
    -- `coalesce` obrigatório: sem série ativa, `min()` é NULL e a flag sairia NULL
    coalesce((select fim from mes) > (select ate from horizonte), false),
    (select n from sem_registro)
  from l;
$$;
grant execute on function private.month_summary_for(uuid[], date) to authenticated, service_role;


create or replace function private.month_breakdown_for(ws_ids uuid[], p_month date, p_group_by text)
returns table (
  group_key text,
  group_label text,
  total_cents bigint,
  unsettled_cents bigint,
  line_count bigint,
  share_bp int              -- pontos-base inteiros; dinheiro não vira float
)
language sql stable
set search_path = public
as $$
  -- só saída: "para onde o dinheiro foi" é sobre o que saiu
  with l as (
    select * from private.month_lines_for(ws_ids, p_month) where kind = 'expense'
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
$$;
grant execute on function private.month_breakdown_for(uuid[], date, text) to authenticated, service_role;


-- ── os três pares públicos ─────────────────────────────────────────────────
-- Interna: o serviço Python conecta com papel que ignora RLS, então o escopo vem do `uid`
-- resolvido. Wrapper: o app roda sob RLS e o escopo sai do próprio `auth.uid()`.

create or replace function public._month_lines(uid uuid, p_month date)
returns table (
  bucket text, origin text, ref_id uuid, title text, category text,
  method_id uuid, method_label text, due_date date, due_day int,
  installment_no int, installments_total int, kind text,
  amount_cents bigint, settled boolean, projected boolean
)
language sql stable security definer
set search_path = public
as $$
  select * from private.month_lines_for(array(select public._workspace_ids(uid)), p_month)
  order by bucket, due_date, title;
$$;
revoke execute on function public._month_lines(uuid, date) from public, anon, authenticated;

create or replace function public.month_lines(p_month date)
returns table (
  bucket text, origin text, ref_id uuid, title text, category text,
  method_id uuid, method_label text, due_date date, due_day int,
  installment_no int, installments_total int, kind text,
  amount_cents bigint, settled boolean, projected boolean
)
language sql stable
set search_path = public
as $$
  select * from private.month_lines_for(array(select private.my_workspace_ids()), p_month)
  order by bucket, due_date, title;
$$;

create or replace function public._month_summary(uid uuid, p_month date)
returns table (
  income_cents bigint, expense_cents bigint, result_cents bigint,
  fixas_cents bigint, fixas_unsettled_cents bigint,
  parcelas_cents bigint, parcelas_unsettled_cents bigint,
  variaveis_cents bigint, variaveis_unsettled_cents bigint,
  opening_cash_cents bigint, closing_cash_cents bigint,
  recurring_covered_until date, beyond_recurring_horizon boolean,
  debt_installments_undocumented int
)
language sql stable security definer
set search_path = public
as $$
  select * from private.month_summary_for(array(select public._workspace_ids(uid)), p_month);
$$;
revoke execute on function public._month_summary(uuid, date) from public, anon, authenticated;

create or replace function public.month_summary(p_month date)
returns table (
  income_cents bigint, expense_cents bigint, result_cents bigint,
  fixas_cents bigint, fixas_unsettled_cents bigint,
  parcelas_cents bigint, parcelas_unsettled_cents bigint,
  variaveis_cents bigint, variaveis_unsettled_cents bigint,
  opening_cash_cents bigint, closing_cash_cents bigint,
  recurring_covered_until date, beyond_recurring_horizon boolean,
  debt_installments_undocumented int
)
language sql stable
set search_path = public
as $$
  select * from private.month_summary_for(array(select private.my_workspace_ids()), p_month);
$$;

create or replace function public._month_breakdown(uid uuid, p_month date, p_group_by text default 'natureza')
returns table (
  group_key text, group_label text, total_cents bigint,
  unsettled_cents bigint, line_count bigint, share_bp int
)
language sql stable security definer
set search_path = public
as $$
  select * from private.month_breakdown_for(
    array(select public._workspace_ids(uid)), p_month,
    case when p_group_by in ('meio','categoria','natureza') then p_group_by else 'natureza' end);
$$;
revoke execute on function public._month_breakdown(uuid, date, text) from public, anon, authenticated;

create or replace function public.month_breakdown(p_month date, p_group_by text default 'natureza')
returns table (
  group_key text, group_label text, total_cents bigint,
  unsettled_cents bigint, line_count bigint, share_bp int
)
language sql stable
set search_path = public
as $$
  -- allowlist literal: o agrupamento vem da tela, e um valor fora da lista cai no padrão em vez
  -- de devolver vazio em silêncio
  select * from private.month_breakdown_for(
    array(select private.my_workspace_ids()), p_month,
    case when p_group_by in ('meio','categoria','natureza') then p_group_by else 'natureza' end);
$$;

comment on function public.month_lines(date) is
  'As linhas do mês em quatro blocos: entrada, fixa, parcela e variável. Inclui a prestação de financiamento que ainda não virou lançamento.';
comment on function public.month_summary(date) is
  'Os totais do mês: entrou, saiu, resultado, subtotal por bloco, caixa de abertura e fechamento, e o que a tela precisa declarar como incompleto.';
comment on function public.month_breakdown(date, text) is
  'Para onde o dinheiro foi, agrupado por meio, categoria ou natureza. Os três somam o MESMO total.';
