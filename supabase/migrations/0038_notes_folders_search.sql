-- Notas: pastas, tags derivadas, busca em português e lixeira.
--
-- PURAMENTE ADITIVA. `notes.category` NÃO é dropada aqui: o binário instalado cita a coluna
-- nominalmente (`src/hooks/use-items.ts:56`) e o drop derrubaria a aba Notas com 42703 em quem
-- não atualizou. Durante a transição o executor do WhatsApp grava `folder_id` E `category`.
-- O drop vira a 0039, adiada até a adoção.
--
-- ⚠️ ROLLOUT: o binário antigo não filtra `deleted_at is null` e apaga hard (`use-items.ts:117`).
-- Nota mandada para a lixeira por um cliente novo continua visível no antigo até a purga. É
-- consequência aceita da mesma transição, não bug.
--
-- ⚠️ Trocar o regex de `note_tags_of` (ou o dicionário do unaccent) depois NÃO recalcula linhas
-- antigas — coluna gerada só recomputa em write. Para reprocessar:
--   update public.notes set content = content;

-- ── pastas ──────────────────────────────────────────────────────────────────
create table if not exists public.note_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_default_workspace()
    references public.workspaces(id) on delete cascade,
  -- SEM `default auth.uid()`: sob service_role (Edge Function) auth.uid() é null e o not null
  -- estouraria 23502. Todo o resto do repo declara user_id sem default, sempre explícito.
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- A normalização é constraint, não convenção: é o unique COMPLETO (não parcial, não de
  -- expressão) que mantém o .upsert() do PostgREST legal — índice de expressão cairia no 42P10.
  -- Sem este check, um upsert com "Trabalho" criaria duplicata de "trabalho".
  name text not null
    check (name = lower(trim(name)) and char_length(name) between 1 and 40),
  -- nome de SF Symbol (expo-symbols). NUNCA emoji: a regra de design proíbe emoji na chrome.
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

alter table public.note_folders enable row level security;

drop policy if exists "workspace rows" on public.note_folders;
create policy "workspace rows" on public.note_folders
  for all using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));

drop trigger if exists set_updated_at on public.note_folders;
create trigger set_updated_at before update on public.note_folders
  for each row execute function extensions.moddatetime(updated_at);

-- ── colunas simples em notes ────────────────────────────────────────────────
alter table public.notes
  -- set null: apagar pasta NUNCA apaga nota
  add column if not exists folder_id uuid references public.note_folders(id) on delete set null,
  add column if not exists pinned boolean not null default false,
  add column if not exists deleted_at timestamptz;

-- ── pré-requisitos das colunas geradas ──────────────────────────────────────
-- Tudo o que as colunas geradas precisam nasce ANTES delas, para as duas entrarem num único
-- `alter table` — cada `add column ... generated ... stored` reescreve a tabela inteira.

create or replace function public.note_tags_of(txt text)
returns text[]
language sql
immutable
parallel safe
set search_path = public
as $$
  -- `order by 1`: array_agg(distinct) não garante ordem por especificação, e isto alimenta uma
  -- coluna gerada declarada immutable.
  select coalesce(array_agg(distinct lower(m[1]) order by lower(m[1])), '{}')
  from regexp_matches(coalesce(txt, ''), '#([[:alnum:]_]{2,30})', 'g') m;
$$;

-- `unaccent` faz "reuniao" (como se digita no celular) achar "reunião" — sem ele metade das
-- buscas do brasileiro falha em silêncio. `portuguese_stem` colapsa plural regular
-- (casas→casa, mercados→mercado).
--
-- MEDIDO no Postgres, não suposto: o stemmer NÃO colapsa a alternância ão/ões — "reuniões" não
-- acha "reunião". Isso não é efeito do unaccent: `portuguese` puro erra igual, e ainda por cima
-- sem insensibilidade a acento. Ou seja, `pt_unaccent` é estritamente melhor; só não prometa
-- plural irregular.
create extension if not exists unaccent with schema extensions;

do $$
begin
  if not exists (
    select 1 from pg_ts_config
    where cfgname = 'pt_unaccent'
      and cfgnamespace = 'public'::regnamespace
  ) then
    create text search configuration public.pt_unaccent (copy = portuguese);
    alter text search configuration public.pt_unaccent
      alter mapping for hword, hword_part, word
      with extensions.unaccent, portuguese_stem;
  end if;
end $$;

