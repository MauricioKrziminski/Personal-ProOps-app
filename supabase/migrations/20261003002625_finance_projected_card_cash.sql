-- The projected posting and the real posting resolve the SAME invoice target,
-- including a chain that has already moved the original invoice to a later one.
create function private.invoice_target_for(p_account_id uuid,p_occurred_at date)
returns table(invoice_id uuid,reference_month date,closing_date date,due_date date,
  invoice_status text,invoice_paid_at date)
language plpgsql stable security invoker
set search_path = public
set timezone = 'America/Sao_Paulo'
as $$
declare card record; win record; inv public.card_invoices%rowtype; next_id uuid;
begin
  select a.type,a.closing_day,a.due_day,a.closing_day_inclusive into card
    from public.accounts a where a.id=p_account_id;
  if not found or card.type is distinct from 'credit_card'
    or card.closing_day is null or card.due_day is null or p_occurred_at is null then return; end if;
  select * into win from private.invoice_window(card.closing_day,card.due_day,p_occurred_at,
    coalesce(card.closing_day_inclusive,false));
  select ci.* into inv from public.card_invoices ci
    where ci.account_id=p_account_id and ci.reference_month=win.reference_month;
  if not found then
    return query select null::uuid,win.reference_month,win.closing_date,win.due_date,null::text,null::date;
    return;
  end if;
  -- Same loop bound and stop rule as the real transaction trigger.
  for i in 1..12 loop
    next_id:=case when inv.status='rolled' then inv.rolled_into_invoice_id else null end;
    exit when next_id is null;
    select ci.* into inv from public.card_invoices ci where ci.id=next_id;
  end loop;
  return query select inv.id,inv.reference_month,inv.closing_date,inv.due_date,inv.status,inv.paid_at;
end $$;
revoke execute on function private.invoice_target_for(uuid,date) from public,anon;
grant execute on function private.invoice_target_for(uuid,date) to authenticated,service_role;

-- Existing guards, invoice creation and due_at clearing stay at the real write boundary.
create or replace function public.tg_transactions_set_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare card record; win record; inv_id uuid; old_due date;
begin
  if tg_op='UPDATE' and old.invoice_id is not null then
    select ci.due_date into old_due from public.card_invoices ci where ci.id=old.invoice_id;
  end if;
  select a.type,a.closing_day,a.due_day,a.workspace_id,a.user_id,a.closing_day_inclusive
    into card from public.accounts a where a.id=new.account_id;
  if new.account_id is not null then
    if card.workspace_id is distinct from new.workspace_id then
      raise exception 'Conta precisa pertencer ao workspace do lançamento';
    end if;
  end if;
  if new.account_id is null or card.type is distinct from 'credit_card'
    or card.closing_day is null or card.due_day is null then
    new.invoice_id:=null;
    if tg_op='UPDATE' and old.invoice_id is not null
      and new.due_at is not distinct from old.due_at and old.due_at=old_due then
      new.due_at:=null;
    end if;
    return new;
  end if;
  select * into win from private.invoice_window(card.closing_day,card.due_day,new.occurred_at,
    coalesce(card.closing_day_inclusive,false));
  insert into public.card_invoices(workspace_id,user_id,account_id,reference_month,closing_date,due_date)
    values(card.workspace_id,coalesce(new.user_id,card.user_id),new.account_id,
      win.reference_month,win.closing_date,win.due_date)
    on conflict(account_id,reference_month) do nothing;
  select target.invoice_id,target.due_date into inv_id,new.due_at
    from private.invoice_target_for(new.account_id,new.occurred_at) target;
  new.invoice_id:=inv_id;
  return new;
end $$;
revoke execute on function public.tg_transactions_set_invoice() from public,anon,authenticated;

-- One event source feeds both the total forecast and the forecast per bank account.
create or replace function private.eventos_de_caixa(ws_ids uuid[],ate date)
returns table(account_id uuid,day date,in_cents bigint,out_cents bigint)
language sql stable
set search_path = public
set timezone = 'America/Sao_Paulo'
as $$
  select c.payment_account_id,greatest(ci.due_date,current_date),0::bigint,private.invoice_open_cents(ci.id)
  from public.card_invoices ci join public.accounts c on c.id=ci.account_id
  where ci.workspace_id=any(ws_ids) and ci.status not in('paid','rolled')
    and exists(select 1 from public.transactions t where t.invoice_id=ci.id and private.conta_na_fatura(t.kind))
    and greatest(ci.due_date,current_date)<=ate
  union all
  select t.account_id,greatest(coalesce(t.due_at,t.occurred_at),current_date),
    case when t.kind='income' then t.amount_cents else 0 end::bigint,
    case when t.kind='expense' then t.amount_cents else 0 end::bigint
  from public.transactions t
  where t.workspace_id=any(ws_ids) and t.status='pending' and t.invoice_id is null
    and t.kind<>'transfer'
    and (t.kind<>'income' or coalesce(t.due_at,t.occurred_at)>=current_date-3)
    and greatest(coalesce(t.due_at,t.occurred_at),current_date)<=ate
  union all
  select t.account_id,greatest(coalesce(t.due_at,t.occurred_at),current_date),0::bigint,t.amount_cents
  from public.transactions t
  join public.accounts o on o.id=t.account_id and o.type<>'credit_card'
  join public.accounts d on d.id=t.counterparty_account_id and d.type<>'credit_card'
  where t.workspace_id=any(ws_ids) and t.status='pending' and t.kind='transfer'
    and greatest(coalesce(t.due_at,t.occurred_at),current_date)<=ate
  union all
  select t.counterparty_account_id,greatest(coalesce(t.due_at,t.occurred_at),current_date),t.amount_cents,0::bigint
  from public.transactions t
  join public.accounts o on o.id=t.account_id and o.type<>'credit_card'
  join public.accounts d on d.id=t.counterparty_account_id and d.type<>'credit_card'
  where t.workspace_id=any(ws_ids) and t.status='pending' and t.kind='transfer'
    and greatest(coalesce(t.due_at,t.occurred_at),current_date)<=ate
  union all
  select d.account_id,greatest(s.due_date,current_date),0::bigint,s.payment_cents
  from public.debts d cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id=any(ws_ids) and not d.archived and d.remaining_cents>0 and s.due_date<=ate
  union all
  -- Bank/null origins keep their occurrence dates. Card expense reaches bank cash
  -- only at its resolved invoice due date; no payer is the existing "Sem conta" bucket.
  -- Legacy card income and absent card calendars cannot invent spendable bank cash.
  select case when a.type='credit_card' then a.payment_account_id else p.account_id end,
    case when a.type='credit_card' then greatest(target.due_date,current_date) else p.due_date end,
    case when p.kind='income' then p.amount_cents else 0 end::bigint,
    case when p.kind='expense' then p.amount_cents else 0 end::bigint
  from private.recurring_projection_for(ws_ids,current_date,ate) p
  left join public.accounts a on a.id=p.account_id
  left join lateral private.invoice_target_for(p.account_id,p.due_date) target on a.type='credit_card'
  where a.type is distinct from 'credit_card'
    or (p.kind='expense' and target.due_date is not null and greatest(target.due_date,current_date)<=ate);
$$;
revoke execute on function private.eventos_de_caixa(uuid[],date) from public,anon;
grant execute on function private.eventos_de_caixa(uuid[],date) to authenticated,service_role;
