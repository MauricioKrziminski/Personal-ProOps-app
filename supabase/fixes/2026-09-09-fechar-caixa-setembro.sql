-- Fecha o caixa de setembro/2026: as duas contas terminam no saldo real.
--
-- Roda DEPOIS de `2026-09-09-conciliar-setembro.sql`. Aquele acertou as FATURAS; este acerta o
-- DINHEIRO — o que entrou e saiu das contas, incluindo os pagamentos das faturas, que agora o app
-- sabe registrar parcialmente (`20260909060000`).
--
-- Documentos: extrato Nubank 01–07/09 (+ o que o Gabriel informou de 08/09) e extrato BB
-- 01–09/09 da agência 872, conta 43143-5.
--
-- Alvos, ditos por ele e confirmados nos extratos: Conta corrente R$ 0,62 · Conta corrente BB
-- R$ 0,10.
begin;

do $$
declare
  ws uuid; usr uuid; cc uuid; cc_bb uuid; nu uuid; bb uuid;
  fat_nu uuid; fat_bb uuid;
  d1 uuid; d2 uuid;
  v numeric;
begin
  select a.workspace_id, a.user_id, a.id into ws, usr, cc from public.accounts a where a.name = 'Conta corrente';
  select id into cc_bb from public.accounts where workspace_id = ws and name = 'Conta corrente BB';
  select id into nu    from public.accounts where workspace_id = ws and name = 'Nubank';
  select id into bb    from public.accounts where workspace_id = ws and name = 'BB';
  select ci.id into fat_nu from public.card_invoices ci where ci.account_id = nu and ci.due_date = '2026-09-10';
  select ci.id into fat_bb from public.card_invoices ci where ci.account_id = bb and ci.due_date = '2026-09-10';
  select id into d1 from public.debts where workspace_id = ws and name = 'Empréstimo Nubank';
  select id into d2 from public.debts where workspace_id = ws and name = 'Empréstimo Nubank 2';

  -- ── 1. de onde cada conta parte ──────────────────────────────────────────
  -- O app não tem a história anterior a setembro; o saldo de abertura é o do extrato.
  update public.accounts set initial_balance_cents =  86786 where id = cc;     -- 01/09, extrato Nubank
  update public.accounts set initial_balance_cents =     11 where id = cc_bb;  -- 31/08, extrato BB

  -- ── 2. o que a importação inventou em 05/09 ──────────────────────────────
  --
  -- Nada disso está no extrato. Eram linhas da planilha materializadas na data da recorrência,
  -- e a realidade de setembro é outra: o pai mandou 350 (não 340) em 08/09, o Winicius mandou
  -- 420 (não 303) em 08/09 — as duas já foram lançadas na data certa —, e o resto não aconteceu.
  delete from public.transactions
   where account_id = cc and occurred_at = '2026-09-05'
     and description in ('Cashback Nubank','Freela Scai','Pix mãe controle','Pix Maurício',
                         'Pix pai carro','Pix Winicius','Salário');

  -- O Claude saiu da conta e virou duas assinaturas no cartão (já lançadas em 04/09).
  delete from public.transactions
   where account_id = cc and description = 'Claude ProOps' and occurred_at >= '2026-09-01';

  -- Dentista e DAS são Pix no crédito: a cobrança cai no CARTÃO, não na conta. A recorrência já
  -- aponta para lá; estas são as linhas velhas, materializadas antes da correção.
  delete from public.transactions
   where account_id = cc and description in ('Manutenção dentista','DAS') and occurred_at >= '2026-09-01';

  -- ── 3. o que o extrato mostra, na data que mostra ────────────────────────
  -- Salário PJ e Fundacred saem/entram no dia 04, não no 05 nem no último dia do mês.
  update public.transactions set occurred_at = '2026-09-04', status = 'cleared'
   where account_id = cc and description = 'Salário PJ' and occurred_at = '2026-09-05';
  update public.transactions set occurred_at = '2026-09-04', status = 'cleared'
   where account_id = cc and description = 'Fundacred' and occurred_at between '2026-09-01' and '2026-09-30';

  -- ⚠️ Os R$ 1.488,02 NÃO saem da Conta corrente BB.
  --
  -- O extrato da 872/43143-5 mostra saldo de 0,11 → 0,10 no mês inteiro: ela só serve de passagem
  -- para o cartão. O dinheiro vem de OUTRA conta do BB (agência 1203, conta 39805-5), que o app
  -- não conhece — e o CLT de 2.632 cai lá, não aqui. Enquanto essa conta não existir no app, o
  -- que entra na Conta corrente é entrada de fora, e é assim que fica registrado. O valor é o
  -- mesmo em agosto e em setembro.
  delete from public.transactions
   where account_id = cc_bb and counterparty_account_id = cc and description = 'Transferência do BB';
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category, occurred_at, source, status)
  values (ws, usr, cc, 'income', 148802, 'Transferência recebida do BB', 'salario', '2026-09-04', 'import', 'cleared');

  -- ── 4. as prestações dos financiamentos ──────────────────────────────────
  --
  -- `sync_debt_payment` (0057) INCREMENTA `installments_paid` e abate o saldo a cada pagamento
  -- inserido. A contagem atual já inclui setembro, então ela recua um antes — senão a parcela de
  -- setembro seria contada duas vezes. `tg_debts_calculation_mode` só permite isso enquanto não
  -- houver pagamento registrado, que é exatamente o estado agora.
  update public.debts set installments_paid = 6, remaining_cents = 312656 where id = d1;
  update public.debts set installments_paid = 3, remaining_cents = 772983 where id = d2;

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category, occurred_at, source, status, debt_id)
  values
    (ws, usr, cc, 'expense', 78164, 'Parcela Empréstimo Nubank',   'financiamento', '2026-09-04', 'import', 'cleared', d1),
    (ws, usr, cc, 'expense', 85887, 'Parcela Empréstimo Nubank 2', 'financiamento', '2026-09-04', 'import', 'cleared', d2);

  -- ── 5. o estorno de juros do rotativo ────────────────────────────────────
  --
  -- Em 04/09 o Nubank creditou R$ 11,10 de "Juros de pagamento parcial da fatura (rotativo)".
  -- O app não tem linha de crédito dentro da fatura, e criar uma como `income` no cartão levantaria
  -- o saldo sem baixar o total (todo leitor filtra `kind='expense'`) — a contradição da 0046 §4.
  -- O único jeito expressável é abater na própria linha de juros: 54,07 − 11,10 = 42,97.
  update public.transactions set amount_cents = 4297
   where invoice_id = fat_nu and description like 'Juros de pagamento parcial%';

  -- "Vacina Gato 2/4" é o `Bicho Molhado Petcente` de R$ 99,90 em 14/08 (confirmado pelo dono do
  -- produto). O "2/4" é a dose da vacina, não parcela de compra — não falta plano nenhum. O nome
  -- do estabelecimento entra em `merchant` para a linha casar com a fatura numa conferência
  -- futura, sem mexer no rótulo que ELE escolheu.
  update public.transactions set merchant = 'Bicho Molhado Petcente'
   where invoice_id = fat_nu and description = 'Vacina Gato 2/4';

  -- ── 6. os pagamentos de fatura, que agora podem ser parciais ─────────────
  -- BB: débito em conta no dia 04, valor cheio (extrato BB).
  perform public.pay_invoice(fat_bb, cc_bb, date '2026-09-04');

  -- Nubank: boleto de 2.080,00 em 04/09 e mais 649,00 + 160,00 em 08/09. Os três parciais.
  perform public.pay_invoice(fat_nu, cc, date '2026-09-04', 208000);
  perform public.pay_invoice(fat_nu, cc, date '2026-09-08',  64900);
  perform public.pay_invoice(fat_nu, cc, date '2026-09-08',  16000);

  -- 05/09 ele aplicou 37,00 no RDB e 08/09 resgatou os mesmos 37,00. As duas pontas se anulam
  -- dentro do mês e a caixinha não é conta do app — não entra nada, de propósito.

  -- ── 6b. o CLT cai em DUAS partes, e nenhuma delas era o que o app tinha ──
  --
  -- Documentado no extrato da conta Nubank, as duas vindas da agência 1203, conta 39805-5:
  --   05/08 → R$ 1.488,02   ·   20/08 → R$ 1.148,00   (04/09 → R$ 1.488,02 de novo)
  -- Soma R$ 2.636,02, e não os R$ 2.632,00 de uma parcela só que a planilha trazia. Duas
  -- recorrências e não uma com dois dias: `BYMONTHDAY=5,20` valeria como RRULE, mas as duas
  -- metades têm VALORES diferentes, e uma recorrência só guarda um `amount_cents`.
  delete from public.recurring_transactions where workspace_id = ws and description = 'Salário';
  insert into public.recurring_transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category, rrule,
     dtstart, next_run_at, materialized_until)
  values
    -- setembro já está lançado à mão (a linha de 04/09), então esta só passa a valer em outubro
    (ws, usr, cc, 'income', 148802, 'Salário CLT (1ª parte)', 'salario',
     'FREQ=MONTHLY;BYMONTHDAY=5', '2026-09-05', '2026-10-05', '2026-09-30'),
    -- 20/09 ainda não aconteceu: esta o cron materializa como previsto, que é o certo
    (ws, usr, cc, 'income', 114800, 'Salário CLT (2ª parte)', 'salario',
     'FREQ=MONTHLY;BYMONTHDAY=20', '2026-08-20', '2026-09-20', null);

  -- ── 6c. o Marcelao não é mensal ──────────────────────────────────────────
  --
  -- Na fatura o estabelecimento é `Marcelao Beer Luck` (bar), 43,00 em 08/08. A importação leu
  -- isso como corte de cabelo mensal e criou uma recorrência; o dono do produto confirmou que não
  -- é — ele nem foi ainda. A COMPRA de agosto fica (aconteceu, está na fatura); some a regra que
  -- inventava uma nova todo dia 15.
  delete from public.transactions t
   using public.recurring_transactions r
   where t.recurring_id = r.id and r.description = 'Cabelo Marcelao';
  delete from public.recurring_transactions where workspace_id = ws and description = 'Cabelo Marcelao';

  -- ── 7. o futuro que a importação materializou com os valores velhos ──────
  --
  -- As recorrências foram corrigidas no script anterior, mas as linhas já geradas guardam o valor
  -- e o dia antigos. Apagar as futuras e zerar `materialized_until` faz o `finance-scheduler`
  -- refazê-las certas — é ele o dono dessa geração, não este arquivo.
  delete from public.transactions t
   using public.recurring_transactions r
   where t.recurring_id = r.id and t.occurred_at > current_date
     and r.description in ('Pix Winicius','Pix pai carro','Salário PJ','Fundacred',
                           'Manutenção dentista','DAS');
  update public.recurring_transactions set materialized_until = null
   where workspace_id = ws
     and description in ('Pix Winicius','Pix pai carro','Salário PJ','Fundacred',
                         'Manutenção dentista','DAS');

  -- ── 8. as asserções ──────────────────────────────────────────────────────
  --
  -- Saldo do extrato = abertura + o que já ACONTECEU. `_account_balances` soma previsto junto
  -- (é o que faz o cartão dever a compra que ainda não venceu), então a comparação com o extrato
  -- é sobre as linhas liquidadas até hoje — que é o que o extrato mostra.
  select (a.initial_balance_cents + coalesce(sum(
            case when t.kind = 'income'   and t.account_id = a.id then  t.amount_cents
                 when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
                 when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
                 when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
                 else 0 end), 0)) / 100.0
    into v
    from public.accounts a
    left join public.transactions t
      on (t.account_id = a.id or t.counterparty_account_id = a.id)
     and t.status = 'cleared' and t.occurred_at <= current_date
   where a.id = cc group by a.id;
  assert v = 0.62, format('Conta corrente deveria fechar em 0,62 (extrato), fechou em %s', v);

  select (a.initial_balance_cents + coalesce(sum(
            case when t.kind = 'income'   and t.account_id = a.id then  t.amount_cents
                 when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
                 when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
                 when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
                 else 0 end), 0)) / 100.0
    into v
    from public.accounts a
    left join public.transactions t
      on (t.account_id = a.id or t.counterparty_account_id = a.id)
     and t.status = 'cleared' and t.occurred_at <= current_date
   where a.id = cc_bb group by a.id;
  assert v = 0.10, format('Conta corrente BB deveria fechar em 0,10 (extrato), fechou em %s', v);

  -- A fatura do Nubank tem que sobrar o que ele disse: R$ 371,66.
  select private.invoice_open_cents(fat_nu) / 100.0 into v;
  assert v between 371.60 and 371.70, format('a fatura do Nubank deveria ficar com ~371,66 em aberto, ficou com %s', v);

  assert (select status from public.card_invoices where id = fat_bb) = 'paid',
    'a fatura do BB foi paga em 04/09 e deveria constar quitada';

  -- e as dívidas continuam coerentes com o próprio contrato
  select count(*) into v from public.debts d
   where d.workspace_id = ws
     and d.principal_cents = d.installment_cents * d.installments
     and d.remaining_cents = d.installment_cents * (d.installments - d.installments_paid);
  assert v = 3, format('as 3 dívidas deveriam manter o invariante do contrato, %s mantêm', v);

  raise notice 'caixa de setembro: contas, faturas e dívidas conferidas contra os extratos';
end $$;

commit;
