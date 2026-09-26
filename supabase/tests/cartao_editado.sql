-- Editar a conta e o cartão (`20260926170000`).
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/cartao_editado.sql
--
-- 1. Mudar o fechamento refaz as compras em aberto nas faturas certas, com as datas novas, e a
--    fatura aberta que ficou vazia sai; a fatura paga fica como está, e a compra que cairia
--    numa fatura paga fica onde estava.
-- 2. O tipo muda entre contas; entre cartão e conta, só sem lançamento.
-- Datas fixas no futuro, longe de hoje: o teste não depende do dia. Roda numa transação e dá rollback.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000006a1';
  w uuid := '00000000-0000-0000-0000-0000000006b1';
  card uuid := '00000000-0000-0000-0000-0000000006c1';
  cc uuid := '00000000-0000-0000-0000-0000000006c2';
  vazia uuid;
  compra uuid;
  l record;
  n int;
  ano int := extract(year from current_date)::int + 2;
begin
  insert into auth.users (id, email) values (u, 'teste-cartao@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste cartão');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (card, w, u, 'Cartão', 'credit_card', 3, 10, 500000);
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta', 'checking', 0);

  -- compra no dia 10/05: com fechamento no dia 3 ela é da fatura de junho (vence 10/06)
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source)
    values (w, u, 'expense', 5000, 'Fone', card, make_date(ano, 5, 10), 'app') returning id, invoice_id into compra, vazia;
  select ci.reference_month, ci.due_date into l from public.card_invoices ci where ci.id = vazia;
  if l.reference_month <> make_date(ano, 6, 1) then raise exception 'preparo: a compra caiu em % (junho)', l.reference_month; end if;

  -- ── 1. o fechamento passa para o dia 25: a compra do dia 10/05 é da fatura de MAIO ──────
  update public.accounts set closing_day = 25, due_day = 5 where id = card;
  select ci.reference_month, ci.closing_date, ci.due_date into l
    from public.transactions t join public.card_invoices ci on ci.id = t.invoice_id where t.id = compra;
  if l.reference_month <> make_date(ano, 5, 1) or l.closing_date <> make_date(ano, 5, 25) or l.due_date <> make_date(ano, 6, 5) then
    raise exception '1: a compra ficou na fatura % (fecha %, vence %)', l.reference_month, l.closing_date, l.due_date;
  end if;
  select count(*) into n from public.card_invoices where id = vazia;
  if n <> 0 then raise exception '1: a fatura de junho ficou vazia e não saiu'; end if;

  -- a fatura PAGA fica como está: mudar o fechamento de novo não tira a compra de lá
  update public.card_invoices ci set status = 'paid' from public.transactions t
   where t.id = compra and ci.id = t.invoice_id;
  update public.transactions set status = 'cleared' where id = compra;
  update public.accounts set closing_day = 3, due_day = 10 where id = card;
  select ci.reference_month, ci.status into l
    from public.transactions t join public.card_invoices ci on ci.id = t.invoice_id where t.id = compra;
  if l.reference_month <> make_date(ano, 5, 1) or l.status <> 'paid' then
    raise exception '1: a compra paga saiu da fatura paga (% / %)', l.reference_month, l.status;
  end if;

  -- a compra que cairia numa fatura PAGA pela régua nova fica onde estava
  declare
    julho uuid;
    tarde uuid;
  begin
    update public.accounts set closing_day = 25, due_day = 5 where id = card;
    -- 10/06 é de junho (fecha 25/06); 26/06 já é de julho
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source)
      values (w, u, 'expense', 1000, 'Pão', card, make_date(ano, 6, 10), 'app');
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source)
      values (w, u, 'expense', 2000, 'Livro', card, make_date(ano, 6, 26), 'app') returning id, invoice_id into tarde, julho;
    update public.card_invoices set status = 'paid'
     where account_id = card and reference_month = make_date(ano, 6, 1);
    -- fechando no dia 28, o 26/06 seria de junho — que está paga
    update public.accounts set closing_day = 28 where id = card;
    select invoice_id into l from public.transactions where id = tarde;
    if l.invoice_id <> julho then raise exception '1: a compra foi parar numa fatura paga'; end if;
  end;

  -- ── 2. o tipo ─────────────────────────────────────────────────────────────────────────
  update public.accounts set type = 'savings' where id = cc;   -- entre contas: livre
  begin
    update public.accounts set type = 'checking', closing_day = null, due_day = null, credit_limit_cents = null where id = card;
    raise exception 'FALHOU: cartão com lançamento virou conta';
  exception when others then
    if sqlerrm not like 'Esta conta tem lançamentos: cartão não vira conta%' then raise exception '2: recusa errada: %', sqlerrm; end if;
  end;
end $$;

rollback;
