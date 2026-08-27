-- `apply_entitlement` muda de schema: `private` -> `public._apply_entitlement`.
--
-- Motivo: o PostgREST não expõe o schema `private` (é exatamente por isso que os
-- helpers de RLS moram lá desde a `0012`). Só que a Edge Function `billing-webhook`
-- chama por `supabase.rpc()`, ou seja, PELO PostgREST — então a função precisa
-- estar em `public`, com o prefixo `_` da convenção de função interna e com
-- execute revogado de todo mundo que não seja o service_role.
--
-- Mesmo padrão de `_plan_status`, `_tx_summary` e companhia.

create or replace function public._apply_entitlement(
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

revoke execute on function public._apply_entitlement(
  text, text, text, text, text, text, text, date, boolean, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public._apply_entitlement(
  text, text, text, text, text, text, text, date, boolean, boolean, jsonb
) to service_role;

drop function if exists private.apply_entitlement(
  text, text, text, text, text, text, text, date, boolean, boolean, jsonb
);
