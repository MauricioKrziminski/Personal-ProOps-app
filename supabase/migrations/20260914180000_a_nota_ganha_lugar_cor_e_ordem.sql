-- A nota ganha LUGAR, COR e ORDEM — e a pasta deixa de ser um filtro.
--
-- Até aqui a organização de nota era: pasta como chip de filtro, ordem fixa em
-- `pinned desc, updated_at desc`, e nenhuma cor. `docs/design/notas.md:66` dizia literalmente
-- «sem cor por nota, sem ordenação manual». As duas decisões são revertidas aqui a pedido do dono
-- do produto, e o motivo está escrito lá.
--
-- O que entra:
--   notes         → color, archived_at, position
--   note_folders  → color, archived_at, position, pinned, tags
--
-- ⚠️ **A cor guardada é NOME DE TOKEN, nunca hex.** Hex no banco seria cor fora de
-- `src/constants/theme.ts` — exatamente o que o `anti-slop.test.ts` existe para impedir, só que
-- invisível para ele, porque ele lê o repositório e não o banco. O par claro/escuro de cada nome
-- mora em `NoteColors`, e o CHECK aqui é o que impede o app de gravar um nome que não existe lá.
--
-- ⚠️ **ROLLOUT — o APK instalado não conhece `archived_at`.** `useNotesList` filtra só
-- `deleted_at`, então até o app novo sair: a nota arquivada CONTINUA na lista, enquanto
-- `note_folder_counts` (redefinida no fim deste arquivo) já a exclui — o ladrilho da pasta diz 3
-- e a lista mostra 4. É a mesma assimetria que a `0038` documentou para `deleted_at`. Suba a
-- mudança do app na mesma release, ou espere o OTA antes de alguém arquivar alguma coisa.
--
-- ⚠️ **Tag de pasta usa o MESMO namespace da tag de nota.** `notes.tags` é coluna GERADA do
-- `#hashtag` do texto (`public.note_tags_of`); pasta não tem texto, então precisa de coluna de
-- verdade — mas com a mesma forma, senão `#casa` numa nota e `casa` numa pasta viram duas coisas
-- e o chip da tela filtra metade.

-- ── notes ───────────────────────────────────────────────────────────────────
alter table public.notes
  add column if not exists color       text,
  add column if not exists archived_at timestamptz,
  add column if not exists position    double precision;

comment on column public.notes.color is
  'Nome de token de NoteColors (src/constants/theme.ts). Nunca hex.';
comment on column public.notes.archived_at is
  'Arquivada (some das listas, continua existindo). Espelha deleted_at: o "quando" vem de graça.';
comment on column public.notes.position is
  'Ordem manual dentro do escopo (fixadas / soltas / dentro de uma pasta). null = nunca arrastada.';

-- ── note_folders ────────────────────────────────────────────────────────────
alter table public.note_folders
  add column if not exists color       text,
  add column if not exists archived_at timestamptz,
  add column if not exists position    double precision,
  add column if not exists pinned      boolean not null default false,
  add column if not exists tags        text[]  not null default '{}';

-- ── validação de tag de pasta ───────────────────────────────────────────────
-- CHECK **não aceita subconsulta**, então a validação vira função. `immutable` é requisito para
-- entrar num CHECK, e é verdade aqui: é regex pura sobre o argumento.
--
-- Fica em `public` e NÃO em `private`: o CHECK roda com o papel de quem escreve, e `authenticated`
-- não tem `execute` em `private` — em `private` toda escrita de pasta morreria com 42501.
--
-- ⚠️ **A forma é a que o banco GERA, não a que o app digita.** `note_tags_of` (`0038:68`) extrai
-- com `#([[:alnum:]_]{2,30})`, e `[[:alnum:]]` casa letra acentuada num banco UTF-8 — medido:
-- `#reunião` numa nota gera a tag `reunião`. Com um CHECK em `^[a-z0-9_]{2,30}$` a MESMA tag
-- seria recusada na pasta com 23514, e o chip da tela filtraria metade — exatamente o defeito que
-- ter um namespace só existe para impedir. O `lower()` reproduz o `lower(m[1])` da `0038`.
--
-- (O app é mais restrito que isto: `TAG_RE` em `src/lib/search.ts` é ASCII, então o seletor nunca
-- OFERECE `reunião`. Ele só precisa não EXPLODIR quando a tag vem de uma nota ou do agente.)
create or replace function public.note_tags_valid(p_tags text[])
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select coalesce(bool_and(t = lower(t) and t ~ '^[[:alnum:]_]{2,30}$'), true)
  from unnest(p_tags) t;
$$;

revoke execute on function public.note_tags_valid(text[]) from public, anon;
grant execute on function public.note_tags_valid(text[]) to authenticated, service_role;

