-- Regressao: as tres formas aceitas por update_recurring_series tambem projetam.
-- Execute no banco local com psql -v ON_ERROR_STOP=1 -f este_arquivo.
\set ON_ERROR_STOP on
begin;

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a271';
  w uuid := '00000000-0000-0000-0000-00000000b271';
  bi uuid := '00000000-0000-0000-0000-00000000c271';
  ultimo uuid := '00000000-0000-0000-0000-00000000d271';
  semanal uuid := '00000000-0000-0000-0000-00000000e271';
  anual uuid := '00000000-0000-0000-0000-00000000f271';
  fisica uuid := '00000000-0000-0000-0000-000000000271';
  historia uuid := '00000000-0000-0000-0000-000000001271';
  desconhecida uuid := '00000000-0000-0000-0000-000000002271';
  datas date[];
begin
  insert into auth.users (id, email) values (u, 'projection-supported@example.invalid')
    on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Projecao suportada');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');

  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, rrule,
     dtstart, next_run_at, materialized_until)
  values
    (bi, w, u, 'expense', 100, 'Bimestral', 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=31',
     '2027-01-31 12:00-03', '2027-03-31 12:00-03', '2027-01-31 12:00-03'),
    (ultimo, w, u, 'expense', 100, 'Bimestral ultimo', 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=-1',
     '2027-02-28 12:00-03', '2027-04-30 12:00-03', '2027-02-28 12:00-03'),
    (semanal, w, u, 'expense', 100, 'Sexta', 'FREQ=WEEKLY;BYDAY=FR',
     '2027-01-06 12:00-03', '2027-01-08 12:00-03', '2027-01-08 12:00-03'),
    (anual, w, u, 'expense', 100, 'Bissexto', 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
     '2028-02-29 12:00-03', '2029-02-28 12:00-03', '2028-02-29 12:00-03'),
    (fisica, w, u, 'expense', 100, 'Ja movida', 'FREQ=MONTHLY;BYMONTHDAY=31',
     '2027-03-31 12:00-03', '2027-03-31 12:00-03', null),
    (historia, w, u, 'expense', 100, 'Sem passado fantasma', 'FREQ=MONTHLY;BYMONTHDAY=5',
     '2026-01-05 12:00-03', '2026-10-05 12:00-03', null),
    (desconhecida, w, u, 'expense', 100, 'Regra fora do app', 'FREQ=DAILY',
     '2027-01-01 12:00-03', '2027-01-01 12:00-03', null);

  select array_agg(due_date order by due_date) into datas
  from private.recurring_projection_for(array[w], '2027-01-01', '2027-06-30')
  where recurring_id = bi;
  if datas is distinct from array[date '2027-03-31', date '2027-05-31'] then
    raise exception 'intervalo bimestral perdeu a ancora: %', datas;
  end if;

  select array_agg(due_date order by due_date) into datas
  from private.recurring_projection_for(array[w], '2027-01-01', '2027-06-30')
  where recurring_id = ultimo;
  if datas is distinct from array[date '2027-04-30', date '2027-06-30'] then
    raise exception 'ultimo dia bimestral: %', datas;
  end if;

  select array_agg(due_date order by due_date) into datas
  from private.recurring_projection_for(array[w], '2027-01-01', '2027-01-31')
  where recurring_id = semanal;
  if datas is distinct from array[date '2027-01-15', date '2027-01-22', date '2027-01-29'] then
    raise exception 'semanal ou limite materializado: %', datas;
  end if;

  select array_agg(due_date order by due_date) into datas
  from private.recurring_projection_for(array[w], '2029-01-01', '2032-12-31')
  where recurring_id = anual;
  if datas is distinct from array[date '2029-02-28', date '2030-02-28',
                                  date '2031-02-28', date '2032-02-29'] then
    raise exception 'anual bissexto: %', datas;
  end if;

  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, occurred_at,
     due_at, source, status, recurring_id)
  values (w, u, 'expense', 100, 'Ja movida', '2027-03-31', '2027-03-31',
          'recurring', 'pending', fisica);
  select array_agg(due_date order by due_date) into datas
  from private.recurring_projection_for(array[w], '2027-03-01', '2027-04-30')
  where recurring_id = fisica;
  if datas is distinct from array[date '2027-04-30'] then
    raise exception 'duplicou linha fisica ou perdeu abril: %', datas;
  end if;

  select array_agg(due_date order by due_date) into datas
  from private.recurring_projection_for(array[w], '2026-01-01', '2026-06-30')
  where recurring_id = historia;
  if datas is not null then
    raise exception 'inventou lancamentos historicos: %', datas;
  end if;

  select array_agg(due_date order by due_date) into datas
  from private.recurring_projection_for(array[w], '2027-01-01', '2027-01-31')
  where recurring_id = desconhecida;
  if datas is not null then
    raise exception 'regra fora do contrato foi projetada: %', datas;
  end if;

  update public.recurring_transactions set end_date = '2027-04-30' where id = bi;
  select array_agg(due_date order by due_date) into datas
  from private.recurring_projection_for(array[w], '2027-01-01', '2027-06-30')
  where recurring_id = bi;
  if datas is distinct from array[date '2027-03-31'] then
    raise exception 'end_date nao cortou maio: %', datas;
  end if;

  raise notice 'OK: intervalo, ultimo dia, semanal, anual, fisica, historia, fim';
end $$;

rollback;
