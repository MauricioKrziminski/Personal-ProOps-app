-- Aviso de fim de teste grátis, 2 dias antes.
--
-- A loja cuida da mecânica do trial (elegibilidade, contagem, cobrança no dia 8),
-- mas ela não manda a SUA mensagem. A Apple manda um e-mail genérico dela; quem
-- fala com o usuário no canal que ele realmente usa — o WhatsApp — somos nós.
--
-- Duas razões para isso existir, nesta ordem:
--
-- 1. **Não ser cobrança-surpresa.** "Fui cobrado sem saber" é pedido de
--    reembolso, avaliação de 1 estrela e chargeback. Avisar antes custa uma
--    mensagem e evita os três.
-- 2. Conversão. Lembrar do que a pessoa construiu no teste converte muito mais
--    que um aviso seco de vencimento — por isso o corpo cita quantos lançamentos
--    ela registrou.
--
-- A mensagem diz explicitamente COMO cancelar. Parece contraintuitivo num aviso
-- de cobrança, mas é a mesma aposta do resto do produto: dificultar cancelamento
-- é a reclamação nº1 contra os concorrentes no Reclame Aqui. Quem se sente preso
-- cancela e xinga; quem se sente livre costuma ficar.
--
-- Dispara UMA vez, em `current_period_end - 2` (dia 5 de um teste de 7). O
-- dedupe de `alerts_sent` é por (workspace, kind, ref, dia) e o `ref` é a data de
-- vencimento, então nem o cron rodando várias vezes nem um trial renovado
-- duplicam o aviso.

create or replace function public._alerts_to_send()
returns table(
  workspace_id uuid, user_id uuid, phone text, expo_push_token text,
  kind text, ref text, title text, body text
)
language sql stable security definer
set search_path = public
as $fn$
  with donos as (
    select w.id as workspace_id, w.owner_id as user_id, p.phone, p.expo_push_token, p.timezone
    from public.workspaces w
    join public.profiles p on p.id = w.owner_id
  ),
  teste as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
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
  orcamento as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           case when b.spent_cents >= b.limit_cents then 'budget_100' else 'budget_80' end as kind,
           b.category as ref,
           case when b.spent_cents >= b.limit_cents
                then 'Orcamento estourado'
                else 'Orcamento no limite' end as title,
           case when b.spent_cents >= b.limit_cents
                then 'Voce ja gastou ' || round(b.spent_cents::numeric / 100, 2)
                     || ' de ' || round(b.limit_cents::numeric / 100, 2)
                     || ' em ' || b.category || '. Quer que eu remaneje de outra categoria?'
                else 'Voce ja usou ' || round(100.0 * b.spent_cents / b.limit_cents)
                     || '% do orcamento de ' || b.category
                     || '. Faltam ' || round((b.limit_cents - b.spent_cents)::numeric / 100, 2)
                     || ' ate o fim do mes.' end as body
    from donos d
    cross join lateral private.budgets_status_for(array[d.workspace_id], current_date) b
    where b.limit_cents > 0 and b.spent_cents >= b.limit_cents * 0.8
  ),
  fatura as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           'invoice_due' as kind, ci.id::text as ref,
           'Fatura do ' || a.name as title,
           'Fatura de ' || round(coalesce(sum(t.amount_cents), 0)::numeric / 100, 2)
             || ' vence em ' || to_char(ci.due_date, 'DD/MM')
             || '. Ja pagou? Me manda "paguei a fatura do ' || a.name || '".' as body
    from donos d
    join public.card_invoices ci on ci.workspace_id = d.workspace_id and ci.status <> 'paid'
    join public.accounts a on a.id = ci.account_id
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.due_date <= current_date + 3
    group by d.workspace_id, d.user_id, d.phone, d.expo_push_token, ci.id, ci.due_date, a.name
  ),
  conta as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
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
  vermelho as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
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
  -- `teste` vem PRIMEIRO de propósito: o teto de 4 alertas por usuário na
  -- Edge Function corta pelo fim da lista, e este é o único que tem prazo.
  select * from teste
  union all select * from orcamento
  union all select * from fatura
  union all select * from conta
  union all select * from vermelho;
$fn$;
revoke execute on function public._alerts_to_send() from public, anon, authenticated;
