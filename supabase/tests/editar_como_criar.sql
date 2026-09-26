-- Tudo que se cria se edita (`20260926130000`).
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/editar_como_criar.sql
--
-- 1. A dívida troca de modo (parcela fixa ↔ com juros) nos dois sentidos.
-- 2. Compra em CONTA com parcela paga: "parcelas já pagas" sobe e desce, o número de parcelas
--    muda (as pagas ficam, o resto se reparte), e a data e a conta mudam — a paga acompanha.
-- 3. Recusas com o motivo: número abaixo da última paga, à vista com parcela paga.
-- 4. Compra no CARTÃO: as já pagas quitam a fatura vencida que é só delas, e reabrem junto; a
--    fatura paga de verdade não reabre; data e cartão não mudam com parcela paga na fatura.
-- 5. Renomear uma compra de fatura adiada não a leva para a fatura seguinte.
-- 6. Parcelar um lançamento que já existe pergunta as já pagas, como a criação.
-- Datas relativas a hoje: o teste não envelhece. Roda numa transação e dá rollback.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000002a1';
  w uuid := '00000000-0000-0000-0000-0000000002b1';
  cc uuid := '00000000-0000-0000-0000-0000000002c1';
  cc2 uuid := '00000000-0000-0000-0000-0000000002c2';
  card uuid := '00000000-0000-0000-0000-0000000002c3';
  card2 uuid := '00000000-0000-0000-0000-0000000002c4';
  divida uuid := '00000000-0000-0000-0000-0000000002d1';
  plano uuid;
  fatura uuid;
  l record;
  n int;
  v bigint;
  hoje date := current_date;
