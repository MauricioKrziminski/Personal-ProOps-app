-- Ramo do LEMBRETE. "Esta vez" é a próxima (o pai) ou a edição pendente dela (o filho).
-- Não há "Esta e as próximas": os registros do histórico (filhos processados) só existem com o pai
-- (check de 20260927220000), então encerrar mantendo o passado pede um estado novo de lembrete.
create or replace function private.apagar_lembrete(p_id uuid, p_alcance text, p_ws uuid, p_apply boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare l public.reminders%rowtype;
begin
  if p_alcance = 'future' then
    raise exception using errcode = '22023', message = 'Lembrete: escolha só esta vez ou o lembrete inteiro';
  end if;
  -- relê a linha JÁ travada: o cron pode ter andado o next_run_at desde a leitura do chamador
  select * into l from public.reminders r where r.id = p_id and r.workspace_id = p_ws for update;
  if l.id is null then
    raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
  end if;
  if p_apply then
    if p_alcance = 'all' then
      delete from public.reminders r where r.id = coalesce(l.parent_reminder_id, l.id);   -- os filhos saem no cascade
    elsif l.parent_reminder_id is null and l.recurrence is null then
      delete from public.reminders r where r.id = l.id;
    elsif l.parent_reminder_id is null then
      update public.reminders r set skip_run_at = r.next_run_at, updated_at = now() where r.id = l.id;
    else
      delete from public.reminders r where r.id = l.id;   -- o gatilho devolve a vez ao pai…
      update public.reminders r set skip_run_at = l.original_run_at, updated_at = now()
       where r.id = l.parent_reminder_id and r.next_run_at = l.original_run_at;   -- …e ela volta a ser pulada
    end if;
  end if;
  return jsonb_build_object('apagadas', 1, 'pagas_apagadas', 0, 'soma_pagas_cents', '0',
                            'contas', '[]'::jsonb, 'desde', null, 'apaga_contrato', p_alcance = 'all');
end $$;
revoke execute on function private.apagar_lembrete(uuid, text, uuid, boolean) from public, anon, authenticated;
