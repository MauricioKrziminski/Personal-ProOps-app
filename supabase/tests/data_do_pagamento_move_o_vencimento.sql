-- Mudar a data de um pagamento de dívida com "Este e os próximos"/"Todos" muda o dia do contrato,
-- numa transação só e sem repetir a escrita.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e2a1';
  w uuid := '00000000-0000-0000-0000-00000000e2b1';
  a uuid := '00000000-0000-0000-0000-00000000e2c1';
  d uuid := '00000000-0000-0000-0000-00000000e2d1';
  base date := date_trunc('month', current_date)::date;
  p1 uuid;
  p2 uuid;
  dv bigint;
  av bigint;
  versions jsonb;
  req uuid := gen_random_uuid();
  r1 jsonb;
  r2 jsonb;
  proxima date;
begin
  insert into auth.users (id, email) values (u, 'vencimento-pagamento@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Vencimento pelo pagamento');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (a, w, u, 'Conta', 'checking', 1000000);
  insert into public.debts
    (id, workspace_id, user_id, name, kind, calculation_mode, principal_cents, remaining_cents,
     interest_rate_monthly, installments, installments_paid, installment_cents, due_day, first_due_date)
    values (d, w, u, 'Carro', 'financing', 'fixed_installments', 60000, 60000, 0, 6, 0, 10000,
            10, base + 9);
  perform public.pay_debt_installment(d, 10000, a, base + 9);
  perform public.pay_debt_installment(d, 10000, a, base + 9);

  perform set_config('request.jwt.claim.sub', u::text, true);
  select id into p1 from public.transactions where debt_id = d and debt_payment_no = 1;
  select id, edit_revision into p2, av from public.transactions where debt_id = d and debt_payment_no = 2;
  select edit_revision into dv from public.debts where id = d;
  select jsonb_object_agg(id::text, edit_revision) into versions
    from public.transactions where debt_id = d and debt_payment_no >= 2;

  -- "Este e os próximos" com a data no último dia do mês e a descrição nova
  r1 := public.update_debt_payment_due_day(p2, 'from_here', '{"description":"Parcela do carro"}'::jsonb,
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date, -1, dv, av, versions, req);
  assert (select due_day from public.debts where id = d) = -1, 'o contrato passa a vencer no último dia';
  assert (select occurred_at from public.transactions where id = p2)
    = (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'a data deste pagamento muda';
  assert (select occurred_at from public.transactions where id = p1) = base + 9,
    'o pagamento anterior é registro de quando o dinheiro saiu: não se move';
  assert (select description from public.transactions where id = p2) = 'Parcela do carro';
  select min(due_date) into proxima from public.debt_schedule(d);
  assert proxima = (date_trunc('month', proxima) + interval '1 month - 1 day')::date,
    format('a próxima parcela cai no último dia do mês: %s', proxima);

  -- repetir o mesmo pedido devolve a mesma resposta e não escreve de novo
  r2 := public.update_debt_payment_due_day(p2, 'from_here', '{"description":"Parcela do carro"}'::jsonb,
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date, -1, dv, av, versions, req);
  assert r1 = r2, 'repetição devolve a mesma resposta';

  -- revisão velha: nada muda
  begin
    perform public.update_debt_payment_due_day(p2, 'all', '{}'::jsonb, null, 15, dv, av, versions, gen_random_uuid());
    raise exception 'revisão velha aceita';
  exception when others then
    assert sqlerrm like '%mudou enquanto você editava%', sqlerrm;
  end;
  assert (select due_day from public.debts where id = d) = -1;

  -- "Todos" só com o dia: o contrato muda e as datas antigas só contadas são refeitas
  select edit_revision into dv from public.debts where id = d;
  select edit_revision into av from public.transactions where id = p2;
  select jsonb_object_agg(id::text, edit_revision) into versions from public.transactions where debt_id = d;
  perform public.update_debt_payment_due_day(p2, 'all', '{}'::jsonb, null, 15, dv, av, versions, gen_random_uuid());
  assert (select due_day from public.debts where id = d) = 15;
  -- "Todos, inclusive pagamentos passados": os registrados vão para o dia 15 do PRÓPRIO mês
  assert (select occurred_at from public.transactions where id = p1) = base + 14,
    format('o 1º pagamento vai para o dia 15: %s', (select occurred_at from public.transactions where id = p1));
  assert extract(day from (select occurred_at from public.transactions where id = p2)) = 15
    and date_trunc('month', (select occurred_at from public.transactions where id = p2)) = date_trunc('month', current_date),
    'o 2º também, sem mudar de mês';
  select min(due_date) into proxima from public.debt_schedule(d);
  assert extract(day from proxima) = 15, format('a próxima vence no dia 15: %s', proxima);
end $$;
rollback;
