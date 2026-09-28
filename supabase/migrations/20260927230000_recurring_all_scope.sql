-- A correction to an entire recurring series must include recorded occurrences. The
-- request key makes a retry after a lost HTTP response return the first result without
-- moving dates or changing revisions twice.
alter table public.recurring_transactions
  add column if not exists edit_revision bigint not null default 0;
drop trigger if exists zz_edit_revision on public.recurring_transactions;
create trigger zz_edit_revision before update on public.recurring_transactions
  for each row execute function public.tg_finance_edit_revision();

create table if not exists private.recurring_all_edit_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  recurring_id uuid not null,
  line_patch jsonb not null,
  series_patch jsonb not null,
  expected_revision bigint not null,
  result bigint,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table private.recurring_all_edit_requests enable row level security;
drop policy if exists "own recurring edit requests" on private.recurring_all_edit_requests;
create policy "own recurring edit requests" on private.recurring_all_edit_requests
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update on private.recurring_all_edit_requests to authenticated, service_role;

create or replace function public.update_recurring_all(
  p_recurring_id uuid,
  p_line_patch jsonb,
  p_series_patch jsonb,
  p_expected_revision bigint,
  p_request_id uuid
) returns bigint
language plpgsql security invoker
set search_path = public, pg_temp
set timezone to 'America/Sao_Paulo'
as $$
declare
  caller_uid uuid := auth.uid();
  series_row public.recurring_transactions%rowtype;
  request_row private.recurring_all_edit_requests%rowtype;
  line_row public.transactions%rowtype;
  contract_patch jsonb;
  new_rule text;
  new_date date;
  new_amount bigint;
  new_category text;
  new_description text;
  new_merchant text;
  new_account uuid;
  new_kind text;
  new_auto_confirm boolean;
  new_day int;
  new_month int;
  new_dow int;
  changed bigint := 0;
  future_changed bigint := 0;
