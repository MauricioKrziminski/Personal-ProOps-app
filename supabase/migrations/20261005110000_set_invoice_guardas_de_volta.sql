-- `tg_transactions_set_invoice` perdeu duas guardas na `20261003002625` (F04): o `create or replace`
-- reescreveu o corpo para ler o destino de `private.invoice_target_for` e não repetiu
--   1. "nada que decide a fatura mudou: a linha fica onde está" (`20260926130000`) — renomear uma
--      compra de fatura ADIADA a levava para a fatura seguinte, com o dinheiro junto;
--   2. o `proops.refazer_fatura` (`20260926170000`) — cartão com fechamento/vencimento editados
--      deixa a compra em aberto que cairia numa fatura fechada, paga ou paga em parte onde estava.
-- Achado por `supabase/tests/editar_como_criar.sql` (passo 5) em 05/10/2026. O destino continua
-- vindo de `invoice_target_for` (a mesma régua da prévia do F04, que já segue a fatura adiada).

create or replace function public.tg_transactions_set_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare card record; win record; inv_id uuid; inv_due date; old_due date;
begin
  -- 1. Nada que decide a fatura mudou: a linha fica onde está. `UPDATE OF` dispara com a coluna
  -- só MENCIONADA, e o formulário manda a linha inteira.
  if tg_op = 'UPDATE'
     and coalesce(current_setting('proops.refazer_fatura', true), '') <> 'on'
     and new.account_id is not distinct from old.account_id
     and new.occurred_at is not distinct from old.occurred_at
     and new.workspace_id is not distinct from old.workspace_id
     and new.invoice_id is not distinct from old.invoice_id
     and (old.invoice_id is not null or new.due_at is not distinct from old.due_at) then
    if old.invoice_id is not null then
      new.due_at := old.due_at;
    end if;
    return new;
  end if;

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
  select target.invoice_id,target.due_date into inv_id,inv_due
    from private.invoice_target_for(new.account_id,new.occurred_at) target;

  -- 2. Refazendo pela régua nova: a compra em aberto que cairia numa fatura já fechada, paga ou
  -- paga em parte FICA onde estava — lá ela sumiria do caixa.
  if tg_op = 'UPDATE' and coalesce(current_setting('proops.refazer_fatura', true), '') = 'on'
     and old.invoice_id is not null and inv_id is distinct from old.invoice_id
     and exists (select 1 from public.card_invoices ci
                  where ci.id = inv_id and (ci.status <> 'open' or ci.paid_cents > 0)) then
    new.invoice_id := old.invoice_id;
    new.due_at := old_due;
    return new;
  end if;

  new.invoice_id:=inv_id;
  new.due_at:=inv_due;
  return new;
end $$;
revoke execute on function public.tg_transactions_set_invoice() from public,anon,authenticated;
