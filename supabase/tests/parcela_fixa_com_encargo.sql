-- Parcela fixa paga com valor diferente (25/09/2026).
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/parcela_fixa_com_encargo.sql
--
-- Decisão do dono do produto: numa dívida de PARCELA FIXA, pagar R$ 103 numa parcela de R$ 100
-- conta UMA parcela — o saldo cai R$ 100, como o banco vê — e a diferença vira encargo (a mais)
-- ou desconto (a menos). Antes o trigger abatia o valor inteiro, e o CHECK do contrato fixo
-- (saldo = parcela × restantes) recusava: pagar diferente e corrigir o valor depois eram
-- impossíveis, e o erro sumia atrás do teclado.
--
-- 1–2: encargo e desconto no pagamento. 3: corrigir o valor de um pagamento ANTIGO não mexe no
-- saldo (ele não depende do valor). 4: apagar o mais recente devolve UMA parcela; apagar um
-- antigo continua recusado. 5: dívida COM JUROS continua abatendo o valor pago, e corrigir um
-- pagamento antigo dela continua recusado (o desvio do modo fixo não vaza). 6: o valor de UMA
-- parcela tem limite — da metade até menos do dobro —, senão R$ 0,01 quitaria uma parcela e três
-- parcelas pagas juntas contariam como uma. 7: "Este e as próximas parcelas" — o contrato passa
-- ao valor novo ANTES e o pagamento MAIS RECENTE, corrigido para esse valor, vira a parcela inteira
-- nele (sem encargo), como na folha de pagar; num pagamento antigo o encargo continua. 8: pagar,
-- editar o contrato e apagar o pagamento (produção, 25/09/2026) devolve UMA parcela — era recusado.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  ws uuid; u uuid; conta uuid; d uuid; dj uuid; d7 uuid; d8 uuid; p1 uuid; p2 uuid; q1 uuid; q2 uuid; r1 uuid;
  l record;
