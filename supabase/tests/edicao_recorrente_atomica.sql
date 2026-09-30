-- Uma edicao da linha e da serie e uma unica chamada/transacao RPC.
\set ON_ERROR_STOP on
begin;

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a272';
  w uuid := '00000000-0000-0000-0000-00000000b272';
  s uuid := '00000000-0000-0000-0000-00000000c272';
  outra uuid := '00000000-0000-0000-0000-00000000d272';
  primeira uuid;
  changed bigint;
  nova_data date := current_date + 5;
  nova_regra text := format('FREQ=MONTHLY;BYMONTHDAY=%s', extract(day from current_date + 5)::int);
begin
  -- Match the authenticated app caller for the protected history writer.
  perform set_config('request.jwt.claim.sub',u::text,true);
  insert into auth.users (id, email) values (u, 'atomic-recurring@example.invalid')
    on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Edicao atomica');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');

  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at)
  values
    (s, w, u, 'expense', 1000, 'Antes', 'FREQ=MONTHLY;BYMONTHDAY=5',
     current_date + 10, current_date + 10),
    (outra, w, u, 'expense', 1000, 'Outra', 'FREQ=MONTHLY;BYMONTHDAY=5',
     current_date + 10, current_date + 10);
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, occurred_at, source,
     status, recurring_id)
  values (w, u, 'expense', 1000, 'Antes', current_date + 10, 'recurring', 'pending', s)
  returning id into primeira;
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, occurred_at, source,
     status, recurring_id)
  values (w, u, 'expense', 1000, 'Antes', current_date + 40, 'recurring', 'pending', s);

  begin
    perform public.update_recurring_occurrence_and_series(
      primeira, s, '{"description":"Depois"}'::jsonb,
      jsonb_build_object('rrule', 'FREQ=DAILY', 'next_run_at', current_date + 10));
    raise exception 'a regra invalida deveria ter sido recusada';
  exception when others then
    if sqlerrm not like '%Repetição inválida%' then
      raise exception 'erro inesperado na regra invalida: %', sqlerrm;
    end if;
  end;
  if exists (select 1 from public.transactions where recurring_id = s and description <> 'Antes')
     or (select description from public.recurring_transactions where id = s) <> 'Antes' then
    raise exception 'o erro na serie gravou parcialmente a linha';
  end if;

  begin
    perform public.update_recurring_occurrence_and_series(
      primeira, outra, '{"description":"Errado"}'::jsonb, '{}'::jsonb);
    raise exception 'serie alheia deveria ter sido recusada';
  exception when others then
    if sqlerrm not like '%mesmo registro%' then
      raise exception 'erro inesperado no vinculo: %', sqlerrm;
    end if;
  end;

  changed := public.update_recurring_occurrence_and_series(
    primeira, s, '{"description":"Depois"}'::jsonb,
    jsonb_build_object('rrule', nova_regra, 'next_run_at', nova_data));
  if changed <> 2
     or (select count(*) from public.transactions
         where recurring_id = s and description = 'Depois') <> 1
     or (select description from public.recurring_transactions where id = s) <> 'Depois'
     or (select rrule from public.recurring_transactions where id = s) <> nova_regra
     or (select dtstart::date from public.recurring_transactions where id = s) <> nova_data
     or (select occurred_at from public.transactions where id = primeira) <> nova_data then
    raise exception 'sucesso parcial ao mudar a regra: changed %, data %', changed, nova_data;
  end if;

  -- Repetir a mesma edicao preserva o id movido e nao recria a linha excluida.
  perform public.update_recurring_occurrence_and_series(
    primeira, s, '{"description":"Depois"}'::jsonb,
    jsonb_build_object('rrule', nova_regra, 'next_run_at', nova_data));
  if (select count(*) from public.transactions where recurring_id = s) <> 1
     or (select count(*) from public.transactions
         where recurring_id = s and description = 'Depois') <> 1 then
    raise exception 'a repeticao duplicou ou perdeu ocorrencias';
  end if;

  raise notice 'OK: rollback, vinculo, sucesso e repeticao da edicao atomica';
end $$;

rollback;
