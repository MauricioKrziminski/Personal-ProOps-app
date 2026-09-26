-- O pagamento da fatura se edita e se apaga; "Marcar como paga" e o adiamento se desfazem
-- (`20260926180000`). Roda como `authenticated`, que é quem o app usa.
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/pagamento_da_fatura_se_desfaz.sql
--
-- 1. Pagar tudo, baixar o valor do pagamento (reabre, a parcela volta a prevista), subir de
--    volta (quita de novo), passar do total (recusa), mudar a data (a fatura acompanha), apagar
--    (reabre).
-- 2. Pagamento em parte de uma fatura adiada não muda sem desfazer o adiamento; desfazer tira o
--    saldo, os juros e o IOF da fatura seguinte.
-- 3. "Marcar como paga" se desfaz; a fatura paga por pagamento não se desmarca por ali.
-- 4. Cartão que adia sozinho: desfazer o adiamento de uma vencida é recusado, com o motivo.
-- 5. Apagar o espaço inteiro (cascata) não é travado pelo pagamento da fatura adiada.
-- Datas daqui a dois anos: o teste não depende do dia. Roda numa transação e dá rollback.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000007a1', 'teste-fatura@example.invalid')
  on conflict (id) do nothing;
insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000007a1') on conflict (id) do nothing;
insert into public.workspaces (id, owner_id, name)
  values ('00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1', 'Teste fatura');
insert into public.workspace_members (workspace_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1', 'owner');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000007a1', true);
set local role authenticated;

do $$
declare
  w uuid := '00000000-0000-0000-0000-0000000007b1';
  u uuid := '00000000-0000-0000-0000-0000000007a1';
  card uuid := '00000000-0000-0000-0000-0000000007c1';
  cc uuid := '00000000-0000-0000-0000-0000000007c2';
  ano int := extract(year from current_date)::int + 2;
  inv uuid;
  parcela uuid;
  pgto uuid;
  parte uuid;
  l record;
  n int;
