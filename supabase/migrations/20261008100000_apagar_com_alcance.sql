-- Apagar com alcance (spec 2026-10-07-apagar-com-alcance-design.md). UMA conta para a prévia e o
-- comando — a confirmação e a escrita não podem discordar (o desenho de end_recurring_series).

create table if not exists private.delete_scoped_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create index if not exists delete_scoped_receipts_workspace_idx on private.delete_scoped_receipts(workspace_id);
alter table private.delete_scoped_receipts enable row level security;
revoke all on private.delete_scoped_receipts from public, anon, authenticated, service_role;

-- O que a confirmação precisa dizer: quantas, quantas pagas, quanto, de quais contas, desde quando.
create or replace function private.resumo_do_apagar(p_ids uuid[])
returns jsonb language sql stable set search_path = '' as $$
  -- os juros do Pix saem junto da compra (on delete cascade) e entram na conta
  with t as (
    select x.* from public.transactions x
     where x.id = any(p_ids) or x.pix_fee_for_transaction_id = any(p_ids))
  select jsonb_build_object(
    'apagadas', count(*),
    'pagas_apagadas', count(*) filter (where t.status = 'cleared'),
    'soma_pagas_cents', (coalesce(sum(t.amount_cents) filter (where t.status = 'cleared'), 0))::text,
    'contas', coalesce((select jsonb_agg(distinct a.name order by a.name)
                          from t x join public.accounts a on a.id = x.account_id
                         where x.status = 'cleared'), '[]'::jsonb),
    'desde', min(t.occurred_at) filter (where t.status = 'cleared'),
    'apaga_contrato', false)
  from t
$$;
revoke execute on function private.resumo_do_apagar(uuid[]) from public, anon, authenticated;

-- Linha em fatura paga, adiada ou paga em parte não sai — a régua de delete_installment_purchase.
create or replace function private.recusa_fatura_travada(p_ids uuid[])
returns void language plpgsql stable set search_path = '' as $$
begin
  if exists (select 1 from public.transactions t
             where t.id = any(p_ids) and private.parcela_travada('pending', t.invoice_id)) then
    raise exception using errcode = 'P0001',
      message = 'Há lançamento numa fatura paga, adiada ou paga em parte. Desfaça o pagamento da fatura antes.';
  end if;
end $$;
revoke execute on function private.recusa_fatura_travada(uuid[]) from public, anon, authenticated;

-- Ramo da SÉRIE. "Em aberto dali em diante" = pendente com dia >= âncora (dia = vencimento fora
-- do cartão, data da compra no cartão — a régua de series_end_scope); a âncora sai mesmo paga.
-- ⚠️ series_end_scope só olha o futuro (>= hoje) e por isso NÃO serve aqui: a atrasada entre a
-- âncora e hoje também é "próxima".
create or replace function private.apagar_serie(
  p_tipo text, p_id uuid, p_alcance text, p_anchor date, p_ws uuid, p_apply boolean
) returns jsonb
language plpgsql set search_path = '' set timezone to 'America/Sao_Paulo'
as $$
declare
  r public.recurring_transactions%rowtype;
  ancora public.transactions%rowtype;
  dia date; inicio date; ids uuid[]; tudo boolean := p_alcance = 'all'; res jsonb;
