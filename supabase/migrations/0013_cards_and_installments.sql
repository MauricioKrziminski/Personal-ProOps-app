-- Cartão de crédito de verdade: ciclo (fechamento/vencimento), fatura por mês e
-- compra parcelada projetada nos meses futuros.
--
-- Decisões:
-- 1. A fatura NÃO é somatório materializado: `card_invoices` guarda só o ciclo
--    (datas + status). O total sai de `sum(transactions.amount_cents)` por
--    invoice_id, igual ao padrão de saldo derivado de `accounts`.
-- 2. A vinculação compra -> fatura é feita por TRIGGER, não pelo chamador: app,
--    WhatsApp e importação acertam a fatura sem duplicar regra em três lugares.
-- 3. Cartão continua sendo uma `accounts` comum (partida dobrada): a compra
--    deixa o saldo do cartão mais negativo (dívida) e o pagamento é uma
--    `transfer` da conta corrente para o cartão, que zera. Por isso
--    `_account_balances` NÃO muda aqui.
-- 4. Parcela é `transactions` de verdade, uma por mês, com status `pending` no
--    futuro — é o que faz a projeção (Fase 2) ser um `sum()` e não um cálculo.

-- ── helpers de calendário (schema privado: não viram endpoint REST) ─────────
create or replace function private.day_in_month(d date, day_of_month int)
returns date
language sql immutable
as $$
  -- dia 31 em fevereiro cai no último dia do mês, nunca estoura
  select date_trunc('month', d)::date + (least(
    day_of_month,
    extract(day from (date_trunc('month', d) + interval '1 month' - interval '1 day'))::int
  ) - 1);
$$;

create or replace function private.add_months(d date, n int)
returns date
language sql immutable
as $$
  -- 31/01 + 1 mês = 28/02 (ou 29), preservando o dia sempre que couber
  select private.day_in_month((date_trunc('month', d) + make_interval(months => n))::date,
                              extract(day from d)::int);
$$;

/**
 * Janela da fatura que recebe uma compra.
 * Compra até o dia de fechamento cai na fatura que fecha no próprio mês;
 * depois do fechamento, cai na do mês seguinte. O vencimento é no mesmo mês do
 * fechamento quando due_day > closing_day, senão no mês seguinte.
 */
create or replace function private.invoice_window(
  p_closing_day int, p_due_day int, p_occurred date
)
returns table(reference_month date, closing_date date, due_date date)
language sql immutable
as $$
  with ref as (
    select case
      when p_occurred <= private.day_in_month(p_occurred, p_closing_day)
        then date_trunc('month', p_occurred)::date
      else (date_trunc('month', p_occurred) + interval '1 month')::date
    end as ref_month
  )
  select r.ref_month,
         private.day_in_month(r.ref_month, p_closing_day),
         case when p_due_day > p_closing_day
              then private.day_in_month(r.ref_month, p_due_day)
              else private.day_in_month(private.add_months(r.ref_month, 1), p_due_day)
         end
  from ref r;
$$;

-- ── cartão: ciclo e limite em `accounts` ───────────────────────────────────
alter table public.accounts
  add column if not exists closing_day int,
  add column if not exists due_day int,
  add column if not exists credit_limit_cents bigint,
  add column if not exists payment_account_id uuid references public.accounts(id) on delete set null;

alter table public.accounts drop constraint if exists accounts_card_fields_chk;
alter table public.accounts add constraint accounts_card_fields_chk check (
  case when type = 'credit_card'
    then coalesce(closing_day, 1) between 1 and 31
     and coalesce(due_day, 1) between 1 and 31
     and coalesce(credit_limit_cents, 0) >= 0
    else closing_day is null and due_day is null
     and credit_limit_cents is null and payment_account_id is null
  end
);
alter table public.accounts drop constraint if exists accounts_payment_self_chk;
alter table public.accounts add constraint accounts_payment_self_chk
  check (payment_account_id is null or payment_account_id <> id);