begin
  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (card, w, u, 'Cartão', 'credit_card', 3, 10, 500000);
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta', 'checking', 100000);
  -- uma compra à vista e uma "parcela" prevista na fatura de junho (fecha 03/06, vence 10/06)
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source)
    values (w, u, 'expense', 30000, 'Fone', card, make_date(ano, 5, 10), 'app') returning invoice_id into inv;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
    values (w, u, 'expense', 10000, 'Parcela', card, make_date(ano, 5, 12), 'app', 'pending') returning id into parcela;

  -- ── 1. pagar tudo e mexer no pagamento ─────────────────────────────────────────────────
  pgto := public.pay_invoice(inv, cc, make_date(ano, 6, 8), null);
  select status, paid_cents, paid_at, payment_transaction_id into l from public.card_invoices where id = inv;
  if l.status <> 'paid' or l.paid_cents <> 40000 or l.payment_transaction_id <> pgto then
    raise exception '1: não quitou (% %)', l.status, l.paid_cents;
  end if;
  if (select pays_invoice_id from public.transactions where id = pgto) <> inv then
    raise exception '1: o pagamento não ficou ligado à fatura';
  end if;

  update public.transactions set amount_cents = 25000 where id = pgto;
  select status, paid_cents, paid_at, payment_transaction_id into l from public.card_invoices where id = inv;
  if l.status <> 'open' or l.paid_cents <> 25000 or l.paid_at is not null or l.payment_transaction_id is not null then
    raise exception '1: baixar o pagamento não reabriu (% % % %)', l.status, l.paid_cents, l.paid_at, l.payment_transaction_id;
  end if;
  select status, paid_at into l from public.transactions where id = parcela;
  if l.status <> 'pending' or l.paid_at is not null then raise exception '1: a parcela não voltou a prevista (%)', l.status; end if;

  update public.transactions set amount_cents = 40000 where id = pgto;
  select status, paid_cents, paid_at into l from public.card_invoices where id = inv;
  if l.status <> 'paid' or l.paid_cents <> 40000 or l.paid_at <> make_date(ano, 6, 8) then
    raise exception '1: subir de volta não quitou (% % %)', l.status, l.paid_cents, l.paid_at;
  end if;
  if (select status from public.transactions where id = parcela) <> 'cleared' then raise exception '1: a parcela não foi baixada'; end if;

  begin
    update public.transactions set amount_cents = 50000 where id = pgto;
    raise exception 'FALHOU: pagamento maior que a fatura';
  exception when others then
    if sqlerrm not like 'O pagamento passa do valor da fatura%' then raise exception '1: recusa errada: %', sqlerrm; end if;
  end;

  update public.transactions set occurred_at = make_date(ano, 6, 9) where id = pgto;
  select paid_at into l from public.card_invoices where id = inv;
  if l.paid_at <> make_date(ano, 6, 9) then raise exception '1: a data do pagamento não acompanhou (%)', l.paid_at; end if;
  if (select paid_at from public.transactions where id = parcela) <> make_date(ano, 6, 9) then
    raise exception '1: a parcela ficou com a data velha';
  end if;

  delete from public.transactions where id = pgto;
  select status, paid_cents into l from public.card_invoices where id = inv;
  if l.status <> 'open' or l.paid_cents <> 0 then raise exception '1: apagar não reabriu (% %)', l.status, l.paid_cents; end if;

  -- ── 2. fatura adiada ────────────────────────────────────────────────────────────────────
  parte := public.pay_invoice(inv, cc, make_date(ano, 6, 9), 15000);
  perform public.roll_invoice(inv, 1000, 500);
  begin
    update public.transactions set amount_cents = 12000 where id = parte;
    raise exception 'FALHOU: mudou o pagamento da fatura adiada';
  exception when others then
    if sqlerrm not like 'Essa fatura já foi para a próxima%' then raise exception '2: recusa errada: %', sqlerrm; end if;
  end;
  select rolled_into_invoice_id as destino into l from public.card_invoices where id = inv;
  perform public.unroll_invoice(inv);
  select status, rolled_into_invoice_id, paid_cents into l from public.card_invoices where id = inv;
  if l.status <> 'open' or l.rolled_into_invoice_id is not null or l.paid_cents <> 15000 then
    raise exception '2: o adiamento não se desfez (% % %)', l.status, l.rolled_into_invoice_id, l.paid_cents;
  end if;
  select count(*) into n from public.transactions
   where workspace_id = w and (rollover_of_invoice_id = inv or description like '%rotativo%');
  if n <> 0 then raise exception '2: sobraram % linhas do adiamento', n; end if;
  select count(*) into n from public.card_invoices where workspace_id = w and reference_month = make_date(ano, 7, 1);
  if n <> 0 then raise exception '2: a fatura seguinte vazia ficou'; end if;
  -- agora o pagamento em parte muda
  update public.transactions set amount_cents = 12000 where id = parte;
  if (select paid_cents from public.card_invoices where id = inv) <> 12000 then raise exception '2: paid_cents não acompanhou'; end if;

  -- ── 3. "Marcar como paga" se desfaz ────────────────────────────────────────────────────
  perform public.settle_invoice(inv, make_date(ano, 6, 10));
  if (select status from public.transactions where id = parcela) <> 'cleared' then raise exception '3: quitar não baixou'; end if;
  perform public.unsettle_invoice(inv);
  select status, paid_at, settled_manually into l from public.card_invoices where id = inv;
  if l.status <> 'open' or l.paid_at is not null or l.settled_manually then
    raise exception '3: não desmarcou (% % %)', l.status, l.paid_at, l.settled_manually;
  end if;
  if (select status from public.transactions where id = parcela) <> 'pending' then raise exception '3: a parcela não voltou'; end if;
  pgto := public.pay_invoice(inv, cc, make_date(ano, 6, 10), null);
  begin
    perform public.unsettle_invoice(inv);
    raise exception 'FALHOU: desmarcou a fatura paga por pagamento';
  exception when others then
    if sqlerrm not like 'Essa fatura foi paga com um pagamento%' then raise exception '3: recusa errada: %', sqlerrm; end if;
  end;
  delete from public.transactions where id = pgto;

  -- ── 3b. parcela já paga pela edição da compra, com a fatura FECHADA pelo cron ─────────────
  -- (a quitação achava só fatura `open`; o cron fecha de hora em hora as vencidas)
  declare
    plano uuid;
    p1 uuid;
    fat1 uuid;
    passado date := make_date(extract(year from current_date)::int - 1, 3, 10);
  begin
    plano := public.create_installment_plan_with_history(card, 60000, 3, passado, 0, 'Cadeira', 'casa', null);
    select id, invoice_id into p1, fat1 from public.transactions where installment_plan_id = plano and installment_no = 1;
    update public.card_invoices set status = 'closed' where id = fat1;
    perform public.update_installment_plan(plano, 60000, 3, passado, 'Cadeira', 'casa', null, card, 1);
    select status, settled_manually, paid_at, due_date into l from public.card_invoices where id = fat1;
    if l.status <> 'paid' or not l.settled_manually then raise exception '3b: a fatura fechada não quitou (%)', l.status; end if;
    if (select paid_at from public.transactions where id = p1) <> l.due_date then
      raise exception '3b: a parcela não ficou com a data da quitação';
    end if;
    -- desmarcar a fatura reabre a parcela
    perform public.unsettle_invoice(fat1);
    if (select status from public.transactions where id = p1) <> 'pending' then raise exception '3b: desmarcar não reabriu a parcela'; end if;
    if (select status from public.card_invoices where id = fat1) <> 'closed' then raise exception '3b: a fatura vencida devia voltar fechada'; end if;
  end;

  -- ── 4. cartão que adia sozinho ─────────────────────────────────────────────────────────
  update public.accounts set rotativo_auto = true where id = card;
  perform public.roll_invoice(inv, 0, 0);
  update public.card_invoices set due_date = current_date - 1 where id = inv;
  begin
    perform public.unroll_invoice(inv);
    raise exception 'FALHOU: desfez o adiamento automático';
  exception when others then
    if sqlerrm not like 'Este cartão adia a fatura vencida sozinho%' then raise exception '4: recusa errada: %', sqlerrm; end if;
  end;
end $$;

-- ── 5. a cascata não trava ──────────────────────────────────────────────────────────────
reset role;
delete from public.workspaces where id = '00000000-0000-0000-0000-0000000007b1';

rollback;
