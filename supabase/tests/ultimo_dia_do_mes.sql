-- "Todo último dia do mês" projeta, e cada mês usa o próprio tamanho.
--
-- O campo "Vence quando" saiu do formulário: escolher uma data que É o último dia do mês grava
-- `BYMONTHDAY=-1`. Antes da `20260913170000` isso passava pelo formulário e **sumia da projeção**
-- — `recurring_projection_for` filtrava `BYMONTHDAY=[0-9]+`, sem o sinal de menos, e uma série de
-- "último dia" não devolvia NADA além de `materialized_until`. Dinheiro faltando na tela, sem
-- erro nenhum.
--
-- ⚠️ Rodar como `authenticated`, nunca como dono do banco (a lição da `20260911220000`).
begin;

do $$
declare
  ws uuid; u uuid; rid uuid; ctrl uuid;
  datas date[];
  esperado date[];
begin
  select id into ws from public.workspaces order by created_at limit 1;
  select user_id into u from public.workspace_members where workspace_id = ws limit 1;
  if ws is null then raise notice 'sem workspace — nada a testar'; return; end if;

  -- Uma série de ÚLTIMO DIA, ancorada em janeiro para o teste não depender de "hoje".
  insert into public.recurring_transactions
    (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart,
     next_run_at, materialized_until, active)
  values (ws, u, 'expense', 12345, 'teste último dia', 'FREQ=MONTHLY;BYMONTHDAY=-1',
          date '2027-01-01', date '2027-01-01', date '2027-01-01', true)
  returning id into rid;

  select array_agg(due_date order by due_date) into datas
  from private.recurring_projection_for(array[ws], date '2027-01-02', date '2027-04-30')
  where recurring_id = rid;

  -- fevereiro de 2027 tem 28 dias; abril tem 30; março tem 31.
  esperado := array[date '2027-01-31', date '2027-02-28', date '2027-03-31', date '2027-04-30'];
  if datas is distinct from esperado then
    raise exception 'último dia do mês projetou %, esperado %', datas, esperado;
  end if;

  -- Controle: dia fixo continua igual, e o 31 continua clampando em mês curto.
  insert into public.recurring_transactions
    (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart,
     next_run_at, materialized_until, active)
  values (ws, u, 'expense', 12345, 'teste dia 31', 'FREQ=MONTHLY;BYMONTHDAY=31',
          date '2027-01-01', date '2027-01-01', date '2027-01-01', true)
  returning id into ctrl;

  select array_agg(due_date order by due_date) into datas
  from private.recurring_projection_for(array[ws], date '2027-01-02', date '2027-04-30')
  where recurring_id = ctrl;

  if datas is distinct from esperado then
    raise exception 'dia 31 projetou %, esperado % (day_in_month clampa)', datas, esperado;
  end if;

  raise notice 'ok: último dia e dia 31 projetam, cada mês com o próprio tamanho';
end $$;

rollback;