begin
  select w.id, m.user_id into ws, u
  from public.workspaces w join public.workspace_members m on m.workspace_id = w.id
  order by w.created_at limit 1;
  select id into conta from public.accounts
  where workspace_id = ws and type <> 'credit_card' and not archived limit 1;
  if ws is null or conta is null then raise exception 'sem workspace/conta para testar'; end if;

  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents, due_day)
  values (ws, u, 'teste parcela fixa encargo', 'financing', 'fixed_installments', 120000, 120000, 0,
    12, 0, 10000, 10)
  returning id into d;

  -- 1. pagou R$ 3 a mais: uma parcela, saldo cai 100, encargo de 3
  perform public.pay_debt_installment(d, 10300, conta, current_date);
  select id, debt_payment_no, debt_principal_cents, debt_interest_cents, debt_balance_after_cents
    into l from public.transactions where debt_id = d order by debt_payment_no desc limit 1;
  p1 := l.id;
  if l.debt_payment_no <> 1 or l.debt_principal_cents <> 10000 or l.debt_interest_cents <> 300
     or l.debt_balance_after_cents <> 110000 then
    raise exception '1: nº % principal % encargo % saldo %', l.debt_payment_no,
      l.debt_principal_cents, l.debt_interest_cents, l.debt_balance_after_cents;
  end if;
  select installments_paid, remaining_cents into l from public.debts where id = d;
  if l.installments_paid <> 1 or l.remaining_cents <> 110000 then
    raise exception '1: dívida pagas % saldo %', l.installments_paid, l.remaining_cents;
  end if;

  -- 2. pagou R$ 2 a menos: uma parcela, saldo cai 100, desconto (encargo negativo) de 2
  perform public.pay_debt_installment(d, 9800, conta, current_date);
  select id, debt_payment_no, debt_principal_cents, debt_interest_cents into l
  from public.transactions where debt_id = d order by debt_payment_no desc limit 1;
  p2 := l.id;
  if l.debt_payment_no <> 2 or l.debt_principal_cents <> 10000 or l.debt_interest_cents <> -200 then
    raise exception '2: nº % principal % encargo %', l.debt_payment_no, l.debt_principal_cents,
      l.debt_interest_cents;
  end if;
  select installments_paid, remaining_cents into l from public.debts where id = d;
  if l.installments_paid <> 2 or l.remaining_cents <> 100000 then
    raise exception '2: dívida pagas % saldo %', l.installments_paid, l.remaining_cents;
  end if;

  -- 3. corrigir o valor do PRIMEIRO (não é o mais recente): pode, e o saldo não muda
  update public.transactions set amount_cents = 10500 where id = p1;
  select debt_principal_cents, debt_interest_cents, debt_balance_after_cents into l
  from public.transactions where id = p1;
  if l.debt_principal_cents <> 10000 or l.debt_interest_cents <> 500 or l.debt_balance_after_cents <> 110000 then
    raise exception '3: principal % encargo % saldo %', l.debt_principal_cents, l.debt_interest_cents,
      l.debt_balance_after_cents;
  end if;
  select installments_paid, remaining_cents into l from public.debts where id = d;
  if l.installments_paid <> 2 or l.remaining_cents <> 100000 then
    raise exception '3: dívida pagas % saldo %', l.installments_paid, l.remaining_cents;
  end if;

  -- 4. apagar um ANTIGO vale (`20260926140000`): devolve UMA parcela e o seguinte vira o nº 1
  delete from public.transactions where id = p1;
  select installments_paid, remaining_cents into l from public.debts where id = d;
  if l.installments_paid <> 1 or l.remaining_cents <> 110000 then
    raise exception '4: dívida pagas % saldo %', l.installments_paid, l.remaining_cents;
  end if;
  select debt_payment_no into l from public.transactions where id = p2;
  if l.debt_payment_no <> 1 then raise exception '4: o seguinte devia virar o nº 1 (%)', l.debt_payment_no; end if;
  -- e apagar o que sobrou devolve a outra
  delete from public.transactions where id = p2;
  select installments_paid, remaining_cents into l from public.debts where id = d;
  if l.installments_paid <> 0 or l.remaining_cents <> 120000 then
    raise exception '4: dívida pagas % saldo % depois de apagar os dois', l.installments_paid, l.remaining_cents;
  end if;

  -- 5. com juros: o valor pago continua abatendo (juros do mês primeiro)
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, due_day)
  values (ws, u, 'teste juros encargo', 'loan', 'amortized', 100000, 100000, 0.01, 12, 0, 10)
  returning id into dj;
  perform public.pay_debt_installment(dj, 20000, conta, current_date);
  select remaining_cents into l from public.debts where id = dj;
  if l.remaining_cents <> 81000 then
    raise exception '5: com juros o saldo ficou %, esperado 81000 (1000 de juros, 19000 abatidos)',
      l.remaining_cents;
  end if;
  perform public.pay_debt_installment(dj, 20000, conta, current_date);
  -- corrigir o ANTIGO vale (`20260926140000`): +5000 de principal nele, e o saldo depois dele, o
  -- do seguinte e o da dívida caem 5000; os juros cobrados ficam
  update public.transactions set amount_cents = 25000
  where debt_id = dj and debt_payment_no = 1;
  select debt_principal_cents, debt_interest_cents, debt_balance_after_cents into l
    from public.transactions where debt_id = dj and debt_payment_no = 1;
  if l.debt_principal_cents <> 24000 or l.debt_interest_cents <> 1000 or l.debt_balance_after_cents <> 76000 then
    raise exception '5: o antigo ficou principal % juros % saldo %', l.debt_principal_cents, l.debt_interest_cents, l.debt_balance_after_cents;
  end if;
  select debt_balance_after_cents, debt_interest_cents into l from public.transactions where debt_id = dj and debt_payment_no = 2;
  if l.debt_balance_after_cents <> 56810 or l.debt_interest_cents <> 810 then
    raise exception '5: o seguinte ficou saldo % juros % (56810 / 810)', l.debt_balance_after_cents, l.debt_interest_cents;
  end if;
  select remaining_cents into l from public.debts where id = dj;
  if l.remaining_cents <> 56810 then raise exception '5: a dívida ficou em % (56810)', l.remaining_cents; end if;

  -- 6. limites de UMA parcela no modo fixo (parcela de 10000)
  begin
    perform public.pay_debt_installment(d, 4999, conta, current_date);
    raise exception '6: menos da metade da parcela deveria ser recusado';
  exception when others then
    if sqlerrm like '6:%' then raise; end if;
  end;
  begin
    perform public.pay_debt_installment(d, 20000, conta, current_date);
    raise exception '6: o dobro da parcela deveria ser recusado';
  exception when others then
    if sqlerrm like '6:%' then raise; end if;
  end;
  perform public.pay_debt_installment(d, 5000, conta, current_date);   -- metade: aceita
  perform public.pay_debt_installment(d, 19999, conta, current_date);  -- quase o dobro: aceita
  begin
    -- (o p1 do caso 4 foi apagado: a correção vai no de 5000, que acabou de entrar)
    update public.transactions set amount_cents = 30000 where debt_id = d and amount_cents = 5000;
    if not found then raise exception '6: o pagamento de 5000 não existe (o teste não prova nada)'; end if;
    raise exception '6: corrigir para o triplo deveria ser recusado';
  exception when others then
    if sqlerrm like '6:%' then raise; end if;
  end;

  -- 7. parcela de 100, duas pagas a 100; a pessoa corrige a ÚLTIMA para 110 com "Este e as
  -- próximas": o app muda o contrato primeiro (110 × 4 restantes) e depois o pagamento
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents, due_day)
  values (ws, u, 'teste parcela nova', 'financing', 'fixed_installments', 60000, 60000, 0, 6, 0, 10000, 10)
  returning id into d7;
  perform public.pay_debt_installment(d7, 10000, conta, current_date);
  select id into q1 from public.transactions where debt_id = d7 and debt_payment_no = 1;
  perform public.pay_debt_installment(d7, 10000, conta, current_date);
  select id into q2 from public.transactions where debt_id = d7 and debt_payment_no = 2;
  update public.debts set principal_cents = 66000, remaining_cents = 44000, installment_cents = 11000,
    installments_paid = 2 where id = d7;
  update public.transactions set amount_cents = 11000 where id = q2;
  select debt_principal_cents, debt_interest_cents, debt_balance_after_cents into l
  from public.transactions where id = q2;
  if l.debt_principal_cents <> 11000 or l.debt_interest_cents <> 0 or l.debt_balance_after_cents <> 44000 then
    raise exception '7: a última deveria virar parcela de 11000 sem encargo, veio principal % encargo % saldo %',
      l.debt_principal_cents, l.debt_interest_cents, l.debt_balance_after_cents;
  end if;
  select installments_paid, remaining_cents into l from public.debts where id = d7;
  if l.installments_paid <> 2 or l.remaining_cents <> 44000 then
    raise exception '7: a dívida não muda — pagas % saldo %', l.installments_paid, l.remaining_cents;
  end if;
  -- o pagamento ANTIGO corrigido para o valor novo continua uma parcela de 100 com encargo
  update public.transactions set amount_cents = 11000 where id = q1;
  select debt_principal_cents, debt_interest_cents into l from public.transactions where id = q1;
  if l.debt_principal_cents <> 10000 or l.debt_interest_cents <> 1000 then
    raise exception '7: o antigo deveria seguir parcela 10000 + encargo 1000, veio % %',
      l.debt_principal_cents, l.debt_interest_cents;
  end if;
  -- e apagar a última depois disso devolve UMA parcela nova (sem o ramo, "Corrija primeiro…")
  delete from public.transactions where id = q2;
  select installments_paid, remaining_cents into l from public.debts where id = d7;
  if l.installments_paid <> 1 or l.remaining_cents <> 55000 then
    raise exception '7: apagar a última devolve UMA parcela nova — pagas % saldo %', l.installments_paid, l.remaining_cents;
  end if;

  -- 8. o caso de produção: 11 × 100, paga uma, e o contrato vira 12 × 100 com 1 paga — o saldo é
  -- recalculado (110000) e o pagamento guardou 100000. Apagar o único pagamento devolve a parcela.
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents, due_day)
  values (ws, u, 'teste apagar depois de editar', 'financing', 'fixed_installments', 110000, 110000, 0, 11, 0, 10000, 5)
  returning id into d8;
  perform public.pay_debt_installment(d8, 10000, conta, current_date);
  select id into r1 from public.transactions where debt_id = d8;
  update public.debts set principal_cents = 120000, remaining_cents = 110000, installments = 12,
    installments_paid = 1 where id = d8;
  delete from public.transactions where id = r1;
  select installments_paid, remaining_cents into l from public.debts where id = d8;
  if l.installments_paid <> 0 or l.remaining_cents <> 120000 then
    raise exception '8: apagar depois de editar devolve UMA parcela — pagas % saldo %', l.installments_paid, l.remaining_cents;
  end if;
end $$;

rollback;
