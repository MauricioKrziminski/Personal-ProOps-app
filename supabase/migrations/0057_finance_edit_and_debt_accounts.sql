-- Shared app/agent invariants for transaction edits and financing payments.
create or replace function public.tg_transactions_set_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  card record;
  win record;
  inv_id uuid;
  old_due date;
begin
  if tg_op = 'UPDATE' and old.invoice_id is not null then
    select due_date into old_due from public.card_invoices where id = old.invoice_id;
  end if;
  select a.type, a.closing_day, a.due_day, a.workspace_id, a.user_id into card
    from public.accounts a where a.id = new.account_id;
  if new.account_id is not null then
    if card.workspace_id is distinct from new.workspace_id then
      raise exception 'Conta precisa pertencer ao workspace do lançamento';
    end if;
  end if;
  if new.account_id is null or card.type is distinct from 'credit_card'
     or card.closing_day is null or card.due_day is null then
    new.invoice_id := null;
    -- Remove only a carried-over invoice deadline, keeping an explicitly changed deadline.
    if tg_op = 'UPDATE' and old.invoice_id is not null
       and new.due_at is not distinct from old.due_at and old.due_at = old_due then
      new.due_at := null;
    end if;
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
  new.due_at := win.due_date;
  return new;
end;
$$;
revoke execute on function public.tg_transactions_set_invoice() from public, anon, authenticated;
drop trigger if exists set_invoice on public.transactions;
create trigger set_invoice before insert or update of account_id, occurred_at, due_at, workspace_id
  on public.transactions for each row execute function public.tg_transactions_set_invoice();

create or replace function public.tg_debts_payment_account()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.account_id is not null and not exists (
    select 1 from public.accounts a where a.id = new.account_id
      and a.workspace_id = new.workspace_id and a.type <> 'credit_card' and not a.archived
  ) then
    raise exception 'Escolha uma conta ativa do mesmo workspace para pagar a dívida';
  end if;
  if new.installments is not null and new.installments < new.installments_paid then
    raise exception 'Total de parcelas não pode ser menor que as parcelas pagas';
  end if;
  return new;
end;
$$;
revoke execute on function public.tg_debts_payment_account() from public, anon, authenticated;
create trigger validate_debt_payment_account before insert or update of account_id, workspace_id, installments, installments_paid
  on public.debts for each row execute function public.tg_debts_payment_account();

-- Preserve the allocation at payment time; never infer historical interest for legacy rows.
alter table public.transactions
  add column debt_payment_no int,
  add column debt_principal_cents bigint,
  add column debt_interest_cents bigint,
  add column debt_balance_after_cents bigint;

create or replace function public.tg_transactions_debt_payment()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  d record;
  debt uuid;
  balance_before bigint;
  economic_change boolean;