-- ── constraints (add constraint NÃO é idempotente) ──────────────────────────
-- `pg_constraint.conname` é único por RELAÇÃO, não global: sem o `conrelid` a guarda mascararia
-- uma colisão de nome e a constraint nasceria ausente, sem erro nenhum.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.notes'::regclass and conname = 'notes_color_ck') then
    alter table public.notes add constraint notes_color_ck
      check (color is null or color in
        ('grafite','oceano','violeta','magenta','terra','mostarda','musgo','turquesa'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.note_folders'::regclass
                    and conname = 'note_folders_color_ck') then
    alter table public.note_folders add constraint note_folders_color_ck
      check (color is null or color in
        ('grafite','oceano','violeta','magenta','terra','mostarda','musgo','turquesa'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.note_folders'::regclass
                    and conname = 'note_folders_tags_ck') then
    alter table public.note_folders add constraint note_folders_tags_ck
      check (public.note_tags_valid(tags));
  end if;
end $$;

-- ── REORDENAR NÃO PODE MEXER EM updated_at ──────────────────────────────────
-- `extensions.moddatetime` sobrescreve NEW.updated_at INCONDICIONALMENTE — a `0038` precisou
-- desligar o trigger para fazer backfill por causa disso (linhas 126/135). Sem a trava, arrastar
-- uma nota mudaria o "há 2 dias" do cartão e a ordem do modo Recentes: número errado, sem erro.
--
-- A cláusula WHEN pula o trigger quando `position` MUDOU. Ela sozinha não basta — a outra metade
-- é o `position is distinct from` dentro da RPC, que impede a linha que NÃO mudou de slot de ser
-- escrita com o mesmo valor (ali o WHEN seria verdadeiro e o trigger dispararia).
--
-- ⚠️ **REGRA PARA QUEM ESCREVE O APP: `position` nunca viaja no mesmo `.update()` que outra
-- coluna.** Um UPDATE que mude `position` E outra coluna na mesma instrução não atualiza
-- `updated_at` — e o caso que vai tentar isso é concreto: mover a nota de pasta zerando o slot
-- ("mudou de escopo, perde a posição") caberia num `.update({ folder_id, position: null })`,
-- e ali o `updated_at` pararia de subir, sem erro. Limpar slot é uma segunda chamada, ou é a
-- própria `notes_reorder`.
--
-- (Não trocar por plpgsql comparando `to_jsonb(new)` com `to_jsonb(old)`: `notes` tem duas
-- colunas `generated always ... stored` — `tags` e `search_tsv` — que num trigger BEFORE ainda
-- não estão calculadas em NEW. A comparação acusaria diferença em TODO update e desligaria a
-- trava em silêncio, que é pior que o buraco acima.)
drop trigger if exists set_updated_at on public.notes;
create trigger set_updated_at
  before update on public.notes
  for each row
  when (old.position is not distinct from new.position)
  execute function extensions.moddatetime(updated_at);

drop trigger if exists set_updated_at on public.note_folders;
create trigger set_updated_at
  before update on public.note_folders
  for each row
  when (old.position is not distinct from new.position)
  execute function extensions.moddatetime(updated_at);

-- ── as RPCs de reordenar ────────────────────────────────────────────────────
-- Reescrevem o escopo visível INTEIRO em vez de calcular ponto médio entre dois vizinhos: não
-- existe deriva de precisão de float e não existe job de renumeração. O escopo aqui é dezenas de
-- linhas (fixadas, soltas, ou o conteúdo de uma pasta).
--
-- `security invoker` com o filtro de workspace inline, sob RLS. Sem o par interno/wrapper de
-- `supabase.md` porque isto é ESCRITA DO APP, não leitura do agente — mesmo precedente do
-- `save_budget` (`0031`) e das duas RPCs de contagem da `0038`.
--
-- ⚠️ `n.position is distinct from v.ord` é obrigatório, e é a metade não óbvia da trava de
-- `updated_at`: numa lista [1,2,3,4] onde só 3 e 4 trocam, as linhas 1 e 2 receberiam o mesmo
-- valor que já tinham, o WHEN do trigger seria VERDADEIRO nelas e o `updated_at` da maioria da
-- lista pularia. Com a cláusula, linha que não moveu não é escrita.
create or replace function public.notes_reorder(p_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  update public.notes n
     set position = v.ord
    from unnest(p_ids) with ordinality as v(id, ord)
   where n.id = v.id
     and n.position is distinct from v.ord
     and n.workspace_id in (select private.my_workspace_ids());
$$;

create or replace function public.note_folders_reorder(p_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  update public.note_folders f
     set position = v.ord
    from unnest(p_ids) with ordinality as v(id, ord)
   where f.id = v.id
     and f.position is distinct from v.ord
     and f.workspace_id in (select private.my_workspace_ids());
$$;

revoke execute on function public.notes_reorder(uuid[]) from public, anon;
revoke execute on function public.note_folders_reorder(uuid[]) from public, anon;
grant execute on function public.notes_reorder(uuid[]) to authenticated, service_role;
grant execute on function public.note_folders_reorder(uuid[]) to authenticated, service_role;

-- ── índices ─────────────────────────────────────────────────────────────────
-- A lista ativa agora ordena por `pinned desc, position, updated_at desc`. `position` vem DEPOIS
-- de `pinned` de propósito: à frente, uma nota fixada com posição 2 cairia atrás de uma solta com
-- posição 1 e a seção FIXADAS se intercalaria.
--
-- Índice parcial de LEITURA é seguro (a armadilha do 42P10 é de unique parcial). `position` sem
-- qualificador é ASC NULLS LAST, que é exatamente o que a leitura pede — antes do primeiro
-- arrasto tudo é null e a ordem é a de sempre.
create index if not exists notes_ws_active_idx
  on public.notes (workspace_id, pinned desc, position, updated_at desc)
  where deleted_at is null and archived_at is null;

create index if not exists notes_archived_idx
  on public.notes (workspace_id, archived_at desc)
  where archived_at is not null and deleted_at is null;

create index if not exists note_folders_tags_idx
  on public.note_folders using gin (tags);

create index if not exists note_folders_order_idx
  on public.note_folders (workspace_id, pinned desc, position, name)
  where archived_at is null;

-- ── a contagem da pasta conta o que se vê ───────────────────────────────────
-- Arquivada some da contagem pelo mesmo motivo que a da lixeira já sumia: o número no ladrilho é
-- "quantas notas você encontra aqui", não "quantas linhas existem".
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
    and n.archived_at is null
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
    and n.archived_at is null
    and n.workspace_id in (select private.my_workspace_ids())
  group by t.tag
  order by 2 desc, 1;
$$;