begin
  if p_tipo = 'occurrence' then
    select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
    if ancora.recurring_id is null then
      raise exception using errcode = '22023', message = 'Este lançamento não é de uma série';
    end if;
    select * into r from public.recurring_transactions x where x.id = ancora.recurring_id;
  else
    select * into r from public.recurring_transactions x where x.id = p_id;
  end if;
  if p_apply then
    perform 1 from public.recurring_transactions x where x.id = r.id for update;
    perform 1 from public.transactions t where t.recurring_id = r.id and t.workspace_id = p_ws order by t.id for update;
    -- relê depois do travamento: outra transação pode ter movido a âncora ou a data
    select * into r from public.recurring_transactions x where x.id = r.id;
    if p_tipo = 'occurrence' then
      select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
      if ancora.id is null then
        raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
      end if;
    end if;
  end if;
  if p_tipo = 'occurrence' then
    dia := case when ancora.invoice_id is null then coalesce(ancora.due_at, ancora.occurred_at) else ancora.occurred_at end;
  else
    dia := coalesce(p_anchor, (r.next_run_at at time zone 'America/Sao_Paulo')::date);
  end if;
  -- o início original, como end_recurring_series: dtstart é reescrito a cada edição de calendário
  inicio := least((coalesce(r.dtstart, r.next_run_at) at time zone 'America/Sao_Paulo')::date,
    (select min(v.valid_from) from private.recurring_history_versions v where v.recurring_id = r.id),
    (select min(t.occurred_at) from public.transactions t where t.recurring_id = r.id and t.workspace_id = p_ws));
  if p_alcance = 'future' and dia - 1 < inicio then tudo := true; end if;

  if p_alcance = 'one' then
    ids := array[ancora.id];
  elsif tudo then
    select array_agg(t.id) into ids from public.transactions t where t.recurring_id = r.id and t.workspace_id = p_ws;
  else
    select array_agg(s.id) into ids from (
      select t.id, case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end as d
      from public.transactions t
      where t.recurring_id = r.id and t.workspace_id = p_ws and t.status = 'pending') s
    where s.d >= dia;
    if ancora.id is not null and not (ancora.id = any(coalesce(ids, '{}'))) then
      ids := coalesce(ids, '{}') || ancora.id;
    end if;
  end if;
  ids := coalesce(ids, '{}');
  perform private.recusa_fatura_travada(ids);
  res := private.resumo_do_apagar(ids) || jsonb_build_object('apaga_contrato', tudo);
  if not p_apply then return res; end if;

  if p_alcance = 'one' then
    delete from public.transactions t where t.id = ancora.id;          -- a marca impede o agendador de recriar
  elsif tudo then
    delete from public.transactions t where t.id = any(ids);
    delete from public.recurring_transactions x where x.id = r.id;     -- as marcas saem no cascade
  else
    -- O UPDATE vem antes do DELETE (marca_serie_editada), como em end_recurring_series.
    -- só encolhe: série já encerrada com next_run_at depois do fim não pode ser reaberta
    update public.recurring_transactions x set end_date = least(coalesce(x.end_date, dia - 1), dia - 1) where x.id = r.id;
    delete from public.transactions t where t.id = any(ids);
  end if;
  return res;
end $$;
revoke execute on function private.apagar_serie(text, uuid, text, date, uuid, boolean) from public, anon, authenticated;

