-- Pix no crédito para conta própria (28/09/2026): a transferência que SAI do cartão para uma
-- conta do próprio usuário é dívida do cartão — entra na FATURA (total, aberto, o que vence,
-- projeção, aviso) e, no caixa, é ENTRADA na conta no dia (o `cash_events` ganha o ramo 1b).
-- Continua fora de gasto, orçamento e categoria (competência não muda).
--
-- Antes, ~20 leituras filtravam a linha da fatura por `kind = 'expense'`: o `set_invoice` já dava
-- `invoice_id` ao transfer, mas ele não somava — a fatura ficava R$ 340 menor em silêncio (medido
-- em produção). A regra agora mora em UM predicado, `private.conta_na_fatura`, que é o que se
-- procura antes de escrever outra leitura de fatura.
--
-- Só a linha do PRÓPRIO cartão ganha `invoice_id` (conferido no `tg_transactions_set_invoice`):
-- o pagamento da fatura (conta → cartão) nunca entra.
--
-- Corpos copiados do `pg_get_functiondef` do staging (cabeçalhos inteiros: `CREATE OR REPLACE`
-- apaga o que não repetir). Ficam de fora de propósito, com `expense` só: `budgets_status_for`,
-- `month_lines_for` (competência), `_account_balances`/`cash_total` (já tratam transfer nos dois
-- lados), `_liquidar_faturas_vencidas`/`tg_card_invoices_liquidada` (o Pix nasce pago),
-- `importar_parcelado`, `anticipation_candidates` e o `em_aberto` do `cycle_series_for`.

-- Sem `set search_path`: sem objeto referenciado, e assim o planejador a inlina nas somas.
create or replace function private.conta_na_fatura(p_kind text)
returns boolean
language sql
immutable
parallel safe
as $$ select p_kind in ('expense', 'transfer') $$;

