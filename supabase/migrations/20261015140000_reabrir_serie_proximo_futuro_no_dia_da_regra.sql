-- Reabrir série no dia da regra, depois da hora da cobrança, gravava o próximo vencimento HOJE na hora
-- que já passou. Agora só vale data cuja hora ainda é futura. Copia o corpo anterior sem outra mudança.
create or replace function private.recurring_end_bounds()
returns trigger
language plpgsql
set search_path = ''
as $$
declare tz text := 'America/Sao_Paulo'; proximo date; hora time;
begin
  if new.end_date is not distinct from old.end_date then return new; end if;
  if old.end_date is not null and (new.end_date is null or new.end_date > old.end_date) then
    -- O encerramento deixa `next_run_at` parado. Reabrindo com ele no passado, o agendador
    -- recomeçaria dali e gravaria as datas que já passaram como pagas: vai para a próxima FUTURA,
    -- no mesmo horário.
    if new.next_run_at < now() then
      -- No dia da própria regra, com a hora já passada, hoje NÃO é futuro: vale a data seguinte.
      hora := (new.next_run_at at time zone tz)::time;
      select min(d.due_date) into proximo
        from private.recurring_dates_for(new.rrule,
          (coalesce(new.dtstart, new.next_run_at) at time zone tz)::date,
          (now() at time zone tz)::date, (now() at time zone tz)::date + 400) d
       where ((d.due_date + hora) at time zone tz) >= now();
      if proximo is not null then
        new.next_run_at := (proximo + hora) at time zone tz;
      end if;
    end if;
    if not old.active and old.last_error is null
       and (old.end_date < (now() at time zone tz)::date
            or old.end_date < (old.next_run_at at time zone tz)::date) then
      new.active := true;
    end if;
    new.materialized_until := null;
  elsif new.end_date is not null and new.materialized_until is not null
        and (new.materialized_until at time zone tz)::date > new.end_date then
    new.materialized_until := null;
  end if;
  return new;
end $$;
revoke execute on function private.recurring_end_bounds() from public, anon, authenticated;
