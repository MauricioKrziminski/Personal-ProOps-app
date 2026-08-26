-- Dívidas com amortização (Tabela Price) e estratégia de quitação.
-- Nenhum assistente financeiro de WhatsApp do mercado faz isso; quem faz são
-- apps separados. `interest_rate_monthly` é fração mensal: 1,99% a.m. = 0.0199;
-- zero = sem juros (parcelamento de loja, dívida com pessoa).

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade
    default public.my_default_workspace(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  kind text not null default 'loan'
    check (kind in ('loan','financing','credit_card','person','other')),
  principal_cents bigint not null check (principal_cents > 0),
  remaining_cents bigint not null check (remaining_cents >= 0),
  interest_rate_monthly numeric(10,6) not null default 0 check (interest_rate_monthly >= 0),
  installments int check (installments > 0),
  installments_paid int not null default 0 check (installments_paid >= 0),
  installment_cents bigint check (installment_cents > 0),
  due_day int check (due_day between 1 and 31),
  account_id uuid references public.accounts(id) on delete set null,
  started_at date not null default current_date,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create index if not exists debts_ws_idx on public.debts (workspace_id) where not archived;
alter table public.debts enable row level security;
drop policy if exists "workspace rows" on public.debts;
create policy "workspace rows" on public.debts for all
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
drop trigger if exists set_updated_at on public.debts;
create trigger set_updated_at before update on public.debts
  for each row execute function extensions.moddatetime(updated_at);

alter table public.transactions
  add column if not exists debt_id uuid references public.debts(id) on delete set null;
create index if not exists transactions_debt_idx on public.transactions (debt_id);

/** Parcela pela Tabela Price. Juros zero cai na divisão simples. */
create or replace function private.price_installment(pv bigint, taxa numeric, n int)
returns bigint
language sql immutable
set search_path = public
as $$
  select case
    when n is null or n <= 0 then null
    when taxa = 0 then ceil(pv::numeric / n)::bigint
    else ceil(pv::numeric * taxa / (1 - power(1 + taxa, -n)))::bigint
  end;
$$;
grant execute on function private.price_installment(bigint, numeric, int) to authenticated, service_role;

/**
 * Tabela de amortização do que AINDA falta pagar.
 * Recursiva: cada mês cobra juros sobre o saldo e abate o resto. A última
 * parcela recebe o resíduo para o saldo fechar exatamente em zero.
 * ⚠️ `with recursive` vale para o WITH inteiro — sem a palavra o CTE não
 * consegue se referenciar.
 */
create or replace function private.debt_schedule_for(p_debt_id uuid)
returns table(
  installment_no int, due_date date, payment_cents bigint,
  interest_cents bigint, principal_cents bigint, balance_cents bigint
)
language sql stable
set search_path = public
as $$
  with recursive d as (
    select id, remaining_cents, interest_rate_monthly, due_day,
           coalesce(installments, 0) - installments_paid as restantes,
           installment_cents
    from public.debts where id = p_debt_id
  ),
  parametros as (
    select d.remaining_cents, d.interest_rate_monthly as taxa, d.due_day,
           nullif(d.restantes, 0) as n,
           coalesce(d.installment_cents,
                    private.price_installment(d.remaining_cents, d.interest_rate_monthly,
                                              nullif(d.restantes, 0))) as parcela
    from d
  ),
  amortizacao as (
    select 1 as installment_no,
           (select remaining_cents from parametros) as saldo_inicial,
           (select parcela from parametros) as parcela,
           (select taxa from parametros) as taxa,
           (select n from parametros) as n
    union all
    select a.installment_no + 1,
           a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint - a.parcela,
           a.parcela, a.taxa, a.n
    from amortizacao a
    where a.installment_no < a.n
      and a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint - a.parcela > 0
  )
  select a.installment_no,
         private.day_in_month(
           private.add_months(current_date, a.installment_no),
           coalesce((select due_day from parametros), extract(day from current_date)::int)
         ) as due_date,
         case when a.installment_no = a.n
              then a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
              else a.parcela end as payment_cents,
         ceil(a.saldo_inicial::numeric * a.taxa)::bigint as interest_cents,
         case when a.installment_no = a.n
              then a.saldo_inicial
              else a.parcela - ceil(a.saldo_inicial::numeric * a.taxa)::bigint end as principal_cents,
         greatest(
           a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
           - case when a.installment_no = a.n
                  then a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
                  else a.parcela end,
           0) as balance_cents
  from amortizacao a
  order by a.installment_no;
$$;
grant execute on function private.debt_schedule_for(uuid) to authenticated, service_role;

create or replace function public.debt_schedule(p_debt_id uuid)
returns table(
  installment_no int, due_date date, payment_cents bigint,
  interest_cents bigint, principal_cents bigint, balance_cents bigint
)
language sql stable
set search_path = public
as $$
  -- RLS de `debts` filtra: id de outro workspace não é visível e volta vazio
  select s.* from private.debt_schedule_for(p_debt_id) s
  where exists (select 1 from public.debts d where d.id = p_debt_id);
$$;

/**
 * Ordem de ataque das dívidas.
 * snowball = menor saldo primeiro (ganha no psicológico, quita rápido a 1ª).
 * avalanche = maior juros primeiro (paga menos juros no total).
 * O total de juros é POR DÍVIDA, isolado — não simula redirecionar a parcela
 * quitada para a próxima. Sem isso o número ainda é honesto.
 */
create or replace function private.payoff_strategy_for(ws_ids uuid[], estrategia text)
returns table(
  priority int, debt_id uuid, name text, remaining_cents bigint,
  interest_rate_monthly numeric, months_left int, total_interest_cents bigint
)
language sql stable
set search_path = public
as $$
  select row_number() over (
           order by case when estrategia = 'avalanche' then d.interest_rate_monthly end desc,
                    case when estrategia = 'avalanche' then d.remaining_cents end asc,
                    case when estrategia <> 'avalanche' then d.remaining_cents end asc
         )::int,
         d.id, d.name, d.remaining_cents, d.interest_rate_monthly,
         coalesce((select count(*)::int from private.debt_schedule_for(d.id)), 0),
         coalesce((select sum(s.interest_cents)::bigint from private.debt_schedule_for(d.id) s), 0)
  from public.debts d
  where d.workspace_id = any(ws_ids) and not d.archived and d.remaining_cents > 0;
$$;
grant execute on function private.payoff_strategy_for(uuid[], text) to authenticated, service_role;

create or replace function public._payoff_strategy(uid uuid, estrategia text default 'avalanche')
returns table(
  priority int, debt_id uuid, name text, remaining_cents bigint,
  interest_rate_monthly numeric, months_left int, total_interest_cents bigint
)
language sql stable security definer
set search_path = public
as $$
  select * from private.payoff_strategy_for(array(select public._workspace_ids(uid)), estrategia)
  order by priority;
$$;
revoke execute on function public._payoff_strategy(uuid, text) from public, anon, authenticated;

create or replace function public.payoff_strategy(estrategia text default 'avalanche')
returns table(
  priority int, debt_id uuid, name text, remaining_cents bigint,
  interest_rate_monthly numeric, months_left int, total_interest_cents bigint
)
language sql stable
set search_path = public
as $$
  select * from private.payoff_strategy_for(array(select private.my_workspace_ids()), estrategia)
  order by priority;
$$;

/**
 * Pagamento de parcela: cria a despesa e abate o saldo devedor.
 * O abatimento desconta os juros do mês — pagar parcela não reduz o principal
 * pelo valor cheio, e mostrar isso é metade do valor da tela de dívidas.
 */
create or replace function public.pay_debt_installment(
  p_debt_id uuid,
  p_amount_cents bigint,
  p_account_id uuid default null,
  p_paid_at date default current_date
)
returns bigint
language plpgsql security invoker
set search_path = public
as $$
declare
  divida record;
  juros bigint;
  abate bigint;
  novo_saldo bigint;
begin
  select d.* into divida from public.debts d where d.id = p_debt_id;
  if divida.id is null then
    raise exception 'divida % nao encontrada', p_debt_id;
  end if;
  if p_amount_cents <= 0 then
    raise exception 'pagamento precisa ser positivo';
  end if;

  juros := ceil(divida.remaining_cents::numeric * divida.interest_rate_monthly)::bigint;
  abate := greatest(p_amount_cents - juros, 0);
  novo_saldo := greatest(divida.remaining_cents - abate, 0);

  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, category, description,
     account_id, occurred_at, source, status, debt_id)
  values (divida.workspace_id, coalesce((select auth.uid()), divida.user_id), 'expense',
          p_amount_cents, 'contas', 'Parcela ' || divida.name,
          coalesce(p_account_id, divida.account_id), p_paid_at, 'app', 'cleared', p_debt_id);

  update public.debts
  set remaining_cents = novo_saldo,
      installments_paid = installments_paid + 1
  where id = p_debt_id;

  return novo_saldo;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'debts') then
    alter publication supabase_realtime add table public.debts;
  end if;
end $$;
