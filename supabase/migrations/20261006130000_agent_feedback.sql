-- Ciclo de dados do agente (auditoria 06/10/2026, seção 9) e memória de apelidos de conta (8.4).
--
-- `agent_feedback`: todo HITL é um rótulo de graça. Quando uma pergunta de confirmação é RESOLVIDA
-- (SIM, NÃO, correção antes do SIM, ou expirou), o agente grava uma linha com o texto da pessoa
-- (já sanitizado), a proposta, a frase do SIM, o desfecho e as versões de prompt/modelos que
-- geraram a proposta. É o insumo das métricas de qualidade (`private.agent_quality`), de um golden
-- set que cresce sozinho e, bem mais adiante, de ajuste supervisionado.
--
-- O texto, a proposta e as versões moram em `pending_actions.action -> 'feedback'`, gravados NO
-- MOMENTO DA PERGUNTA (é o único instante em que o turno que propôs ainda está à mão). A expiração
-- por tempo acontece só aqui no banco (`expire_pending_actions`), por isso a função grava a linha
-- de feedback ela mesma.
--
-- `account_aliases`: apelido de conta aprendido da conversa ("roxinho" = Nubank Cartão). Dado
-- tipado, listável e apagável no app; escrita só pelo serviço.

-- ---------------------------------------------------------------------------
-- agent_feedback
-- ---------------------------------------------------------------------------
create table public.agent_feedback (
  id uuid primary key default gen_random_uuid(),
  -- a pergunta que originou o feedback; unique impede contar a mesma duas vezes (retry, corrida)
  pending_id uuid unique,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  channel text not null check (channel in ('whatsapp', 'app')),
  source_message_id text,
  input_text text not null default '',
  proposal jsonb not null default '[]'::jsonb,
  summary text,
  outcome text not null check (outcome in ('approved', 'rejected', 'revised', 'expired')),
  revised_to jsonb,
  prompt_versions jsonb not null default '{}'::jsonb,
  models jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.agent_feedback enable row level security;
-- sem policy: só o serviço (papel que ignora RLS) lê e escreve
revoke all on public.agent_feedback from public, anon, authenticated;

create index agent_feedback_workspace_created_idx
  on public.agent_feedback (workspace_id, created_at);

comment on table public.agent_feedback is
  'Rótulo de cada HITL resolvido: texto sanitizado, proposta, desfecho, versões de prompt e modelos. Retenção de 180 dias (cron /alerts).';

-- ---------------------------------------------------------------------------
-- expire_pending_actions: o corpo é o da 0040 + a gravação do feedback `expired`
-- ---------------------------------------------------------------------------
-- `create or replace` apaga toda cláusula não repetida: assinatura, security definer, search_path
-- e o revoke abaixo são os da 0040.
create or replace function public.expire_pending_actions(p_thread_id text default null)
returns int
language sql
security definer
set search_path = public
as $$
  with expirados as (
    update public.pending_actions
    set status = 'expired', resolved_at = now()
    where status = 'awaiting'
      and expires_at < now()
      and (p_thread_id is null or thread_id = p_thread_id)
    returning id, workspace_id, user_id, summary, action
  ),
  rotulos as (
    insert into public.agent_feedback
      (pending_id, workspace_id, user_id, channel, source_message_id, input_text, proposal,
       summary, outcome, prompt_versions, models)
    select e.id, e.workspace_id, e.user_id,
           coalesce(nullif(e.action #>> '{feedback,channel}', ''), 'whatsapp'),
           e.action #>> '{feedback,source_message_id}',
           coalesce(e.action #>> '{feedback,input_text}', ''),
           coalesce(e.action #> '{feedback,proposal}', '[]'::jsonb),
           e.summary, 'expired',
           coalesce(e.action #> '{feedback,prompt_versions}', '{}'::jsonb),
           coalesce(e.action #> '{feedback,models}', '{}'::jsonb)
    from expirados e
    where e.workspace_id is not null and e.action ? 'feedback'
    on conflict (pending_id) do nothing
    returning 1
  )
  select count(*)::int from expirados;
$$;

revoke execute on function public.expire_pending_actions(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- métricas de qualidade do produto
-- ---------------------------------------------------------------------------
-- Uma linha por (dimensão, chave): `geral`, `tipo_acao` (tipo da primeira ação da proposta) e
-- `versao_prompt` (`nó=versão`, uma por entrada de `prompt_versions`). As taxas são sobre o total
-- da linha. `aprovacao_de_primeira` = aprovadas / total; `correcao` = corrigidas antes do SIM.
create or replace function private.agent_quality(p_de date, p_ate date)
returns table(
  dimensao text, chave text, total int,
  aprovadas int, corrigidas int, recusadas int, expiradas int,
  taxa_aprovacao numeric, taxa_correcao numeric, taxa_recusa numeric, taxa_expiracao numeric
)
language sql stable security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $fn$
  with base as (
    select f.outcome,
           coalesce(f.proposal -> 0 ->> 'type', 'desconhecido') as tipo,
           f.prompt_versions
    from public.agent_feedback f
    where f.created_at >= p_de::timestamp
      and f.created_at < (p_ate + 1)::timestamp
  ),
  linhas as (
    select 'geral'::text as dimensao, 'todas'::text as chave, outcome from base
    union all
    select 'tipo_acao', tipo, outcome from base
    union all
    select 'versao_prompt', v.key || '=' || v.value, b.outcome
    from base b, lateral pg_catalog.jsonb_each_text(b.prompt_versions) v
  ),
  somas as (
    select dimensao, chave,
           count(*)::int as total,
           (count(*) filter (where outcome = 'approved'))::int as aprovadas,
           (count(*) filter (where outcome = 'revised'))::int as corrigidas,
           (count(*) filter (where outcome = 'rejected'))::int as recusadas,
           (count(*) filter (where outcome = 'expired'))::int as expiradas
    from linhas
    group by dimensao, chave
  )
  select dimensao, chave, total, aprovadas, corrigidas, recusadas, expiradas,
         pg_catalog.round(aprovadas::numeric / total, 4),
         pg_catalog.round(corrigidas::numeric / total, 4),
         pg_catalog.round(recusadas::numeric / total, 4),
         pg_catalog.round(expiradas::numeric / total, 4)
  from somas
  order by dimensao, total desc, chave;
$fn$;

revoke execute on function private.agent_quality(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- unit economics: custo de IA por workspace no mês
-- ---------------------------------------------------------------------------
-- Só turnos de verdade (`kind = 'turn'`, fora a reserva em voo). `turnos_sem_custo` conta os que
-- usaram modelo sem preço na tabela do agente (custo null): somar só o que se conhece
-- subestimaria em silêncio, então o número aparece ao lado do custo.
create or replace function private.ai_unit_economics(p_mes date)
returns table(
  workspace_id uuid, plano text, turnos int, turnos_sem_custo int,
  custo_usd numeric, custo_medio_turno_usd numeric
)
language sql stable security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $fn$
  select e.workspace_id,
         private.effective_plan(e.workspace_id),
         count(*)::int,
         (count(*) filter (where e.estimated_cost_usd is null))::int,
         coalesce(sum(e.estimated_cost_usd), 0)::numeric(14, 6),
         (coalesce(sum(e.estimated_cost_usd), 0)
            / nullif(count(*) filter (where e.estimated_cost_usd is not null), 0))::numeric(14, 6)
  from public.ai_events e
  where e.kind = 'turn'
    and not e.reserved
    and e.workspace_id is not null
    and e.created_at >= pg_catalog.date_trunc('month', p_mes::timestamp)
    and e.created_at <  pg_catalog.date_trunc('month', p_mes::timestamp) + interval '1 month'
  group by e.workspace_id
  order by 5 desc;
$fn$;

revoke execute on function private.ai_unit_economics(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- account_aliases
-- ---------------------------------------------------------------------------
create table public.account_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  -- normalizado pelo agente (`matching.normalize`): sem acento, minúsculo, sem pontuação
  alias text not null check (alias <> '' and alias = pg_catalog.btrim(alias) and alias = pg_catalog.lower(alias)),
  created_at timestamptz not null default now(),
  unique (workspace_id, alias)
);

create index account_aliases_account_idx on public.account_aliases (account_id);

alter table public.account_aliases enable row level security;

-- membro lê e APAGA os apelidos do espaço dele; criar/alterar é só do serviço
create policy "account_aliases: members read" on public.account_aliases
  for select using (workspace_id in (select private.my_workspace_ids()));
create policy "account_aliases: members delete" on public.account_aliases
  for delete using (workspace_id in (select private.my_workspace_ids()));

revoke all on public.account_aliases from public, anon, authenticated;
grant select, delete on public.account_aliases to authenticated;

comment on table public.account_aliases is
  'Apelido de conta aprendido da conversa (roxinho = Nubank Cartão). O app lista e remove; só o agente cria.';

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'account_aliases') then
    alter publication supabase_realtime add table public.account_aliases;
  end if;
end $$;
