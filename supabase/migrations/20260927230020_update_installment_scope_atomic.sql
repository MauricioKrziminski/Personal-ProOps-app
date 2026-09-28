-- A scope is selected on Save, then one RPC applies it in one database transaction.
-- Numbering, rather than dates or payment status, defines past and future.
create or replace function public.update_installment_scope(
  p_transaction_id uuid,
  p_scope text,
  p_patch jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  anchor public.transactions%rowtype;
  plan_row public.installment_plans%rowtype;
  line public.transactions%rowtype;
  line_patch jsonb;
  base_description text;
  target_count integer;
  outside_cents bigint;
  target_cents bigint;
  ordinal integer := 0;
  changed bigint := 0;
  line_changed bigint;
  desired_total bigint;
  desired_amount bigint;
  first_date date;
  first_due date;
begin
  if p_scope not in ('one', 'future', 'all') or p_scope is null then
    raise exception 'Escolha quais parcelas editar';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) as key
    where key not in ('amount_cents', 'total_cents', 'category', 'description', 'merchant',
                      'occurred_at', 'status', 'due_at', 'auto_confirm')
  ) then
    raise exception 'Campo não permitido nas parcelas';
  end if;
  if p_patch ? 'amount_cents' and p_patch ? 'total_cents' then
    raise exception 'Informe o valor da parcela ou o total da compra, não os dois';
  end if;

  -- Match the lock order of update_installment_plan and update_installment_occurrence.
  select t.installment_plan_id into anchor.installment_plan_id
    from public.transactions t where t.id = p_transaction_id;
  if anchor.installment_plan_id is null then
    raise exception 'Parcela não encontrada';
  end if;
  select p.* into plan_row from public.installment_plans p
    where p.id = anchor.installment_plan_id for update;
  if plan_row.id is null then
    raise exception 'Compra parcelada não encontrada';
  end if;
  perform 1 from public.transactions t
    where t.installment_plan_id = plan_row.id and t.workspace_id = plan_row.workspace_id
    for update;
  select t.* into anchor from public.transactions t
    where t.id = p_transaction_id and t.installment_plan_id = plan_row.id
      and t.workspace_id = plan_row.workspace_id;
  if anchor.id is null or anchor.installment_no is null then
    raise exception 'Parcela não encontrada';
  end if;

  if p_patch ? 'total_cents' then
    desired_total := (p_patch->>'total_cents')::bigint;
    if desired_total is null or desired_total <= 0 then
      raise exception 'O total da compra precisa ser maior que zero';
    end if;
  end if;

  if p_scope = 'one' then
    line_patch := p_patch - 'total_cents';
    if desired_total is not null then
      desired_amount := anchor.amount_cents + desired_total - plan_row.total_cents;
      if desired_amount <> anchor.amount_cents then
        line_patch := line_patch || jsonb_build_object('amount_cents', desired_amount);
      end if;
    end if;
    if line_patch = '{}'::jsonb then return 0; end if;
    return public.update_installment_occurrence(anchor.id, line_patch);
  end if;

  select count(*), coalesce(sum(t.amount_cents), 0)
    into target_count, target_cents
    from public.transactions t
   where t.installment_plan_id = plan_row.id and t.workspace_id = plan_row.workspace_id
     and (p_scope = 'all' or t.installment_no >= anchor.installment_no);
  if target_count = 0 then raise exception 'Nenhuma parcela encontrada'; end if;

  if desired_total is not null then
    outside_cents := plan_row.total_cents - target_cents;
    target_cents := desired_total - outside_cents;
    if target_cents < target_count then
      raise exception 'O total precisa cobrir as parcelas fora do escopo e deixar pelo menos um centavo por parcela selecionada';
    end if;
  end if;
  if p_patch ? 'description' then
    base_description := regexp_replace(p_patch->>'description', '\s+\([0-9]+/[0-9]+\)$', '');
    if base_description is null or btrim(base_description) = '' then
      raise exception 'Informe o título da compra';
    end if;
  end if;
  if p_patch ? 'occurred_at' then
    first_date := (p_patch->>'occurred_at')::date;
    if first_date is null then raise exception 'Informe a data da parcela'; end if;
  end if;
  if p_patch ? 'due_at' and p_patch->>'due_at' is not null then
    first_due := (p_patch->>'due_at')::date;
  end if;

  for line in
    select t.* from public.transactions t
     where t.installment_plan_id = plan_row.id and t.workspace_id = plan_row.workspace_id
       and (p_scope = 'all' or t.installment_no >= anchor.installment_no)
     order by t.installment_no
  loop
    ordinal := ordinal + 1;
    line_patch := p_patch - 'total_cents';
    if desired_total is not null then
      line_patch := line_patch || jsonb_build_object(
        'amount_cents', private.valor_da_parcela(target_cents, target_count, ordinal));
    end if;
    if p_patch ? 'description' then
      line_patch := line_patch || jsonb_build_object(
        'description', base_description || ' (' || line.installment_no || '/' || plan_row.installments || ')');
    end if;
    if p_patch ? 'occurred_at' then
      line_patch := line_patch || jsonb_build_object(
        'occurred_at', private.add_months(first_date, line.installment_no - anchor.installment_no));
    end if;
    if p_patch ? 'due_at' and first_due is not null then
      line_patch := line_patch || jsonb_build_object(
        'due_at', private.add_months(first_due, line.installment_no - anchor.installment_no));
    end if;
    -- The older one-line RPC allows a cleared bank transaction to change amount because
    -- its guard is invoice-specific. A series edit must never quietly rewrite a paid line.
    if private.parcela_travada(line.status, line.invoice_id) and
       ((line_patch ? 'amount_cents' and (line_patch->>'amount_cents')::bigint is distinct from line.amount_cents)
        or (line_patch ? 'occurred_at' and (line_patch->>'occurred_at')::date is distinct from line.occurred_at)
        or (line_patch ? 'due_at' and (line_patch->>'due_at')::date is distinct from line.due_at)
        or (line_patch ? 'status' and line_patch->>'status' is distinct from line.status)) then
      raise exception 'A parcela % já foi paga ou está em fatura paga, adiada ou parcialmente paga: valor, data e pagamento não mudam',
        line.installment_no;
    end if;
    line_changed := public.update_installment_occurrence(line.id, line_patch);
    changed := changed + line_changed;
  end loop;

  -- Only a complete series rewrite changes the canonical purchase title and metadata.
  if p_scope = 'all' and
      ((p_patch ? 'description' and plan_row.description is distinct from base_description)
       or (p_patch ? 'category' and plan_row.category is distinct from p_patch->>'category')
       or (p_patch ? 'merchant' and plan_row.merchant is distinct from p_patch->>'merchant')) then
    update public.installment_plans p set
      description = case when p_patch ? 'description' then base_description else p.description end,
      category = case when p_patch ? 'category' then p_patch->>'category' else p.category end,
      merchant = case when p_patch ? 'merchant' then p_patch->>'merchant' else p.merchant end,
      updated_at = now()
    where p.id = plan_row.id and p.workspace_id = plan_row.workspace_id;
  end if;
  return changed;
end;
$$;

revoke execute on function public.update_installment_scope(uuid, text, jsonb) from public, anon;
grant execute on function public.update_installment_scope(uuid, text, jsonb) to authenticated;

comment on function public.update_installment_scope(uuid, text, jsonb) is
  'Atomic one, future, or all installment edit anchored by installment_no; total_cents distributes a purchase total over the selected lines.';
