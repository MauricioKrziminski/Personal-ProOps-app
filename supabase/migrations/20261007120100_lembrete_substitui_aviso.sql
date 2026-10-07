-- O lembrete de conta SUBSTITUI o aviso automatico daquele registro (spec 5): sem mensagem
-- dobrada, nem template pago dobrado. Os outros tipos de aviso nao mudam.
-- Corpo de `_alerts_to_send` copiado de `pg_get_functiondef` do staging em 07/10/2026; so as
-- exclusoes `tx_tem_lembrete` / `bill_reminders ... invoice_id` sao novas.

create or replace function private.tx_tem_lembrete(p_tx public.transactions)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.bill_reminders b
    where b.transaction_id = p_tx.id
       or b.recurring_id = p_tx.recurring_id
       or b.installment_plan_id = p_tx.installment_plan_id);
$$;
revoke execute on function private.tx_tem_lembrete(public.transactions) from public, anon, authenticated;

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
      and not exists (select 1 from public.bill_reminders b where b.invoice_id = ci.id)
      and not exists (select 1 from public.transactions tc
                      where tc.invoice_id = ci.id and private.tx_tem_lembrete(tc))
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
      and not private.tx_tem_lembrete(t)
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

-- `_bill_reminders_due`: so os espacos que tem lembrete (antes agregava todos, todo minuto).
create or replace function public._bill_reminders_due()
returns table (bill_reminder_id uuid, user_id uuid, workspace_id uuid, due_date date, days_before int,
               title text, amount_cents bigint, target text, ref uuid, channel text,
               phone text, expo_push_token text, alerts_whatsapp_enabled boolean, attempts int)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  select b.id, b.user_id, b.workspace_id, d.due_date, b.days_before, d.title, d.amount_cents, d.target, d.ref,
         b.channel, p.phone, p.expo_push_token, p.alerts_whatsapp_enabled, coalesce(s.attempts, 0)
  from private.bill_reminder_dues((select array_agg(distinct r.workspace_id) from public.bill_reminders r)) d
  join public.bill_reminders b on b.id = d.bill_reminder_id
  join public.profiles p on p.id = b.user_id
  left join private.bill_reminder_sends s on s.bill_reminder_id = b.id and s.due_date = d.due_date
  where d.due_date - b.days_before = current_date
    and localtime >= b.at_time
    and s.sent_at is null
    and coalesce(s.attempts, 0) < 5;
$$;
revoke execute on function public._bill_reminders_due() from public, anon, authenticated;
grant execute on function public._bill_reminders_due() to service_role;

-- `save_bill_reminder`: avisos repetidos em p_avisos colapsam (distinct).
create or replace function private.save_bill_reminder(p_alvo jsonb, p_avisos jsonb, p_channel text)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_tx uuid := nullif(p_alvo ->> 'transaction_id', '')::uuid;
  v_rec uuid := nullif(p_alvo ->> 'recurring_id', '')::uuid;
  v_plan uuid := nullif(p_alvo ->> 'installment_plan_id', '')::uuid;
  v_debt uuid := nullif(p_alvo ->> 'debt_id', '')::uuid;
  v_no int := nullif(p_alvo ->> 'debt_installment_no', '')::int;
  v_inv uuid := nullif(p_alvo ->> 'invoice_id', '')::uuid;
  v_n int := 0;
  a record;
begin
  if auth.uid() is null then raise exception 'Sem sessão' using errcode = '42501'; end if;
  if num_nonnulls(v_tx, v_rec, v_plan, v_debt, v_inv) <> 1 then
    raise exception 'Escolha um registro para lembrar' using errcode = '22023';
  end if;
  if p_channel not in ('push', 'whatsapp', 'both') then
    raise exception 'Canal inválido' using errcode = '22023';
  end if;

  v_ws := coalesce(
    (select workspace_id from public.transactions where id = v_tx),
    (select workspace_id from public.recurring_transactions where id = v_rec),
    (select workspace_id from public.installment_plans where id = v_plan),
    (select workspace_id from public.debts where id = v_debt),
    (select workspace_id from public.card_invoices where id = v_inv));
  if v_ws is null or v_ws not in (select private.my_workspace_ids()) then
    raise exception 'Esse registro não existe mais' using errcode = 'P0001';
  end if;

  delete from public.bill_reminders b
  where b.workspace_id = v_ws
    and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
    and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
    and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv;

  -- avisos repetidos (mesmos dias e hora) colapsam em um
  for a in select distinct (e ->> 'days_before')::int as db, (e ->> 'at_time')::time as hr
           from jsonb_array_elements(coalesce(p_avisos, '[]'::jsonb)) e loop
    insert into public.bill_reminders (workspace_id, user_id, transaction_id, recurring_id, installment_plan_id,
                                       debt_id, debt_installment_no, invoice_id, days_before, at_time, channel)
    values (v_ws, auth.uid(), v_tx, v_rec, v_plan, v_debt, v_no, v_inv,
            a.db, a.hr, p_channel);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function private.save_bill_reminder(jsonb, jsonb, text) from public, anon;
grant execute on function private.save_bill_reminder(jsonb, jsonb, text) to authenticated;
