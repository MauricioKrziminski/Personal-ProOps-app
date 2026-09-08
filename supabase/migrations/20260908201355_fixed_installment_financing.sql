-- Fixed installments track the contractual payable total; interest is included,
-- but its allocation is unknown. Zero is an internal arithmetic value only.
alter table public.debts
  add column calculation_mode text not null default 'amortized',
  add constraint debts_calculation_mode_check check (calculation_mode in ('amortized', 'fixed_installments')),
  add constraint debts_fixed_installments_check check (
    calculation_mode <> 'fixed_installments' or (
      installment_cents is not null and installment_cents > 0
      and installments is not null and installments > 0
      and installments_paid between 0 and installments
      and interest_rate_monthly = 0
      and principal_cents::numeric = installment_cents::numeric * installments
      and remaining_cents::numeric = installment_cents::numeric * (installments - installments_paid)
    )
  );
comment on column public.debts.calculation_mode is
  'amortized: remaining principal and known interest rate; fixed_installments: remaining contractual installments, interest allocation unknown (rate zero is internal).';

create or replace function public.tg_debts_calculation_mode()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.calculation_mode is distinct from old.calculation_mode then
    raise exception 'O modo de cálculo não pode ser alterado. Cadastre outro financiamento para um novo contrato';
  end if;
  if old.calculation_mode = 'fixed_installments' and (
    new.principal_cents is distinct from old.principal_cents
    or new.installment_cents is distinct from old.installment_cents
    or new.installments is distinct from old.installments
  ) and exists (select 1 from public.transactions where debt_id = old.id) then
    raise exception 'Não altere o contrato de parcelas fixas após registrar pagamentos';
  end if;
  if old.calculation_mode = 'fixed_installments' and pg_trigger_depth() = 1
    and (new.remaining_cents is distinct from old.remaining_cents
      or new.installments_paid is distinct from old.installments_paid)
    and exists (select 1 from public.transactions where debt_id = old.id) then
    raise exception 'Corrija os pagamentos registrados para alterar o saldo das parcelas fixas';
  end if;
  return new;
end;
$$;
revoke execute on function public.tg_debts_calculation_mode() from public, anon, authenticated;
create trigger validate_debt_calculation_mode before update on public.debts
  for each row execute function public.tg_debts_calculation_mode();

-- Run before sync_debt_payment, retaining its atomic ledger and account checks.
create or replace function public.tg_fixed_installment_payment()
returns trigger language plpgsql security invoker set search_path = public as $$
declare d record;
begin
  if new.debt_id is null then return new; end if;
  select * into d from public.debts where id = new.debt_id for update;
  if d.calculation_mode = 'fixed_installments' then
    if (tg_op = 'INSERT' and new.amount_cents is distinct from d.installment_cents)
      or (tg_op = 'UPDATE' and new.amount_cents is distinct from old.amount_cents) then
      raise exception 'No modo simples, registre o valor integral da parcela. Pagamentos parciais ou valores diferentes exigem um contrato com cálculo detalhado';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.tg_fixed_installment_payment() from public, anon, authenticated;
create trigger check_fixed_installment_payment before insert or update on public.transactions
  for each row execute function public.tg_fixed_installment_payment();

create or replace function private.debt_schedule_for(p_debt_id uuid)
returns table(
  installment_no int, due_date date, payment_cents bigint,
  interest_cents bigint, principal_cents bigint, balance_cents bigint
)
language sql stable
set search_path = public
as $$
  with recursive d as (
    select id, remaining_cents, interest_rate_monthly, due_day, calculation_mode,
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
         case when (select calculation_mode from d) = 'fixed_installments' then null::bigint
              else ceil(a.saldo_inicial::numeric * a.taxa)::bigint end as interest_cents,
         case when (select calculation_mode from d) = 'fixed_installments' then null::bigint
              when a.installment_no = a.n
              then a.saldo_inicial
              else a.parcela - ceil(a.saldo_inicial::numeric * a.taxa)::bigint end as principal_cents,
         greatest(
           a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
           - case when a.installment_no = a.n
                  then a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
                  else a.parcela end,
           0) as balance_cents
  from amortizacao a
  where (select calculation_mode from d) <> 'fixed_installments'
     or (a.saldo_inicial > 0 and a.n > 0)
  order by a.installment_no;
$$;
grant execute on function private.debt_schedule_for(uuid) to authenticated, service_role;

create or replace function private.payoff_strategy_for(ws_ids uuid[], estrategia text)
returns table(
  priority int, debt_id uuid, name text, remaining_cents bigint,
  interest_rate_monthly numeric, months_left int, total_interest_cents bigint
)
language sql stable
set search_path = public
as $$
  select row_number() over (
           order by case when estrategia = 'avalanche' and d.calculation_mode = 'amortized' then d.interest_rate_monthly end desc nulls last,
                    case when estrategia = 'avalanche' then d.remaining_cents end asc,
                    case when estrategia <> 'avalanche' then d.remaining_cents end asc
         )::int,
         d.id, d.name, d.remaining_cents,
         case when d.calculation_mode = 'amortized' then d.interest_rate_monthly end,
         coalesce((select count(*)::int from private.debt_schedule_for(d.id)), 0),
         case when d.calculation_mode = 'amortized' then
           coalesce((select sum(s.interest_cents)::bigint from private.debt_schedule_for(d.id) s), 0) end
  from public.debts d
  where d.workspace_id = any(ws_ids) and not d.archived and d.remaining_cents > 0;
$$;
grant execute on function private.payoff_strategy_for(uuid[], text) to authenticated, service_role;

