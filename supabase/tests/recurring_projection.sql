-- `recurring_projection_for` (20260910140000): a recorrente além do horizonte materializado.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/recurring_projection.sql
--
-- As cinco asserções são os cinco jeitos de errar isto, e nenhum deles dá erro na tela —
-- só um número diferente do que deveria:
--
--   • projetar em cima do que o cron já materializou  → salário DOBRADO no mês
--   • não projetar depois do horizonte                → mês com prestação e sem salário
--   • BYMONTHDAY=31 em mês curto                      → data estourada (é a divergência real
--                                                        entre o expansor SQL e o do Python)
--   • RRULE de forma desconhecida                     → projeção ERRADA em vez de ausente
--   • end_date ignorado                               → série morta continua projetando

\set ON_ERROR_STOP on
begin;

do $$
declare
  u  uuid := '00000000-0000-0000-0000-0000000000a7';
  w  uuid := '00000000-0000-0000-0000-0000000000b7';
  cc uuid := '00000000-0000-0000-0000-0000000000c7';
  s_mensal uuid := '00000000-0000-0000-0000-0000000000d7';
  s_dia31  uuid := '00000000-0000-0000-0000-0000000000e7';
  s_semana uuid := '00000000-0000-0000-0000-0000000000f7';
  s_finda  uuid := '00000000-0000-0000-0000-000000000017';
  n int;
  quando date;
begin
  insert into auth.users (id, email) values (u, 'teste-proj@example.invalid')
    on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste projeção');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta teste', 'checking', 0);

  -- salário dia 5, materializado até 2026-12-06 (é o formato real: UTC-meia-noite do dia
  -- seguinte ao da última ocorrência criada)
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, account_id, rrule,
     next_run_at, active, dtstart, materialized_until)
  values (s_mensal, w, u, 'income', 400000, 'Salário PJ', cc, 'FREQ=MONTHLY;BYMONTHDAY=5',
          '2026-12-06', true, '2026-01-05', '2026-12-06');

  -- aluguel dia 31: fevereiro não tem 31
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, account_id, rrule,
     next_run_at, active, dtstart, materialized_until)
  values (s_dia31, w, u, 'expense', 100000, 'Aluguel', cc, 'FREQ=MONTHLY;BYMONTHDAY=31',
          '2026-12-31', true, '2026-01-31', '2026-12-31');

  -- forma que o expansor NÃO conhece
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, account_id, rrule,
     next_run_at, active, dtstart, materialized_until)
  values (s_semana, w, u, 'expense', 5000, 'Faxina', cc, 'FREQ=WEEKLY;BYDAY=MO',
          '2026-12-07', true, '2026-01-05', '2026-12-07');

  -- série que acaba em 2027-03
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, account_id, rrule,
     next_run_at, active, dtstart, materialized_until, end_date)
  values (s_finda, w, u, 'expense', 20000, 'Curso', cc, 'FREQ=MONTHLY;BYMONTHDAY=10',
          '2026-12-10', true, '2026-01-10', '2026-12-10', '2027-03-31');

  -- 1. NÃO projeta em cima do que já foi materializado (dezembro já tem linha real)
  select count(*) into n
  from private.recurring_projection_for(array[w], date '2026-12-01', date '2026-12-31')
  where recurring_id = s_mensal;
  if n <> 0 then
    raise exception 'projetou dentro do horizonte materializado: % linhas em dezembro', n;
  end if;

  -- 2. projeta DEPOIS do horizonte — é o "outubro de 2027" do dono do produto
  select count(*), min(due_date) into n, quando
  from private.recurring_projection_for(array[w], date '2027-10-01', date '2027-10-31')
  where recurring_id = s_mensal;
  if n <> 1 or quando <> date '2027-10-05' then
    raise exception 'outubro/2027 devia ter 1 salário em 05/10; veio % em %', n, quando;
  end if;

  -- 3. dia 31 em fevereiro cai no último dia, nunca estoura
  select due_date into quando
  from private.recurring_projection_for(array[w], date '2027-02-01', date '2027-02-28')
  where recurring_id = s_dia31;
  if quando <> date '2027-02-28' then
    raise exception 'BYMONTHDAY=31 em fevereiro devia cair em 28/02; veio %', quando;
  end if;

  -- 4. RRULE desconhecida não projeta NADA (falha fechada, não falha errada)
  select count(*) into n
  from private.recurring_projection_for(array[w], date '2027-01-01', date '2027-12-31')
  where recurring_id = s_semana;
  if n <> 0 then
    raise exception 'RRULE não suportada projetou % linhas em vez de nenhuma', n;
  end if;

  -- 5. end_date encerra a projeção
  select count(*) into n
  from private.recurring_projection_for(array[w], date '2027-04-01', date '2027-12-31')
  where recurring_id = s_finda;
  if n <> 0 then
    raise exception 'série com end_date em 03/2027 projetou % linhas depois disso', n;
  end if;

  -- 6. e o mês inteiro enxerga a projeção, marcada como projected
  select count(*) into n
  from private.month_lines_for(array[w], date '2027-10-01')
  where origin = 'recurring_projection' and projected;
  if n < 1 then
    raise exception 'month_lines_for não trouxe a recorrente projetada de outubro/2027';
  end if;

  raise notice 'OK: projeção de recorrente — 6 asserções';
end $$;

rollback;
