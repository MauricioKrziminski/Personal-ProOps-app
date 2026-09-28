-- Preserve displayed historical estimates outside the selected edit scope.
-- A declared installment has no transaction; this table records only exceptions to the
-- contract-derived estimate. Real payments always take precedence in the client.
create table public.debt_declared_estimates (
  debt_id uuid not null references public.debts(id) on delete cascade,
  installment_no int not null check (installment_no > 0),
  amount_cents bigint not null check (amount_cents > 0),
  primary key (debt_id, installment_no)
);
alter table public.debt_declared_estimates enable row level security;
create policy "workspace debt estimates" on public.debt_declared_estimates for all
  using (exists (select 1 from public.debts d where d.id=debt_id
    and d.workspace_id in (select private.my_workspace_ids())))
  with check (exists (select 1 from public.debts d where d.id=debt_id
    and d.workspace_id in (select private.my_workspace_ids())));
grant select, insert, update, delete on public.debt_declared_estimates to authenticated, service_role;

create or replace function public.update_debt_payment_scoped(
  p_anchor_id uuid,
  p_scope text,
  p_patch jsonb,
  p_expected_debt_revision bigint,
  p_expected_anchor_revision bigint,
  p_expected_payment_versions jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  anchor record;
  d record;
  payment record;
  selected_count integer;
  changed_count integer := 0;
  recorded_count integer;
  declared_count integer;
  declared_before_anchor integer;
  declared_recalculated integer := 0;
  old_estimate bigint;
  future_count integer;
  contract_changed boolean := false;
  new_amount bigint;
  new_account uuid;
  new_category text;
  new_description text;
  new_merchant text;
  new_occurred_at date;
  changed boolean;
  caller_uid uuid;
  request_row record;
  response jsonb;
begin
  caller_uid := auth.uid();
  if caller_uid is null then raise exception 'Sessão autenticada obrigatória'; end if;
  if p_request_id is null then raise exception 'Identificador da requisição obrigatório'; end if;
  if p_scope not in ('one', 'from_here', 'all') then
    raise exception 'Escopo de pagamento inválido';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Informe os campos do pagamento';
  end if;
  -- Insert first: concurrent retries of one key serialize on its unique index. A failing RPC
  -- rolls back this row along with every payment update. A committed reply is safe to replay.
  insert into private.debt_payment_edit_requests
    (user_id, request_id, anchor_id, scope, patch, expected_debt_revision,
     expected_anchor_revision, expected_payment_versions)
  values (caller_uid, p_request_id, p_anchor_id, p_scope, p_patch,
          p_expected_debt_revision, p_expected_anchor_revision, p_expected_payment_versions)
  on conflict (user_id, request_id) do nothing;
  select * into request_row from private.debt_payment_edit_requests
    where user_id = caller_uid and request_id = p_request_id for update;
  if request_row.anchor_id is distinct from p_anchor_id
     or request_row.scope is distinct from p_scope
     or request_row.patch is distinct from p_patch
     or request_row.expected_debt_revision is distinct from p_expected_debt_revision
     or request_row.expected_anchor_revision is distinct from p_expected_anchor_revision
     or request_row.expected_payment_versions is distinct from p_expected_payment_versions then
    raise exception 'Identificador de requisição reutilizado com dados diferentes';
  end if;
  if request_row.result is not null then return request_row.result; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k
             where k not in ('amount_cents', 'category', 'description', 'merchant', 'account_id', 'occurred_at')) then
    raise exception 'Campo não permitido na edição de pagamento de dívida';
  end if;
  if p_patch ? 'amount_cents' then
    if jsonb_typeof(p_patch->'amount_cents') <> 'number'
       or (p_patch->>'amount_cents')::numeric <> trunc((p_patch->>'amount_cents')::numeric)
       or (p_patch->>'amount_cents')::numeric <= 0 then
      raise exception 'Valor do pagamento deve ser inteiro e maior que zero';
    end if;
    new_amount := (p_patch->>'amount_cents')::bigint;
  end if;
  if p_patch ? 'account_id' and p_patch->'account_id' <> 'null'::jsonb then
    new_account := (p_patch->>'account_id')::uuid;
  end if;
  if p_patch ? 'category' then new_category := p_patch->>'category'; end if;
  if p_patch ? 'description' then new_description := p_patch->>'description'; end if;
  if p_patch ? 'merchant' then new_merchant := p_patch->>'merchant'; end if;
  if p_patch ? 'occurred_at' then
    if p_scope <> 'one' or p_patch->'occurred_at' = 'null'::jsonb then
      raise exception 'A data da baixa só pode mudar neste pagamento; altere o vencimento das próximas na dívida';
    end if;
    new_occurred_at := (p_patch->>'occurred_at')::date;
  end if;
  if p_scope <> 'one' and
     ((p_patch ? 'category' and new_category is null)
      or (p_patch ? 'description' and new_description is null)) then
    raise exception 'Categoria e descrição das próximas parcelas precisam ter texto; para voltar ao padrão, edite a dívida';
  end if;

  -- Read the anchor to find the debt, then lock debt before payments: the payment trigger locks
  -- debt in this same order. All reads and writes run as the caller under workspace RLS.
  select id, debt_id into anchor from public.transactions where id = p_anchor_id;
  if anchor.id is null or anchor.debt_id is null then raise exception 'Pagamento não encontrado'; end if;
  select * into d from public.debts where id = anchor.debt_id for update;
  if d.id is null or d.calculation_mode not in ('fixed_installments', 'amortized') or d.archived then
    raise exception 'Esta edição exige uma dívida ativa com parcelas';
  end if;
  select * into anchor from public.transactions where id = p_anchor_id and debt_id = d.id for update;
  if anchor.id is null or anchor.debt_payment_no is null or anchor.kind <> 'expense'
     or anchor.status <> 'cleared' or anchor.workspace_id <> d.workspace_id then
    raise exception 'Pagamento de dívida inválido';
  end if;
  if p_scope <> 'one' and exists
    (select 1 from public.transactions t where t.debt_id = d.id and t.debt_payment_no is null) then
    raise exception 'Há pagamento sem número da parcela; não é possível determinar o alcance';
  end if;
  if d.edit_revision is distinct from p_expected_debt_revision
     or anchor.edit_revision is distinct from p_expected_anchor_revision then
    raise exception 'A dívida ou o pagamento mudou enquanto você editava';
  end if;

  -- Snapshot and lock every selected payment before the first write. A complete version map
  -- detects concurrent edits to non-anchor rows, including metadata edits that do not touch debt.
  perform 1 from public.transactions t
    where t.debt_id = d.id and
      (p_scope = 'all' or (p_scope = 'from_here' and t.debt_payment_no >= anchor.debt_payment_no)
       or (p_scope = 'one' and t.id = anchor.id))
    order by t.debt_payment_no, t.id for update;
  select count(*) into selected_count from public.transactions t
    where t.debt_id = d.id and
      (p_scope = 'all' or (p_scope = 'from_here' and t.debt_payment_no >= anchor.debt_payment_no)
       or (p_scope = 'one' and t.id = anchor.id));
  if p_expected_payment_versions is null
     or jsonb_typeof(p_expected_payment_versions) <> 'object'
     or (select count(*) from jsonb_object_keys(p_expected_payment_versions)) <> selected_count
     or exists (
       select 1 from public.transactions t
       where t.debt_id = d.id and
         (p_scope = 'all' or (p_scope = 'from_here' and t.debt_payment_no >= anchor.debt_payment_no)
          or (p_scope = 'one' and t.id = anchor.id))
         and (not p_expected_payment_versions ? t.id::text
           or t.edit_revision is distinct from (p_expected_payment_versions->>t.id::text)::bigint)
     ) then
    raise exception 'Outro pagamento mudou enquanto você editava';
  end if;
  if exists (
    select 1 from public.transactions t
    where t.debt_id = d.id and
      (p_scope = 'all' or (p_scope = 'from_here' and t.debt_payment_no >= anchor.debt_payment_no)
       or (p_scope = 'one' and t.id = anchor.id))
      and (t.debt_payment_no is null or t.debt_principal_cents is null
           or t.invoice_id is not null or t.pays_invoice_id is not null)
  ) then raise exception 'Pagamento com histórico incompleto ou vinculado a fatura'; end if;
  if p_patch ? 'account_id' and new_account is not null and not exists (
    select 1 from public.accounts a where a.id = new_account and a.workspace_id = d.workspace_id
      and a.type <> 'credit_card' and not a.archived
  ) then raise exception 'Conta pagadora inválida para esta dívida'; end if;
  select count(*) into recorded_count from public.transactions where debt_id = d.id;
  select count(*) into declared_count
  from generate_series(1, greatest(d.installments_paid,
    coalesce((select max(t.debt_payment_no) from public.transactions t where t.debt_id = d.id), 0))) n
  where not exists (select 1 from public.transactions t where t.debt_id = d.id and t.debt_payment_no = n);
  if p_patch ? 'amount_cents' then
    old_estimate := coalesce(d.installment_cents,
      (select s.payment_cents from public.debt_schedule(d.id) s order by s.installment_no limit 1));
    if p_scope = 'all' then
      -- Even if the new value equals today's contract, an earlier scoped edit may have
      -- preserved old estimates. All explicitly replaces them with the contract value.
      delete from public.debt_declared_estimates where debt_id = d.id;
      declared_recalculated := declared_count;
    elsif p_scope = 'from_here' then
      if new_amount is distinct from d.installment_cents then
        select count(*) into declared_before_anchor
        from generate_series(1, least(anchor.debt_payment_no - 1, d.installments_paid)) n
        where not exists (select 1 from public.transactions t
                          where t.debt_id = d.id and t.debt_payment_no = n);
        if declared_before_anchor > 0 and coalesce(old_estimate, 0) <= 0 then
          raise exception 'Não é possível preservar as estimativas anteriores desta dívida';
        end if;
        insert into public.debt_declared_estimates(debt_id, installment_no, amount_cents)
        select d.id, n, old_estimate
        from generate_series(1, least(anchor.debt_payment_no - 1, d.installments_paid)) n
        where not exists (select 1 from public.transactions t
                          where t.debt_id = d.id and t.debt_payment_no = n)
        on conflict (debt_id, installment_no) do nothing;
      end if;
      delete from public.debt_declared_estimates
        where debt_id = d.id and installment_no >= anchor.debt_payment_no;
      select count(*) into declared_recalculated
      from generate_series(anchor.debt_payment_no, d.installments_paid) n
      where not exists (select 1 from public.transactions t
                        where t.debt_id = d.id and t.debt_payment_no = n);
    elsif d.calculation_mode = 'amortized' and d.installment_cents is null then
      -- Correcting one recorded principal changes the next Price estimate. A declared
      -- historical row outside this scope must keep what the user saw before the edit.
      if declared_count > 0 and coalesce(old_estimate, 0) <= 0 then
        raise exception 'Não é possível preservar as estimativas anteriores desta dívida';
      end if;
      insert into public.debt_declared_estimates(debt_id, installment_no, amount_cents)
      select d.id, n, old_estimate
      from generate_series(1, d.installments_paid) n
      where not exists (select 1 from public.transactions t
                        where t.debt_id = d.id and t.debt_payment_no = n)
      on conflict (debt_id, installment_no) do nothing;
    end if;
  end if;

  -- Do paid-cash edits while the contract still has its OLD installment. The existing trigger
  -- thereby keeps every recorded principal and computes amount - principal as fee/discount.
  for payment in
    select t.* from public.transactions t
    where t.debt_id = d.id and
      (p_scope = 'all' or (p_scope = 'from_here' and t.debt_payment_no >= anchor.debt_payment_no)
       or (p_scope = 'one' and t.id = anchor.id))
    order by t.debt_payment_no, t.id
  loop
    changed := (p_patch ? 'amount_cents' and payment.amount_cents is distinct from new_amount)
      or (p_patch ? 'category' and payment.category is distinct from new_category)
      or (p_patch ? 'description' and payment.description is distinct from new_description)
      or (p_patch ? 'merchant' and payment.merchant is distinct from new_merchant)
      or (p_patch ? 'account_id' and payment.account_id is distinct from new_account);
    changed := changed or (p_patch ? 'occurred_at' and payment.occurred_at is distinct from new_occurred_at);
    if changed then
      update public.transactions t set
        amount_cents = case when p_patch ? 'amount_cents' then new_amount else t.amount_cents end,
        category = case when p_patch ? 'category' then new_category else t.category end,
        description = case when p_patch ? 'description' then new_description else t.description end,
        merchant = case when p_patch ? 'merchant' then new_merchant else t.merchant end,
        account_id = case when p_patch ? 'account_id' then new_account else t.account_id end,
        occurred_at = case when p_patch ? 'occurred_at' then new_occurred_at else t.occurred_at end
      where t.id = payment.id;
      changed_count := changed_count + 1;
    end if;
  end loop;

  if p_scope <> 'one' then
    contract_changed := (p_patch ? 'amount_cents' and d.installment_cents is distinct from new_amount)
      or (p_patch ? 'category' and d.payment_category is distinct from new_category)
      or (p_patch ? 'description' and d.payment_description is distinct from new_description)
      or (p_patch ? 'merchant' and d.payment_merchant is distinct from new_merchant)
      or (p_patch ? 'account_id' and d.account_id is distinct from new_account);
    if contract_changed then
      update public.debts set
        installment_cents = case when p_patch ? 'amount_cents' then new_amount else installment_cents end,
        principal_cents = case when p_patch ? 'amount_cents' and d.calculation_mode = 'fixed_installments'
          then new_amount * installments else principal_cents end,
        remaining_cents = case when p_patch ? 'amount_cents' and d.calculation_mode = 'fixed_installments'
          then new_amount * (installments - installments_paid) else remaining_cents end,
        payment_category = case when p_patch ? 'category' then new_category else payment_category end,
        payment_description = case when p_patch ? 'description' then new_description else payment_description end,
        payment_merchant = case when p_patch ? 'merchant' then new_merchant else payment_merchant end,
        account_id = case when p_patch ? 'account_id' then new_account else account_id end
      where id = d.id;
    end if;
  end if;

  -- In Price, recorded payments changed the remaining principal through the ledger trigger.
  -- A chosen future installment must still amortize interest and leave every promised slot
  -- in the schedule. The final payment may differ to settle rounding or a remaining balance.
  if d.calculation_mode = 'amortized' and d.installments > d.installments_paid then
    if (select count(*) from public.debt_schedule(d.id)) <> d.installments - d.installments_paid
       or exists (select 1 from public.debt_schedule(d.id) s
                  where s.principal_cents is null or s.principal_cents <= 0) then
      raise exception 'O valor escolhido não mantém o cronograma de parcelas da dívida com juros';
    end if;
  end if;

  future_count := greatest(d.installments - d.installments_paid, 0);
  response := jsonb_build_object(
    'recorded_changed', changed_count,
    'declared_only_estimates_without_ledger', declared_count,
    'declared_estimates_recalculated', declared_recalculated,
    'future_installments', future_count,
    'contract_changed', contract_changed
  );
  update private.debt_payment_edit_requests set result = response
    where user_id = caller_uid and request_id = p_request_id;
  return response;
end;
$$;
revoke execute on function public.update_debt_payment_scoped(uuid, text, jsonb, bigint, bigint, jsonb, uuid)
  from public, anon;
grant execute on function public.update_debt_payment_scoped(uuid, text, jsonb, bigint, bigint, jsonb, uuid)
  to authenticated, service_role;
