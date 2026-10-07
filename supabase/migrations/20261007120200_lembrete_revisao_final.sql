-- Revisao final do lembrete de conta: (1) salvar de novo nao apaga o registro de envio de quem
-- ficou (nao re-dispara o aviso de hoje); (2) titulo da parcela de divida sem nº de parcelas nao
-- vira NULL, e parcela sem valor nao entra.
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
         coalesce(d.payment_description, 'Parcela ' || d.name) || ' (' || s.installment_no || coalesce('/' || d.installments, '') || ')',
         s.payment_cents, 'debt', d.id
  from r
  join public.debts d on d.id = r.debt_id and not d.archived and d.remaining_cents > 0
  cross join lateral private.debt_schedule_for(d.id) s
  where s.payment_cents is not null
    and (r.debt_installment_no is null or s.installment_no = r.debt_installment_no);
$$;
revoke execute on function private.bill_reminder_dues(uuid[]) from public, anon, authenticated;

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
  v_keys text[];
  v_n int;
  a record;
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

  -- Fica o aviso que já existe com os mesmos dias e hora (só o canal muda): apagá-lo levaria o
  -- registro de envio junto (cascade) e o de hoje tocaria de novo. Sai só o que foi tirado.
  v_keys := array(select distinct (e ->> 'days_before')::int || '|' || (e ->> 'at_time')::time
                  from jsonb_array_elements(coalesce(p_avisos, '[]'::jsonb)) e);

  delete from public.bill_reminders b
  where b.workspace_id = v_ws
    and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
    and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
    and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv
    and not (b.days_before || '|' || b.at_time = any (v_keys));

  update public.bill_reminders b set channel = p_channel
  where b.workspace_id = v_ws
    and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
    and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
    and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv
    and b.channel <> p_channel;

  for a in select split_part(k, '|', 1)::int as db, split_part(k, '|', 2)::time as hr from unnest(v_keys) k
           where not exists (
             select 1 from public.bill_reminders b
             where b.workspace_id = v_ws
               and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
               and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
               and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv
               and b.days_before || '|' || b.at_time = k) loop
    insert into public.bill_reminders (workspace_id, user_id, transaction_id, recurring_id, installment_plan_id,
                                       debt_id, debt_installment_no, invoice_id, days_before, at_time, channel)
    values (v_ws, auth.uid(), v_tx, v_rec, v_plan, v_debt, v_no, v_inv, a.db, a.hr, p_channel);
  end loop;
  return coalesce(cardinality(v_keys), 0);
end $$;
revoke execute on function private.save_bill_reminder(jsonb, jsonb, text) from public, anon;
grant execute on function private.save_bill_reminder(jsonb, jsonb, text) to authenticated;
