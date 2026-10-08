-- docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/valor_previsto_da_baixa.sql
-- Pago × previsto (20261010100000): a baixa com outro valor guarda o previsto; uma vez só.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000e7f01';
  w uuid := '00000000-0000-0000-0000-0000000e7f02';
  a uuid := '00000000-0000-0000-0000-0000000e7f03';
  p uuid := '00000000-0000-0000-0000-0000000e7f04';
begin
  insert into auth.users (id, email) values (u, 'valor-previsto@example.invalid');
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Valor previsto');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (a, w, u, 'Conta', 'checking', 0);
  insert into public.installment_plans
    (id, workspace_id, user_id, account_id, description, total_cents, installments, first_occurred_at)
    values (p, w, u, a, 'Plano', 30000, 3, current_date);
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, source, status, installment_plan_id, installment_no)
    values
      (w, u, a, 'expense', 10000, 'P1', current_date, 'app', 'pending', p, 1),
      (w, u, a, 'expense', 10000, 'P2', current_date + 30, 'app', 'pending', p, 2),
      (w, u, a, 'expense', 10000, 'P3', current_date + 60, 'app', 'pending', p, 3);
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, source, status)
    values
      (w, u, a, 'expense', 12000, 'Luz', current_date, 'app', 'pending'),
      (w, u, a, 'expense', 5000, 'Agua', current_date, 'app', 'pending'),
      (w, u, a, 'expense', 8000, 'Gas', current_date, 'whatsapp', 'pending');
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000e7f01', true);
set local role authenticated;

do $$
declare
  w uuid := '00000000-0000-0000-0000-0000000e7f02';
  luz uuid; agua uuid; p1 uuid;
begin
  select id into luz from public.transactions where workspace_id = w and description = 'Luz';
  select id into agua from public.transactions where workspace_id = w and description = 'Agua';
  select id into p1 from public.transactions where workspace_id = w and description = 'P1';

  -- 1. outro valor: o previsto fica na linha paga
  perform public.confirm_payment_scoped(luz, current_date, 11000, 'one');
  assert (select amount_cents = 11000 and status = 'cleared' and expected_amount_cents = 12000
          from public.transactions where id = luz), 'baixa com outro valor guarda o previsto';

  -- 2. repetir a MESMA baixa (retry de rede) não muda nada
  perform public.confirm_payment_scoped(luz, current_date, 11000, 'one');
  assert (select expected_amount_cents = 12000 from public.transactions where id = luz), 'idempotente';

  -- 3. no valor previsto: nada a guardar
  perform public.confirm_payment_scoped(agua, current_date, 5000, 'one');
  assert (select expected_amount_cents is null from public.transactions where id = agua), 'pago no previsto fica null';

  -- 4. escopo future: só a âncora guarda o previsto; as próximas passam a prever o valor novo
  perform public.confirm_payment_scoped(p1, current_date, 9000, 'future');
  assert (select expected_amount_cents = 10000 from public.transactions where id = p1), 'a âncora guarda';
  assert (select bool_and(expected_amount_cents is null and amount_cents = 9000 and status = 'pending')
          from public.transactions where workspace_id = w and description in ('P2', 'P3')),
         'as próximas ficam em aberto, com o valor novo e sem previsto';

  -- 5. corrigir o valor da linha paga DEPOIS não apaga o previsto original
  update public.transactions set amount_cents = 11500 where id = luz;
  assert (select amount_cents = 11500 and expected_amount_cents = 12000 from public.transactions where id = luz),
         'a correção posterior mantém o previsto';
end $$;

reset role;

-- 6. o caminho do agente: baixa e valor numa instrução só (o gatilho grava)
do $$
declare
  w uuid := '00000000-0000-0000-0000-0000000e7f02';
  gas uuid;
begin
  select id into gas from public.transactions where workspace_id = w and description = 'Gas';
  update public.transactions set amount_cents = 7500, status = 'cleared', paid_at = current_date where id = gas;
  assert (select expected_amount_cents = 8000 from public.transactions where id = gas), 'gatilho grava na baixa com valor novo';
  -- voltar a previsto e pagar de novo com outro valor: o previsto ORIGINAL fica
  update public.transactions set status = 'pending' where id = gas;
  update public.transactions set amount_cents = 7000, status = 'cleared', paid_at = current_date where id = gas;
  assert (select expected_amount_cents = 8000 from public.transactions where id = gas), 'o primeiro previsto não é sobrescrito';
  -- mudar só o valor de uma linha paga não é baixa: nada muda
  update public.transactions set expected_amount_cents = null where id = gas;
  update public.transactions set amount_cents = 6900 where id = gas;
  assert (select expected_amount_cents is null from public.transactions where id = gas), 'correção de linha paga não inventa previsto';
end $$;

rollback;
