-- Lembrete de conta (spec 2026-10-07-lembrete-de-conta-design.md).
-- A INTENÇÃO é gravada (qual registro, dias antes, hora, canal); o disparo é DERIVADO do
-- vencimento atual. Uma data de disparo gravada seria a segunda cópia do vencimento, e ele muda
-- por ~10 caminhos (editar série, reparcelar, mudar o dia da dívida, adiar fatura, pagar...).

create table if not exists public.bill_reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_default_workspace() references public.workspaces (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id uuid references public.transactions (id) on delete cascade,
  recurring_id uuid references public.recurring_transactions (id) on delete cascade,
  installment_plan_id uuid references public.installment_plans (id) on delete cascade,
  debt_id uuid references public.debts (id) on delete cascade,
  debt_installment_no int,
  invoice_id uuid references public.card_invoices (id) on delete cascade,
  days_before int not null check (days_before between 0 and 30),
  at_time time not null,
  channel text not null default 'push' check (channel in ('push', 'whatsapp', 'both')),
  created_at timestamptz not null default now(),
  constraint bill_reminders_um_alvo check (
    num_nonnulls(transaction_id, recurring_id, installment_plan_id, debt_id, invoice_id) = 1),
  constraint bill_reminders_parcela_da_divida check (debt_installment_no is null or debt_id is not null)
);

create index if not exists bill_reminders_ws_idx on public.bill_reminders (workspace_id);
create index if not exists bill_reminders_tx_idx on public.bill_reminders (transaction_id) where transaction_id is not null;
create index if not exists bill_reminders_rec_idx on public.bill_reminders (recurring_id) where recurring_id is not null;
create index if not exists bill_reminders_plan_idx on public.bill_reminders (installment_plan_id) where installment_plan_id is not null;
create index if not exists bill_reminders_debt_idx on public.bill_reminders (debt_id) where debt_id is not null;
create index if not exists bill_reminders_inv_idx on public.bill_reminders (invoice_id) where invoice_id is not null;

-- RLS: o membro LÊ; escrever é só pela RPC, que confere o espaço do ALVO. Sem policy de escrita,
-- um insert direto pelo PostgREST apontando para um registro de outro espaço não passa.
alter table public.bill_reminders enable row level security;
drop policy if exists "workspace read" on public.bill_reminders;
create policy "workspace read" on public.bill_reminders
  for select using (workspace_id in (select private.my_workspace_ids()));
revoke all on public.bill_reminders from public, anon, authenticated;
grant select on public.bill_reminders to authenticated;
grant all on public.bill_reminders to service_role;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'bill_reminders') then
    alter publication supabase_realtime add table public.bill_reminders;
  end if;
end $$;

-- Reserva por (aviso, vencimento), ANTES do envio: WhatsApp é template pago.
create table if not exists private.bill_reminder_sends (
  bill_reminder_id uuid not null references public.bill_reminders (id) on delete cascade,
  due_date date not null,
  attempts int not null default 0,
  sent_at timestamptz,
  last_error text,
  primary key (bill_reminder_id, due_date)
);
revoke all on private.bill_reminder_sends from public, anon, authenticated;

