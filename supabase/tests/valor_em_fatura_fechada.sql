-- O VALOR muda em fatura paga, adiada ou paga em parte (`20260928235000`).
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/valor_em_fatura_fechada.sql
--
-- O caso de produção (28/09/2026): "Controle (mãe)", 4 parcelas; 1 e 2 em faturas marcadas como
-- pagas à mão, 3 numa fatura paga por transferência, 4 na aberta. "Todas" com R$ 60,08 era
-- recusado. O que prende: a série inteira muda, a fatura paga continua paga com o pagamento que
-- saiu da conta, o saldo adiado anda a mesma diferença, e a paga em parte fecha ou recusa.

\set ON_ERROR_STOP on
begin;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f0a1', true);

do $$
declare
  usr uuid := '00000000-0000-0000-0000-00000000f0a1';
  ws uuid; conta uuid; cartao uuid;
begin
  insert into auth.users (id, email) values (usr, 'teste-valor-fatura@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  insert into public.workspaces (name, owner_id) values ('teste valor em fatura fechada', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Conta', 'checking', 500000) returning id into conta;
  insert into public.accounts
    (workspace_id, user_id, name, type, closing_day, due_day, payment_account_id)
    values (ws, usr, 'Cartao', 'credit_card', 3, 10, conta);
end $$;

set local role authenticated;

do $$
declare
  ws uuid := (select id from public.workspaces where name = 'teste valor em fatura fechada');
  conta uuid := (select id from public.accounts where workspace_id = (select id from public.workspaces where name = 'teste valor em fatura fechada') and type = 'checking');
  cartao uuid := (select id from public.accounts where workspace_id = (select id from public.workspaces where name = 'teste valor em fatura fechada') and type = 'credit_card');
  plano uuid; p1 uuid; p4 uuid;
  f1 uuid; f2 uuid; f3 uuid;
  pago3 bigint; total3 bigint; saldo_conta bigint; saldo_depois bigint;
  n int; v bigint; st text;
begin
  -- 1. o "Controle (mãe)": 240,41 em 4x a partir de 15/06
  perform public.create_installment_plan_with_history(cartao, 24041, 4, '2026-06-15', 0, 'Controle (mãe)', 'presentes', null);
  select id into plano from public.installment_plans where workspace_id = ws and description = 'Controle (mãe)';
  select id, invoice_id into p1, f1 from public.transactions where installment_plan_id = plano and installment_no = 1;
  select invoice_id into f2 from public.transactions where installment_plan_id = plano and installment_no = 2;
  select invoice_id into f3 from public.transactions where installment_plan_id = plano and installment_no = 3;
  select id into p4 from public.transactions where installment_plan_id = plano and installment_no = 4;

  perform public.settle_invoice(f1, '2026-07-10');
  perform public.settle_invoice(f2, '2026-08-10');
  select sum(amount_cents) into total3 from public.transactions where invoice_id = f3;
  perform public.pay_invoice(f3, conta, '2026-09-10', total3);
  select paid_cents into pago3 from public.card_invoices where id = f3;
  select cleared_cents into saldo_conta from public.account_balances() where account_id = conta;

  -- 2. "Todas" com 60,08 a partir da parcela 4: passa (era recusado)
  perform public.update_installment_scope(p4, 'all', '{"amount_cents": 6008}'::jsonb);
  select count(*) into n from public.transactions where installment_plan_id = plano and amount_cents = 6008;
  if n <> 4 then raise exception '2. as 4 parcelas deveriam ter 60,08, % têm', n; end if;

  -- 3. as faturas pagas continuam pagas; a paga por transferência mantém o pagamento, e a conta
  --    corrente não se mexe
  select count(*) into n from public.card_invoices where id in (f1, f2, f3) and status = 'paid';
  if n <> 3 then raise exception '3. as 3 faturas deveriam seguir pagas, % estão', n; end if;
  select paid_cents into v from public.card_invoices where id = f3;
  if v <> pago3 then raise exception '3. o pagamento da fatura 3 mudou: % → %', pago3, v; end if;
  select cleared_cents into saldo_depois from public.account_balances() where account_id = conta;
  if saldo_depois <> saldo_conta then raise exception '3. a conta corrente mudou: % → %', saldo_conta, saldo_depois; end if;

  -- 4. o total da compra acompanha (a soma das parcelas)
  select total_cents into v from public.installment_plans where id = plano;
  if v <> 4 * 6008 then raise exception '4. o total da compra deveria ser %, é %', 4 * 6008, v; end if;

  -- 5. a data de uma parcela em fatura paga continua travada
  begin
    perform public.update_installment_occurrence(p1, '{"occurred_at": "2026-06-20"}'::jsonb);
    raise exception '5. mudar a data da parcela paga deveria ser recusado';
  exception when others then
    if sqlerrm not like '%data não muda%' then raise; end if;
  end;
end $$;

reset role;

