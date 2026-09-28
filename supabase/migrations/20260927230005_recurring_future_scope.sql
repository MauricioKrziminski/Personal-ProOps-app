-- One atomic entry point for future edits from either editor. The request key makes
-- retries safe after a lost response, including calendar changes that may slide.
create table if not exists private.recurring_future_edit_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  transaction_id uuid,
  recurring_id uuid not null,
  line_patch jsonb not null,
  series_patch jsonb not null,
  expected_revision bigint not null,
  result bigint,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table private.recurring_future_edit_requests enable row level security;
drop policy if exists "own recurring future edit requests" on private.recurring_future_edit_requests;
create policy "own recurring future edit requests" on private.recurring_future_edit_requests
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update on private.recurring_future_edit_requests to authenticated, service_role;

create or replace function public.update_recurring_future(
  p_transaction_id uuid,
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
  request_row private.recurring_future_edit_requests%rowtype;
  series_row public.recurring_transactions%rowtype;
  anchor public.transactions%rowtype;
  changed bigint;
begin
  if caller_uid is null or p_recurring_id is null or p_request_id is null
     or p_expected_revision is null then
    raise exception 'Sessão, recorrência, revisão e identificador da requisição obrigatórios';
  end if;
  if p_line_patch is null or jsonb_typeof(p_line_patch) <> 'object'
     or p_series_patch is null or jsonb_typeof(p_series_patch) <> 'object'
     or (p_line_patch = '{}'::jsonb and p_series_patch = '{}'::jsonb) then
    raise exception 'Informe as alterações da recorrência';
  end if;
  if p_transaction_id is null and p_line_patch <> '{}'::jsonb then
    raise exception 'Uma alteração de ocorrência precisa da ocorrência de referência';
  end if;

  insert into private.recurring_future_edit_requests
    (user_id,request_id,transaction_id,recurring_id,line_patch,series_patch,expected_revision)
  values (caller_uid,p_request_id,p_transaction_id,p_recurring_id,
    p_line_patch,p_series_patch,p_expected_revision)
  on conflict (user_id,request_id) do nothing;
  select * into request_row from private.recurring_future_edit_requests
    where user_id=caller_uid and request_id=p_request_id for update;
  if request_row.transaction_id is distinct from p_transaction_id
     or request_row.recurring_id is distinct from p_recurring_id
     or request_row.line_patch is distinct from p_line_patch
     or request_row.series_patch is distinct from p_series_patch
     or request_row.expected_revision is distinct from p_expected_revision then
    raise exception 'Identificador de requisição reutilizado com dados diferentes';
  end if;
  if request_row.result is not null then return request_row.result; end if;

  select * into series_row from public.recurring_transactions r
    where r.id=p_recurring_id for update;
  if series_row.id is null or series_row.workspace_id not in (select private.my_workspace_ids()) then
    raise exception 'Recorrência não encontrada';
  end if;
  if series_row.edit_revision is distinct from p_expected_revision then
    raise exception 'A recorrência mudou enquanto você editava. Abra de novo antes de salvar.';
  end if;
  if p_transaction_id is not null then
    select * into anchor from public.transactions t
      where t.id=p_transaction_id for update;
    if anchor.id is null or anchor.recurring_id is distinct from series_row.id
       or anchor.workspace_id is distinct from series_row.workspace_id then
      raise exception 'Ocorrência não pertence à recorrência';
    end if;
    changed := public.update_recurring_occurrence_and_series(
      anchor.id,series_row.id,p_line_patch,p_series_patch);
  else
    changed := public.update_recurring_series(series_row.id,p_series_patch,true);
  end if;
  if changed > 0 and (select edit_revision from public.recurring_transactions
      where id=series_row.id) = series_row.edit_revision then
    update public.recurring_transactions r set updated_at=now() where r.id=series_row.id;
  end if;
  update private.recurring_future_edit_requests set result=changed
    where user_id=caller_uid and request_id=p_request_id;
  return changed;
end;
$$;
revoke execute on function public.update_recurring_future(uuid,uuid,jsonb,jsonb,bigint,uuid)
  from public,anon;
grant execute on function public.update_recurring_future(uuid,uuid,jsonb,jsonb,bigint,uuid)
  to authenticated;
