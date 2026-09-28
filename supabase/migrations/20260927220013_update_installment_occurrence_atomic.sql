-- "Só esta parcela" edits the line and its plan total in one database transaction.
-- The plan's title/category/account remain unchanged for an individual correction.
-- Installment 1 also anchors the purchase date. Repeating the same save does no writes.
create or replace function public.update_installment_occurrence(
  p_transaction_id uuid,
  p_patch jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  anchor public.transactions%rowtype;
  locked_plan_id uuid;
  plan_workspace uuid;
  desired_amount bigint;
  desired_category text;
  desired_description text;
  desired_merchant text;
  desired_date date;
  desired_status text;
  desired_due date;
  desired_auto_confirm boolean;
  plan_total bigint;
  changed bigint;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) as key
     where key not in ('amount_cents', 'category', 'description', 'merchant',
                       'occurred_at', 'status', 'due_at', 'auto_confirm')
  ) then
    raise exception 'Campo não permitido nesta parcela';
  end if;

  -- Lock in the same order as update_installment_plan (plan, then line), so the purchase
  -- cannot be repartitioned between reading its installments and recomputing the total.
  select t.installment_plan_id into locked_plan_id
    from public.transactions t where t.id = p_transaction_id;
  if locked_plan_id is null then
    raise exception 'Parcela não encontrada';
  end if;
  select p.workspace_id into plan_workspace
    from public.installment_plans p where p.id = locked_plan_id for update;
  if plan_workspace is null then
    raise exception 'Compra parcelada não encontrada';
  end if;
  select t.* into anchor
    from public.transactions t where t.id = p_transaction_id for update;
  if anchor.id is null or anchor.installment_plan_id is distinct from locked_plan_id
     or anchor.workspace_id <> plan_workspace then
    raise exception 'Parcela não encontrada';
  end if;

  desired_amount := case when p_patch ? 'amount_cents'
                         then (p_patch->>'amount_cents')::bigint else anchor.amount_cents end;
  desired_category := case when p_patch ? 'category'
                           then p_patch->>'category' else anchor.category end;
  desired_description := case when p_patch ? 'description'
                              then p_patch->>'description' else anchor.description end;
  desired_merchant := case when p_patch ? 'merchant'
                           then p_patch->>'merchant' else anchor.merchant end;
  desired_date := case when p_patch ? 'occurred_at'
                       then (p_patch->>'occurred_at')::date else anchor.occurred_at end;
  desired_status := case when p_patch ? 'status'
                         then p_patch->>'status' else anchor.status end;
  desired_due := case when p_patch ? 'due_at'
                      then (p_patch->>'due_at')::date else anchor.due_at end;
  desired_auto_confirm := case when p_patch ? 'auto_confirm'
                               then (p_patch->>'auto_confirm')::boolean else anchor.auto_confirm end;

  if desired_amount is null or desired_amount <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;
  if desired_description is null or btrim(desired_description) = '' then
    raise exception 'Informe o título da parcela';
  end if;
  if desired_date is null then
    raise exception 'Informe a data da parcela';
  end if;
  if desired_status not in ('pending', 'cleared') or desired_status is null then
    raise exception 'Status inválido';
  end if;
  if desired_auto_confirm is null then
    raise exception 'Confirmação automática inválida';
  end if;
  if anchor.invoice_id is not null then
    -- The card's settlement belongs to the invoice workflow. A paid/rolled/partly paid
    -- invoice also freezes the monetary amount and calendar date of its line.
    if desired_status is distinct from anchor.status then
      raise exception 'O pagamento desta parcela é controlado pela fatura';
    end if;
    if private.parcela_travada(anchor.status, anchor.invoice_id)
       and (desired_amount is distinct from anchor.amount_cents
         or desired_date is distinct from anchor.occurred_at
         or desired_due is distinct from anchor.due_at) then
      raise exception 'Parcela em fatura paga ou adiada: valor e data não mudam';
    end if;
  end if;

  if desired_amount is not distinct from anchor.amount_cents
     and desired_category is not distinct from anchor.category
     and desired_description is not distinct from anchor.description
     and desired_merchant is not distinct from anchor.merchant
     and desired_date is not distinct from anchor.occurred_at
     and desired_status is not distinct from anchor.status
     and desired_due is not distinct from anchor.due_at
     and desired_auto_confirm is not distinct from anchor.auto_confirm then
    return 0;
  end if;

  update public.transactions t set
    amount_cents = desired_amount,
    category = desired_category,
    description = desired_description,
    merchant = desired_merchant,
    occurred_at = desired_date,
    status = desired_status,
    due_at = desired_due,
    auto_confirm = desired_auto_confirm
   where t.id = anchor.id and t.workspace_id = plan_workspace
     and t.installment_plan_id = anchor.installment_plan_id;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Parcela não encontrada para salvar';
  end if;
  if desired_date is distinct from anchor.occurred_at and exists (
    select 1 from public.transactions t
     where t.id = anchor.id and t.invoice_id is not null
       and private.parcela_travada(t.status, t.invoice_id)
  ) then
    -- set_invoice may have assigned the line to a protected invoice even though its
    -- previous invoice was open. The exception rolls the trigger's assignment back too.
    raise exception 'Esta data joga a parcela dentro de uma fatura paga ou adiada';
  end if;

  if anchor.installment_no = 1 and desired_date is distinct from anchor.occurred_at then
    -- The purchase editor derives its calendar from this date. Leaving the old anchor
    -- would revert a correction to installment 1 on the next whole-purchase edit.
    update public.installment_plans p
       set first_occurred_at = desired_date, updated_at = now()
     where p.id = anchor.installment_plan_id and p.workspace_id = plan_workspace;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'Não consegui salvar a data inicial da compra';
    end if;
  end if;

  if desired_amount is distinct from anchor.amount_cents then
    select sum(t.amount_cents) into plan_total
      from public.transactions t
     where t.installment_plan_id = anchor.installment_plan_id
       and t.workspace_id = plan_workspace;
    if plan_total is null or plan_total <= 0 then
      raise exception 'Não consegui recalcular o total da compra';
    end if;
    update public.installment_plans p
       set total_cents = plan_total, updated_at = now()
     where p.id = anchor.installment_plan_id and p.workspace_id = plan_workspace;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'Não consegui salvar o total da compra';
    end if;
  end if;
  return 1;
end;
$$;

revoke execute on function public.update_installment_occurrence(uuid, jsonb) from public, anon;
grant execute on function public.update_installment_occurrence(uuid, jsonb) to authenticated;

comment on function public.update_installment_occurrence(uuid, jsonb) is
  'Corrige uma única parcela e recalcula o total quando o valor muda; a data inicial acompanha só a parcela 1. Título, categoria e conta do plano não mudam.';