-- 6. fatura ADIADA: o saldo levado para a seguinte anda a mesma diferença
do $$
declare
  ws uuid := (select id from public.workspaces where name = 'teste valor em fatura fechada');
  usr uuid := '00000000-0000-0000-0000-00000000f0a1';
  cartao uuid := (select id from public.accounts where workspace_id = (select id from public.workspaces where name = 'teste valor em fatura fechada') and type = 'credit_card');
  compra uuid; fat uuid; adiado bigint; depois bigint; r jsonb;
begin
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, category, description, occurred_at, status)
    values (ws, usr, cartao, 'expense', 100000, 'outros', 'Compra adiada', '2026-04-15', 'pending')
    returning id, invoice_id into compra, fat;
  update public.card_invoices set status = 'closed' where id = fat;
  r := public.roll_invoice(fat);
  select amount_cents into adiado from public.transactions where rollover_of_invoice_id = fat;

  update public.transactions set amount_cents = 100500 where id = compra;
  select amount_cents into depois from public.transactions where rollover_of_invoice_id = fat;
  if depois <> adiado + 500 then raise exception '6. o saldo adiado deveria ir de % para %, foi %', adiado, adiado + 500, depois; end if;
  if (select status from public.card_invoices where id = fat) <> 'rolled' then
    raise exception '6. a fatura adiada deixou de ser adiada';
  end if;
end $$;

-- 7. fatura aberta PAGA EM PARTE: baixar até o que foi pago fecha; abaixo disso recusa
do $$
declare
  ws uuid := (select id from public.workspaces where name = 'teste valor em fatura fechada');
  usr uuid := '00000000-0000-0000-0000-00000000f0a1';
  conta uuid := (select id from public.accounts where workspace_id = (select id from public.workspaces where name = 'teste valor em fatura fechada') and type = 'checking');
  cartao uuid := (select id from public.accounts where workspace_id = (select id from public.workspaces where name = 'teste valor em fatura fechada') and type = 'credit_card');
  compra uuid; fat uuid;
begin
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, category, description, occurred_at, status)
    values (ws, usr, cartao, 'expense', 20000, 'outros', 'Compra em parte', '2026-01-15', 'pending')
    returning id, invoice_id into compra, fat;
  update public.card_invoices set status = 'closed' where id = fat;
  perform public.pay_invoice(fat, conta, '2026-02-10', 15000);

  begin
    update public.transactions set amount_cents = 14000 where id = compra;
    raise exception '7. baixar abaixo do que já foi pago deveria ser recusado';
  exception when others then
    if sqlerrm not like '%passa do total%' then raise; end if;
  end;

  update public.transactions set amount_cents = 15000 where id = compra;
  if (select status from public.card_invoices where id = fat) <> 'paid' then
    raise exception '7. com o que falta zerado, a fatura deveria virar paga';
  end if;
end $$;

-- 8. fatura PAGA por transferência com o valor que SOBE: reabre com a diferença (senão ela
--    sumiria de toda leitura de "a pagar"); o pagamento, que é o que saiu da conta, fica
do $$
declare
  ws uuid := (select id from public.workspaces where name = 'teste valor em fatura fechada');
  usr uuid := '00000000-0000-0000-0000-00000000f0a1';
  conta uuid := (select id from public.accounts where workspace_id = (select id from public.workspaces where name = 'teste valor em fatura fechada') and type = 'checking');
  cartao uuid := (select id from public.accounts where workspace_id = (select id from public.workspaces where name = 'teste valor em fatura fechada') and type = 'credit_card');
  compra uuid; fat uuid; r record;
begin
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, category, description, occurred_at, status)
    values (ws, usr, cartao, 'expense', 30000, 'outros', 'Compra que sobe', '2025-11-15', 'pending')
    returning id, invoice_id into compra, fat;
  update public.card_invoices set status = 'closed' where id = fat;
  perform public.pay_invoice(fat, conta, '2025-12-10', 30000);
  if (select status from public.card_invoices where id = fat) <> 'paid' then
    raise exception '8. a fatura deveria estar paga antes da correção';
  end if;

  update public.transactions set amount_cents = 30500 where id = compra;
  select status, paid_cents, private.invoice_open_cents(id) as aberto into r from public.card_invoices where id = fat;
  if r.status = 'paid' then raise exception '8. subiu além do pago e a fatura seguiu paga'; end if;
  if r.paid_cents <> 30000 or r.aberto <> 500 then
    raise exception '8. deveria ficar pago 30000 e faltando 500, ficou % e %', r.paid_cents, r.aberto;
  end if;

  -- e voltando ao valor pago, ela fecha de novo
  update public.transactions set amount_cents = 30000 where id = compra;
  if (select status from public.card_invoices where id = fat) <> 'paid' then
    raise exception '8. voltando ao valor pago, a fatura deveria fechar de novo';
  end if;
end $$;

select 'valor_em_fatura_fechada: ok' as resultado;
rollback;