grant execute on function private.conta_na_fatura(text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION private.invoice_open_cents(p_invoice_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select (coalesce((select sum(t.amount_cents) from public.transactions t
                    where t.invoice_id = p_invoice_id and private.conta_na_fatura(t.kind)), 0)
        - coalesce((select ci.paid_cents from public.card_invoices ci
                    where ci.id = p_invoice_id), 0))::bigint;
$function$;

CREATE OR REPLACE FUNCTION public._card_summary(uid uuid)
 RETURNS TABLE(account_id uuid, name text, credit_limit_cents bigint, closing_day integer, due_day integer, invoice_id uuid, reference_month date, closing_date date, due_date date, invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint, overdue_count integer, overdue_total_cents bigint, oldest_overdue_invoice_id uuid, invoice_open_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with cards as (
    select a.* from public.accounts a
    where a.workspace_id in (select public._workspace_ids(uid))
      and a.type = 'credit_card' and not a.archived
  ),
  totals as (
    select ci.id as invoice_id, coalesce(sum(t.amount_cents), 0)::bigint as total_cents,
           private.invoice_open_cents(ci.id) as open_cents
    from public.card_invoices ci
    -- escopo no workspace: sem este join a CTE varria card_invoices de TODOS os
    -- usuarios a cada chamada (herdado da 0013). Nao vazava, porque o resultado e
    -- filtrado depois, mas custava O(faturas do banco inteiro).
    join cards c on c.id = ci.account_id
    left join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status not in ('paid','rolled')
    order by ci.account_id,
             -- corrente e futuras primeiro, da mais próxima para a mais distante
             (ci.reference_month < date_trunc('month', current_date)::date),
             case when ci.reference_month >= date_trunc('month', current_date)::date
                  then ci.reference_month end asc,
             ci.reference_month desc
  ),
  atrasadas as (
    select ci.account_id,
           count(*)::int as overdue_count,
           coalesce(sum(tt.open_cents), 0)::bigint as overdue_total_cents,
           (array_agg(ci.id order by ci.reference_month))[1] as oldest_id
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    left join totals tt on tt.invoice_id = ci.id
    where ci.status not in ('paid','rolled') and ci.due_date < current_date
    group by ci.account_id
  )
  select c.id, c.name, c.credit_limit_cents, c.closing_day, c.due_day,
         ab.id, ab.reference_month, ab.closing_date, ab.due_date,
         coalesce(tt.total_cents, 0)::bigint,
         coalesce((select sum(t2.open_cents) from totals t2
                   join public.card_invoices ci2 on ci2.id = t2.invoice_id
                   where ci2.account_id = c.id and ci2.status not in ('paid','rolled')), 0)::bigint,
         (coalesce(c.credit_limit_cents, 0)
          - coalesce((select sum(t3.open_cents) from totals t3
                      join public.card_invoices ci3 on ci3.id = t3.invoice_id
                      where ci3.account_id = c.id and ci3.status not in ('paid','rolled')), 0))::bigint,
         coalesce(atr.overdue_count, 0),
         coalesce(atr.overdue_total_cents, 0)::bigint,
         atr.oldest_id,
         coalesce(tt.open_cents, 0)::bigint
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$function$;

CREATE OR REPLACE FUNCTION public.card_summary()
 RETURNS TABLE(account_id uuid, name text, credit_limit_cents bigint, closing_day integer, due_day integer, invoice_id uuid, reference_month date, closing_date date, due_date date, invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint, overdue_count integer, overdue_total_cents bigint, oldest_overdue_invoice_id uuid, invoice_open_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with cards as (
    select a.* from public.accounts a
    where a.workspace_id in (select private.my_workspace_ids())
      and a.type = 'credit_card' and not a.archived
  ),
  totals as (
    select ci.id as invoice_id, coalesce(sum(t.amount_cents), 0)::bigint as total_cents,
           private.invoice_open_cents(ci.id) as open_cents
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    left join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status not in ('paid','rolled')
    order by ci.account_id,
             (ci.reference_month < date_trunc('month', current_date)::date),
             case when ci.reference_month >= date_trunc('month', current_date)::date
                  then ci.reference_month end asc,
             ci.reference_month desc
  ),
  atrasadas as (
    select ci.account_id,
           count(*)::int as overdue_count,
           coalesce(sum(tt.open_cents), 0)::bigint as overdue_total_cents,
           (array_agg(ci.id order by ci.reference_month))[1] as oldest_id
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    left join totals tt on tt.invoice_id = ci.id
    where ci.status not in ('paid','rolled') and ci.due_date < current_date
    group by ci.account_id
  )
  select c.id, c.name, c.credit_limit_cents, c.closing_day, c.due_day,
         ab.id, ab.reference_month, ab.closing_date, ab.due_date,
         coalesce(tt.total_cents, 0)::bigint,
         coalesce((select sum(t2.open_cents) from totals t2
                   join public.card_invoices ci2 on ci2.id = t2.invoice_id
                   where ci2.account_id = c.id and ci2.status not in ('paid','rolled')), 0)::bigint,
         (coalesce(c.credit_limit_cents, 0)
          - coalesce((select sum(t3.open_cents) from totals t3
                      join public.card_invoices ci3 on ci3.id = t3.invoice_id
                      where ci3.account_id = c.id and ci3.status not in ('paid','rolled')), 0))::bigint,
         coalesce(atr.overdue_count, 0),
         coalesce(atr.overdue_total_cents, 0)::bigint,
         atr.oldest_id,
         coalesce(tt.open_cents, 0)::bigint
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$function$;

CREATE OR REPLACE FUNCTION public._upcoming_bills(uid uuid, days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
  where ci.workspace_id in (select public._workspace_ids(uid))
    and ci.status not in ('paid','rolled')
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select case when t.kind = 'income' then 'income' else 'transaction' end, t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  union all
  -- prestação de dívida/financiamento: vence e sai da conta como qualquer conta
  select 'debt', d.id, coalesce(d.payment_description, 'Parcela ' || d.name), s.payment_cents, s.due_date,
         s.due_date < current_date
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id in (select public._workspace_ids(uid))
    and not d.archived and d.remaining_cents > 0
    and s.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$function$;

CREATE OR REPLACE FUNCTION public.upcoming_bills(days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
  where ci.workspace_id in (select private.my_workspace_ids())
    and ci.status not in ('paid','rolled')
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select case when t.kind = 'income' then 'income' else 'transaction' end, t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  union all
  -- prestação de dívida/financiamento: vence e sai da conta como qualquer conta
  select 'debt', d.id, coalesce(d.payment_description, 'Parcela ' || d.name), s.payment_cents, s.due_date,
         s.due_date < current_date
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id in (select private.my_workspace_ids())
    and not d.archived and d.remaining_cents > 0
    and s.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$function$;

CREATE OR REPLACE FUNCTION public._cash_flow_forecast(uid uuid, days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with horizonte as (select private.clamp_forecast_days(days) as dias),
  saldo_inicial as (select private.cash_total(array(select public._workspace_ids(uid))) as cents),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
    where ci.workspace_id in (select public._workspace_ids(uid)) and ci.status not in ('paid','rolled')
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select public._workspace_ids(uid))
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
      and (t.kind <> 'income' or coalesce(t.due_at, t.occurred_at) >= current_date - 3)
    union all
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select public._workspace_ids(uid))
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
    union all
    -- NOVO: recorrente além do horizonte materializado
    select p.due_date,
           case when p.kind = 'income'  then p.amount_cents else 0 end::bigint,
           case when p.kind = 'expense' then p.amount_cents else 0 end::bigint
    from private.recurring_projection_for(
           array(select public._workspace_ids(uid)), current_date,
           current_date + (select dias from horizonte)) p
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;

CREATE OR REPLACE FUNCTION public.cash_flow_forecast(days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with horizonte as (select private.clamp_forecast_days(days) as dias),
  saldo_inicial as (select private.cash_total(array(select private.my_workspace_ids())) as cents),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
    where ci.workspace_id in (select private.my_workspace_ids()) and ci.status not in ('paid','rolled')
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select private.my_workspace_ids())
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
      and (t.kind <> 'income' or coalesce(t.due_at, t.occurred_at) >= current_date - 3)
    union all
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select private.my_workspace_ids())
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
    union all
    select p.due_date,
           case when p.kind = 'income'  then p.amount_cents else 0 end::bigint,
           case when p.kind = 'expense' then p.amount_cents else 0 end::bigint
    from private.recurring_projection_for(
           array(select private.my_workspace_ids()), current_date,
           current_date + (select dias from horizonte)) p
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;

CREATE OR REPLACE FUNCTION public._alerts_to_send()
 RETURNS TABLE(workspace_id uuid, user_id uuid, phone text, expo_push_token text, alerts_push_enabled boolean, alerts_whatsapp_enabled boolean, kind text, ref text, title text, body text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with donos as (
    select w.id as workspace_id, w.owner_id as user_id,
           p.phone, p.expo_push_token, p.timezone,
           p.alerts_push_enabled, p.alerts_whatsapp_enabled
    from public.workspaces w
    join public.profiles p on p.id = w.owner_id
    where (p.alerts_push_enabled and p.expo_push_token is not null)
       or (p.alerts_whatsapp_enabled and p.phone is not null)
  ),
  teste as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'trial_ending' as kind,
           s.current_period_end::text as ref,
           'Seu teste acaba em 2 dias' as title,
           case when uso.lancamentos > 0
                then 'Voce ja registrou ' || uso.lancamentos
                     || ' lancamento' || case when uso.lancamentos = 1 then '' else 's' end
                     || ' nesta semana. Dia ' || to_char(s.current_period_end, 'DD/MM')
                     || ' o teste vira assinatura automaticamente. '
                     || 'Se nao quiser continuar, cancele na loja antes disso — '
                     || 'sao dois toques e nao precisa falar com ninguem.'
                else 'Dia ' || to_char(s.current_period_end, 'DD/MM')
                     || ' o teste vira assinatura automaticamente. '
                     || 'Manda um gasto aqui pra experimentar antes de decidir — '
                     || 'ou cancele na loja, sao dois toques.' end as body
    from donos d
    join public.subscriptions s on s.workspace_id = d.workspace_id
    cross join lateral (
      select count(*)::int as lancamentos
      from public.transactions t
      where t.workspace_id = d.workspace_id
        and t.created_at >= now() - interval '7 days'
    ) uso
    where s.is_trial
      and s.status = 'trialing'
      and s.current_period_end = current_date + 2
  ),
  fechamento as (
    -- O ciclo que terminou ONTEM. Com `cycle_close_day = 10` dispara no dia 11; com `null`
    -- (mês civil) dispara no dia 1º — o mesmo `private.cycle_close_day` que as telas usam, então
    -- o número do aviso e o da tela que ele abre saem da MESMA borda.
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'cycle_closed' as kind,
           -- O `ref` é a data de FIM, e ela faz DOIS trabalhos: deduplica em `alerts_sent`
           -- (um aviso por ciclo) e vai no `data` do push como o mês a abrir. Ela cai sempre no
           -- mês do RÓTULO, porque o rótulo de um ciclo é o mês em que ele termina.
           b.fim::text as ref,
           initcap(translate(private.mes_pt(b.fim), 'ç', 'c')) || ' fechou' as title,
           -- ⚠️ **Colunas CRUAS, nunca uma manchete de "fechou em X".** Qual número lidera um
           -- ciclo fechado é regra de produto e mora em `describeCycle` (`src/lib/cycle-label.ts`):
           -- com dívida ele lidera com `-faltou_pagar`, sem dívida com `caixa_no_fim`. Escrever
           -- essa escolha aqui seria a segunda cópia — e o push diria um número enquanto a tela
           -- que ele abre diria outro, que é a queixa que criou o `describeCycle`.
           'Entrou ' || round(s.entrou::numeric / 100, 2)
             || ', saiu ' || round(s.saiu::numeric / 100, 2)
             || '. Sobrou na conta ' || round(coalesce(s.caixa_no_fim, 0)::numeric / 100, 2)
             || case when coalesce(s.faltou_pagar, 0) > 0
                     then '. Ficou faltando pagar ' || round(s.faltou_pagar::numeric / 100, 2)
                     else '' end
             || '. Quer ver o detalhe?' as body
    from donos d
    cross join lateral (select private.cycle_close_day(array[d.workspace_id], null) as dia) cfg
    cross join lateral (select private.cycle_month_of(cfg.dia, current_date - 1) as m) lbl
    cross join lateral private.cycle_bounds(cfg.dia, lbl.m) b
    -- `cycle_series_for` recebe o mês do RÓTULO, não a data de início: ela mesma chama
    -- `cycle_bounds` por dentro. Passar `b.ini` devolveria o ciclo anterior ao certo.
    cross join lateral private.cycle_series_for(array[d.workspace_id], lbl.m, lbl.m, null) s
    where b.fim = current_date - 1
  ),
  orcamento as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           -- O GATILHO é gasto + comprometido; o TEXTO separa os dois. Avisar só pelo gasto
           -- deixaria a pessoa tranquila com um limite já tomado por um boleto agendado —
           -- e é justamente enquanto o boleto não saiu que ainda dá para fazer algo.
           case when b.spent_cents + b.committed_cents >= b.limit_cents
                then 'budget_100' else 'budget_80' end as kind,
           b.category as ref,
           case when b.spent_cents + b.committed_cents >= b.limit_cents
                then 'Orcamento estourado'
                else 'Orcamento no limite' end as title,
           case when b.spent_cents + b.committed_cents >= b.limit_cents
                then 'Voce ja gastou ' || round(b.spent_cents::numeric / 100, 2)
                     || ' de ' || round(b.limit_cents::numeric / 100, 2)
                     || ' em ' || b.category
                     || case when b.committed_cents > 0
                             then ', e tem mais ' || round(b.committed_cents::numeric / 100, 2)
                                  || ' em conta prevista'
                             else '' end
                     || '. Quer que eu remaneje de outra categoria?'
                else 'Voce ja usou ' || round(100.0 * (b.spent_cents + b.committed_cents) / b.limit_cents)
                     || '% do orcamento de ' || b.category
                     || case when b.committed_cents > 0
                             then ' (contando ' || round(b.committed_cents::numeric / 100, 2)
                                  || ' que ainda nao saiu)'
                             else '' end
                     || '. Faltam ' || round((b.limit_cents - b.spent_cents - b.committed_cents)::numeric / 100, 2)
                     || ' ate o fim do mes.' end as body
    from donos d
    cross join lateral private.budgets_status_for(array[d.workspace_id], current_date) b
    where b.limit_cents > 0 and b.spent_cents + b.committed_cents >= b.limit_cents * 0.8
  ),
  fatura as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'invoice_due' as kind, ci.id::text as ref,
           'Fatura do ' || a.name as title,
           'Fatura de ' || round(private.invoice_open_cents(ci.id)::numeric / 100, 2)
             || ' vence em ' || to_char(ci.due_date, 'DD/MM')
             || '. Ja pagou? Me manda "paguei a fatura do ' || a.name || '".' as body
    from donos d
    join public.card_invoices ci on ci.workspace_id = d.workspace_id
                                and ci.status not in ('paid', 'rolled')
    join public.accounts a on a.id = ci.account_id
    join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
    where ci.due_date <= current_date + 3
    group by d.workspace_id, d.user_id, d.phone, d.expo_push_token,
             d.alerts_push_enabled, d.alerts_whatsapp_enabled,
             ci.id, ci.due_date, a.name
  ),
  conta as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'bill_due' as kind, t.id::text as ref,
           'Conta vencendo' as title,
           coalesce(t.description, t.category, 'Conta') || ' de '
             || round(t.amount_cents::numeric / 100, 2)
             || ' vence ' || case when coalesce(t.due_at, t.occurred_at) = current_date
                                  then 'hoje' else 'amanha' end
             || '. Depois me diz "paguei" que eu dou baixa.' as body
    from donos d
    join public.transactions t on t.workspace_id = d.workspace_id
    where t.status = 'pending' and t.kind = 'expense' and t.invoice_id is null
      and coalesce(t.due_at, t.occurred_at) between current_date and current_date + 1
  ),
  receita as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'income_to_confirm' as kind, t.id::text as ref,
           'Chegou o dinheiro?' as title,
           coalesce(t.description, t.category, 'Receita') || ' de '
             || round(t.amount_cents::numeric / 100, 2)
             || case when coalesce(t.due_at, t.occurred_at) = current_date
                     then ' estava previsto pra hoje. '
                     else ' estava previsto pra '
                          || to_char(coalesce(t.due_at, t.occurred_at), 'DD/MM')
                          || ' e ainda nao foi confirmado. ' end
             || 'Se ja caiu, me manda "recebi" que eu dou baixa. '
             || 'Ate la ele conta so na projecao, nao no saldo.' as body
    from donos d
    join public.transactions t on t.workspace_id = d.workspace_id
    where t.status = 'pending' and t.kind = 'income'
      -- quem tem `auto_confirm` nao precisa de aviso: o cron da baixa sozinho
      and not t.auto_confirm
      -- dois toques: no dia previsto e tres dias depois. Ver o cabecalho.
      and coalesce(t.due_at, t.occurred_at) in (current_date, current_date - 3)
  ),
  vermelho as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'negative_forecast' as kind, f.day::text as ref,
           'Saldo vai ficar negativo' as title,
           'Do jeito que esta, dia ' || to_char(f.day, 'DD/MM')
             || ' seu saldo fica em ' || round(f.balance_cents::numeric / 100, 2)
             || '. Quer ver o que da pra adiar?' as body
    from donos d
    cross join lateral (
      select day, balance_cents
      from public._cash_flow_forecast(d.user_id, 30)
      where balance_cents < 0
      order by day
      limit 1
    ) f
  )
  -- O teste vem primeiro porque é o único aviso com prazo dentro do teto diário.
  -- O fechamento vem logo atrás: ele acontece UMA vez por ciclo e é o aviso mais
  -- importante do mês. Deixado no fim, três avisos de orçamento no dia 11 o cortariam
  -- pelo `MAX_ALERTS_PER_USER`.
  select * from teste
  union all select * from fechamento
  union all select * from orcamento
  union all select * from fatura
  union all select * from conta
  union all select * from receita
  union all select * from vermelho;