begin
  if caller_uid is null or p_request_id is null then
    raise exception 'Sessão e identificador da requisição obrigatórios';
  end if;
  if p_line_patch is null or jsonb_typeof(p_line_patch) <> 'object'
     or p_series_patch is null or jsonb_typeof(p_series_patch) <> 'object' then
    raise exception 'Alterações precisam ser objetos';
  end if;
  if p_line_patch = '{}'::jsonb and p_series_patch = '{}'::jsonb then return 0; end if;
  if exists (select 1 from jsonb_object_keys(p_line_patch) k
             where k not in ('amount_cents','category','description','merchant','account_id')) then
    raise exception 'Campo não permitido nas ocorrências';
  end if;
  if exists (select 1 from jsonb_object_keys(p_series_patch) k
             where k not in ('amount_cents','category','description','merchant','account_id',
                             'kind','auto_confirm','end_date','rrule','next_run_at')) then
    raise exception 'Campo não permitido na recorrência';
  end if;
  if (p_series_patch ? 'rrule') <> (p_series_patch ? 'next_run_at') then
    raise exception 'Repetição e próximo vencimento mudam juntos';
  end if;

  -- The unique key serializes duplicate deliveries of the same request. A failed edit
  -- rolls this row back together with the financial changes.
  insert into private.recurring_all_edit_requests
    (user_id, request_id, recurring_id, line_patch, series_patch, expected_revision)
  values (caller_uid, p_request_id, p_recurring_id, p_line_patch, p_series_patch, p_expected_revision)
  on conflict (user_id, request_id) do nothing;
  select * into request_row from private.recurring_all_edit_requests
    where user_id = caller_uid and request_id = p_request_id for update;
  if request_row.recurring_id is distinct from p_recurring_id
     or request_row.line_patch is distinct from p_line_patch
     or request_row.series_patch is distinct from p_series_patch
     or request_row.expected_revision is distinct from p_expected_revision then
    raise exception 'Identificador de requisição reutilizado com dados diferentes';
  end if;
  if request_row.result is not null then return request_row.result; end if;

  select * into series_row from public.recurring_transactions r
    where r.id = p_recurring_id for update;
  if series_row.id is null or series_row.workspace_id not in (select private.my_workspace_ids()) then
    raise exception 'Recorrência não encontrada';
  end if;
  if series_row.edit_revision is distinct from p_expected_revision then
    raise exception 'A recorrência mudou enquanto você editava. Abra de novo antes de salvar.';
  end if;
  contract_patch := p_series_patch || p_line_patch;
  if contract_patch ? 'amount_cents'
     and coalesce((contract_patch->>'amount_cents')::bigint, 0) <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;
  if contract_patch ? 'account_id' and contract_patch->>'account_id' is not null
     and not exists (select 1 from public.accounts a
       where a.id = (contract_patch->>'account_id')::uuid
         and a.workspace_id = series_row.workspace_id and not a.archived) then
    raise exception 'Conta precisa ser ativa e do mesmo espaço da série';
  end if;
  if p_line_patch ? 'account_id' and p_series_patch ? 'account_id'
     and p_line_patch->'account_id' is distinct from p_series_patch->'account_id' then
    raise exception 'A conta da ocorrência e da regra precisam coincidir';
  end if;
  new_rule := p_series_patch->>'rrule';
  if new_rule is not null then
    -- update_recurring_series validates the complete RRULE. The mapper below only accepts
    -- the exact app-supported subset, and rejects a custom recurrence instead of guessing.
    if new_rule !~ '^FREQ=(MONTHLY(;INTERVAL=([2-9]|[1-9][0-9]))?;BYMONTHDAY=(-1|[1-9]|[12][0-9]|3[01])|WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)|YEARLY;BYMONTH=([1-9]|1[0-2]);BYMONTHDAY=([1-9]|[12][0-9]|3[01]))$' then
      raise exception 'Repetição inválida para corrigir o histórico';
    end if;
    new_day := case when new_rule like '%BYMONTHDAY=-1%' then 31
      else ((regexp_match(new_rule, 'BYMONTHDAY=([0-9]+)'))[1])::int end;
    if new_rule like 'FREQ=YEARLY%' then
      new_month := ((regexp_match(new_rule, 'BYMONTH=([0-9]+)'))[1])::int;
    elsif new_rule like 'FREQ=WEEKLY%' then
      new_dow := case ((regexp_match(new_rule, 'BYDAY=(SU|MO|TU|WE|TH|FR|SA)'))[1])
        when 'MO' then 1 when 'TU' then 2 when 'WE' then 3 when 'TH' then 4
        when 'FR' then 5 when 'SA' then 6 else 7 end;
    end if;
  end if;

  -- Lock every recorded occurrence before altering the series or its projected rows.
  perform 1 from public.transactions t where t.recurring_id = series_row.id
    and t.workspace_id = series_row.workspace_id order by t.occurred_at, t.id for update;

  -- Existing series logic shifts/rebuilds pending projections and validates the calendar.
  future_changed := public.update_recurring_series(series_row.id, contract_patch, true);
  for line_row in select * from public.transactions t
      where t.recurring_id = series_row.id and t.workspace_id = series_row.workspace_id
      order by t.occurred_at, t.id for update loop
    new_date := line_row.occurred_at;
    if new_rule is not null and
       (line_row.status <> 'pending' or line_row.occurred_at < current_date) then
      if new_rule like 'FREQ=MONTHLY%' then
        new_date := private.day_in_month(line_row.occurred_at, new_day);
      elsif new_rule like 'FREQ=YEARLY%' then
        new_date := private.day_in_month(make_date(extract(year from line_row.occurred_at)::int, new_month, 1), new_day);
      else
        new_date := date_trunc('week', line_row.occurred_at::timestamp)::date + (new_dow - 1);
      end if;
    end if;
    new_amount := case when contract_patch ? 'amount_cents' then (contract_patch->>'amount_cents')::bigint else line_row.amount_cents end;
    new_category := case when contract_patch ? 'category' then contract_patch->>'category' else line_row.category end;
    new_description := case when contract_patch ? 'description' then contract_patch->>'description' else line_row.description end;
    new_merchant := case when contract_patch ? 'merchant' then nullif(contract_patch->>'merchant', '') else line_row.merchant end;
    new_account := case when contract_patch ? 'account_id' then (contract_patch->>'account_id')::uuid else line_row.account_id end;
    new_kind := case when contract_patch ? 'kind' then contract_patch->>'kind' else line_row.kind end;
    new_auto_confirm := case when contract_patch ? 'auto_confirm' then (contract_patch->>'auto_confirm')::boolean else line_row.auto_confirm end;
    if line_row.invoice_id is not null or line_row.pays_invoice_id is not null then
      if new_amount is distinct from line_row.amount_cents
         or new_account is distinct from line_row.account_id
         or new_kind is distinct from line_row.kind
         or new_date is distinct from line_row.occurred_at then
        raise exception 'Histórico ligado a fatura: valor, conta, tipo e data não podem mudar em Todos';
      end if;
    end if;
    if new_amount is distinct from line_row.amount_cents
       or new_category is distinct from line_row.category
       or new_description is distinct from line_row.description
       or new_merchant is distinct from line_row.merchant
       or new_kind is distinct from line_row.kind
       or new_auto_confirm is distinct from line_row.auto_confirm then
      update public.transactions t set amount_cents = new_amount,
        category = new_category, description = new_description, merchant = new_merchant,
        kind = new_kind, auto_confirm = new_auto_confirm
      where t.id = line_row.id;
      changed := changed + 1;
    end if;
    -- Mentioning occurred_at in SET fires set_invoice even when its value stays the same.
    -- Keep it out of a text-only correction, as the existing scoped editor does.
    if new_date is distinct from line_row.occurred_at then
      update public.transactions t set occurred_at = new_date,
        due_at = case when new_date is distinct from line_row.occurred_at and line_row.invoice_id is null
          and line_row.due_at = line_row.occurred_at then new_date else line_row.due_at end
      where t.id = line_row.id;
      changed := changed + 1;
    end if;
    if new_account is distinct from line_row.account_id then
      update public.transactions t set account_id = new_account where t.id = line_row.id;
      changed := changed + 1;
    end if;
  end loop;
  changed := greatest(changed, future_changed);
  update private.recurring_all_edit_requests set result = changed
    where user_id = caller_uid and request_id = p_request_id;
  return changed;
end;
$$;

revoke execute on function public.update_recurring_all(uuid, jsonb, jsonb, bigint, uuid)
  from public, anon;
grant execute on function public.update_recurring_all(uuid, jsonb, jsonb, bigint, uuid)
  to authenticated;
