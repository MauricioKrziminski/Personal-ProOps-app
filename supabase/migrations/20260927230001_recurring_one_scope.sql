-- Correct exactly one recorded occurrence without changing the recurrence rule or its peers.
-- The request record is committed atomically with the edit, making a lost-response retry safe.
create table if not exists private.recurring_one_edit_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  transaction_id uuid not null,
  patch jsonb not null,
  expected_revision bigint not null,
  result bigint,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table private.recurring_one_edit_requests enable row level security;
drop policy if exists "own recurring one edit requests" on private.recurring_one_edit_requests;
create policy "own recurring one edit requests" on private.recurring_one_edit_requests
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant usage on schema private to authenticated, service_role;
grant select, insert, update on private.recurring_one_edit_requests to authenticated, service_role;

create or replace function public.update_recurring_one(
  p_transaction_id uuid,
  p_patch jsonb,
  p_expected_revision bigint,
  p_request_id uuid
) returns bigint
language plpgsql security invoker
set search_path = public, pg_temp
set timezone to 'America/Sao_Paulo'
as $$
declare
  caller_uid uuid := auth.uid();
  request_row private.recurring_one_edit_requests%rowtype;
  series_row public.recurring_transactions%rowtype;
  line_row public.transactions%rowtype;
  series_id uuid;
  desired_amount bigint;
  desired_category text;
  desired_description text;
  desired_merchant text;
  desired_account uuid;
  desired_date date;
  desired_due date;
  desired_kind text;
  desired_status text;
  desired_auto_confirm boolean;
  changed bigint := 0;
