-- `recurring_drop_future` (20260909090000): apagar a série leva as futuras em aberto.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/recurring_drop_future.sql
--
-- As três linhas que este arquivo separa são as três que o trigger precisa tratar
-- diferente, e nenhuma delas é óbvia olhando só a FK:
--
--   • futura e em aberto  → SAI (é o salário fantasma de 09/09/2026)
--   • passada             → FICA (é histórico; a conta aconteceu)
--   • atrasada            → FICA (é dívida em aberto, não sobra de série)

\set ON_ERROR_STOP on
begin;

set local timezone to 'America/Sao_Paulo';
-- ⚠️ O relógio do teste tem que ser o MESMO do negócio.
-- Desde a `20260911030000` as funções financeiras avaliam `current_date` em BRT
-- (`alter function ... set timezone`), enquanto a sessão continua em UTC. Das 21h à meia-noite
-- as duas datas diferem, e um teste que compara "o dia 0 da projeção" com o `current_date` da
-- SESSÃO falha por um dia — sem nada de errado no código. Foi o que aconteceu com
-- `draft_scenario`, `agent_migrations` e `alert_channels` em 10/09/2026 às 21h.

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000a9';
  w uuid := '00000000-0000-0000-0000-0000000000b9';
  cc uuid := '00000000-0000-0000-0000-0000000000c9';
  serie uuid := '00000000-0000-0000-0000-0000000000f9';
  sobraram int;
begin
  insert into auth.users (id, email) values (u, 'teste-orfa@example.invalid')
    on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste órfã');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta teste', 'checking', 0);

  insert into public.recurring_transactions
    (id, workspace_id, user_id, account_id, kind, amount_cents, description, category,
     rrule, dtstart, next_run_at, auto_confirm)
    values (serie, w, u, cc, 'income', 263200, 'Salário', 'salário',
            'FREQ=MONTHLY;BYMONTHDAY=5', now(), now() + interval '30 days', true);

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, source,
     status, recurring_id)
  values
    (w, u, cc, 'income', 263200, 'Salário', current_date - 30, 'recurring', 'cleared', serie),
    (w, u, cc, 'income', 263200, 'Salário', current_date - 5,  'recurring', 'pending', serie),
    (w, u, cc, 'income', 263200, 'Salário', current_date + 26, 'recurring', 'pending', serie),
    (w, u, cc, 'income', 263200, 'Salário', current_date + 56, 'recurring', 'pending', serie);

  delete from public.recurring_transactions where id = serie;

  select count(*) into sobraram from public.transactions where description = 'Salário';
  assert sobraram = 2,
    format('deveriam sobrar as 2 do passado; sobraram %s', sobraram);
  assert (select count(*) from public.transactions
          where description = 'Salário' and occurred_at > current_date) = 0,
    'ocorrência futura de série apagada é o salário fantasma — não podia sobrar';
  assert (select count(*) from public.transactions
          where description = 'Salário' and status = 'pending' and occurred_at < current_date) = 1,
    'a ocorrência ATRASADA é conta em aberto, não sobra de série: tinha que ficar';
  assert (select count(*) from public.transactions
          where description = 'Salário' and status = 'cleared') = 1,
    'o histórico não some porque a série parou de existir';

  raise notice 'ok — apagar a série leva só o futuro em aberto';
end $$;

rollback;
