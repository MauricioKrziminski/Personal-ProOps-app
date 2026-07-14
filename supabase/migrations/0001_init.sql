-- ProOps — schema inicial
-- Todas as tabelas com RLS deny-by-default: usuário só enxerga o próprio dado.
-- Edge Functions usam service_role e passam por cima do RLS de forma controlada.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: espelho de auth.users + vínculo com o WhatsApp
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text unique not null,
  whatsapp_verified boolean not null default false,
  timezone text not null default 'America/Sao_Paulo',
  locale text not null default 'pt-BR',
  expo_push_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: own row" on public.profiles
  for all using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- cria o profile automaticamente no signup (Phone OTP)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, coalesce(new.phone, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- messages_raw: log de entrada/saída p/ auditoria e idempotência do webhook
-- ---------------------------------------------------------------------------
create table public.messages_raw (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text unique not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  phone text not null,
  user_id uuid references public.profiles (id) on delete set null,
  message_type text,        -- text | audio | image | ...
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.messages_raw enable row level security;
-- sem policies: apenas service_role acessa (deny-by-default para o app)

create index messages_raw_phone_idx on public.messages_raw (phone, created_at desc);

-- ---------------------------------------------------------------------------
-- jobs: fila de processamento assíncrono (webhook responde <5s e delega)
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'process_message',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  payload jsonb not null,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.jobs enable row level security;
-- apenas service_role

create index jobs_pending_idx on public.jobs (created_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- categories: categorias do usuário (notas e gastos)
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  type text not null check (type in ('note', 'expense')),
  created_at timestamptz not null default now(),
  unique (user_id, type, name)
);

alter table public.categories enable row level security;

create policy "categories: own rows" on public.categories
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- notes: notas rápidas
-- ---------------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null,
  category text,
  source text not null default 'whatsapp' check (source in ('whatsapp', 'app')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

create policy "notes: own rows" on public.notes
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create index notes_user_idx on public.notes (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- reminders: lembretes com recorrência (RRULE) e timezone
-- ---------------------------------------------------------------------------
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  recurrence text,                     -- RRULE (null = disparo único)
  next_run_at timestamptz not null,
  timezone text not null default 'America/Sao_Paulo',
  channel text not null default 'push' check (channel in ('push', 'whatsapp', 'both')),
  active boolean not null default true,
  source text not null default 'whatsapp' check (source in ('whatsapp', 'app')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reminders enable row level security;

create policy "reminders: own rows" on public.reminders
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- índice parcial: a query quente do agendador (lembretes vencidos e ativos)
create index reminders_due_idx on public.reminders (next_run_at) where active;
create index reminders_user_idx on public.reminders (user_id, next_run_at);

-- ---------------------------------------------------------------------------
-- expenses: gastos — SEMPRE amount_cents inteiro, nunca float
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'BRL',
  category text,
  description text,
  spent_at date not null default current_date,
  source text not null default 'whatsapp' check (source in ('whatsapp', 'app', 'import')),
  created_at timestamptz not null default now()
);

alter table public.expenses enable row level security;

create policy "expenses: own rows" on public.expenses
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- índice da query quente do dashboard (gastos por período)
create index expenses_user_spent_idx on public.expenses (user_id, spent_at desc);

-- ---------------------------------------------------------------------------
-- ai_events: auditoria de cada parse de IA (custo, modelo, confiança)
-- ---------------------------------------------------------------------------
create table public.ai_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  message_raw_id uuid references public.messages_raw (id) on delete set null,
  model text not null,
  input_tokens int,
  output_tokens int,
  confidence real,
  result jsonb,
  error text,
  created_at timestamptz not null default now()
);

alter table public.ai_events enable row level security;
-- apenas service_role

-- ---------------------------------------------------------------------------
-- RPC: agregado financeiro por categoria/mês (dashboard do app)
-- ---------------------------------------------------------------------------
create or replace function public.expenses_summary(from_date date, to_date date)
returns table (category text, total_cents bigint, expense_count bigint)
language sql
security invoker
stable
as $$
  select coalesce(category, 'outros') as category,
         sum(amount_cents)::bigint as total_cents,
         count(*)::bigint as expense_count
  from public.expenses
  where user_id = (select auth.uid())
    and spent_at between from_date and to_date
  group by 1
  order by 2 desc;
$$;

create or replace function public.expenses_monthly(months_back int default 6)
returns table (month date, total_cents bigint)
language sql
security invoker
stable
as $$
  select date_trunc('month', spent_at)::date as month,
         sum(amount_cents)::bigint as total_cents
  from public.expenses
  where user_id = (select auth.uid())
    and spent_at >= (date_trunc('month', current_date) - make_interval(months => months_back))::date
  group by 1
  order by 1;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: app recebe novos itens ao vivo
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.reminders;
alter publication supabase_realtime add table public.expenses;
