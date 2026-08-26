-- Ingestão inteligente: o substituto do Open Finance.
-- Agregador custa Pluggy ~R$2,5k/mês / Belvo ~R$6k/mês — fora de cogitação aqui.
-- Em vez disso o usuário manda foto de cupom, PDF de fatura, extrato OFX/CSV ou
-- print de Pix, e a IA transforma em lançamento. Cobre a mesma dor, custo ~zero,
-- e funciona até com banco que não está no Open Finance.
--
-- Fluxo: arquivo -> `import_batches` -> N `import_items` (staging, com sugestão
-- de categoria) -> usuário revisa -> `approve_import_items` vira transactions.
-- Nada entra no extrato sem passar pela revisão: importação errada silenciosa é
-- exatamente a reclamação que os concorrentes colecionam.

-- ── regras de categorização do usuário ─────────────────────────────────────
-- O "Sherlock" do Pierre é vendido como IA que aprende. Aqui é determinístico e
-- visível: o usuário vê a regra, edita e sabe por que caiu naquela categoria.
create table if not exists public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade
    default public.my_default_workspace(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_type text not null default 'contains'
    check (match_type in ('contains','merchant','regex')),
  pattern text not null check (length(trim(pattern)) > 0),
  category text,
  account_id uuid references public.accounts(id) on delete set null,
  -- menor roda primeiro; empate desempata pela mais específica (padrão mais longo)
  priority int not null default 100,
  hits int not null default 0,
  source text not null default 'user' check (source in ('user','learned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, match_type, pattern)
);
create index if not exists categorization_rules_ws_idx
  on public.categorization_rules (workspace_id, priority);
alter table public.categorization_rules enable row level security;
drop policy if exists "workspace rows" on public.categorization_rules;
create policy "workspace rows" on public.categorization_rules for all
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
drop trigger if exists set_updated_at on public.categorization_rules;
create trigger set_updated_at before update on public.categorization_rules
  for each row execute function extensions.moddatetime(updated_at);

-- ── importação ─────────────────────────────────────────────────────────────
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade
    default public.my_default_workspace(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('photo','pdf','ofx','csv','forwarded')),
  filename text,
  account_id uuid references public.accounts(id) on delete set null,
  status text not null default 'review'
    check (status in ('parsing','review','done','failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists import_batches_ws_idx
  on public.import_batches (workspace_id, created_at desc);
alter table public.import_batches enable row level security;
drop policy if exists "workspace rows" on public.import_batches;
create policy "workspace rows" on public.import_batches for all
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
drop trigger if exists set_updated_at on public.import_batches;
create trigger set_updated_at before update on public.import_batches
  for each row execute function extensions.moddatetime(updated_at);

/** Normaliza descrição para comparação: minúscula, só alfanumérico. */
create or replace function private.normalize_description(descr text)
returns text
language sql immutable
as $$
  select regexp_replace(lower(coalesce(descr, '')), '[^a-z0-9]+', '', 'g');
$$;
grant execute on function private.normalize_description(text) to authenticated, service_role;

/**
 * Chave de deduplicação de importação: mesma data + mesmo valor + mesma
 * descrição normalizada. NÃO é unique de propósito — dois cafés iguais no mesmo
 * dia são legítimos. Duplicata é MARCADA para o usuário decidir na revisão.
 */
create or replace function private.dedupe_hash(occurred date, cents bigint, descr text)
returns text
language sql immutable
as $$
  select md5(occurred::text || '|' || cents::text || '|' || private.normalize_description(descr));
$$;
grant execute on function private.dedupe_hash(date, bigint, text) to authenticated, service_role;

create table if not exists public.import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  -- desnormalizado: a policy filtra sem join com import_batches
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null default 'expense' check (kind in ('expense','income')),
  amount_cents bigint not null check (amount_cents > 0),
  occurred_at date not null,
  description text,
  merchant text,
  suggested_category text,
  suggested_account_id uuid references public.accounts(id) on delete set null,
  raw jsonb,
  dedupe_hash text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','discarded','duplicate')),
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists import_items_batch_idx on public.import_items (batch_id, occurred_at);
create index if not exists import_items_dedupe_idx on public.import_items (workspace_id, dedupe_hash);
alter table public.import_items enable row level security;
drop policy if exists "workspace rows" on public.import_items;
create policy "workspace rows" on public.import_items for all
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));

-- anexo (cupom/comprovante) no lançamento
alter table public.transactions
  add column if not exists attachment_path text;

-- ── aplicação das regras ───────────────────────────────────────────────────
/**
 * Devolve a categoria/conta sugerida para um texto, pela primeira regra que casa.
 * `security definer` porque roda dentro do executor da IA (service_role) e do
 * import; recebe o workspace já resolvido.
 */
create or replace function public._match_rule(ws_id uuid, texto text)
returns table(category text, account_id uuid, rule_id uuid)
language sql stable security definer
set search_path = public
as $$
  select r.category, r.account_id, r.id
  from public.categorization_rules r
  where r.workspace_id = ws_id
    and case r.match_type
      when 'regex' then coalesce(texto, '') ~* r.pattern
      else private.normalize_description(texto)
           like '%' || private.normalize_description(r.pattern) || '%'
    end
  order by r.priority, length(r.pattern) desc
  limit 1;
$$;
revoke execute on function public._match_rule(uuid, text) from public, anon, authenticated;

-- ── aprovação da revisão ───────────────────────────────────────────────────
/**
 * Vira os itens escolhidos em `transactions` (source='import') e marca o item
 * como aprovado. Idempotente por item: já aprovado é ignorado.
 * `security invoker`: sob RLS o usuário só alcança itens do próprio workspace.
 */
create or replace function public.approve_import_items(p_item_ids uuid[])
returns int
language plpgsql security invoker
set search_path = public
as $$
declare
  item record;
  tx_id uuid;
  criadas int := 0;
begin
  for item in
    select i.*, b.account_id as batch_account_id, b.user_id as batch_user_id
    from public.import_items i
    join public.import_batches b on b.id = i.batch_id
    where i.id = any(p_item_ids) and i.status in ('pending','duplicate')
  loop
    insert into public.transactions
      (workspace_id, user_id, kind, amount_cents, category, description, merchant,
       account_id, occurred_at, source, status)
    values (item.workspace_id, coalesce((select auth.uid()), item.batch_user_id),
            item.kind, item.amount_cents, item.suggested_category, item.description,
            item.merchant,
            coalesce(item.suggested_account_id, item.batch_account_id),
            item.occurred_at, 'import', 'cleared')
    returning id into tx_id;

    update public.import_items
    set status = 'approved', transaction_id = tx_id
    where id = item.id;
    criadas := criadas + 1;
  end loop;

  return criadas;
end;
$$;

-- ── realtime ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'import_items') then
    alter publication supabase_realtime add table public.import_items;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'categorization_rules') then
    alter publication supabase_realtime add table public.categorization_rules;
  end if;
end $$;

-- ── bucket dos comprovantes (privado, isolado por workspace) ───────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('receipts', 'receipts', false, 10485760)
on conflict (id) do nothing;

-- caminho é sempre `<workspace_id>/<arquivo>`: a primeira pasta é a chave do RLS
drop policy if exists "receipts: workspace read" on storage.objects;
create policy "receipts: workspace read" on storage.objects
  for select using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (select ws::text from private.my_workspace_ids() ws)
  );

drop policy if exists "receipts: workspace write" on storage.objects;
create policy "receipts: workspace write" on storage.objects
  for insert with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (select ws::text from private.my_workspace_ids() ws)
  );

drop policy if exists "receipts: workspace delete" on storage.objects;
create policy "receipts: workspace delete" on storage.objects
  for delete using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (select ws::text from private.my_workspace_ids() ws)
  );