-- Os vencimentos EM ABERTO de cada lembrete, das mesmas fontes de `_upcoming_bills`:
-- fora do cartão = a linha pendente; no cartão = a FATURA não paga/adiada (uma por fatura);
-- financiamento = o cronograma do contrato (`debt_schedule_for`).
create or replace function private.bill_reminder_dues(p_ws uuid[])
returns table (bill_reminder_id uuid, due_date date, title text, amount_cents bigint, target text, ref uuid)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  with r as (select * from public.bill_reminders b where b.workspace_id = any (p_ws)),
  linhas as (
    select r.id as rid, t.*
    from r join public.transactions t
      on t.workspace_id = r.workspace_id
     and (t.id = r.transaction_id or t.recurring_id = r.recurring_id or t.installment_plan_id = r.installment_plan_id)
    where t.kind <> 'transfer'
  )
  select l.rid, coalesce(l.due_at, l.occurred_at),
         coalesce(l.description, l.merchant, l.category, 'Lançamento'), l.amount_cents, 'transaction', l.id
  from linhas l
  where l.invoice_id is null and l.status = 'pending'
  union
  select l.rid, ci.due_date, 'Fatura ' || a.name, private.invoice_open_cents(ci.id), 'invoice', ci.id
  from linhas l
  join public.card_invoices ci on ci.id = l.invoice_id and ci.status not in ('paid', 'rolled')
  join public.accounts a on a.id = ci.account_id
  union
  select r.id, ci.due_date, 'Fatura ' || a.name, private.invoice_open_cents(ci.id), 'invoice', ci.id
  from r
  join public.card_invoices ci on ci.id = r.invoice_id and ci.status not in ('paid', 'rolled')
  join public.accounts a on a.id = ci.account_id
  union
  select r.id, s.due_date,
         coalesce(d.payment_description, 'Parcela ' || d.name) || ' (' || s.installment_no || '/' || d.installments || ')',
         s.payment_cents, 'debt', d.id
  from r
  join public.debts d on d.id = r.debt_id and not d.archived and d.remaining_cents > 0
  cross join lateral private.debt_schedule_for(d.id) s
  where r.debt_installment_no is null or s.installment_no = r.debt_installment_no;
$$;
revoke execute on function private.bill_reminder_dues(uuid[]) from public, anon, authenticated;

-- O que toca AGORA (cron de 1 min). Hoje = vencimento − dias antes, e a hora já passou; cron fora do
-- ar entrega atrasado no MESMO dia, nunca no seguinte. Enviado ou 5 tentativas = não volta.
create or replace function public._bill_reminders_due()
returns table (bill_reminder_id uuid, user_id uuid, workspace_id uuid, due_date date, days_before int,
               title text, amount_cents bigint, target text, ref uuid, channel text,
               phone text, expo_push_token text, alerts_whatsapp_enabled boolean, attempts int)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  select b.id, b.user_id, b.workspace_id, d.due_date, b.days_before, d.title, d.amount_cents, d.target, d.ref,
         b.channel, p.phone, p.expo_push_token, p.alerts_whatsapp_enabled, coalesce(s.attempts, 0)
  from private.bill_reminder_dues((select array_agg(w.id) from public.workspaces w)) d
  join public.bill_reminders b on b.id = d.bill_reminder_id
  join public.profiles p on p.id = b.user_id
  left join private.bill_reminder_sends s on s.bill_reminder_id = b.id and s.due_date = d.due_date
  where d.due_date - b.days_before = current_date
    and localtime >= b.at_time
    and s.sent_at is null
    and coalesce(s.attempts, 0) < 5;
$$;
revoke execute on function public._bill_reminders_due() from public, anon, authenticated;
grant execute on function public._bill_reminders_due() to service_role;

-- Escrita: substitui ATOMICAMENTE o conjunto de avisos daquele alvo. `[]` remove.
create or replace function private.save_bill_reminder(p_alvo jsonb, p_avisos jsonb, p_channel text)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_tx uuid := nullif(p_alvo ->> 'transaction_id', '')::uuid;
  v_rec uuid := nullif(p_alvo ->> 'recurring_id', '')::uuid;
  v_plan uuid := nullif(p_alvo ->> 'installment_plan_id', '')::uuid;
  v_debt uuid := nullif(p_alvo ->> 'debt_id', '')::uuid;
  v_no int := nullif(p_alvo ->> 'debt_installment_no', '')::int;
  v_inv uuid := nullif(p_alvo ->> 'invoice_id', '')::uuid;
  v_n int := 0;
  a jsonb;
