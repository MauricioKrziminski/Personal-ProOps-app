-- Revisão final de 'Apagar com alcance': a série e o pai do lembrete têm de ser do espaço do chamador;
-- 'Esta e as próximas' leva também a paga depois da âncora. (I1 — apagar o usuário com fatura paga em
-- parte — foi provado por teste e já passa: a guarda 100500 não muda.)
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
    select * into r from public.recurring_transactions x where x.id = ancora.recurring_id and x.workspace_id = p_ws;
  else
    select * into r from public.recurring_transactions x where x.id = p_id and x.workspace_id = p_ws;
  end if;
  -- a FK de recurring_id não garante o espaço: série de outro espaço nunca é lida nem tocada
  if r.id is null then
    raise exception using errcode = 'P0001', message = 'Recorrência não encontrada';
  end if;
  if p_apply then
    perform 1 from public.recurring_transactions x where x.id = r.id and x.workspace_id = p_ws for update;
    perform 1 from public.transactions t where t.recurring_id = r.id and t.workspace_id = p_ws order by t.id for update;
    -- relê depois do travamento: outra transação pode ter movido a âncora ou a data
    select * into r from public.recurring_transactions x where x.id = r.id and x.workspace_id = p_ws;
    if r.id is null then
      raise exception using errcode = 'P0001', message = 'Recorrência não encontrada';
    end if;
    if p_tipo = 'occurrence' then
      select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
      if ancora.id is null or ancora.recurring_id is distinct from r.id then
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
      where t.recurring_id = r.id and t.workspace_id = p_ws) s
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
    delete from public.recurring_transactions x where x.id = r.id and x.workspace_id = p_ws;     -- as marcas saem no cascade
  else
    -- O UPDATE vem antes do DELETE (marca_serie_editada), como em end_recurring_series.
    -- só encolhe: série já encerrada com next_run_at depois do fim não pode ser reaberta
    update public.recurring_transactions x set end_date = least(coalesce(x.end_date, dia - 1), dia - 1) where x.id = r.id and x.workspace_id = p_ws;
    delete from public.transactions t where t.id = any(ids);
  end if;
  return res;
end $$;
revoke execute on function private.apagar_serie(text, uuid, text, date, uuid, boolean) from public, anon, authenticated;

create or replace function private.apagar_lembrete(p_id uuid, p_alcance text, p_ws uuid, p_apply boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare l public.reminders%rowtype; n int := 1;
begin
  if p_alcance = 'future' then
    raise exception using errcode = '22023', message = 'Lembrete: escolha só esta vez ou o lembrete inteiro';
  end if;
  -- relê a linha JÁ travada: o cron pode ter andado o next_run_at desde a leitura do chamador
  if p_apply then
    select * into l from public.reminders r where r.id = p_id and r.workspace_id = p_ws for update;
  else
    select * into l from public.reminders r where r.id = p_id and r.workspace_id = p_ws;
  end if;
  if l.id is null then
    raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
  end if;
  -- o pai tem que ser do mesmo espaço e da mesma pessoa: parent_reminder_id é FK pura
  if l.parent_reminder_id is not null and not exists (
       select 1 from public.reminders pr
        where pr.id = l.parent_reminder_id and pr.workspace_id = p_ws and pr.user_id = l.user_id) then
    raise exception using errcode = 'P0001', message = 'Lembrete não encontrado';
  end if;
  if p_alcance = 'all' then   -- o pai e as edições dele (o cascade leva os filhos)
    select 1 + count(*) into n from public.reminders r where r.parent_reminder_id = coalesce(l.parent_reminder_id, l.id);
  end if;
  if p_apply then
    if p_alcance = 'all' then
      delete from public.reminders r where r.id = coalesce(l.parent_reminder_id, l.id);   -- os filhos saem no cascade
    elsif l.parent_reminder_id is null and l.recurrence is null then
      delete from public.reminders r where r.id = l.id;
    elsif l.parent_reminder_id is null then
      -- a edição pendente DESTA vez ainda dispararia: sai junto, e o pulo vale
      delete from public.reminders r where r.parent_reminder_id = l.id and r.original_run_at = l.next_run_at;
      update public.reminders r set skip_run_at = r.next_run_at, updated_at = now() where r.id = l.id;
    else
      delete from public.reminders r where r.id = l.id;   -- o gatilho devolve a vez ao pai…
      update public.reminders r set skip_run_at = l.original_run_at, updated_at = now()
       where r.id = l.parent_reminder_id and r.next_run_at = l.original_run_at;   -- …e ela volta a ser pulada
    end if;
  end if;
  return jsonb_build_object('apagadas', n, 'pagas_apagadas', 0, 'soma_pagas_cents', '0',
                            'contas', '[]'::jsonb, 'desde', null, 'apaga_contrato', p_alcance = 'all');
end $$;
revoke execute on function private.apagar_lembrete(uuid, text, uuid, boolean) from public, anon, authenticated;
