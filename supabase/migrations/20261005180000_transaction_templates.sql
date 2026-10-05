-- F22: favoritos de lançamento (modelos). Guarda só dados da pessoa em `fields` (validado pelo
-- decoder do app), nunca vínculo contábil. Apagar um favorito não toca nenhum lançamento.
create table if not exists public.transaction_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_default_workspace()
    references public.workspaces(id) on delete cascade,
  -- autor; apagar a conta leva os favoritos dele (sem isso o delete do perfil falhava em 23503)
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  use_count int not null default 0 check (use_count >= 0),
  last_used_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transaction_templates_ws_idx
  on public.transaction_templates (workspace_id, archived, use_count desc);
create index if not exists transaction_templates_author_idx on public.transaction_templates (user_id);
create unique index if not exists transaction_templates_name_uq
  on public.transaction_templates (workspace_id, lower(btrim(name))) where not archived;
alter table public.transaction_templates enable row level security;
drop policy if exists "workspace rows" on public.transaction_templates;
create policy "workspace rows" on public.transaction_templates
  for all to authenticated
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
revoke all on public.transaction_templates from public, anon, authenticated;
grant select, insert, update, delete on public.transaction_templates to authenticated;
grant all on public.transaction_templates to service_role;
drop trigger if exists set_updated_at on public.transaction_templates;
create trigger set_updated_at before update on public.transaction_templates
  for each row execute function extensions.moddatetime(updated_at);
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and schemaname = 'public' and tablename = 'transaction_templates') then
    alter publication supabase_realtime add table public.transaction_templates;
  end if;
end $$;
