-- Quem assinou pela loja cancela NA LOJA.
--
-- O bug que isto evita: `cancel_subscription` marcava `status='canceled'` na
-- nossa tabela. Com In-App Purchase isso é pior que não fazer nada — o acesso
-- some aqui e a Apple/Google **continua cobrando**, porque elas não sabem que a
-- pessoa cancelou. O usuário paga por algo que não usa e a culpa parece nossa.
--
-- Agora a RPC recusa quando a assinatura veio de loja, e devolve para onde
-- mandar a pessoa. Só quem não tem `provider` de loja (assinatura concedida
-- manualmente, cortesia, teste) cancela por aqui.
--
-- `plan_status` passa a devolver `provider` para a tela saber montar o botão
-- certo — mesma chamada, sem round-trip novo.

drop function if exists private.plan_status_for(uuid);
create function private.plan_status_for(ws_id uuid)
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
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
           coalesce(s.is_trial, false) as is_trial,
           s.provider
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
         a.current_period_end, a.is_trial, a.provider,
         u.membros, l.max_members,
         u.mensagens, l.max_ai_messages_month,
         l.can_import
  from assinatura a, limites l, uso u;
$fn$;

drop function if exists public._plan_status(uuid);
create function public._plan_status(ws_id uuid)
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
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
  plan text, status text, current_period_end date, is_trial boolean, provider text,
  members int, max_members int,
  ai_messages_month int, max_ai_messages_month int,
  can_import boolean
)
language sql stable
set search_path = public
as $fn$
  select p.* from private.plan_status_for(public.my_default_workspace()) p;
$fn$;

-- Cancelar continua sendo UMA chamada, sem formulário — mas a chamada certa.
create or replace function public.cancel_subscription()
returns text
language plpgsql security definer
set search_path = public
as $fn$
declare
  ws_id uuid;
  loja text;
begin
  select w.id into ws_id from public.workspaces w
  where w.owner_id = (select auth.uid()) order by w.created_at limit 1;
  if ws_id is null then
    raise exception 'nenhum espaco encontrado';
  end if;

  select s.provider into loja from public.subscriptions s where s.workspace_id = ws_id;

  -- Cancelar aqui uma assinatura de loja tiraria o acesso E deixaria a cobrança
  -- rodando. A tela usa este retorno para abrir a tela de assinaturas da loja.
  if loja in ('apple', 'google') then
    return 'cancelar_na_loja:' || loja;
  end if;

  update public.subscriptions
  set status = 'canceled', canceled_at = now()
  where workspace_id = ws_id;

  return 'cancelado';
end;
$fn$;
revoke execute on function public.cancel_subscription() from public, anon;
grant execute on function public.cancel_subscription() to authenticated;
