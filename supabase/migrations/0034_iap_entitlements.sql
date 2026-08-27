-- Assinatura por In-App Purchase (App Store + Google Play), via RevenueCat.
--
-- Decisão: a cobrança é SÓ pelas lojas. Não existe checkout web, então não existe
-- link externo no app, nem entitlement de link externo, nem transação a reportar
-- para a Apple. A landing page é informativa ("planos a partir de X, baixe o
-- app") — e landing page não é governada por App Review, só o binário é.
--
-- IMPORTANTE: **o Free NÃO vem da loja.** A loja só avisa compra, renovação,
-- cancelamento, expiração e reembolso. Free é o estado padrão — a ausência de
-- assinatura ativa. Por isso o Free continua funcionando com a loja fora do ar,
-- e ninguém consegue "virar free" de propósito para escapar de um limite.

-- ── 1. o que a loja nos conta sobre a assinatura ────────────────────────────
alter table public.subscriptions
  add column if not exists product_id text,
  add column if not exists environment text,
  add column if not exists is_trial boolean not null default false;

do $guard$
begin
  alter table public.subscriptions
    add constraint subscriptions_environment_check
    check (environment is null or environment in ('production','sandbox'));
exception when duplicate_object then null;
end
$guard$;

-- ANTI-ABUSO: uma compra da loja libera UM workspace, nunca dois. Sem isto,
-- bastaria apontar o mesmo `original_transaction_id` para várias contas e uma
-- assinatura pagaria por todas.
--
-- (Unique parcial de propósito: `external_id` é null enquanto ninguém assinou e
-- no Postgres NULL não colide com NULL. A regra da `0031` sobre unique parcial
-- quebrar `.upsert()` não se aplica: aqui a escrita é SEMPRE por RPC.)
create unique index if not exists subscriptions_provider_external_idx
  on public.subscriptions (provider, external_id)
  where external_id is not null;

-- ── 2. auditoria + idempotência do webhook ──────────────────────────────────
-- A RevenueCat reenvia o evento quando não recebe 2xx. Sem trava, um reenvio de
-- INITIAL_PURCHASE reaplicaria a assinatura; com trava, o segundo vira no-op.
create table if not exists public.billing_events (
  id text primary key,                -- id do evento na RevenueCat
  type text,
  provider text,
  workspace_id uuid references public.workspaces(id) on delete set null,
  result text,
  payload jsonb,
  received_at timestamptz not null default now()
);
create index if not exists billing_events_received_idx
  on public.billing_events (received_at desc);
-- tabela de infra: RLS ligada SEM policies, igual jobs/messages_raw — só service_role
alter table public.billing_events enable row level security;

-- ── 3. plano EFETIVO: expirou, virou free ───────────────────────────────────
-- O buraco que isto fecha: `plan_status_for` lia `plan` e `status` e IGNORAVA
-- `current_period_end`. Um único webhook de EXPIRATION perdido (loja fora do ar,
-- deploy no meio, bug nosso) deixaria a pessoa Pro para sempre. Agora a data
-- manda: o webhook é o caminho feliz, a expiração é a rede de segurança.
create or replace function private.effective_plan(ws_id uuid)
returns text
language sql stable
set search_path = public
as $fn$
  select case
    when s.plan is null then 'free'
    when s.plan = 'free' then 'free'
    when s.status not in ('active','trialing') then 'free'
    when s.current_period_end is not null and s.current_period_end < current_date then 'free'
    else s.plan
  end
  from public.workspaces w
  left join public.subscriptions s on s.workspace_id = w.id
  where w.id = ws_id;
$fn$;

drop function if exists private.plan_status_for(uuid);
create function private.plan_status_for(ws_id uuid)
returns table(
  plan text, status text, current_period_end date, is_trial boolean,
  members int, max_members int,
  ai_messages_month int, max_ai_messages_month int,
  can_import boolean
)
language sql stable
set search_path = public
as $fn$
  with assinatura as (
    select private.effective_plan(ws_id) as plan,
           coalesce(s.plan, 'free') as plan_bruto,
           coalesce(s.status, 'active') as status_bruto,
           s.current_period_end,
           coalesce(s.is_trial, false) as is_trial
    from public.workspaces w
    left join public.subscriptions s on s.workspace_id = w.id
    where w.id = ws_id
  ),
  limites as (select * from private.plan_limits((select plan from assinatura))),
  uso as (
    select (select count(*)::int from public.workspace_members m where m.workspace_id = ws_id) as membros,
           (select count(*)::int from public.ai_events e
             join public.workspace_members m on m.user_id = e.user_id and m.workspace_id = ws_id
            where e.created_at >= date_trunc('month', now())) as mensagens
  )
  select a.plan,
         -- caiu para free tendo plano pago gravado = expirou. A tela precisa
         -- poder dizer isso, senão o usuário acha que perdeu o dinheiro.
         case when a.plan = 'free' and a.plan_bruto <> 'free' then 'expired'
              else a.status_bruto end,
         a.current_period_end, a.is_trial,
         u.membros, l.max_members,
         u.mensagens, l.max_ai_messages_month,
         l.can_import
  from assinatura a, limites l, uso u;
$fn$;

drop function if exists public._plan_status(uuid);
create function public._plan_status(ws_id uuid)
returns table(
  plan text, status text, current_period_end date, is_trial boolean,
  members int, max_members int,
  ai_messages_month int, max_ai_messages_month int,
  can_import boolean
)
language sql stable security definer
set search_path = public
as $fn$
  select * from private.plan_status_for(ws_id);
$fn$;
revoke execute on function public._plan_status(uuid) from public, anon, authenticated;

drop function if exists public.plan_status();
create function public.plan_status()
returns table(
  plan text, status text, current_period_end date, is_trial boolean,
  members int, max_members int,
  ai_messages_month int, max_ai_messages_month int,
  can_import boolean
)
language sql stable
set search_path = public
as $fn$
  select p.* from private.plan_status_for(public.my_default_workspace()) p;
$fn$;

-- ── 4. a única porta de entrada de assinatura ───────────────────────────────
-- Chamada só pela Edge Function `billing-webhook` (service_role). O app NUNCA
-- escreve plano: a `0033` tirou a policy de escrita e o trigger `guard_billing`
-- recusa alteração das colunas de cobrança vinda de authenticated/anon.
create or replace function private.apply_entitlement(
  p_event_id     text,
  p_app_user_id  text,     -- auth.uid() do assinante, enviado à RevenueCat
  p_provider     text,     -- 'apple' | 'google'
  p_external_id  text,     -- original_transaction_id / purchase_token
  p_product_id   text,
  p_plan         text,     -- resolvido em _shared/billing.ts
  p_environment  text,     -- 'production' | 'sandbox'
  p_expires_on   date,
  p_is_trial     boolean,
  p_active       boolean,  -- false = expirou, reembolsou, revogou
  p_payload      jsonb
)
returns text
language plpgsql security definer
set search_path = public
as $fn$
declare
  uid uuid;
  ws uuid;
  resultado text;
begin
  -- Idempotência ANTES de qualquer efeito: reenvio da RevenueCat vira no-op.
  -- Se algo abaixo levantar exceção, a transação inteira volta atrás (inclusive
  -- este insert) e o reenvio reprocessa — que é exatamente o que queremos.
  insert into public.billing_events (id, type, provider, payload)
  values (p_event_id, p_payload->>'type', p_provider, p_payload)
  on conflict (id) do nothing;
  if not found then
    return 'duplicado';
  end if;

  -- SANDBOX NUNCA CONCEDE. É o furo clássico de IAP: com StoreKit Testing ou
  -- conta sandbox dá para gerar compra de graça o dia inteiro.
  if coalesce(p_environment, 'production') <> 'production' then
    resultado := 'sandbox_ignorado';
  elsif p_plan is null or p_plan not in ('pro', 'family') then
    resultado := 'produto_desconhecido';
  else
    begin
      uid := p_app_user_id::uuid;
    exception when others then
      uid := null;
    end;

    if uid is null then
      resultado := 'app_user_id_invalido';
    else
      select w.id into ws from public.workspaces w
      where w.owner_id = uid order by w.created_at limit 1;

      if ws is null then
        resultado := 'workspace_nao_encontrado';
      elsif exists (
        select 1 from public.subscriptions s
        where s.provider = p_provider
          and s.external_id = p_external_id
          and s.workspace_id <> ws
      ) then
        -- mesma compra tentando liberar um segundo workspace
        resultado := 'compra_ja_vinculada';
      else
        update public.subscriptions set
          plan     = case when p_active then p_plan else 'free' end,
          status   = case when not p_active then 'canceled'
                          when coalesce(p_is_trial, false) then 'trialing'
                          else 'active' end,
          provider = p_provider,
          external_id = p_external_id,
          product_id  = p_product_id,
          environment = p_environment,
          is_trial    = coalesce(p_is_trial, false),
          current_period_end = p_expires_on,
          canceled_at = case when p_active then null else now() end
        where workspace_id = ws;

        resultado := case when p_active then 'concedido' else 'revogado' end;
      end if;
    end if;
  end if;

  update public.billing_events
  set workspace_id = ws, result = resultado
  where id = p_event_id;

  return resultado;
end;
$fn$;
revoke execute on function private.apply_entitlement(
  text, text, text, text, text, text, text, date, boolean, boolean, jsonb
) from public, anon, authenticated;

-- ── 5. as colunas novas também são do backend ───────────────────────────────
create or replace function private.guard_subscription_billing()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if current_user in ('authenticated', 'anon')
     and (new.plan               is distinct from old.plan
       or new.status             is distinct from old.status
       or new.provider           is distinct from old.provider
       or new.external_id        is distinct from old.external_id
       or new.current_period_end is distinct from old.current_period_end
       or new.product_id         is distinct from old.product_id
       or new.environment        is distinct from old.environment
       or new.is_trial           is distinct from old.is_trial)
  then
    raise exception 'plano e assinatura sao definidos pela cobranca, nao pelo app'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;
