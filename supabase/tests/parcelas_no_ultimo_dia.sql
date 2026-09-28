-- Compra parcelada fora do cartão no último dia de cada mês: na criação e nos alcances.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e3a1';
  w uuid := '00000000-0000-0000-0000-00000000e3b1';
  conta uuid := '00000000-0000-0000-0000-00000000e3c1';
  cartao uuid := '00000000-0000-0000-0000-00000000e3c2';
  plano uuid;
  p2 uuid;
  datas date[];
begin
  insert into auth.users (id, email) values (u, 'parcela-ultimo-dia@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Parcela no fim do mês');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (conta, w, u, 'Conta', 'checking', 100000);
  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day)
    values (cartao, w, u, 'Cartão', 'credit_card', 3, 10);
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('role', 'authenticated', true);

  -- criação: 4x a partir de 30/06/2026, a 1ª já paga
  plano := public.create_installment_plan_last_day(conta, 40000, 4, date '2026-06-30', 1, 'Geladeira');
  select array_agg(occurred_at order by installment_no) into datas from public.transactions where installment_plan_id = plano;
  assert datas = array[date '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'], format('datas: %s', datas);
  assert (select status from public.transactions where installment_plan_id = plano and installment_no = 1) = 'cleared',
    'a já paga continua paga';
  assert (select sum(amount_cents) from public.transactions where installment_plan_id = plano) = 40000;

  -- "Esta e as próximas" num dia fixo (15) a partir da 2ª; depois de volta ao último dia só da 3ª em diante
  select id into p2 from public.transactions where installment_plan_id = plano and installment_no = 2;
  perform public.update_installment_scope(p2, 'future', jsonb_build_object('occurred_at', date '2026-07-15'));
  perform public.update_installment_scope_last_day(
    (select id from public.transactions where installment_plan_id = plano and installment_no = 3), 'future', '{}'::jsonb);
  select array_agg(occurred_at order by installment_no) into datas from public.transactions where installment_plan_id = plano;
  assert datas = array[date '2026-06-30', '2026-07-15', '2026-08-31', '2026-09-30'], format('datas: %s', datas);

  -- repetir não muda nada
  assert public.update_installment_scope_last_day(
    (select id from public.transactions where installment_plan_id = plano and installment_no = 3), 'future', '{}'::jsonb) = 0,
    'repetir não reescreve';

  -- "Todas" com outro campo junto: título e datas numa transação
  perform public.update_installment_scope_last_day(p2, 'all', '{"description":"Geladeira nova"}'::jsonb);
  select array_agg(occurred_at order by installment_no) into datas from public.transactions where installment_plan_id = plano;
  assert datas = array[date '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'], format('datas: %s', datas);
  assert (select description from public.transactions where id = p2) = 'Geladeira nova (2/4)';

  -- só esta não é regra
  begin
    perform public.update_installment_scope_last_day(p2, 'one', '{}'::jsonb);
    raise exception 'alcance one aceito';
  exception when others then
    assert sqlerrm like '%Esta e as próximas ou Todas%', sqlerrm;
  end;

  -- no cartão, recusado, e nada fica gravado pela metade
  begin
    perform public.create_installment_plan_last_day(cartao, 30000, 3, current_date, 0, 'Tv');
    raise exception 'cartão aceito';
  exception when others then
    assert sqlerrm like '%No cartão%', sqlerrm;
  end;
  assert not exists (select 1 from public.installment_plans where account_id = cartao), 'a compra no cartão não ficou';
end $$;
rollback;