-- Esqueletos: o plpgsql planeja o `case` do comando inteiro, então os três ramos precisam existir.
-- As Tasks 2 a 4 os substituem (create or replace, mesma assinatura).
create or replace function private.apagar_parcelas(p_tipo text, p_id uuid, p_alcance text, p_ws uuid, p_apply boolean)
returns jsonb language plpgsql set search_path = '' as $$
begin raise exception using errcode = '0A000', message = 'Ainda não implementado'; end $$;
create or replace function private.apagar_pagamentos(p_tipo text, p_id uuid, p_alcance text, p_ws uuid, p_apply boolean)
returns jsonb language plpgsql set search_path = '' as $$
begin raise exception using errcode = '0A000', message = 'Ainda não implementado'; end $$;
create or replace function private.apagar_lembrete(p_id uuid, p_alcance text, p_ws uuid, p_apply boolean)
returns jsonb language plpgsql set search_path = '' as $$
begin raise exception using errcode = '0A000', message = 'Ainda não implementado'; end $$;
revoke execute on function private.apagar_parcelas(text, uuid, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function private.apagar_pagamentos(text, uuid, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function private.apagar_lembrete(uuid, text, uuid, boolean) from public, anon, authenticated;

create or replace function private.delete_scoped(
  p_tipo text, p_id uuid, p_alcance text, p_anchor date, p_request_id uuid, p_apply boolean
) returns jsonb
language plpgsql security definer set search_path = '' set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := auth.uid();
  ws uuid; intent jsonb; sealed private.delete_scoped_receipts%rowtype; result jsonb;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  if p_id is null
     or p_tipo is null or p_tipo not in ('occurrence', 'installment', 'debt_payment', 'recurring', 'plan', 'debt', 'reminder')
     or p_alcance is null or p_alcance not in ('one', 'future', 'all') then
    raise exception using errcode = '22023', message = 'Pedido de apagar inválido';
  end if;
  if p_tipo in ('recurring', 'plan', 'debt') and p_alcance = 'one' then
    raise exception using errcode = '22023', message = 'Pelo contrato não existe "só esta"';
  end if;
  if p_tipo = 'debt' and p_alcance = 'future' then
    raise exception using errcode = '22023', message = 'Pelo contrato da dívida só existe "todas"';
  end if;
  if p_apply and p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da tentativa obrigatório';
  end if;
  -- A repetição devolve o recibo MESMO com o registro já apagado: o registro some, o recibo fica.
  intent := jsonb_build_object('operation', 'delete_scoped', 'tipo', p_tipo, 'id', p_id,
                               'alcance', p_alcance, 'anchor', p_anchor);
  if p_apply then
    select * into sealed from private.delete_scoped_receipts where user_id = uid and request_id = p_request_id;
    if sealed.request_id is not null then
      if sealed.payload is distinct from intent then
        raise exception using errcode = '22023', message = 'Identificador reutilizado com dados diferentes';
      end if;
      return sealed.result;
    end if;
  end if;
  ws := case
    when p_tipo in ('occurrence', 'installment', 'debt_payment') then (select t.workspace_id from public.transactions t where t.id = p_id)
    when p_tipo = 'recurring' then (select r.workspace_id from public.recurring_transactions r where r.id = p_id)
    when p_tipo = 'plan' then (select p.workspace_id from public.installment_plans p where p.id = p_id)
    when p_tipo = 'debt' then (select d.workspace_id from public.debts d where d.id = p_id)
    else (select r.workspace_id from public.reminders r where r.id = p_id and r.user_id = uid) end;
  if ws is null or not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
  end if;
  if p_apply then
    perform pg_advisory_xact_lock(hashtextextended('delete-scoped:' || ws::text, 0));
    select * into sealed from private.delete_scoped_receipts where user_id = uid and request_id = p_request_id;
    if sealed.request_id is not null then
      if sealed.payload is distinct from intent then
        raise exception using errcode = '22023', message = 'Identificador reutilizado com dados diferentes';
      end if;
      return sealed.result;
    end if;
  end if;
  result := case
    when p_tipo in ('occurrence', 'recurring') then private.apagar_serie(p_tipo, p_id, p_alcance, p_anchor, ws, p_apply)
    when p_tipo in ('installment', 'plan') then private.apagar_parcelas(p_tipo, p_id, p_alcance, ws, p_apply)
    when p_tipo in ('debt_payment', 'debt') then private.apagar_pagamentos(p_tipo, p_id, p_alcance, ws, p_apply)
    else private.apagar_lembrete(p_id, p_alcance, ws, p_apply) end;
  if p_apply then
    insert into private.delete_scoped_receipts(user_id, request_id, workspace_id, payload, result)
      values (uid, p_request_id, ws, intent, result);
  end if;
  return result;
end $$;
revoke execute on function private.delete_scoped(text, uuid, text, date, uuid, boolean) from public, anon;
grant execute on function private.delete_scoped(text, uuid, text, date, uuid, boolean) to authenticated;

create or replace function public.delete_scoped(
  p_tipo text, p_id uuid, p_alcance text, p_request_id uuid, p_anchor date default null
) returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.delete_scoped(p_tipo, p_id, p_alcance, p_anchor, p_request_id, true)
$$;
create or replace function public.delete_scoped_preview(
  p_tipo text, p_id uuid, p_alcance text, p_anchor date default null
) returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.delete_scoped(p_tipo, p_id, p_alcance, p_anchor, null, false)
$$;
revoke execute on function public.delete_scoped(text, uuid, text, uuid, date) from public, anon;
revoke execute on function public.delete_scoped_preview(text, uuid, text, date) from public, anon;
grant execute on function public.delete_scoped(text, uuid, text, uuid, date) to authenticated;
grant execute on function public.delete_scoped_preview(text, uuid, text, date) to authenticated;