begin
  insert into auth.users (id, email) values (u, 'teste-editar@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste editar');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents) values
    (cc, w, u, 'Conta', 'checking', 0), (cc2, w, u, 'Outra conta', 'checking', 0);
  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents) values
    (card, w, u, 'Cartão', 'credit_card', 3, 10, 5000000), (card2, w, u, 'Outro cartão', 'credit_card', 3, 10, 5000000);

  -- ── 1. dívida: parcela fixa → com juros → parcela fixa ─────────────────────────────────
  insert into public.debts (id, workspace_id, user_id, name, kind, calculation_mode, principal_cents, remaining_cents,
                            interest_rate_monthly, installments, installments_paid, installment_cents, due_day)
    values (divida, w, u, 'Carro', 'financing', 'fixed_installments', 1000000, 800000, 0, 10, 2, 100000, 5);
  update public.debts set calculation_mode = 'amortized', interest_rate_monthly = 0.0199 where id = divida;
  update public.debts set calculation_mode = 'fixed_installments', interest_rate_monthly = 0,
                          installment_cents = 100000, installments = 10, installments_paid = 2,
                          principal_cents = 1000000, remaining_cents = 800000 where id = divida;
  select calculation_mode into l from public.debts where id = divida;
  if l.calculation_mode <> 'fixed_installments' then raise exception '1: o modo não voltou (%)', l.calculation_mode; end if;

  -- ── 2. compra em conta ─────────────────────────────────────────────────────────────────
  plano := public.create_installment_plan_with_history(cc, 40000, 4, hoje + 5, 0, 'Curso', 'estudo', null);
  -- as já pagas SOBEM de 0 para 2
  perform public.update_installment_plan(plano, 40000, 4, hoje + 5, 'Curso', 'estudo', null, cc, 2);
  select count(*) filter (where status = 'cleared' and installment_no <= 2) as pagas,
         count(*) filter (where status = 'pending' and installment_no > 2) as abertas into l
    from public.transactions where installment_plan_id = plano;
  if l.pagas <> 2 or l.abertas <> 2 then raise exception '2: pagas % (2), abertas % (2)', l.pagas, l.abertas; end if;

  -- o número muda com parcela paga: 4 → 6, as pagas ficam (10.000 cada) e 20.000 se reparte em 4
  perform public.update_installment_plan(plano, 40000, 6, hoje + 5, 'Curso', 'estudo', null, cc, null);
  select count(*) as n, sum(amount_cents) filter (where status = 'cleared') as pago,
         count(*) filter (where status = 'pending' and amount_cents = 5000) as de5000 into l
    from public.transactions where installment_plan_id = plano;
  if l.n <> 6 or l.pago <> 20000 or l.de5000 <> 4 then
    raise exception '2: parcelas % (6), pago % (20000), em aberto de 5.000: % (4)', l.n, l.pago, l.de5000;
  end if;

  -- data e conta mudam com parcela paga FORA do cartão — e a paga acompanha
  perform public.update_installment_plan(plano, 40000, 6, hoje + 12, 'Curso', 'estudo', null, cc2, null);
  select count(*) filter (where account_id = cc2) as na_outra, min(occurred_at) as primeira into l
    from public.transactions where installment_plan_id = plano;
  if l.na_outra <> 6 or l.primeira <> hoje + 12 then raise exception '2: conta % (6 na outra), 1ª em % (%)', l.na_outra, l.primeira, hoje + 12; end if;

  -- as já pagas DESCEM de 2 para 1: a 2ª reabre
  perform public.update_installment_plan(plano, 40000, 6, hoje + 12, 'Curso', 'estudo', null, cc2, 1);
  select status into l from public.transactions where installment_plan_id = plano and installment_no = 2;
  if l.status <> 'pending' then raise exception '2: a 2ª não reabriu (%)', l.status; end if;

  -- ── 3. recusas com o motivo ────────────────────────────────────────────────────────────
  perform public.update_installment_plan(plano, 40000, 6, hoje + 12, 'Curso', 'estudo', null, cc2, 3);
  begin
    perform public.update_installment_plan(plano, 40000, 2, hoje + 12, 'Curso', 'estudo', null, cc2, null);
    raise exception 'FALHOU: 2 parcelas com a 3ª paga';
  exception when others then
    if sqlerrm not like 'A parcela 3 já está paga%' then raise exception '3: recusa errada: %', sqlerrm; end if;
  end;
  begin
    perform public.update_installment_plan(plano, 40000, 1, hoje + 12, 'Curso', 'estudo', null, cc2, null);
    raise exception 'FALHOU: à vista com parcela paga';
  exception when others then
    if sqlerrm not like '%à vista seria um pagamento só%' then raise exception '3: recusa errada: %', sqlerrm; end if;
  end;
  begin
    perform public.update_installment_plan(plano, 40000, 6, hoje + 12, 'Curso', 'estudo', null, cc2, 7);
    raise exception 'FALHOU: 7 pagas de 6';
  exception when others then
    if sqlerrm not like 'As parcelas já pagas precisam ficar entre 0 e 6%' then raise exception '3: recusa errada: %', sqlerrm; end if;
  end;

  -- ── 4. compra no cartão, começada há 100 dias ──────────────────────────────────────────
  plano := public.create_installment_plan_with_history(card, 30000, 3, hoje - 100, 0, 'Fone', 'eletrônicos', null);
  perform public.update_installment_plan(plano, 30000, 3, hoje - 100, 'Fone', 'eletrônicos', null, card, 2);
  select count(*) into n from public.card_invoices ci
   where ci.id in (select invoice_id from public.transactions where installment_plan_id = plano and installment_no <= 2)
     and ci.status = 'paid' and ci.settled_manually;
  if n <> 2 then raise exception '4: as faturas vencidas das 2 pagas deviam ter sido quitadas (%)', n; end if;

  -- desce para 1: a 2ª reabre, e a fatura que foi quitada por causa dela também
  perform public.update_installment_plan(plano, 30000, 3, hoje - 100, 'Fone', 'eletrônicos', null, card, 1);
  select t.status, ci.status as fatura into l
    from public.transactions t join public.card_invoices ci on ci.id = t.invoice_id
   where t.installment_plan_id = plano and t.installment_no = 2;
  if l.status <> 'pending' or l.fatura <> 'open' then raise exception '4: a 2ª % / fatura % (pending/open)', l.status, l.fatura; end if;

  -- data e cartão não mudam com parcela paga na fatura
  begin
    perform public.update_installment_plan(plano, 30000, 3, hoje - 90, 'Fone', 'eletrônicos', null, card, null);
    raise exception 'FALHOU: data com parcela paga na fatura';
  exception when others then
    if sqlerrm not like '%a data da primeira não muda%' then raise exception '4: recusa errada: %', sqlerrm; end if;
  end;
  begin
    perform public.update_installment_plan(plano, 30000, 3, hoje - 100, 'Fone', 'eletrônicos', null, card2, null);
    raise exception 'FALHOU: cartão com parcela paga na fatura';
  exception when others then
    if sqlerrm not like '%o cartão não muda%' then raise exception '4: recusa errada: %', sqlerrm; end if;
  end;
  -- mas o número muda: 3 → 5, a paga fica
  perform public.update_installment_plan(plano, 30000, 5, hoje - 100, 'Fone', 'eletrônicos', null, card, null);
  select count(*) into n from public.transactions where installment_plan_id = plano;
  if n <> 5 then raise exception '4: 5 parcelas (%)', n; end if;

  -- a fatura paga DE VERDADE não reabre por aqui
  select invoice_id into fatura from public.transactions where installment_plan_id = plano and installment_no = 1;
  update public.card_invoices set settled_manually = false where id = fatura;
  begin
    perform public.update_installment_plan(plano, 30000, 5, hoje - 100, 'Fone', 'eletrônicos', null, card, 0);
    raise exception 'FALHOU: reabrir parcela de fatura paga';
  exception when others then
    if sqlerrm not like 'A parcela 1 foi paga junto com a fatura do cartão%' then raise exception '4: recusa errada: %', sqlerrm; end if;
  end;

  select sum(amount_cents) into v from public.transactions where installment_plan_id = plano;
  if v <> 30000 then raise exception '4: a soma das parcelas é % (30000)', v; end if;

  -- ── 5. renomear uma compra de fatura ADIADA não a leva para a fatura seguinte ─────────
  declare
    compra uuid;
    adiada uuid;
    seguinte uuid;
  begin
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source)
      values (w, u, 'expense', 5000, 'Mercado', card2, hoje - 40, 'app') returning id, invoice_id into compra, adiada;
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source)
      values (w, u, 'expense', 100, 'Outra', card2, hoje - 5, 'app') returning invoice_id into seguinte;
    if adiada = seguinte then raise exception '5: o teste precisa de duas faturas'; end if;
    update public.card_invoices set status = 'rolled', rolled_into_invoice_id = seguinte where id = adiada;
    -- o formulário manda a linha inteira: conta e data MENCIONADAS, iguais
    update public.transactions set description = 'Mercado do mês', account_id = card2, occurred_at = hoje - 40
     where id = compra;
    select invoice_id into l from public.transactions where id = compra;
    if l.invoice_id <> adiada then raise exception '5: renomear levou a compra da fatura adiada para outra'; end if;
    -- mudar a data de verdade continua mudando a fatura
    update public.transactions set occurred_at = hoje - 5 where id = compra;
    select invoice_id into l from public.transactions where id = compra;
    if l.invoice_id <> seguinte then raise exception '5: mudar a data não mudou a fatura'; end if;
  end;

  -- ── 6. parcelar um lançamento que já existe, com 2 já pagas ─────────────────────────────
  declare
    avulso uuid;
  begin
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
      values (w, u, 'expense', 30000, 'Geladeira', cc, hoje - 60, 'app', 'cleared') returning id into avulso;
    plano := public.convert_transaction_to_installments(avulso, 30000, 3, hoje - 60, 'Geladeira', 'casa', null, cc, 2);
    select count(*) filter (where status = 'cleared' and installment_no <= 2) as pagas,
           count(*) filter (where status = 'pending' and installment_no = 3) as aberta into l
      from public.transactions where installment_plan_id = plano;
    if l.pagas <> 2 or l.aberta <> 1 then raise exception '6: pagas % (2), aberta % (1)', l.pagas, l.aberta; end if;
    select count(*) into n from pg_proc where proname = 'convert_transaction_to_installments';
    if n <> 1 then raise exception '6: % versões da conversão (1)', n; end if;
  end;
end $$;

rollback;
