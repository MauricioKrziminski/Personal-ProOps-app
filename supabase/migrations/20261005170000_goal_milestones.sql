-- F19: identidade visual e marcos das metas.
--
-- `goals.icon`/`goals.color`: aparência escolhida pela pessoa (ícone da grade do app, cor da paleta
-- das notas). Nulos = ícone padrão e sem cor, como antes.
-- `goal_milestones`: marcos em centavos (percentual digitado vira centavos ao salvar). A ETAPA é
-- derivada do ledger (`saved_cents`), nunca gravada. Escrita direta pelo app, com RLS por espaço.

alter table public.goals add column if not exists icon text;
alter table public.goals add column if not exists color text;
alter table public.goals drop constraint if exists goals_icon_check;
alter table public.goals add constraint goals_icon_check
  check (icon is null or char_length(icon) between 1 and 60);
alter table public.goals drop constraint if exists goals_color_check;
alter table public.goals add constraint goals_color_check
  check (color is null or color in
    ('grafite','oceano','violeta','magenta','terra','mostarda','musgo','turquesa'));

create table if not exists public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_default_workspace()
    references public.workspaces(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 9007199254740991),
  created_at timestamptz not null default now(),
  unique (goal_id, amount_cents)
);
create index if not exists goal_milestones_workspace_idx on public.goal_milestones (workspace_id);

-- O espaço do marco é o da meta (o chamador pode ser membro de dois), e 100% é o próprio alvo.
create or replace function private.goal_milestones_before_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare g record;
begin
  select workspace_id, target_cents into g from public.goals where id = new.goal_id;
  if not found then raise exception 'Meta não encontrada' using errcode = '23503'; end if;
  if new.amount_cents >= g.target_cents then
    raise exception 'O marco precisa ficar abaixo do alvo da meta' using errcode = '23514';
  end if;
  new.workspace_id := g.workspace_id;
  return new;
end $$;
revoke execute on function private.goal_milestones_before_insert() from public, anon, authenticated, service_role;

drop trigger if exists goal_milestones_before_insert on public.goal_milestones;
create trigger goal_milestones_before_insert before insert on public.goal_milestones
  for each row execute function private.goal_milestones_before_insert();

alter table public.goal_milestones enable row level security;
drop policy if exists "workspace rows" on public.goal_milestones;
create policy "workspace rows" on public.goal_milestones
  for all using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
-- sem UPDATE: o app insere e apaga a diferença
revoke all on public.goal_milestones from public, anon, authenticated;
grant select, insert, delete on public.goal_milestones to authenticated;
grant all on public.goal_milestones to service_role;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'goal_milestones') then
    alter publication supabase_realtime add table public.goal_milestones;
  end if;
end $$;
