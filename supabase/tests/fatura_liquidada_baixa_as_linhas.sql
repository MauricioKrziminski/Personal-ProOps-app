-- Fatura adiada, ou paga em parte e vencida: as linhas ficam pagas (`20260927130000`).
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/fatura_liquidada_baixa_as_linhas.sql
--
-- 1. Pagar em parte uma fatura VENCIDA dá baixa nas compras e parcelas dela, com o vencimento.
-- 2. Apagar esse pagamento as reabre; a compra importada (já paga pelo extrato) fica.
-- 3. Adiar dá baixa; desfazer o adiamento sem pagamento reabre.
-- 4. Paga em parte e AINDA NÃO vencida: nada muda até vencer — e a rodada de hora em hora
--    (`_liquidar_faturas_vencidas`) dá a baixa quando vence.
-- 5. Quitar o resto depois não mexe na data de quem já tinha sido baixado.
-- Roda numa transação e dá rollback.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000008a1', 'teste-liquidada@example.invalid')
  on conflict (id) do nothing;
insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000008a1') on conflict (id) do nothing;
insert into public.workspaces (id, owner_id, name)
  values ('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000008a1', 'Teste liquidada');
insert into public.workspace_members (workspace_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000008a1', 'owner');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000008a1', true);
set local role authenticated;

do $$
declare
  w uuid := '00000000-0000-0000-0000-0000000008b1';
  u uuid := '00000000-0000-0000-0000-0000000008a1';
  card uuid := gen_random_uuid();
  cc uuid := gen_random_uuid();
  inv uuid;
  inv2 uuid;
  parcela uuid;
  importada uuid;
  pgto uuid;
  plano uuid;
  l record;
  n int;
begin
  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (card, w, u, 'Cartão', 'credit_card', 3, 10, 500000);
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta', 'checking', 1000000);

  -- uma fatura VENCIDA (compras de 3 meses atrás): uma parcela do app e uma compra importada
  plano := public.create_installment_plan_with_history(card, 30000::bigint, 3, (current_date - 90)::date, 0, 'TV', 'casa', null);
  select id, invoice_id into parcela, inv from public.transactions where installment_plan_id = plano and installment_no = 1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
    values (w, u, 'expense', 5000, 'Mercado', card, (current_date - 89)::date, 'import', 'cleared') returning id into importada;
  select due_date, status into l from public.card_invoices where id = inv;
  if l.due_date >= current_date then raise exception 'o teste precisa de uma fatura vencida (%)', l.due_date; end if;
  update public.transactions set paid_at = (current_date - 89)::date where id = importada;

  -- 1. paga em parte uma vencida
  pgto := public.pay_invoice(inv, cc, current_date, 4000::bigint);
  select status, paid_at into l from public.transactions where id = parcela;
  if l.status <> 'cleared' or l.paid_at <> (select due_date from public.card_invoices where id = inv) then
    raise exception '1: a parcela não foi baixada com o vencimento (% %)', l.status, l.paid_at;
  end if;

  -- 2. apagar o pagamento reabre a parcela; a importada fica
  delete from public.transactions where id = pgto;
  if (select status from public.transactions where id = parcela) <> 'pending' then raise exception '2: a parcela não reabriu'; end if;
  if (select status from public.transactions where id = importada) <> 'cleared' then raise exception '2: a importada reabriu'; end if;

  -- 3. adiar dá baixa; desfazer o adiamento (sem pagamento) reabre
  perform public.roll_invoice(inv, 0, 0);
  if (select status from public.transactions where id = parcela) <> 'cleared' then raise exception '3: adiar não baixou'; end if;
  perform public.unroll_invoice(inv);
  if (select status from public.transactions where id = parcela) <> 'pending' then raise exception '3: desfazer o adiamento não reabriu'; end if;

  -- 5. paga em parte (baixa) e depois quita o resto: a data da baixa fica
  perform public.pay_invoice(inv, cc, current_date, 4000::bigint);
  perform public.pay_invoice(inv, cc, current_date, null);
  select t.status, t.paid_at, ci.status as fatura, ci.due_date into l
    from public.transactions t join public.card_invoices ci on ci.id = t.invoice_id where t.id = parcela;
  if l.status <> 'cleared' or l.fatura <> 'paid' then raise exception '5: % %', l.status, l.fatura; end if;

  -- 4. paga em parte e ainda NÃO vencida: nada muda; vencendo, a rodada dá a baixa
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
    values (w, u, 'expense', 8000, 'Fone', card, current_date, 'app', 'pending') returning id, invoice_id into parcela, inv2;
  select due_date into l from public.card_invoices where id = inv2;
  if l.due_date < current_date then raise exception '4: a compra de hoje devia estar numa fatura a vencer (%)', l.due_date; end if;
  perform public.pay_invoice(inv2, cc, current_date, 1000::bigint);
  if (select status from public.transactions where id = parcela) <> 'pending' then raise exception '4: baixou antes de vencer'; end if;
  reset role;
  update public.card_invoices set due_date = current_date - 1 where id = inv2;  -- o dia passou (o gatilho vê)
  update public.transactions set status = 'pending', paid_at = null where id = parcela;  -- e a rodada também tem que ver
  n := public._liquidar_faturas_vencidas();
  if n < 1 or (select status from public.transactions where id = parcela) <> 'cleared' then
    raise exception '4: a rodada não deu a baixa (%)', n;
  end if;
end $$;

rollback;
