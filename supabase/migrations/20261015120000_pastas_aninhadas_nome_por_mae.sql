-- Pastas aninhadas: o nome é único por MÃE, a árvore é travada no banco e a contagem soma as filhas.
--
-- `unique nulls not distinct` COMPLETO (não parcial): o .upsert() do PostgREST com
-- onConflict 'workspace_id,parent_id,name' e o ON CONFLICT do agente só casam com índice completo.
-- Duas pastas na raiz com o mesmo nome continuam colidindo (nulls not distinct).

alter table public.note_folders drop constraint if exists note_folders_workspace_id_name_key;
alter table public.note_folders drop constraint if exists note_folders_ws_parent_name_key;
alter table public.note_folders
  add constraint note_folders_ws_parent_name_key unique nulls not distinct (workspace_id, parent_id, name);

-- ── trava da árvore: mesmo workspace, sem ciclo, no máximo 5 níveis (raiz = 1) ──
create or replace function private.tg_note_folders_arvore()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  acima int;    -- níveis da raiz até a mãe (0 = raiz)
  abaixo int;   -- níveis da subárvore desta pasta, ela inclusa
begin
  if new.parent_id is null then
    acima := 0;
  else
    -- serializa movimentações do workspace: duas simultâneas (A→B e B→A) criariam ciclo
    perform pg_advisory_xact_lock(hashtextextended('note_folders:' || new.workspace_id::text, 0));
    if new.parent_id = new.id then
      raise exception 'Uma pasta não pode ficar dentro dela mesma.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.note_folders where id = new.parent_id and workspace_id = new.workspace_id) then
      raise exception 'A pasta de destino não existe neste espaço.' using errcode = 'P0001';
    end if;
    -- sobe pela cadeia da mãe; `union` dedup protege de ciclo legado
    with recursive up(id, parent_id, lvl) as (
      select f.id, f.parent_id, 1 from public.note_folders f where f.id = new.parent_id
      union
      select f.id, f.parent_id, up.lvl + 1 from public.note_folders f join up on f.id = up.parent_id
      where f.workspace_id = new.workspace_id and up.lvl < 6  -- teto: ciclo legado não pode rodar para sempre
    )
    select max(lvl) into acima from up;
    if exists (
      with recursive up(id, parent_id) as (
        select f.id, f.parent_id from public.note_folders f where f.id = new.parent_id
        union
        select f.id, f.parent_id from public.note_folders f join up on f.id = up.parent_id
        where f.workspace_id = new.workspace_id
      )
      select 1 from up where id = new.id
    ) then
      raise exception 'Uma pasta não pode ficar dentro de uma pasta que está dentro dela.' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    with recursive down(id, lvl) as (
      select new.id, 1
      union
      select f.id, down.lvl + 1 from public.note_folders f join down on f.parent_id = down.id
      where f.workspace_id = new.workspace_id and down.lvl < 6
    )
    select max(lvl) into abaixo from down;
  else
    abaixo := 1;
  end if;

  if acima + abaixo > 5 then
    raise exception 'Limite de 5 níveis de pastas.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function private.tg_note_folders_arvore() from public, anon, authenticated;

drop trigger if exists note_folders_arvore on public.note_folders;
create trigger note_folders_arvore
  before insert or update of parent_id, workspace_id on public.note_folders
  for each row execute function private.tg_note_folders_arvore();

-- ── contagem: a pasta soma as notas das subpastas ───────────────────────────
-- Subpasta arquivada não soma (nem o que está abaixo dela): ela não aparece, e o número é
-- "quantas notas você encontra aqui". Mesmas colunas, invoker e search_path da definição anterior.
create or replace function public.note_folder_counts()
returns table (folder_id uuid, notes_count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  with recursive arv(raiz, id) as (
    select f.id, f.id from public.note_folders f
    where f.workspace_id in (select private.my_workspace_ids())
    union
    select arv.raiz, c.id
    from arv join public.note_folders c on c.parent_id = arv.id and c.archived_at is null
      and c.workspace_id in (select private.my_workspace_ids())
  )
  select arv.raiz, count(*)::bigint
  from arv
  join public.notes n on n.folder_id = arv.id
  where n.deleted_at is null
    and n.archived_at is null
    and n.workspace_id in (select private.my_workspace_ids())
  group by arv.raiz
  union all
  select null::uuid, count(*)::bigint
  from public.notes n
  where n.folder_id is null
    and n.deleted_at is null
    and n.archived_at is null
    and n.workspace_id in (select private.my_workspace_ids())
  having count(*) > 0;
$$;

revoke execute on function public.note_folder_counts() from public, anon;
grant execute on function public.note_folder_counts() to authenticated, service_role;

-- a unique nova tem o prefixo (workspace_id, parent_id): o índice da 0049 ficou redundante
drop index if exists public.note_folders_parent_idx;
