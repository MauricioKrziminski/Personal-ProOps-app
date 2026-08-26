-- Alertas proativos: orçamento estourando, fatura/conta vencendo e saldo
-- projetado negativo.
--
-- Dedupe por (workspace, tipo, referência, DIA): o cron pode rodar quantas vezes
-- quiser que o usuário recebe cada alerta uma vez por dia. Sem isso, alerta
-- proativo vira spam — e no WhatsApp spam custa template pago.
--
-- A mensagem é sempre ACIONÁVEL. Dizer "estourou o orçamento" sem dizer o que
-- fazer é o que faz o usuário desinstalar no segundo mês (a causa nº1 de churn
-- em PFM, segundo a pesquisa de mercado).

create table if not exists public.alerts_sent (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  ref text not null,
  sent_on date not null default current_date,
  channel text,
  created_at timestamptz not null default now(),
  unique (workspace_id, kind, ref, sent_on)
);
create index if not exists alerts_sent_ws_idx on public.alerts_sent (workspace_id, sent_on desc);
alter table public.alerts_sent enable row level security;
-- infra: só o cron escreve. Leitura own-rows para uma futura tela de histórico.
drop policy if exists "alerts: own rows read" on public.alerts_sent;
create policy "alerts: own rows read" on public.alerts_sent
  for select using (workspace_id in (select private.my_workspace_ids()));

/**
 * Tudo que MERECE um alerta agora, em todos os workspaces.
 * Só devolve; quem envia (e grava `alerts_sent`) é a Edge Function `send-alerts`.
 */
create or replace function public._alerts_to_send()
returns table(
  workspace_id uuid, user_id uuid, phone text, expo_push_token text,
  kind text, ref text, title text, body text
)
language sql stable security definer
set search_path = public
as $$
  with donos as (
    select w.id as workspace_id, w.owner_id as user_id, p.phone, p.expo_push_token, p.timezone
    from public.workspaces w
    join public.profiles p on p.id = w.owner_id
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
  select * from orcamento
  union all select * from fatura
  union all select * from conta
  union all select * from vermelho;
$$;
revoke execute on function public._alerts_to_send() from public, anon, authenticated;