begin
  debt := case when tg_op = 'DELETE' then old.debt_id else new.debt_id end;
  if tg_op = 'UPDATE' and new.debt_id is distinct from old.debt_id then
    raise exception 'Não é possível vincular ou desvincular um pagamento já criado';
  end if;
  if debt is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select * into d from public.debts where id = debt for update;
  if d.id is null then raise exception 'Dívida não encontrada'; end if;
  if tg_op <> 'DELETE' then
    if new.kind <> 'expense' or new.status <> 'cleared' or new.workspace_id <> d.workspace_id then
      raise exception 'Pagamento de dívida deve continuar como despesa paga do mesmo workspace';
    end if;
    if new.account_id is not null and not exists (
      select 1 from public.accounts a where a.id = new.account_id and a.workspace_id = d.workspace_id
        and a.type <> 'credit_card' and not a.archived
    ) then raise exception 'Conta pagadora inválida para esta dívida'; end if;
  end if;
  if tg_op = 'INSERT' then
    if d.archived or d.remaining_cents <= 0 then raise exception 'Dívida arquivada ou já quitada'; end if;
    if exists (select 1 from public.transactions t where t.debt_id = debt and t.occurred_at > new.occurred_at) then
      raise exception 'Registre pagamentos em ordem de data';
    end if;
    new.debt_payment_no := d.installments_paid + 1;
    new.debt_interest_cents := ceil(d.remaining_cents::numeric * d.interest_rate_monthly)::bigint;
    new.debt_principal_cents := new.amount_cents - new.debt_interest_cents;
    if new.debt_principal_cents is null or new.debt_principal_cents <= 0 or new.debt_principal_cents > d.remaining_cents then
      raise exception 'Pagamento deve amortizar o saldo e não superar a quitação';
    end if;
    new.debt_balance_after_cents := d.remaining_cents - new.debt_principal_cents;
    update public.debts set remaining_cents = new.debt_balance_after_cents,
      installments_paid = new.debt_payment_no where id = debt;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- The ledger is derived by the database, never accepted from an API patch.
    new.debt_payment_no := old.debt_payment_no;
    new.debt_interest_cents := old.debt_interest_cents;
    new.debt_principal_cents := old.debt_principal_cents;
    new.debt_balance_after_cents := old.debt_balance_after_cents;
    if new.occurred_at is distinct from old.occurred_at and exists (
      select 1 from public.transactions t where t.debt_id = debt and t.id <> old.id
        and ((t.occurred_at <= old.occurred_at and t.occurred_at > new.occurred_at)
          or (t.occurred_at >= old.occurred_at and t.occurred_at < new.occurred_at))
    ) then raise exception 'A nova data mudaria a ordem de amortização dos pagamentos'; end if;
    economic_change := new.amount_cents is distinct from old.amount_cents;
    if not economic_change then return new; end if;
  end if;
  if old.debt_payment_no is null or old.debt_principal_cents is null or old.debt_balance_after_cents is null then
    raise exception 'Pagamento antigo sem histórico de amortização. Valor e exclusão exigem conciliar o saldo em Dívidas e financiamentos';
  end if;
  if old.debt_payment_no <> d.installments_paid or old.debt_balance_after_cents <> d.remaining_cents then
    raise exception 'Corrija primeiro o pagamento mais recente; o saldo mudou após este pagamento';
  end if;
  balance_before := old.debt_balance_after_cents + old.debt_principal_cents;
  if tg_op = 'DELETE' then
    update public.debts set remaining_cents = balance_before,
      installments_paid = installments_paid - 1 where id = debt;
    return old;
  end if;
  new.debt_principal_cents := new.amount_cents - old.debt_interest_cents;
  if new.debt_principal_cents is null or new.debt_principal_cents <= 0 or new.debt_principal_cents > balance_before then
    raise exception 'Correção deve amortizar o saldo e não superar a quitação';
  end if;
  new.debt_balance_after_cents := balance_before - new.debt_principal_cents;
  update public.debts set remaining_cents = new.debt_balance_after_cents where id = debt;
  return new;
end;
$$;
revoke execute on function public.tg_transactions_debt_payment() from public, anon, authenticated;
create trigger sync_debt_payment before insert or update or delete on public.transactions
  for each row execute function public.tg_transactions_debt_payment();

-- The transaction trigger now performs allocation atomically for every writer, including RPC.
create or replace function public.pay_debt_installment(
  p_debt_id uuid, p_amount_cents bigint, p_account_id uuid default null,
  p_paid_at date default current_date
)
returns bigint language plpgsql security invoker set search_path = public as $$
declare d record; result bigint;
begin
  select * into d from public.debts where id = p_debt_id for update;
  if d.id is null then raise exception 'Dívida não encontrada'; end if;
  if p_paid_at is null then raise exception 'Informe a data do pagamento'; end if;
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, category, description,
     account_id, occurred_at, source, status, debt_id)
  values (d.workspace_id, coalesce((select auth.uid()), d.user_id), 'expense',
          p_amount_cents, 'contas', 'Parcela ' || d.name,
          coalesce(p_account_id, d.account_id), p_paid_at, 'app', 'cleared', p_debt_id)
  returning debt_balance_after_cents into result;
  return result;
end;
$$;
