-- Contabilidade de tokens por turno e reserva atômica da cota de IA.
--
-- `ai_events.input_tokens/output_tokens` existem desde a 0001 e nunca foram preenchidos. Agora o
-- agente grava o uso real (lido do `usage_metadata` de cada resposta): tokens de entrada, saída,
-- cacheados e de raciocínio, o custo estimado (US$) e o detalhamento por chamada (nó, MODELO que
-- de fato respondeu, versão do prompt, tokens). Tudo nullable: linha antiga e turno sem medição
-- seguem válidos, e custo de modelo sem preço na tabela do agente fica null, nunca chutado.
--
-- `kind` separa o que conta como "mensagem de IA" do plano (`turn`, uma linha por turno que
-- chamou o modelo — como sempre foi) do que só protege o custo contra rajada: a transcrição de
-- áudio do app (`transcription`) e a importação de extrato (`import`). Estas últimas entram na
-- contagem HORÁRIA do usuário, mas NÃO na cota mensal do plano: um áudio vira um turno depois, e
-- contar os dois cobraria a mesma mensagem duas vezes.
--
-- `reserved` marca a linha que `check_limits` insere sob lock ANTES do turno (N conversas em
-- paralelo passavam juntas pela mesma contagem). O fim do turno a completa com o uso real
-- (`reserved = false`) ou a apaga se o turno não chamou o modelo; a que sobrar por queda do
-- processo é apagada pelo próximo `check_limits` do workspace depois de alguns minutos.

alter table public.ai_events
  add column cached_tokens int,
  add column reasoning_tokens int,
  add column estimated_cost_usd numeric(12, 6),
  add column calls jsonb,
  add column kind text not null default 'turn',
  add column reserved boolean not null default false,
  add constraint ai_events_kind_check check (kind in ('turn', 'transcription', 'import'));

create index ai_events_reserved_idx
  on public.ai_events (workspace_id, created_at)
  where reserved;

comment on column public.ai_events.estimated_cost_usd is
  'Custo estimado em US$ (tabela de preços do agente); null se algum modelo não tem preço.';
comment on column public.ai_events.calls is
  'Uma entrada por chamada de modelo: papel, nó, modelo real, versão do prompt, tokens, custo.';
comment on column public.ai_events.kind is
  'turn = mensagem de IA do plano; transcription/import só entram no limite por hora.';

-- A cota mensal passa a contar só `kind = 'turn'`. O resto da função é o da 0054.
create or replace function private.plan_status_for(ws_id uuid)
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
  members int, max_members int,
  ai_messages_month int, ai_messages_whatsapp int, ai_messages_app int,
  max_ai_messages_month int, can_import boolean
)
language sql stable
set search_path = ''
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
    select
      (select count(*)::int from public.workspace_members m
       where m.workspace_id = ws_id) as membros,
      count(e.id)::int as mensagens,
      count(e.id) filter (where e.channel = 'whatsapp')::int as mensagens_whatsapp,
      count(e.id) filter (where e.channel = 'app')::int as mensagens_app
    from public.ai_events e
    where e.workspace_id = ws_id
      and e.kind = 'turn'
      and e.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
  )
  select a.plan,
         case when a.plan = 'free' and a.plan_bruto <> 'free' then 'expired'
              else a.status_bruto end,
         a.current_period_end, a.is_trial, a.provider,
         u.membros, l.max_members,
         u.mensagens, u.mensagens_whatsapp, u.mensagens_app,
         l.max_ai_messages_month, l.can_import
  from assinatura a, limites l, uso u;
$fn$;