$function$;

CREATE OR REPLACE FUNCTION private.cash_events(ws_ids uuid[], ini date, fim date)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, title text, origin text, ref_id uuid, method_label text, realizado boolean, atrasada boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  -- 1. PAGAMENTO REALIZADO de fatura: o transfer para uma conta de cartão.
  select case when t.status = 'cleared' then coalesce(t.paid_at, t.occurred_at) else t.occurred_at end,
         0::bigint, t.amount_cents,
         coalesce(nullif(t.description,''), 'Pagamento de fatura'), 'invoice_payment', t.id,
         coalesce(d.name, 'Cartão'),
         -- ⚠️ `<= current_date` JUNTO com `cleared`: uma linha quitada com `paid_at` FUTURO não
         -- está em `cash_total(hoje)` (que filtra `paid_at <= as_of`), então ela ainda é
         -- compromisso. Sem esta metade, o dinheiro sumiria dos dois lados.
         (t.status = 'cleared' and coalesce(t.paid_at, t.occurred_at) <= current_date),
         false
  from public.transactions t
  join public.accounts d on d.id = t.counterparty_account_id and d.type = 'credit_card'
  left join public.accounts o on o.id = t.account_id
  where t.workspace_id = any(ws_ids) and t.kind = 'transfer'
    and coalesce(o.type, 'x') <> 'credit_card'
    and (case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at) else t.occurred_at end)
        between ini and fim
    -- Janela que já FECHOU só conta o que aconteceu (25/09/2026): pendente ali não saiu do caixa.
    and (t.status = 'cleared' or fim >= current_date)
  union all
  -- 1b. PIX NO CRÉDITO para conta própria (28/09/2026): o transfer que SAI do cartão para uma
  -- conta. O dinheiro ENTRA na conta no dia; a saída é a fatura, no vencimento (ramo 2, que
  -- soma o transfer pelo `conta_na_fatura`). Sem este ramo o ciclo mostraria só a cobrança, e
  -- "comecei + entrou − saiu" deixaria de chegar ao "sobrou na conta" (o `cash_total` já conta
  -- a entrada).
  select case when t.status = 'cleared' then coalesce(t.paid_at, t.occurred_at) else t.occurred_at end,
         t.amount_cents, 0::bigint,
         coalesce(nullif(t.description,''), 'Pix no crédito'), 'transaction', t.id,
         coalesce(d.name, 'Conta'),
         (t.status = 'cleared' and coalesce(t.paid_at, t.occurred_at) <= current_date),
         false
  from public.transactions t
  join public.accounts o on o.id = t.account_id and o.type = 'credit_card'
  join public.accounts d on d.id = t.counterparty_account_id and d.type <> 'credit_card'
  where t.workspace_id = any(ws_ids) and t.kind = 'transfer'
    and (case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at) else t.occurred_at end)
        between ini and fim
    and (t.status = 'cleared' or fim >= current_date)
  union all
  -- 2. O que AINDA falta pagar de uma fatura: nunca passou pelo caixa.
  select greatest(ci.due_date, current_date), 0::bigint, private.invoice_open_cents(ci.id),
         'Fatura ' || coalesce(a.name,'cartão') ||
           case when ci.due_date < current_date then ' (atrasada)' else '' end,
         'invoice', ci.id, coalesce(a.name,'Cartão'), false,
         ci.due_date < current_date
  from public.card_invoices ci join public.accounts a on a.id = ci.account_id
  where ci.workspace_id = any(ws_ids) and ci.status not in ('paid','rolled')
    and greatest(ci.due_date, current_date) between ini and fim
    and private.invoice_open_cents(ci.id) > 0
  union all
  -- 3. Lançamento fora de cartão.
  select case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at)
              else coalesce(t.due_at,t.occurred_at) end,
         case when t.kind='income' then t.amount_cents else 0 end::bigint,
         case when t.kind='expense' then t.amount_cents else 0 end::bigint,
         coalesce(nullif(t.description,''), nullif(t.merchant,''), t.category, 'Lançamento'),
         'transaction', t.id, coalesce(a.name,'Sem conta'),
         (t.status = 'cleared' and coalesce(t.paid_at, t.occurred_at) <= current_date),
         false
  from public.transactions t left join public.accounts a on a.id = t.account_id
  where t.workspace_id = any(ws_ids) and t.kind <> 'transfer'
    and t.invoice_id is null and t.rollover_of_invoice_id is null
    and (case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at)
              else coalesce(t.due_at,t.occurred_at) end) between ini and fim
    -- O mesmo: a conta que ficou sem pagar num ciclo fechado aparece no ciclo ATUAL como
    -- "(atrasado)" (ramo 4) e no "faltou pagar" do ciclo fechado — nunca como saída dele.
    and (t.status = 'cleared' or fim >= current_date)
  union all
  -- 4. Atrasado, clampado para hoje. `pending` por definição: não saiu do caixa.
  select current_date,
         case when t.kind='income' then t.amount_cents else 0 end::bigint,
         case when t.kind='expense' then t.amount_cents else 0 end::bigint,
         coalesce(nullif(t.description,''), nullif(t.merchant,''), t.category, 'Lançamento') || ' (atrasado)',
         'transaction_overdue', t.id, coalesce(a.name,'Sem conta'), false,
         true
  from public.transactions t left join public.accounts a on a.id = t.account_id
  where t.workspace_id = any(ws_ids) and t.status='pending'
    and t.kind <> 'transfer' and t.invoice_id is null and t.rollover_of_invoice_id is null
    and coalesce(t.due_at,t.occurred_at) < ini and current_date between ini and fim
    and (t.kind <> 'income' or coalesce(t.due_at,t.occurred_at) >= current_date - 3)
  union all
  -- 5. Cronograma de dívida: sai do CONTRATO, não de `transactions`. Nunca realizado.
  select s.due_date, 0::bigint, s.payment_cents, coalesce(d.payment_description, 'Parcela ' || d.name), 'debt_schedule', d.id,
         coalesce(a.name,'Financiamento'), false, false
  from public.debts d cross join lateral private.debt_schedule_for(d.id) s
  left join public.accounts a on a.id = d.account_id
  where d.workspace_id = any(ws_ids) and not d.archived and d.remaining_cents > 0
    and s.due_date between ini and fim and not private.debt_paid_in_month(d.id, s.due_date)
  union all
  -- 6. Recorrente projetada da REGRA: linha que ainda não existe. Nunca realizada.
  select p.due_date,
         case when p.kind='income' then p.amount_cents else 0 end::bigint,
         case when p.kind='expense' then p.amount_cents else 0 end::bigint,
         p.description, 'recurring_projection', p.recurring_id, coalesce(a.name,'Sem conta'), false,
         false
  from private.recurring_projection_for(ws_ids, ini, fim) p
  left join public.accounts a on a.id = p.account_id
  -- A REGRA projetada também não inventa movimento num período que já passou: série que o cron
  -- ainda não materializou (no staging ele não roda) punha ocorrência fantasma no ciclo fechado.
  where fim >= current_date;
$function$;