-- ── faturas ────────────────────────────────────────────────────────────────
create table if not exists public.card_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade
    default public.my_default_workspace(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  reference_month date not null,          -- sempre dia 1 do mês do fechamento
  closing_date date not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open','closed','paid')),
  paid_at date,
  payment_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, reference_month)
);
create index if not exists card_invoices_ws_idx on public.card_invoices (workspace_id, due_date);
create index if not exists card_invoices_open_idx on public.card_invoices (account_id) where status <> 'paid';
alter table public.card_invoices enable row level security;
drop policy if exists "workspace rows" on public.card_invoices;
create policy "workspace rows" on public.card_invoices for all
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
drop trigger if exists set_updated_at on public.card_invoices;
create trigger set_updated_at before update on public.card_invoices
  for each row execute function extensions.moddatetime(updated_at);

-- ── planos de parcelamento ─────────────────────────────────────────────────
create table if not exists public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade
    default public.my_default_workspace(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  description text,
  merchant text,
  category text,
  total_cents bigint not null check (total_cents > 0),
  installments int not null check (installments between 2 and 72),
  first_occurred_at date not null,
  created_at timestamptz not null default now()
);
create index if not exists installment_plans_ws_idx on public.installment_plans (workspace_id, created_at desc);
alter table public.installment_plans enable row level security;
drop policy if exists "workspace rows" on public.installment_plans;
create policy "workspace rows" on public.installment_plans for all
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));

-- ── transactions: status/vencimento/fatura/parcela ─────────────────────────
alter table public.transactions
  add column if not exists status text not null default 'cleared',
  add column if not exists due_at date,
  add column if not exists invoice_id uuid references public.card_invoices(id) on delete set null,
  add column if not exists installment_plan_id uuid references public.installment_plans(id) on delete cascade,
  add column if not exists installment_no int,
  add column if not exists merchant text;

alter table public.transactions drop constraint if exists transactions_status_chk;
alter table public.transactions add constraint transactions_status_chk
  check (status in ('pending','cleared'));
alter table public.transactions drop constraint if exists transactions_installment_chk;
alter table public.transactions add constraint transactions_installment_chk
  check ((installment_plan_id is null) = (installment_no is null));

create index if not exists transactions_pending_idx
  on public.transactions (workspace_id, due_at) where status = 'pending';
create index if not exists transactions_invoice_idx on public.transactions (invoice_id);
create index if not exists transactions_plan_idx on public.transactions (installment_plan_id);

/**
 * Vincula a transação à fatura certa do cartão (e herda o vencimento dela).
 * Roda no app, no WhatsApp e na importação — a regra de ciclo mora só aqui.
 * Transferência de PAGAMENTO da fatura não entra: nela o cartão é o destino
 * (counterparty), nunca a conta de origem.
 */
create or replace function public.tg_transactions_set_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  card record;
  win record;
  inv_id uuid;
begin
  if new.account_id is null then
    new.invoice_id := null;
    return new;
  end if;

  select a.type, a.closing_day, a.due_day, a.workspace_id, a.user_id
    into card
  from public.accounts a where a.id = new.account_id;

  if card.type is distinct from 'credit_card'
     or card.closing_day is null or card.due_day is null then
    new.invoice_id := null;
    return new;
  end if;

  select * into win from private.invoice_window(card.closing_day, card.due_day, new.occurred_at);

  insert into public.card_invoices
    (workspace_id, user_id, account_id, reference_month, closing_date, due_date)
  values (card.workspace_id, coalesce(new.user_id, card.user_id), new.account_id,
          win.reference_month, win.closing_date, win.due_date)
  on conflict (account_id, reference_month) do nothing;

  select ci.id into inv_id from public.card_invoices ci
  where ci.account_id = new.account_id and ci.reference_month = win.reference_month;

  new.invoice_id := inv_id;
  if new.due_at is null then
    new.due_at := win.due_date;
  end if;
  return new;
