-- Lembrete de conta no cartão: a COMPRA e a FATURA são coisas diferentes (pedido do dono do
-- produto, 07/10/2026: *"só esta no cartão não tem que valer para a fatura inteira, tem que ser
-- coisas diferentes"*).
--
-- Até a 20261009140000 o lembrete de uma compra no cartão (só esta, série ou compra parcelada)
-- virava "a FATURA vence": todas as compras de uma fatura davam o mesmo aviso, um "só esta" numa
-- compra calava o lembrete de OUTRAS séries daquela fatura, e o lembrete da própria fatura calava
-- os das compras. Agora:
--   * o lembrete da compra avisa da COMPRA — o nome e o valor dela, no vencimento da fatura em que
--     ela cai ("Netflix (fatura Nubank) vence em 3 dias"), e abre o lançamento;
--   * "só esta" substitui só o da PRÓPRIA série/compra, naquela linha — a mesma régua de fora do
--     cartão;
--   * o lembrete da fatura é dela: não cala nem é calado pelos das compras. O aviso automático da
--     fatura (do dono) só cala pelo lembrete da FATURA, não mais pelo de uma compra dentro dela.
-- Linha numa fatura paga ou adiada não tem o que lembrar (o dinheiro já foi ou foi adiado junto).

create or replace function private.bill_reminder_dues(p_ws uuid[], p_de date default null, p_ate date default null)
returns table (bill_reminder_id uuid, due_date date, title text, amount_cents bigint, target text, ref uuid)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  with r as (select * from public.bill_reminders b where b.workspace_id = any (p_ws)),
  linhas as (
    select r.id as rid, r.user_id as ruid, (r.transaction_id is not null) as so_esta, t.*,
           ci.due_date as fatura_vence, a.name as cartao
    from r join public.transactions t
      on t.workspace_id = r.workspace_id
     and (t.id = r.transaction_id or t.recurring_id = r.recurring_id or t.installment_plan_id = r.installment_plan_id)
    left join public.card_invoices ci on ci.id = t.invoice_id
    left join public.accounts a on a.id = ci.account_id
    where t.kind <> 'transfer'
      -- fora do cartão: a linha em aberto; no cartão: a compra de uma fatura não paga nem adiada
      and ((t.invoice_id is null and t.status = 'pending')
           or (t.invoice_id is not null and ci.status not in ('paid', 'rolled')))
  )
  select l.rid, coalesce(l.fatura_vence, l.due_at, l.occurred_at),
         coalesce(l.description, l.merchant, l.category, 'Lançamento')
           || case when l.cartao is not null then ' (fatura ' || l.cartao || ')' else '' end,
         l.amount_cents, 'transaction', l.id
  from linhas l
  where (p_de is null or coalesce(l.fatura_vence, l.due_at, l.occurred_at) >= p_de)
    and (p_ate is null or coalesce(l.fatura_vence, l.due_at, l.occurred_at) <= p_ate)
    -- a linha com "só esta" DA MESMA PESSOA não recebe o da série/compra dela
    and (l.so_esta or not exists (
      select 1 from public.bill_reminders b2 where b2.transaction_id = l.id and b2.user_id = l.ruid))
  union
  select r.id, ci.due_date, 'Fatura ' || a.name, private.invoice_open_cents(ci.id), 'invoice', ci.id
  from r
  join public.card_invoices ci on ci.id = r.invoice_id and ci.status not in ('paid', 'rolled')
  join public.accounts a on a.id = ci.account_id
  where (p_de is null or ci.due_date >= p_de) and (p_ate is null or ci.due_date <= p_ate)
  union
  select r.id, s.due_date,
         coalesce(d.payment_description, 'Parcela ' || d.name) || ' (' || s.installment_no || coalesce('/' || d.installments, '') || ')',
         s.payment_cents, 'debt', d.id
  from r
  join public.debts d on d.id = r.debt_id and not d.archived and d.remaining_cents > 0
  cross join lateral private.debt_schedule_for(d.id) s
  where s.payment_cents is not null
    and (p_de is null or s.due_date >= p_de) and (p_ate is null or s.due_date <= p_ate)
    and (s.installment_no = r.debt_installment_no
         or (r.debt_installment_no is null and not exists (
               select 1 from public.bill_reminders b2
               where b2.debt_id = d.id and b2.debt_installment_no = s.installment_no and b2.user_id = r.user_id)));
$$;
revoke execute on function private.bill_reminder_dues(uuid[], date, date) from public, anon, authenticated;

-- Corpo de `_alerts_to_send` copiado de `pg_get_functiondef` do staging em 07/10/2026 (o da
-- 20261009140000); só saiu a exclusão "uma compra da fatura tem lembrete".
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
      and not exists (select 1 from public.bill_reminders b where b.invoice_id = ci.id and b.user_id = d.user_id)
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
      and not private.tx_tem_lembrete(t, d.user_id)
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
revoke execute on function public._alerts_to_send() from public, anon, authenticated;
grant execute on function public._alerts_to_send() to service_role;
