-- Lote C: a compra parcelada com forma, classificação e detalhe (o que o agente grava por
-- `create_purchase`), inclusive num espaço que NÃO é o padrão de quem chama (`20261005210000`).
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c0c2', true);
do $$
declare usr uuid := '00000000-0000-0000-0000-00000000c0c2'; w1 uuid; w2 uuid; a1 uuid; c2 uuid; sub2 uuid; sub1 uuid;
  t uuid; r jsonb; p uuid; rec uuid; x record;
begin
  insert into auth.users (id, email) values (usr, 'lote-c2@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  select id into w1 from public.workspaces where owner_id = usr order by created_at limit 1;
  if w1 is null then
    insert into public.workspaces (name, owner_id) values ('padrão', usr) returning id into w1;
    insert into public.workspace_members (workspace_id, user_id, role) values (w1, usr, 'owner');
  end if;
  insert into public.workspaces (name, owner_id) values ('segundo', usr) returning id into w2;
  insert into public.workspace_members (workspace_id, user_id, role) values (w2, usr, 'owner');
  assert public.my_default_workspace() = w1, 'o espaço padrão é o primeiro';
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents) values (w1, usr, 'A1', 'checking', 100000) returning id into a1;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (w2, usr, 'C2', 'credit_card', 3, 10, 500000) returning id into c2;
  insert into public.subcategories(workspace_id,user_id,parent_category,name) values (w2,usr,'mercado','feira') returning id into sub2;
  insert into public.subcategories(workspace_id,user_id,parent_category,name) values (w1,usr,'mercado','feira') returning id into sub1;

  -- avulso, como o agente grava
  insert into public.transactions (user_id, workspace_id, kind, amount_cents, category, description, account_id, occurred_at,
     payment_method, expense_pattern, expense_pattern_source, expense_necessity, expense_necessity_source, currency, source, subcategory_id, subcategory_snapshot_set)
  values (usr, w1, 'expense', 4500, 'mercado', 'mercado', a1, current_date, 'pix','fixed','explicit','essential','category_default','BRL','whatsapp', sub1, true) returning id into t;
  select * into x from public.transactions where id = t;
  assert x.payment_method='pix' and x.expense_pattern='fixed' and x.expense_necessity_source='category_default' and x.subcategory_id=sub1, 'avulso';

  -- parcelada no cartão do SEGUNDO espaço, com o detalhe dele: o espaço é o da conta, não o padrão
  r := public.create_purchase('parcelada', jsonb_build_object('p_account_id', c2, 'p_total_cents', 300000, 'p_installments', 3,
      'p_occurred_at', current_date::text, 'p_paid_installments', 0, 'p_description', 'tv', 'p_category', 'mercado',
      'p_payment_method', 'credit', 'expense_pattern','variable','expense_pattern_source','explicit','subcategory_id', sub2::text), null, gen_random_uuid());
  p := (r->'ids'->>0)::uuid;
  assert (select payment_method from public.installment_plans where id=p)='credit', 'plano forma';
  assert (select count(*) from public.transactions where installment_plan_id=p and payment_method='credit'
          and expense_pattern='variable' and subcategory_id=sub2)=3, 'parcelas no segundo espaço';

  -- o detalhe de OUTRO espaço continua recusado
  begin
    perform public.create_purchase('parcelada', jsonb_build_object('p_account_id', c2, 'p_total_cents', 300000, 'p_installments', 3,
      'p_occurred_at', current_date::text, 'p_paid_installments', 0, 'p_description', 'tv2', 'p_category', 'mercado',
      'subcategory_id', sub1::text), null, gen_random_uuid());
    raise exception 'detalhe de outro espaço aceito';
  exception when others then
    assert sqlerrm <> 'detalhe de outro espaço aceito', sqlerrm;
  end;

  insert into public.recurring_transactions (user_id, workspace_id, kind, amount_cents, category, description, account_id, rrule, dtstart, next_run_at,
     payment_method, expense_necessity, expense_necessity_source, subcategory_id, currency)
  values (usr, w1, 'expense', 9000, 'mercado','feira mensal', a1, 'FREQ=MONTHLY;BYMONTHDAY=5', now(), now(), 'boleto','essential','explicit', sub1, 'BRL') returning id into rec;
  assert (select payment_method from public.recurring_transactions where id=rec)='boleto';
  raise notice 'LOTE C OK';
end $$;
rollback;