end;
$$;
revoke execute on function public.tg_transactions_set_invoice() from public, anon, authenticated;

drop trigger if exists set_invoice on public.transactions;
create trigger set_invoice before insert or update of account_id, occurred_at
  on public.transactions
  for each row execute function public.tg_transactions_set_invoice();

/**
 * Cria a compra parcelada: uma transação por parcela, no mês de cada uma.
 * Parcelas futuras nascem `pending` (é o que alimenta a projeção da Fase 2) e a
 * fatura de cada uma é resolvida pelo trigger acima.
 * O resto da divisão vai na ÚLTIMA parcela — a soma sempre bate com o total.
 * `security invoker`: sob RLS o usuário só enxerga a própria conta; o
 * service_role (Edge Function) passa por cima e usa o user_id da conta.
 */
create or replace function public.create_installment_plan(
  p_account_id uuid,
  p_total_cents bigint,
  p_installments int,
  p_occurred_at date,
  p_description text default null,
  p_category text default null,
  p_merchant text default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  acc record;
  plan_id uuid;
  base_cents bigint;
  parcela_cents bigint;
  data_parcela date;
  i int;
begin
  if p_installments < 2 or p_installments > 72 then
    raise exception 'parcelas fora do intervalo 2..72: %', p_installments;
  end if;
  if p_total_cents <= 0 then
    raise exception 'total precisa ser positivo';
  end if;

  select a.id, a.workspace_id, a.user_id into acc
  from public.accounts a where a.id = p_account_id;
  if acc.id is null then
    raise exception 'conta % não encontrada', p_account_id;
  end if;

  insert into public.installment_plans
    (workspace_id, user_id, account_id, description, merchant, category,
     total_cents, installments, first_occurred_at)
  values (acc.workspace_id, coalesce((select auth.uid()), acc.user_id), p_account_id,
          p_description, p_merchant, p_category, p_total_cents, p_installments, p_occurred_at)
  returning id into plan_id;

  base_cents := p_total_cents / p_installments;  -- divisão inteira: nunca float
  for i in 1..p_installments loop
    parcela_cents := case when i = p_installments
      then p_total_cents - base_cents * (p_installments - 1)
      else base_cents end;
    data_parcela := private.add_months(p_occurred_at, i - 1);

    insert into public.transactions
      (workspace_id, user_id, kind, amount_cents, category, description, merchant,
       account_id, occurred_at, source, status, installment_plan_id, installment_no)
    values (acc.workspace_id, coalesce((select auth.uid()), acc.user_id), 'expense',
            parcela_cents, p_category,
            coalesce(p_description, 'Compra parcelada') || ' (' || i || '/' || p_installments || ')',
            p_merchant, p_account_id, data_parcela, 'app',
            case when data_parcela > current_date then 'pending' else 'cleared' end,
            plan_id, i);
  end loop;

  return plan_id;
end;
$$;

/**
 * Paga a fatura: transferência da conta pagadora para o cartão (o saldo
 * negativo do cartão volta a zero) + fatura marcada como paga.
 * O valor é o total das compras da fatura — nunca vira despesa nova, senão o
 * gasto contaria duas vezes.
 */
create or replace function public.pay_invoice(
  p_invoice_id uuid,
  p_account_id uuid,
  p_paid_at date default current_date
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  inv record;
  total_cents bigint;
  tx_id uuid;
begin
  select ci.*, a.name as card_name into inv
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  where ci.id = p_invoice_id;
  if inv.id is null then
    raise exception 'fatura % não encontrada', p_invoice_id;
  end if;
  if inv.status = 'paid' then
    raise exception 'fatura já paga em %', inv.paid_at;
  end if;
  if p_account_id = inv.account_id then
    raise exception 'a conta pagadora não pode ser o próprio cartão';
  end if;

  select coalesce(sum(t.amount_cents), 0) into total_cents
  from public.transactions t
  where t.invoice_id = p_invoice_id and t.kind = 'expense';

  if total_cents = 0 then
    raise exception 'fatura sem lançamentos';
  end if;

  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description,
     account_id, counterparty_account_id, occurred_at, source, status)
  values (inv.workspace_id, coalesce((select auth.uid()), inv.user_id), 'transfer',
          total_cents, 'Pagamento da fatura ' || inv.card_name,
          p_account_id, inv.account_id, p_paid_at, 'app', 'cleared')
  returning id into tx_id;

  update public.card_invoices
  set status = 'paid', paid_at = p_paid_at, payment_transaction_id = tx_id
  where id = p_invoice_id;

  return tx_id;
end;
$$;

-- ── RPC de resumo dos cartões (padrão duplo interna/wrapper) ───────────────
create or replace function public._card_summary(uid uuid)
returns table(
  account_id uuid, name text, credit_limit_cents bigint,
  closing_day int, due_day int,
  invoice_id uuid, reference_month date, closing_date date, due_date date,
  invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint
)
language sql stable security definer
set search_path = public
as $$
  with cards as (
    select a.* from public.accounts a
    where a.workspace_id in (select public._workspace_ids(uid))
      and a.type = 'credit_card' and not a.archived
  ),
  totals as (
    select ci.id as invoice_id, coalesce(sum(t.amount_cents), 0)::bigint as total_cents
    from public.card_invoices ci
    left join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status <> 'paid'
    order by ci.account_id, ci.reference_month
  )
  select c.id, c.name, c.credit_limit_cents, c.closing_day, c.due_day,
         ab.id, ab.reference_month, ab.closing_date, ab.due_date,
         coalesce(tt.total_cents, 0)::bigint,
         coalesce((select sum(t2.total_cents) from totals t2
                   join public.card_invoices ci2 on ci2.id = t2.invoice_id
                   where ci2.account_id = c.id and ci2.status <> 'paid'), 0)::bigint,
         (coalesce(c.credit_limit_cents, 0)
          - coalesce((select sum(t3.total_cents) from totals t3
                      join public.card_invoices ci3 on ci3.id = t3.invoice_id
                      where ci3.account_id = c.id and ci3.status <> 'paid'), 0))::bigint
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  order by c.name;
$$;
revoke execute on function public._card_summary(uuid) from public, anon, authenticated;

create or replace function public.card_summary()
returns table(
  account_id uuid, name text, credit_limit_cents bigint,
  closing_day int, due_day int,
  invoice_id uuid, reference_month date, closing_date date, due_date date,
  invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint
)
language sql stable
set search_path = public
as $$
  with cards as (
    select a.* from public.accounts a
    where a.workspace_id in (select private.my_workspace_ids())
      and a.type = 'credit_card' and not a.archived
  ),
  totals as (
    select ci.id as invoice_id, coalesce(sum(t.amount_cents), 0)::bigint as total_cents
    from public.card_invoices ci
    left join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status <> 'paid'
    order by ci.account_id, ci.reference_month
  )
  select c.id, c.name, c.credit_limit_cents, c.closing_day, c.due_day,
         ab.id, ab.reference_month, ab.closing_date, ab.due_date,
         coalesce(tt.total_cents, 0)::bigint,
         coalesce((select sum(t2.total_cents) from totals t2
                   join public.card_invoices ci2 on ci2.id = t2.invoice_id
                   where ci2.account_id = c.id and ci2.status <> 'paid'), 0)::bigint,
         (coalesce(c.credit_limit_cents, 0)
          - coalesce((select sum(t3.total_cents) from totals t3
                      join public.card_invoices ci3 on ci3.id = t3.invoice_id
                      where ci3.account_id = c.id and ci3.status <> 'paid'), 0))::bigint
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  order by c.name;
$$;

-- ── realtime ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'card_invoices') then
    alter publication supabase_realtime add table public.card_invoices;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'installment_plans') then
    alter publication supabase_realtime add table public.installment_plans;
  end if;
end $$;
