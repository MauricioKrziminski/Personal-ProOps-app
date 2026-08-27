-- Plano e assinatura passam a ser propriedade do BACKEND, não do app.
--
-- Como estava: a policy "subscriptions: owner writes" era `for all`, então o dono
-- do workspace podia dar `update` na própria linha — inclusive na coluna `plan`.
-- Isso valia em produção, não só em teste: qualquer assinante poderia se promover
-- para 'family' com uma chamada REST, sem passar por cobrança nenhuma. E os
-- limites que o `process-jobs` checa (private.plan_limits) leem exatamente essa
-- coluna, então eram decorativos enquanto o cliente pudesse reescrevê-la.
--
-- Como fica: o app só LÊ. Quem escreve plano é o webhook do provedor de pagamento
-- (service_role, que ignora RLS) — qualquer que venha a ser o provedor; nada aqui
-- presume Stripe, Asaas, loja de app ou outro.
--
-- Duas travas, de propósito, porque protegem coisas diferentes:
--   1. sem policy de escrita  -> o cliente não escreve NADA nesta tabela;
--   2. trigger por coluna     -> mesmo que uma policy de escrita volte um dia (por
--      um campo inofensivo qualquer), as colunas de cobrança seguem fechadas.

-- 1. o cliente perde a escrita direta (o `select` de membros continua)
drop policy if exists "subscriptions: owner writes" on public.subscriptions;

-- 2. colunas de cobrança são intocáveis para quem chega pelo PostgREST
--
-- O discriminador é `current_user`, não `auth.uid()`: dentro de uma função
-- `security definer` o auth.uid() CONTINUA sendo o do usuário (sai do JWT), então
-- ele não distingue "app" de "backend". Já o current_user vira o dono da função
-- no definer e é `service_role` no webhook — que é exatamente a distinção que
-- queremos.
create or replace function private.guard_subscription_billing()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.plan               is distinct from old.plan
       or new.status             is distinct from old.status
       or new.provider           is distinct from old.provider
       or new.external_id        is distinct from old.external_id
       or new.current_period_end is distinct from old.current_period_end)
  then
    raise exception 'plano e assinatura sao definidos pela cobranca, nao pelo app'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_billing on public.subscriptions;
create trigger guard_billing before update on public.subscriptions
  for each row execute function private.guard_subscription_billing();

-- 3. cancelar continua sendo UMA chamada, sem formulário
--
-- Vira `security definer` porque agora o usuário não tem mais update na tabela —
-- e cancelar é direito dele, não favor nosso. Dificultar cancelamento é a
-- reclamação nº1 contra os concorrentes; a trava de plano não pode virar trava
-- de saída.
create or replace function public.cancel_subscription()
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  ws_id uuid;
begin
  select w.id into ws_id from public.workspaces w
  where w.owner_id = (select auth.uid()) order by w.created_at limit 1;
  if ws_id is null then
    raise exception 'nenhum espaco encontrado';
  end if;

  update public.subscriptions
  set status = 'canceled', canceled_at = now()
  where workspace_id = ws_id;

  return 'cancelado';
end;
$$;
revoke execute on function public.cancel_subscription() from public, anon;
grant execute on function public.cancel_subscription() to authenticated;