-- ── colunas geradas: um rewrite só ──────────────────────────────────────────
-- to_tsvector na forma de DOIS argumentos com regconfig qualificado: é o que a torna IMMUTABLE,
-- requisito de coluna gerada, e independente de search_path.
alter table public.notes
  add column if not exists tags text[]
    generated always as (public.note_tags_of(content)) stored,
  add column if not exists search_tsv tsvector
    generated always as (
      to_tsvector('public.pt_unaccent'::regconfig, coalesce(content, ''))
    ) stored;

create index if not exists notes_tags_idx on public.notes using gin (tags);
create index if not exists notes_search_idx on public.notes using gin (search_tsv);

-- ── backfill: category vira pasta ───────────────────────────────────────────
-- `left(..., 40)` nos DOIS lados: `notes.category` é texto livre gravado pelo Gemini sem clamp
-- (`process-jobs/index.ts:751`). Uma categoria longa estouraria o check e derrubaria a migration
-- inteira — e truncar só no insert deixaria essas notas sem link. Colisões de truncamento são
-- absorvidas pelo `on conflict do nothing` e pelo join por nome.
insert into public.note_folders (workspace_id, user_id, name)
select distinct on (n.workspace_id, left(lower(trim(n.category)), 40))
       n.workspace_id, n.user_id, left(lower(trim(n.category)), 40)
from public.notes n
where coalesce(trim(n.category), '') <> ''
order by n.workspace_id, left(lower(trim(n.category)), 40), n.created_at
on conflict (workspace_id, name) do nothing;

-- `notes` tem o trigger set_updated_at (0011:214) e `extensions.moddatetime` sobrescreve
-- NEW.updated_at INCONDICIONALMENTE — um `set updated_at = n.updated_at` no próprio update não
-- resolveria. Sem desligar, toda nota categorizada colapsaria para o timestamp da migration e a
-- ordenação da feature (notes_ws_list_idx, por updated_at desc) viraria lixo, sem volta.
alter table public.notes disable trigger set_updated_at;

update public.notes n
   set folder_id = f.id
  from public.note_folders f
 where f.workspace_id = n.workspace_id
   and f.name = left(lower(trim(n.category)), 40)
   and n.folder_id is null;

alter table public.notes enable trigger set_updated_at;

-- ── índices de leitura ──────────────────────────────────────────────────────
-- Índice PARCIAL de leitura é seguro: a armadilha do 42P10 é de unique parcial, não deste.
create index if not exists notes_ws_list_idx
  on public.notes (workspace_id, pinned desc, updated_at desc)
  where deleted_at is null;

create index if not exists notes_trash_idx
  on public.notes (deleted_at)
  where deleted_at is not null;

-- FK `on delete set null` sem índice = seq scan em notes a cada pasta apagada. Sem o filtro de
-- lixeira de propósito: o set null também precisa alcançar nota que está na lixeira.
create index if not exists notes_folder_idx
  on public.notes (folder_id)
  where folder_id is not null;

-- ── contagens para os chips de pasta e de tag ───────────────────────────────
-- security invoker com query inline, sob RLS. Não usam o padrão duplo _nome(uid)+wrapper porque
-- nenhuma Edge Function os chama (precedente: save_budget, 0031).
create or replace function public.note_folder_counts()
returns table (folder_id uuid, notes_count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select n.folder_id, count(*)::bigint
  from public.notes n
  where n.deleted_at is null
    and n.workspace_id in (select private.my_workspace_ids())
  group by n.folder_id;
$$;

create or replace function public.note_tag_counts()
returns table (tag text, notes_count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select t.tag, count(*)::bigint
  from public.notes n, unnest(n.tags) as t(tag)
  where n.deleted_at is null
    and n.workspace_id in (select private.my_workspace_ids())
  group by t.tag
  order by 2 desc, 1;
$$;

-- ── realtime ────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'note_folders'
  ) then
    alter publication supabase_realtime add table public.note_folders;
  end if;
end $$;

-- ── purga da lixeira aos 30 dias ────────────────────────────────────────────
-- SQL puro: um delete não precisa de HTTP, e pendurar isso no finance-scheduler seria acoplar
-- limpeza de nota a uma function financeira.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-trashed-notes') then
    perform cron.unschedule('purge-trashed-notes');
  end if;
end $$;

select cron.schedule(
  'purge-trashed-notes',
  '17 4 * * *',
  $$delete from public.notes where deleted_at < now() - interval '30 days'$$
);