begin
  if auth.uid() is null then raise exception 'Sem sessão' using errcode = '42501'; end if;
  if num_nonnulls(v_tx, v_rec, v_plan, v_debt, v_inv) <> 1 then
    raise exception 'Escolha um registro para lembrar' using errcode = '22023';
  end if;
  if p_channel not in ('push', 'whatsapp', 'both') then
    raise exception 'Canal inválido' using errcode = '22023';
  end if;

  v_ws := coalesce(
    (select workspace_id from public.transactions where id = v_tx),
    (select workspace_id from public.recurring_transactions where id = v_rec),
    (select workspace_id from public.installment_plans where id = v_plan),
    (select workspace_id from public.debts where id = v_debt),
    (select workspace_id from public.card_invoices where id = v_inv));
  if v_ws is null or v_ws not in (select private.my_workspace_ids()) then
    raise exception 'Esse registro não existe mais' using errcode = 'P0001';
  end if;

  delete from public.bill_reminders b
  where b.workspace_id = v_ws
    and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
    and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
    and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv;

  for a in select * from jsonb_array_elements(coalesce(p_avisos, '[]'::jsonb)) loop
    insert into public.bill_reminders (workspace_id, user_id, transaction_id, recurring_id, installment_plan_id,
                                       debt_id, debt_installment_no, invoice_id, days_before, at_time, channel)
    values (v_ws, auth.uid(), v_tx, v_rec, v_plan, v_debt, v_no, v_inv,
            (a ->> 'days_before')::int, (a ->> 'at_time')::time, p_channel);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function private.save_bill_reminder(jsonb, jsonb, text) from public, anon;
grant execute on function private.save_bill_reminder(jsonb, jsonb, text) to authenticated;

create or replace function public.save_bill_reminder(p_alvo jsonb, p_avisos jsonb, p_channel text)
returns integer language sql security invoker set search_path = ''
as $$ select private.save_bill_reminder(p_alvo, p_avisos, p_channel); $$;
revoke execute on function public.save_bill_reminder(jsonb, jsonb, text) from public, anon;
grant execute on function public.save_bill_reminder(jsonb, jsonb, text) to authenticated;

-- Leitura da tela: um item por ALVO, com os avisos e o próximo vencimento (null = sem próximo).
create or replace function private.bill_reminders_overview()
returns table (alvo jsonb, title text, channel text, avisos jsonb, next_due date)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  with mine as (select array_agg(w) as ws from private.my_workspace_ids() w),
  b as (select * from public.bill_reminders where workspace_id in (select private.my_workspace_ids())),
  prox as (
    select d.bill_reminder_id, min(d.due_date) as due
    from private.bill_reminder_dues((select ws from mine)) d where d.due_date >= current_date
    group by 1
  )
  select jsonb_strip_nulls(jsonb_build_object(
           'transaction_id', b.transaction_id, 'recurring_id', b.recurring_id,
           'installment_plan_id', b.installment_plan_id, 'debt_id', b.debt_id,
           'debt_installment_no', b.debt_installment_no, 'invoice_id', b.invoice_id)) as alvo,
         coalesce(
           (select coalesce(t.description, t.merchant, t.category, 'Lançamento') from public.transactions t where t.id = b.transaction_id),
           (select coalesce(r.description, 'Recorrente') from public.recurring_transactions r where r.id = b.recurring_id),
           (select coalesce(p.description, p.merchant, 'Compra parcelada') from public.installment_plans p where p.id = b.installment_plan_id),
           (select d.name from public.debts d where d.id = b.debt_id),
           (select 'Fatura ' || a.name from public.card_invoices ci join public.accounts a on a.id = ci.account_id where ci.id = b.invoice_id)
         ) as title,
         min(b.channel),
         jsonb_agg(jsonb_build_object('days_before', b.days_before, 'at_time', to_char(b.at_time, 'HH24:MI'))
                   order by b.days_before desc, b.at_time),
         min(prox.due)
  from b left join prox on prox.bill_reminder_id = b.id
  group by 1, 2;
$$;
revoke execute on function private.bill_reminders_overview() from public, anon;
grant execute on function private.bill_reminders_overview() to authenticated;

create or replace function public.bill_reminders_overview()
returns table (alvo jsonb, title text, channel text, avisos jsonb, next_due date)
language sql stable security invoker set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$ select * from private.bill_reminders_overview(); $$;
revoke execute on function public.bill_reminders_overview() from public, anon;
grant execute on function public.bill_reminders_overview() to authenticated;
