-- A declared installment is a count, not a ledger entry. Persist its displayed date once so
-- editing the mutable next due date cannot rewrite the past. Amount exceptions stay sparse in
-- debt_declared_estimates; recorded transaction dates continue to take precedence in the app.
create table public.debt_declared_due_dates (
  debt_id uuid not null references public.debts(id) on delete cascade,
  installment_no int not null check (installment_no > 0),
  due_date date not null,
  primary key (debt_id, installment_no)
);
alter table public.debt_declared_due_dates enable row level security;
create policy "workspace debt historical dates" on public.debt_declared_due_dates for all
  using (exists (select 1 from public.debts d where d.id=debt_id
    and d.workspace_id in (select private.my_workspace_ids())))
  with check (exists (select 1 from public.debts d where d.id=debt_id
    and d.workspace_id in (select private.my_workspace_ids())));
grant select, insert, update, delete on public.debt_declared_due_dates to authenticated, service_role;
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public'
         and tablename='debt_declared_due_dates') then
    alter publication supabase_realtime add table public.debt_declared_due_dates;
  end if;
end $$;

-- Future schedule rows include one-installment exceptions. For historical rows the original
-- first_due_date is a stronger anchor than today's schedule, which can advance with time.
create or replace function private.debt_projected_due_date(p_debt_id uuid, p_installment_no int)
returns date language plpgsql stable security invoker
set search_path = public
set "TimeZone" = 'America/Sao_Paulo'
as $$
declare
  d record;
  projected date;
  anchor date;
  target_day int;
begin
  select * into d from public.debts where id=p_debt_id;
  if d.id is null or p_installment_no is null or p_installment_no < 1 then return null; end if;
  target_day := coalesce(d.due_day, extract(day from d.started_at)::int);
  if p_installment_no > d.installments_paid then
    select s.due_date into projected from public.debt_schedule(p_debt_id) s
      where s.installment_no=p_installment_no;
    if projected is not null then return projected; end if;
  end if;
  if d.first_due_date is not null then
    return private.day_in_month(private.add_months(d.first_due_date,p_installment_no-1),target_day);
  end if;
  select s.due_date into anchor from public.debt_schedule(p_debt_id) s
    order by s.installment_no limit 1;
  return private.day_in_month(
    private.add_months(coalesce(anchor,current_date),p_installment_no-d.installments_paid-1),
    target_day);
end;
$$;
revoke execute on function private.debt_projected_due_date(uuid,int) from public, anon;
grant execute on function private.debt_projected_due_date(uuid,int) to authenticated, service_role;

create or replace function private.snapshot_debt_due_dates(
  p_debt_id uuid, p_from_no int, p_to_no int, p_replace boolean default false
) returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_from_no is null or p_to_no is null or p_from_no > p_to_no then return; end if;
  insert into public.debt_declared_due_dates(debt_id,installment_no,due_date)
  select p_debt_id,n,private.debt_projected_due_date(p_debt_id,n)
  from generate_series(greatest(1,p_from_no),p_to_no) n
  on conflict (debt_id,installment_no) do update set due_date=excluded.due_date
    where p_replace and public.debt_declared_due_dates.due_date is distinct from excluded.due_date;
end;
$$;
revoke execute on function private.snapshot_debt_due_dates(uuid,int,int,boolean) from public, anon;
grant execute on function private.snapshot_debt_due_dates(uuid,int,int,boolean) to authenticated, service_role;

create or replace function public.tg_debt_historical_due_dates()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op='INSERT' then
    perform private.snapshot_debt_due_dates(new.id,1,new.installments_paid);
  elsif new.installments_paid > old.installments_paid then
    -- BEFORE UPDATE still sees the old schedule, including a one-parcel exception about to
    -- become the next registered payment. Transaction and snapshot roll back together.
    perform private.snapshot_debt_due_dates(new.id,old.installments_paid+1,new.installments_paid);
  end if;
  return new;
end;
$$;
revoke execute on function public.tg_debt_historical_due_dates() from public, anon, authenticated;
create trigger debt_historical_dates_on_insert after insert on public.debts
  for each row execute function public.tg_debt_historical_due_dates();
create trigger debt_historical_dates_before_paid_count before update of installments_paid on public.debts
  for each row execute function public.tg_debt_historical_due_dates();

-- The scoped contract RPC stores its reply only after all contract changes succeed. Its
-- request row carries both scope and patch, so this trigger can distinguish an intentional
-- all-history date correction from a future-only edit without changing the RPC signature.
create or replace function private.tg_all_debt_dates_requested()
returns trigger language plpgsql security invoker set search_path = public as $$
declare paid int;
begin
  if old.result is null and new.result is not null and new.scope='all'
     and (new.patch ? 'due_day' or new.patch ? 'first_due_date') then
    select installments_paid into paid from public.debts where id=new.debt_id;
    perform private.snapshot_debt_due_dates(new.debt_id,1,paid,true);
  end if;
  return new;
end;
$$;
revoke execute on function private.tg_all_debt_dates_requested() from public, anon, authenticated;
create trigger all_debt_dates_requested after update of result on private.debt_contract_edit_requests
  for each row execute function private.tg_all_debt_dates_requested();

-- Existing displayed dates are only recoverable from the current contract. Capture that
-- best available projection once; later edits preserve it unless All explicitly changes dates.
insert into public.debt_declared_due_dates(debt_id,installment_no,due_date)
select d.id,n,private.debt_projected_due_date(d.id,n)
from public.debts d cross join lateral generate_series(1,d.installments_paid) n
on conflict (debt_id,installment_no) do nothing;