begin
  if caller_uid is null or p_transaction_id is null or p_request_id is null
     or p_expected_revision is null then
    raise exception 'Sessão, ocorrência, revisão e identificador da requisição obrigatórios';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k
             where k not in ('amount_cents', 'category', 'description', 'merchant',
                             'account_id', 'occurred_at', 'due_at', 'kind', 'status',
                             'auto_confirm')) then
    raise exception 'Campo não permitido nesta ocorrência';
  end if;
  if p_patch ? 'amount_cents' and
     (jsonb_typeof(p_patch->'amount_cents') <> 'number'
      or (p_patch->>'amount_cents')::numeric <> trunc((p_patch->>'amount_cents')::numeric)
      or (p_patch->>'amount_cents')::numeric <= 0) then
    raise exception 'O valor precisa ser inteiro e maior que zero';
  end if;
  if p_patch ? 'auto_confirm' and jsonb_typeof(p_patch->'auto_confirm') <> 'boolean' then
    raise exception 'Confirmação automática inválida';
  end if;

  insert into private.recurring_one_edit_requests
    (user_id, request_id, transaction_id, patch, expected_revision)
  values (caller_uid, p_request_id, p_transaction_id, p_patch, p_expected_revision)
  on conflict (user_id, request_id) do nothing;
  select * into request_row from private.recurring_one_edit_requests
    where user_id = caller_uid and request_id = p_request_id for update;
  if request_row.transaction_id is distinct from p_transaction_id
     or request_row.patch is distinct from p_patch
     or request_row.expected_revision is distinct from p_expected_revision then
    raise exception 'Identificador de requisição reutilizado com dados diferentes';
  end if;
  if request_row.result is not null then return request_row.result; end if;

  -- Take locks in the same order as whole-series edits. Recheck the membership after
  -- locking: another writer may have moved or removed the line between the two reads.
  select t.recurring_id into series_id from public.transactions t
    where t.id = p_transaction_id;
  if series_id is null then raise exception 'Ocorrência recorrente não encontrada'; end if;
  select * into series_row from public.recurring_transactions r
    where r.id = series_id for update;
  if series_row.id is null or series_row.workspace_id not in (select private.my_workspace_ids()) then
    raise exception 'Recorrência não encontrada';
  end if;
  select * into line_row from public.transactions t
    where t.id = p_transaction_id for update;
  if line_row.id is null or line_row.recurring_id is distinct from series_row.id
     or line_row.workspace_id is distinct from series_row.workspace_id then
    raise exception 'Ocorrência recorrente não encontrada';
  end if;
  if line_row.edit_revision is distinct from p_expected_revision then
    raise exception 'A ocorrência mudou enquanto você editava. Abra de novo antes de salvar.';
  end if;

  desired_amount := case when p_patch ? 'amount_cents'
    then (p_patch->>'amount_cents')::bigint else line_row.amount_cents end;
  desired_category := case when p_patch ? 'category'
    then p_patch->>'category' else line_row.category end;
  desired_description := case when p_patch ? 'description'
    then p_patch->>'description' else line_row.description end;
  desired_merchant := case when p_patch ? 'merchant'
    then nullif(p_patch->>'merchant', '') else line_row.merchant end;
  desired_account := case when p_patch ? 'account_id'
    then (p_patch->>'account_id')::uuid else line_row.account_id end;
  desired_date := case when p_patch ? 'occurred_at'
    then (p_patch->>'occurred_at')::date else line_row.occurred_at end;
  desired_due := case when p_patch ? 'due_at'
    then (p_patch->>'due_at')::date
    when desired_date is distinct from line_row.occurred_at
       and line_row.invoice_id is null and line_row.due_at = line_row.occurred_at
    then desired_date else line_row.due_at end;
  desired_kind := case when p_patch ? 'kind'
    then p_patch->>'kind' else line_row.kind end;
  desired_status := case when p_patch ? 'status'
    then p_patch->>'status' else line_row.status end;
  desired_auto_confirm := case when p_patch ? 'auto_confirm'
    then (p_patch->>'auto_confirm')::boolean else line_row.auto_confirm end;

  if desired_amount is null or desired_amount <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;
  if p_patch ? 'description' and
     (desired_description is null or btrim(desired_description) = '') then
    raise exception 'Informe a descrição da ocorrência';
  end if;
  if desired_date is null then raise exception 'Informe a data da ocorrência'; end if;
  if desired_kind is null or desired_kind not in ('expense', 'income') then
    raise exception 'Tipo inválido para ocorrência recorrente';
  end if;
  if desired_status is null or desired_status not in ('pending', 'cleared') then
    raise exception 'Status inválido';
  end if;
  if desired_auto_confirm is null then raise exception 'Confirmação automática inválida'; end if;
  if desired_account is distinct from line_row.account_id
     and desired_account is not null and not exists
    (select 1 from public.accounts a where a.id = desired_account
      and a.workspace_id = line_row.workspace_id and not a.archived) then
    raise exception 'Conta precisa ser ativa e do mesmo espaço da ocorrência';
  end if;
  if line_row.invoice_id is not null then
    if desired_status is distinct from line_row.status
       or desired_due is distinct from line_row.due_at then
      raise exception 'Pagamento e vencimento desta ocorrência são controlados pela fatura';
    end if;
    if private.parcela_travada(line_row.status, line_row.invoice_id)
       and (desired_amount is distinct from line_row.amount_cents
         or desired_account is distinct from line_row.account_id
         or desired_date is distinct from line_row.occurred_at
         or desired_kind is distinct from line_row.kind) then
      raise exception 'Ocorrência em fatura paga ou adiada: valor, conta, tipo e data não mudam';
    end if;
  end if;
  if line_row.pays_invoice_id is not null
     and (desired_amount is distinct from line_row.amount_cents
       or desired_account is distinct from line_row.account_id
       or desired_date is distinct from line_row.occurred_at
       or desired_due is distinct from line_row.due_at
       or desired_kind is distinct from line_row.kind
       or desired_status is distinct from line_row.status) then
    raise exception 'Pagamento de fatura precisa ser alterado pelo fluxo da fatura';
  end if;

  if desired_amount is not distinct from line_row.amount_cents
     and desired_category is not distinct from line_row.category
     and desired_description is not distinct from line_row.description
     and desired_merchant is not distinct from line_row.merchant
     and desired_account is not distinct from line_row.account_id
     and desired_date is not distinct from line_row.occurred_at
     and desired_due is not distinct from line_row.due_at
     and desired_kind is not distinct from line_row.kind
     and desired_status is not distinct from line_row.status
     and desired_auto_confirm is not distinct from line_row.auto_confirm then
    changed := 0;
  else
    -- The invoice trigger listens to account_id, occurred_at AND due_at. A text
    -- correction must not mention any of those columns in its SET list.
    if desired_category is distinct from line_row.category
       or desired_description is distinct from line_row.description
       or desired_merchant is distinct from line_row.merchant
       or desired_auto_confirm is distinct from line_row.auto_confirm then
      update public.transactions t set
        category = desired_category,
        description = desired_description, merchant = desired_merchant,
        auto_confirm = desired_auto_confirm
      where t.id = line_row.id;
    end if;
    if desired_amount is distinct from line_row.amount_cents
       or desired_kind is distinct from line_row.kind then
      update public.transactions t set amount_cents = desired_amount,
        kind = desired_kind where t.id = line_row.id;
    end if;
    if desired_status is distinct from line_row.status then
      update public.transactions t set status = desired_status where t.id = line_row.id;
    end if;
    if desired_account is distinct from line_row.account_id
       and desired_date is distinct from line_row.occurred_at then
      update public.transactions t set account_id = desired_account,
        occurred_at = desired_date, due_at = desired_due where t.id = line_row.id;
    elsif desired_account is distinct from line_row.account_id then
      if desired_due is distinct from line_row.due_at then
        update public.transactions t set account_id = desired_account,
          due_at = desired_due where t.id = line_row.id;
      else
        update public.transactions t set account_id = desired_account where t.id = line_row.id;
      end if;
    elsif desired_date is distinct from line_row.occurred_at then
      update public.transactions t set occurred_at = desired_date,
        due_at = desired_due where t.id = line_row.id;
    elsif desired_due is distinct from line_row.due_at then
      update public.transactions t set due_at = desired_due where t.id = line_row.id;
    end if;
    if (desired_account is distinct from line_row.account_id
        or desired_date is distinct from line_row.occurred_at)
       and exists (select 1 from public.transactions t where t.id = line_row.id
         and t.invoice_id is not null and private.parcela_travada(t.status, t.invoice_id)) then
      raise exception 'Esta conta ou data joga a ocorrência em uma fatura paga ou adiada';
    end if;
    -- A whole-series edit with an earlier snapshot must not overwrite this correction.
    -- Bumping the shared revision changes no rule or projected occurrence.
    update public.recurring_transactions r set updated_at = now()
      where r.id = series_row.id;
    changed := 1;
  end if;
  update private.recurring_one_edit_requests set result = changed
    where user_id = caller_uid and request_id = p_request_id;
  return changed;
end;
$$;

revoke execute on function public.update_recurring_one(uuid, jsonb, bigint, uuid)
  from public, anon;
grant execute on function public.update_recurring_one(uuid, jsonb, bigint, uuid)
  to authenticated;
