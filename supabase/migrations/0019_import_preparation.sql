-- Preparo do lote de importação dentro do banco: o Deno insere as linhas cruas e
-- chama UMA função, em vez de N round-trips por linha.

-- hash de deduplicação sai do trigger: quem insere não precisa saber a regra
create or replace function public.tg_import_items_dedupe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dedupe_hash is null or new.dedupe_hash = '' then
    new.dedupe_hash := private.dedupe_hash(new.occurred_at, new.amount_cents, new.description);
  end if;
  return new;
end;
$$;
revoke execute on function public.tg_import_items_dedupe() from public, anon, authenticated;

drop trigger if exists set_dedupe_hash on public.import_items;
create trigger set_dedupe_hash before insert on public.import_items
  for each row execute function public.tg_import_items_dedupe();

alter table public.import_items alter column dedupe_hash drop not null;

/**
 * Aplica as regras do usuário e marca duplicatas do lote.
 * Duplicata = já existe transação no workspace com a mesma data, mesmo valor e
 * mesma descrição normalizada. É MARCAÇÃO, não bloqueio: dois cafés iguais no
 * mesmo dia são legítimos e quem decide é o usuário, na revisão.
 *
 * ⚠️ O primeiro UPDATE não pode usar `from lateral (... i.description ...)`:
 * LATERAL no FROM de um UPDATE não enxerga a tabela alvo. Por isso a junção com
 * `_match_rule` acontece numa subquery sobre OUTRA referência de import_items e
 * o UPDATE casa só por id.
 */
create or replace function public._prepare_import_batch(p_batch_id uuid)
returns table(total int, categorizados int, duplicados int)
language plpgsql security definer
set search_path = public
as $$
declare
  ws_id uuid;
begin
  select b.workspace_id into ws_id from public.import_batches b where b.id = p_batch_id;
  if ws_id is null then
    raise exception 'lote % não encontrado', p_batch_id;
  end if;

  update public.import_items i
  set suggested_category = m.category,
      suggested_account_id = coalesce(i.suggested_account_id, m.account_id)
  from (
    select it.id, r.category, r.account_id
    from public.import_items it
    cross join lateral public._match_rule(ws_id, it.description) r
    where it.batch_id = p_batch_id and it.suggested_category is null
  ) m
  where i.id = m.id and m.category is not null;

  update public.import_items i
  set status = 'duplicate'
  where i.batch_id = p_batch_id
    and i.status = 'pending'
    and exists (
      select 1 from public.transactions t
      where t.workspace_id = ws_id
        and t.occurred_at = i.occurred_at
        and t.amount_cents = i.amount_cents
        and private.normalize_description(t.description)
            = private.normalize_description(i.description)
    );

  return query
  select count(*)::int,
         count(*) filter (where i.suggested_category is not null)::int,
         count(*) filter (where i.status = 'duplicate')::int
  from public.import_items i
  where i.batch_id = p_batch_id;
end;
$$;
revoke execute on function public._prepare_import_batch(uuid) from public, anon, authenticated;
