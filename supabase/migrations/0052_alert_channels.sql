-- =============================================================================
-- Fase 8 — canais independentes para avisos proativos automáticos
-- =============================================================================
--
-- Telefone e expo_push_token são capacidades. Nenhum deles autoriza o sistema
-- a interromper a pessoa. Perfis atuais e novos começam com os dois canais
-- desligados e cada entrega é deduplicada separadamente.

alter table public.profiles
  add column if not exists alerts_push_enabled boolean not null default false,
  add column if not exists alerts_whatsapp_enabled boolean not null default false;

comment on column public.profiles.alerts_push_enabled is
  'Consentimento para avisos financeiros automáticos por push. Não controla lembretes pessoais.';
comment on column public.profiles.alerts_whatsapp_enabled is
  'Consentimento para avisos financeiros automáticos por WhatsApp. Não controla lembretes pessoais.';

-- Compatibilidade com o APK 1.0.0: a coluna antiga continua existindo para que
-- o cliente publicado não quebre, mas deixa de participar da decisão do cron.
update public.profiles set alerts_enabled = false where alerts_enabled;
alter table public.profiles alter column alerts_enabled set default false;
comment on column public.profiles.alerts_enabled is
  'Obsoleto desde a Fase 8. Mantido temporariamente para clientes antigos; o cron ignora.';

-- Antes só cabia uma linha por aviso/dia. Agora push e WhatsApp precisam ocupar
-- reservas diferentes para que uma duplicata em um canal não bloqueie o outro.
update public.alerts_sent set channel = 'legacy' where channel is null;
alter table public.alerts_sent
  alter column channel set not null,
  drop constraint if exists alerts_sent_workspace_id_kind_ref_sent_on_key,
  drop constraint if exists alerts_sent_workspace_kind_ref_day_channel_key;
alter table public.alerts_sent
  add constraint alerts_sent_workspace_kind_ref_day_channel_key
  unique (workspace_id, kind, ref, sent_on, channel);

comment on column public.alerts_sent.channel is
  'Canal realmente reservado para a entrega: push, whatsapp ou legacy em histórico antigo.';
comment on table public.alerts_sent is
  'Histórico das entregas de avisos proativos automáticos, separado por canal.';

-- A assinatura muda porque os emissores precisam receber as duas preferências.
-- O corpo é a definição vigente da 0049, com somente as flags propagadas e o
-- filtro geral substituído pelo consentimento por canal.
drop function if exists public._alerts_to_send();

create function public._alerts_to_send()
returns table(
  workspace_id uuid, user_id uuid, phone text, expo_push_token text,
  alerts_push_enabled boolean, alerts_whatsapp_enabled boolean,
  kind text, ref text, title text, body text
)
language sql stable security definer
set search_path = public
as $fn$
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
  orcamento as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
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
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
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
  select * from teste
  union all select * from orcamento
  union all select * from fatura
  union all select * from conta
  union all select * from vermelho;
$fn$;

revoke execute on function public._alerts_to_send() from public, anon, authenticated;
