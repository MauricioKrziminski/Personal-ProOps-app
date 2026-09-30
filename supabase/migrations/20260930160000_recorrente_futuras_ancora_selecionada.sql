-- 'Esta e as próximas' opened from a future pending occurrence retains earlier
-- pending bills and moves the SELECTED id, not the first line in the requested
-- month. Capture the original due/purchase cutoff before any account/date edits.
-- Direct series/all edits and paid/overdue anchors retain their existing calendar.
-- The revision/request wrapper is unchanged; every refusal still rolls back.

create or replace function private.update_recurring_series_context(
  p_recurring_id uuid,
  p_patch jsonb,
  p_propagate boolean default true,
  p_transaction_id uuid default null,
  p_line_patch jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  serie   record;
  changed bigint := 0;
  proxima timestamptz;
  fica    record;
  periodo text;
  movida  uuid;
  dia     int;
  passo   int;
  anchor public.transactions%rowtype;
  original_date date;
  from_occurrence boolean := false;
  targets uuid[];
  line_changed bigint := 0;
begin
  p_patch := coalesce(p_patch, '{}'::jsonb);
  p_line_patch := coalesce(p_line_patch, '{}'::jsonb);
  if jsonb_typeof(p_patch) <> 'object' or jsonb_typeof(p_line_patch) <> 'object' then
    raise exception 'Alteracoes precisam ser objetos';
  end if;
  if p_patch = '{}'::jsonb and p_line_patch = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  if exists (
    select 1 from unnest(array(select jsonb_object_keys(p_patch))) k
    where k not in ('amount_cents', 'category', 'description', 'account_id',
                    'auto_confirm', 'end_date', 'kind', 'merchant', 'rrule', 'next_run_at')
  ) then
    raise exception 'Campo não permitido nesta alteração';
  end if;
  if p_patch ? 'amount_cents'
     and coalesce((p_patch->>'amount_cents')::bigint, 0) <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;
  if p_patch ? 'kind' and coalesce(p_patch->>'kind', '') not in ('expense', 'income') then
    raise exception 'A série é de saída ou de entrada';
  end if;
  if (p_patch ? 'rrule') <> (p_patch ? 'next_run_at') then
    raise exception 'A repetição e o próximo vencimento mudam juntos';
  end if;
  if p_patch ? 'rrule' then
    if coalesce(p_patch->>'rrule', '') !~ '^FREQ=(MONTHLY(;INTERVAL=([2-9]|[1-9][0-9]))?;BYMONTHDAY=(-1|[1-9]|[12][0-9]|3[01])|WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)|YEARLY;BYMONTH=([1-9]|1[0-2]);BYMONTHDAY=([1-9]|[12][0-9]|3[01]))$' then
      raise exception 'Repetição inválida: use mensal, semanal ou anual';
    end if;
    proxima := (p_patch->>'next_run_at')::timestamptz;
    if proxima is null or proxima::date < current_date then
      raise exception 'O próximo vencimento não pode ser antes de hoje';
    end if;
  end if;

  select r.id, r.workspace_id into serie
  from public.recurring_transactions r where r.id = p_recurring_id
  for update;
  if serie.id is null then
    raise exception 'Recorrência não encontrada';
  end if;

  -- Capture the selected occurrence before metadata/account edits can change
  -- its due date or invoice. All selectors below reuse this original context.
  if p_transaction_id is not null then
    select * into anchor from public.transactions where id=p_transaction_id for update;
    if anchor.id is null or anchor.recurring_id is distinct from serie.id
       or anchor.workspace_id is distinct from serie.workspace_id then
      raise exception 'Ocorrencia e serie precisam pertencer ao mesmo registro';
    end if;
    original_date := case when anchor.invoice_id is null
      then coalesce(anchor.due_at,anchor.occurred_at) else anchor.occurred_at end;
    from_occurrence := anchor.status='pending' and original_date>=current_date;
    if from_occurrence then
      if p_patch ? 'rrule' and private.parcela_travada(anchor.status,anchor.invoice_id) then
        raise exception 'Ocorrência em fatura paga, adiada ou paga em parte: a data não muda';
      end if;
      perform 1 from public.transactions t where t.recurring_id=serie.id
        and t.workspace_id=serie.workspace_id order by t.id for update;
      select array_agg(t.id) into targets from public.transactions t
        where t.recurring_id=serie.id and t.workspace_id=serie.workspace_id
          and t.status='pending'
          and case when t.invoice_id is null then coalesce(t.due_at,t.occurred_at)
            else t.occurred_at end >= original_date;
    end if;
  elsif p_line_patch <> '{}'::jsonb then
    raise exception 'Uma alteração de ocorrência precisa da ocorrência de referência';
  end if;

  if p_line_patch <> '{}'::jsonb then
    if not from_occurrence then
      -- Paid/overdue anchors keep the existing metadata scope and calendar slide.
      line_changed := public.update_transaction_scoped(p_transaction_id,'future',p_line_patch);
    else
      if exists(select 1 from jsonb_object_keys(p_line_patch) k where k not in
        ('amount_cents','category','description','merchant','account_id')) then
        raise exception 'Campo não permitido nesta alteração';
      end if;
      if p_line_patch ? 'amount_cents' and coalesce((p_line_patch->>'amount_cents')::bigint,0)<=0 then
        raise exception 'O valor precisa ser maior que zero';
      end if;
      if p_line_patch ? 'account_id' and p_line_patch->>'account_id' is not null
        and not exists(select 1 from public.accounts a where a.id=(p_line_patch->>'account_id')::uuid
          and a.workspace_id=serie.workspace_id) then
        raise exception 'Conta precisa ser do mesmo workspace do lançamento';
      end if;
      if p_line_patch ? 'account_id' and exists(select 1 from public.transactions t
        where t.id=any(targets) and private.parcela_travada(t.status,t.invoice_id)
          and t.account_id is distinct from (p_line_patch->>'account_id')::uuid) then
        raise exception 'Ocorrência em fatura paga, adiada ou paga em parte: a conta não muda';
      end if;
      update public.transactions t set
        amount_cents=coalesce((p_line_patch->>'amount_cents')::bigint,t.amount_cents),
        category=case when p_line_patch ? 'category' then p_line_patch->>'category' else t.category end,
        description=case when p_line_patch ? 'description' then p_line_patch->>'description' else t.description end,
        merchant=case when p_line_patch ? 'merchant' then p_line_patch->>'merchant' else t.merchant end
      where t.id=any(targets);
      get diagnostics line_changed=row_count;
      if p_line_patch ? 'account_id' then
        update public.transactions t set account_id=(p_line_patch->>'account_id')::uuid where t.id=any(targets);
      end if;
      update public.recurring_transactions r set
        amount_cents=coalesce((p_line_patch->>'amount_cents')::bigint,r.amount_cents),
        category=case when p_line_patch ? 'category' then p_line_patch->>'category' else r.category end,
        description=case when p_line_patch ? 'description' then p_line_patch->>'description' else r.description end,
        merchant=case when p_line_patch ? 'merchant' then nullif(p_line_patch->>'merchant','') else r.merchant end,
        account_id=case when p_line_patch ? 'account_id' then (p_line_patch->>'account_id')::uuid else r.account_id end
      where r.id=serie.id;
    end if;
  end if;
  if p_patch = '{}'::jsonb then return line_changed; end if;

  if p_patch ? 'rrule' then
    periodo := case when p_patch->>'rrule' like 'FREQ=WEEKLY%' then 'week'
                    when p_patch->>'rrule' like 'FREQ=YEARLY%' then 'year' else 'month' end;
    -- A mais recente das que FICAM (tudo menos a em aberto que ainda não venceu). O dia dela é o
    -- vencimento fora do cartão; no cartão, a data da compra.
    select x.dia, x.status into fica
    from (
      select case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end as dia,
             t.status
      from public.transactions t
      where t.recurring_id = serie.id and t.workspace_id = serie.workspace_id
        and not (t.status = 'pending'
                 and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
                 and (not from_occurrence or not private.parcela_travada(t.status,t.invoice_id)))
    ) x
    order by x.dia desc
    limit 1;
    -- O período dela já tem a sua cobrança: o calendário novo começa no primeiro período DEPOIS
    -- dela, no dia da regra — nunca recusa (27/09/2026: dia 4 → dia 31 com setembro pago dava
    -- erro, e o que a pessoa queria era mudar o dia da série inteira). A que fica não se move.
    dia := case when p_patch->>'rrule' like '%BYMONTHDAY=-1%' then 31
                else ((regexp_match(p_patch->>'rrule', 'BYMONTHDAY=([0-9]+)'))[1])::int end;
    passo := coalesce(((regexp_match(p_patch->>'rrule', 'INTERVAL=([0-9]+)'))[1])::int, 1);
    while fica.dia is not null and date_trunc(periodo, proxima::date) <= date_trunc(periodo, fica.dia) loop
      proxima := ((case periodo
                     when 'week' then proxima::date + 7
                     when 'year' then private.day_in_month((date_trunc('month', proxima::date) + interval '1 year')::date, dia)
                     else private.day_in_month((date_trunc('month', proxima::date) + make_interval(months => passo))::date, dia)
                   end) + proxima::time)::timestamptz;
    end loop;
  end if;

  if p_patch ? 'account_id' and p_patch->>'account_id' is not null and not exists (
    select 1 from public.accounts a
    where a.id = (p_patch->>'account_id')::uuid and a.workspace_id = serie.workspace_id
  ) then
    raise exception 'Conta precisa ser do mesmo workspace da série';
  end if;

  update public.recurring_transactions r set
    amount_cents = coalesce((p_patch->>'amount_cents')::bigint, r.amount_cents),
    category     = case when p_patch ? 'category'     then p_patch->>'category'     else r.category end,
    description  = case when p_patch ? 'description'  then p_patch->>'description'  else r.description end,
    merchant     = case when p_patch ? 'merchant'     then nullif(p_patch->>'merchant', '') else r.merchant end,
    kind         = case when p_patch ? 'kind'         then p_patch->>'kind'         else r.kind end,
    account_id   = case when p_patch ? 'account_id'   then (p_patch->>'account_id')::uuid else r.account_id end,
    auto_confirm = case when p_patch ? 'auto_confirm' then (p_patch->>'auto_confirm')::boolean else r.auto_confirm end,
    end_date     = case when p_patch ? 'end_date'     then (p_patch->>'end_date')::date else r.end_date end,
    rrule        = case when p_patch ? 'rrule'        then p_patch->>'rrule'        else r.rrule end,
    dtstart      = case when p_patch ? 'rrule'        then proxima                  else r.dtstart end,
    next_run_at  = case when p_patch ? 'rrule'        then proxima                  else r.next_run_at end,
    materialized_until = case when p_patch ? 'rrule'  then null                     else r.materialized_until end
  where r.id = serie.id;

  if p_patch ? 'rrule' then
    -- With occurrence context, move the selected id and rebuild only the target
    -- ids captured against its original cutoff. Direct/all and paid/overdue
    -- contexts keep the first open occurrence in the requested calendar period.
    if from_occurrence then
      movida := anchor.id;
    else
      select t.id into movida
      from public.transactions t
      where t.recurring_id = serie.id
        and t.workspace_id = serie.workspace_id
        and t.status = 'pending'
        and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
        and date_trunc(periodo, case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end)
            >= date_trunc(periodo, proxima::date)
      order by case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end
      limit 1;
    end if;

    -- Antes de mover: uma delas pode já estar na data nova, e o unique recusaria a movida.
    delete from public.transactions t
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
      and ((from_occurrence and t.id=any(targets) and not private.parcela_travada(t.status,t.invoice_id))
        or (not from_occurrence and date_trunc(periodo,
          case when t.invoice_id is null then coalesce(t.due_at,t.occurred_at) else t.occurred_at end)
          >= date_trunc(periodo,proxima::date)))
      and t.id is distinct from movida;

    if movida is not null then
      if from_occurrence and exists(select 1 from public.transactions t where t.id=movida
        and private.parcela_travada(t.status,t.invoice_id)) then
        raise exception 'Ocorrência em fatura paga, adiada ou paga em parte: a data não muda';
      end if;
      update public.transactions t
         set occurred_at = proxima::date,
             due_at = case when t.invoice_id is null then proxima::date else t.due_at end
       where t.id = movida;
    end if;
  end if;

  if p_patch ? 'end_date' and p_patch->>'end_date' is not null then
    -- Fim mais cedo: o que passou dele não vai mais acontecer.
    delete from public.transactions t
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
      and (not from_occurrence or (t.id=any(targets) and not private.parcela_travada(t.status,t.invoice_id)))
      and case when from_occurrence and t.invoice_id is null then coalesce(t.due_at,t.occurred_at)
        else t.occurred_at end > (p_patch->>'end_date')::date;
  end if;

  if p_propagate then
    -- Mesmo cuidado da irmã: `account_id` só entra no `set` quando foi pedido, senão
    -- `set_invoice` recalcula a fatura de ocorrências que ninguém mandou mover.
    update public.transactions t set
      amount_cents = coalesce((p_patch->>'amount_cents')::bigint, t.amount_cents),
      category     = case when p_patch ? 'category'    then p_patch->>'category'    else t.category end,
      description  = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
      merchant     = case when p_patch ? 'merchant'    then nullif(p_patch->>'merchant', '') else t.merchant end,
      kind         = case when p_patch ? 'kind'        then p_patch->>'kind'        else t.kind end
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
      and (not from_occurrence or t.id=any(targets));
    get diagnostics changed = row_count;

    if p_patch ? 'account_id' then
      update public.transactions t
         set account_id = (p_patch->>'account_id')::uuid
       where t.recurring_id = serie.id
         and t.workspace_id = serie.workspace_id
         and t.status = 'pending'
         and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
         and (not from_occurrence or t.id=any(targets));
    end if;
  end if;

  return greatest(changed,line_changed);
end;
$$;

revoke execute on function private.update_recurring_series_context(uuid,jsonb,boolean,uuid,jsonb) from public,anon;
grant execute on function private.update_recurring_series_context(uuid,jsonb,boolean,uuid,jsonb) to authenticated;

-- The direct series/all entry point has no selected-occurrence context and
-- therefore keeps the existing period-based calendar rewrite unchanged.
create or replace function public.update_recurring_series(
  p_recurring_id uuid,p_patch jsonb,p_propagate boolean default true
) returns bigint
language plpgsql security invoker set search_path=public
set timezone to 'America/Sao_Paulo'
as $$
begin
  if p_patch is null or p_patch='{}'::jsonb then raise exception 'Nada para alterar'; end if;
  return private.update_recurring_series_context(p_recurring_id,p_patch,p_propagate);
end;
$$;
revoke execute on function public.update_recurring_series(uuid,jsonb,boolean) from public,anon;
grant execute on function public.update_recurring_series(uuid,jsonb,boolean) to authenticated;

create or replace function public.update_recurring_occurrence_and_series(
  p_transaction_id uuid,p_recurring_id uuid,p_line_patch jsonb,p_series_patch jsonb
) returns bigint
language plpgsql security invoker set search_path=public
set timezone to 'America/Sao_Paulo'
as $$
begin
  if p_transaction_id is null then raise exception 'Ocorrencia e serie precisam pertencer ao mesmo registro'; end if;
  return private.update_recurring_series_context(p_recurring_id,p_series_patch,true,p_transaction_id,p_line_patch);
end;
$$;
revoke execute on function public.update_recurring_occurrence_and_series(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.update_recurring_occurrence_and_series(uuid,uuid,jsonb,jsonb) to authenticated;
