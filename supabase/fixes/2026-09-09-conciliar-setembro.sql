-- Conciliação de setembro/2026 contra os documentos.
-- Base: docs/bugs/2026-09-09-conciliacao-setembro.md
--
-- PRÉ-REQUISITO: a migration 20260909050000 (dia do fechamento pertence à fatura seguinte)
-- precisa estar aplicada ANTES deste arquivo. As linhas movidas para o dia 3 dependem dela.
--
-- Uma transação só. As asserções do fim comparam com a fatura e o extrato; qualquer divergência
-- derruba tudo e nada é gravado.
begin;

do $$
declare
  ws        uuid;
  usr       uuid;
  cc        uuid;   -- Conta corrente (Nubank)
  cc_bb     uuid;   -- Conta corrente BB (criada aqui)
  nu        uuid;   -- cartão Nubank
  bb        uuid;   -- cartão BB
  fat_set   uuid;   -- fatura Nubank que vence 10/09
  fat_out   uuid;   -- fatura Nubank que vence 10/10
  fat_bb    uuid;   -- fatura BB que vence 10/09
  v         numeric;
begin
  select a.workspace_id, a.user_id, a.id into ws, usr, cc
    from public.accounts a where a.name = 'Conta corrente';
  select id into nu from public.accounts where workspace_id = ws and name = 'Nubank';
  select id into bb from public.accounts where workspace_id = ws and name = 'BB';
  select id into fat_set from public.card_invoices where account_id = nu and due_date = '2026-09-10';
  select id into fat_out from public.card_invoices where account_id = nu and due_date = '2026-10-10';
  select id into fat_bb  from public.card_invoices where account_id = bb and due_date = '2026-09-10';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 1. A conta corrente do BB passa a existir
  --
  -- Sem ela o app não tem como fechar: o CLT chega no BB (o que entra na conta do Nubank é uma
  -- transferência de 1.488,02), e a fatura do BB é paga de lá, em débito automático.
  -- `initial_balance_cents = 0` de propósito — não existe extrato do BB aqui, então o saldo dela
  -- só passa a valer quando ele importar um. O que este arquivo grava são os movimentos que TÊM
  -- documento.
  -- ─────────────────────────────────────────────────────────────────────────
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
  values (ws, usr, 'Conta corrente BB', 'checking', 0)
  returning id into cc_bb;

  update public.accounts set payment_account_id = cc_bb where id = bb;

  -- ─────────────────────────────────────────────────────────────────────────
  -- 2. Fatura Nubank de setembro — datas
  --
  -- A importação leu a aba "Setembro" da planilha como se fosse o mês de setembro. Ela é a
  -- FATURA de setembro, cujo ciclo é 03/08 a 03/09. Cada linha volta para o dia do documento.
  -- ─────────────────────────────────────────────────────────────────────────
  update public.transactions set occurred_at = '2026-08-05', due_at = null
    where invoice_id = fat_set and description = 'Case Mac';                      -- Shopee*As Place
  update public.transactions set occurred_at = '2026-08-11', due_at = null
    where invoice_id = fat_set and description = 'Tim multa';                     -- Tim Pos
  update public.transactions set occurred_at = '2026-08-05', due_at = null
    where invoice_id = fat_set and description = 'Película Teclado Mac';          -- Mercado*Inovetecnolog
  update public.transactions set occurred_at = '2026-08-10', due_at = null
    where invoice_id = fat_set and description = 'Entrega Mac';                   -- LUIZ ROBERTO (Pix no crédito)
  update public.transactions set occurred_at = '2026-08-14', due_at = null
    where invoice_id = fat_set and description = 'Vacina Gato 2/4';               -- Bicho Molhado Petcente
  -- Karen: 28,47 + 56,75 = 85,22 na fatura; o app tinha 85,23
  update public.transactions set occurred_at = '2026-08-10', due_at = null, amount_cents = 8522
    where invoice_id = fat_set and description = 'Pix Karen';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 3. Compras que faltavam na fatura de setembro (todas no PDF, seção "TRANSAÇÕES")
  -- ─────────────────────────────────────────────────────────────────────────
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category, occurred_at, source, status)
  values
    (ws, usr, nu, 'expense',  1990, 'Apple.Com/Bill',          'assinaturas', '2026-08-05', 'import', 'cleared'),
    (ws, usr, nu, 'expense',  3500, 'Conta Vivo',              'telefone',    '2026-08-08', 'import', 'cleared'),
    (ws, usr, nu, 'expense',  4300, 'Marcelao Beer Luck',      'lazer',       '2026-08-08', 'import', 'cleared'),
    (ws, usr, nu, 'expense',  1990, 'Ec *Melimais',            'assinaturas', '2026-08-09', 'import', 'cleared'),
    (ws, usr, nu, 'expense',  2900, 'Nubank Croma',            'assinaturas', '2026-08-10', 'import', 'cleared'),
    (ws, usr, nu, 'expense',  2000, 'Servicos Cla*Claro',      'telefone',    '2026-08-12', 'import', 'cleared'),
    (ws, usr, nu, 'expense',  1290, 'Apple.Com/Bill',          'assinaturas', '2026-08-21', 'import', 'cleared'),
    -- Pix no crédito: adiantamento que vira compra na fatura
    (ws, usr, nu, 'expense', 17700, 'ORAL PLATINUM',           'saude',       '2026-08-10', 'import', 'cleared'),
    (ws, usr, nu, 'expense',  8885, 'RECEITA FEDERAL (DAS)',   'impostos',    '2026-08-20', 'import', 'cleared'),
    -- o saldo que rolou de agosto. Não conta o gasto duas vezes: a fatura de agosto está
    -- settled_manually e a 0046 §4 já exclui as linhas dela do saldo do cartão.
    (ws, usr, nu, 'expense', 33372, 'Saldo em rotativo de agosto', 'juros',    '2026-08-10', 'import', 'cleared');

  -- ─────────────────────────────────────────────────────────────────────────
  -- 4. A linha que não existe em documento nenhum
  -- ─────────────────────────────────────────────────────────────────────────
  delete from public.transactions
   where invoice_id = fat_set and description = 'Despesa Gato' and amount_cents = 12000;

  -- ─────────────────────────────────────────────────────────────────────────
  -- 5. Compras parceladas do Nubank — a âncora de cada plano
  --
  -- O Nubank posta TODA parcela no dia do fechamento (dia 3); a primeira sai no dia da compra.
  -- Mexer em `first_occurred_at` não move linha nenhuma — quem move é o update de `occurred_at`
  -- abaixo, e o trigger `set_invoice` reavalia a fatura de cada uma com a regra nova.
  -- ─────────────────────────────────────────────────────────────────────────
  -- King Cell 9/10 está na fatura de setembro (03/08) e 10/10 na de outubro (03/09): −1 mês
  update public.installment_plans set first_occurred_at = '2025-12-03' where account_id = nu and description = 'King Cell';
  update public.transactions t set occurred_at = (date '2025-12-03' + make_interval(months => t.installment_no - 1)), due_at = null
    from public.installment_plans p where p.id = t.installment_plan_id and p.description = 'King Cell';

  -- Pneu 6/10 em 03/08 e 7/10 em 03/09: −1 mês
  update public.installment_plans set first_occurred_at = '2026-03-03' where account_id = nu and description = 'Pneu';
  update public.transactions t set occurred_at = (date '2026-03-03' + make_interval(months => t.installment_no - 1)), due_at = null
    from public.installment_plans p where p.id = t.installment_plan_id and p.description = 'Pneu';

  -- Mac (Luizroberto): 1/12 comprada em 04/08, 2/12 postada em 03/09
  update public.installment_plans set first_occurred_at = '2026-08-04' where account_id = nu and description = 'Mac';
  update public.transactions t set occurred_at = (date '2026-08-04' + make_interval(months => t.installment_no - 1)), due_at = null
    from public.installment_plans p where p.id = t.installment_plan_id and p.description = 'Mac';

  -- Acessorios Mac (Shopee*Solu Multimarca): 1/2 em 04/08 = 134,16; 2/2 em 03/09 = 134,15
  update public.installment_plans set first_occurred_at = '2026-08-04', total_cents = 26831
    where account_id = nu and description = 'Acessorios Mac';
  update public.transactions t set occurred_at = (date '2026-08-04' + make_interval(months => t.installment_no - 1)),
         due_at = null, amount_cents = case when t.installment_no = 2 then 13415 else 13416 end
    from public.installment_plans p where p.id = t.installment_plan_id and p.description = 'Acessorios Mac';

  -- Globo Premiere: 2/10 em 03/08 e 3/10 em 03/09 → a 1/10 foi em 03/07
  update public.installment_plans set first_occurred_at = '2026-07-03' where account_id = nu and description = 'Globo Premiere';
  update public.transactions t set occurred_at = (date '2026-07-03' + make_interval(months => t.installment_no - 1)), due_at = null
    from public.installment_plans p where p.id = t.installment_plan_id and p.description = 'Globo Premiere';

  -- Playground Gato ML (Mercadolivre*Mercadol): 2/2 em 03/08 = 56,42 → a 1/2 foi em 03/07
  update public.installment_plans set first_occurred_at = '2026-07-03', total_cents = 11285
    where account_id = nu and description = 'Playground Gato ML';
  update public.transactions t set occurred_at = (date '2026-07-03' + make_interval(months => t.installment_no - 1)),
         due_at = null, amount_cents = case when t.installment_no = 2 then 5642 else 5643 end
    from public.installment_plans p where p.id = t.installment_plan_id and p.description = 'Playground Gato ML';

  -- Carro Peças (Shopee *Autopecasfamaf): 1/3 em 22/08 = 140,12; 2/3 em 03/09 = 140,10
  update public.installment_plans set first_occurred_at = '2026-08-22' where account_id = nu and description = 'Carro Peças';
  update public.transactions t set occurred_at = (date '2026-08-22' + make_interval(months => t.installment_no - 1)),
         due_at = null,
         amount_cents = case t.installment_no when 1 then 14012 when 2 then 14010 else 14011 end
    from public.installment_plans p where p.id = t.installment_plan_id and p.description = 'Carro Peças';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 6. Fatura Nubank de outubro — o que já postou (OFX de 09/09)
  -- ─────────────────────────────────────────────────────────────────────────
  -- O Claude saiu do BB e virou DUAS assinaturas no Nubank: Claude (ProOps) e ChatGPT (pessoal).
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category, occurred_at, source, status)
  values
    (ws, usr, nu, 'expense', 56764, 'Anthropic* Claude Sub',        'assinaturas', '2026-09-04', 'import', 'pending'),
    (ws, usr, nu, 'expense',  1986, 'IOF Claude',                   'impostos',    '2026-09-04', 'import', 'pending'),
    (ws, usr, nu, 'expense', 54654, 'Openai *Chatgpt Subscr',       'assinaturas', '2026-09-04', 'import', 'pending'),
    (ws, usr, nu, 'expense',  1912, 'IOF ChatGPT',                  'impostos',    '2026-09-04', 'import', 'pending'),
    (ws, usr, nu, 'expense',  3700, 'Casa do Acai Cafe',            'alimentacao', '2026-09-04', 'import', 'pending'),
    (ws, usr, nu, 'expense',  1999, 'Shopee *Shpstecnologia',       'compras',     '2026-09-06', 'import', 'pending'),
    (ws, usr, nu, 'expense',  7000, 'Auto Posto Costa Costa',       'transporte',  '2026-09-07', 'import', 'pending'),
    (ws, usr, nu, 'expense',  1400, 'Auto Posto Costa Costa',       'transporte',  '2026-09-07', 'import', 'pending');

  -- Meli+ postou em 08/09, não em 11/09
  update public.transactions set occurred_at = '2026-09-08', due_at = null
    where invoice_id = fat_out and description = 'Meli+';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 7. Compras parceladas do BB — o mesmo atraso de um mês
  --
  -- A fatura que vence 10/09 traz EMPORIUM 9/10, AliExpres 3/4 e BICHO MOLHADO 2/2; o app tinha
  -- 8/10, 2/4 e 1/2. As datas do documento são as da COMPRA original (04/12, 15/06, 15/07).
  -- ─────────────────────────────────────────────────────────────────────────
  update public.installment_plans set first_occurred_at = '2025-12-04' where account_id = bb and description = 'Roupas Emporium';
  update public.transactions t set occurred_at = (date '2025-12-04' + make_interval(months => t.installment_no - 1)), due_at = null
    from public.installment_plans p where p.id = t.installment_plan_id and p.description = 'Roupas Emporium';

  -- AliExpres 3/4 = 60,08 no documento; as outras três continuam 60,11
  update public.installment_plans set first_occurred_at = '2026-06-15', total_cents = 24041
    where account_id = bb and description = 'Controle (mãe)';
  update public.transactions t set occurred_at = (date '2026-06-15' + make_interval(months => t.installment_no - 1)),
         due_at = null, amount_cents = case when t.installment_no = 3 then 6008 else 6011 end
    from public.installment_plans p where p.id = t.installment_plan_id and p.description = 'Controle (mãe)';

  update public.installment_plans set first_occurred_at = '2026-07-15' where account_id = bb and description = 'Gato Bicho Molhado';
  update public.transactions t set occurred_at = (date '2026-07-15' + make_interval(months => t.installment_no - 1)), due_at = null
    from public.installment_plans p where p.id = t.installment_plan_id and p.description = 'Gato Bicho Molhado';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 8. Fatura BB de setembro — o Claude estava na conta errada
  --
  -- Ela foi quitada por `settle_invoice` na importação (sem caixa). Volta a `closed` para receber
  -- as linhas que faltavam; o pagamento de verdade entra no passo 9.
  -- ─────────────────────────────────────────────────────────────────────────
  update public.card_invoices
     set status = 'closed', paid_at = null, settled_manually = false, payment_transaction_id = null
   where id = fat_bb;

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category, occurred_at, source, status)
  values
    (ws, usr, bb, 'expense', 110000, 'ANTHROPIC* CLAUDE SUB',   'assinaturas', '2026-08-01', 'import', 'cleared'),
    (ws, usr, bb, 'expense',   3850, 'IOF - COMPRA NO EXTERIOR','impostos',    '2026-08-03', 'import', 'cleared'),
    (ws, usr, bb, 'expense',    399, 'MP*ULTRAPASSEMENSAL',     'assinaturas', '2026-08-12', 'import', 'cleared');

  -- ─────────────────────────────────────────────────────────────────────────
  -- 9. O dinheiro que se moveu de verdade em setembro (extrato de 01 a 07/09)
  -- ─────────────────────────────────────────────────────────────────────────
  -- 04/09: Pix para a conta dele no BB, que é o que cobre o débito automático da fatura
  insert into public.transactions
    (workspace_id, user_id, account_id, counterparty_account_id, kind, amount_cents, description, occurred_at, source, status)
  values (ws, usr, cc, cc_bb, 'transfer', 143250, 'Pix para a conta do BB', '2026-09-04', 'import', 'cleared');

  -- 04/09: o CLT não cai na conta do Nubank; o que entra é transferência vinda do BB
  insert into public.transactions
    (workspace_id, user_id, account_id, counterparty_account_id, kind, amount_cents, description, occurred_at, source, status)
  values (ws, usr, cc_bb, cc, 'transfer', 148802, 'Transferência do BB', '2026-09-04', 'import', 'cleared');

  -- 04/09: crédito em conta que aparece no extrato
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category, occurred_at, source, status)
  values (ws, usr, cc, 'income', 3370, 'Crédito em conta', 'outros', '2026-09-04', 'import', 'cleared');

  -- 08/09: as entradas do dia, informadas por ele
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category, occurred_at, source, status)
  values
    (ws, usr, cc, 'income', 35000, 'Pix do pai (Wanderley)', 'familia',  '2026-09-08', 'import', 'cleared'),
    (ws, usr, cc, 'income', 42000, 'Pix do Winicius',        'freela',   '2026-09-08', 'import', 'cleared'),
    (ws, usr, cc, 'income',   190, 'Cashback',               'outros',   '2026-09-08', 'import', 'cleared');

  -- 05/09 aplicou 37,00 no RDB e 08/09 resgatou. Movimento entre contas dele — não é receita, e
  -- como as duas pontas se anulam no mesmo mês, nada é lançado. Fica registrado aqui para quem
  -- for conferir o extrato e sentir falta.

  -- ─────────────────────────────────────────────────────────────────────────
  -- 10. Empréstimos e recorrentes — os valores da planilha estavam errados
  -- ─────────────────────────────────────────────────────────────────────────
  -- Extratos de agosto E setembro: as duas prestações saem no dia 04 e com o mesmo valor nos dois
  -- meses. A planilha errou as duas.
  --
  -- ⚠️ `fixed_installments` tem invariante de contrato (`debts_fixed_installments_check`):
  -- principal = prestação × parcelas, e restante = prestação × (parcelas − pagas). Mudar só a
  -- prestação viola as duas. E `tg_debts_calculation_mode` recusa mexer no contrato enquanto
  -- houver pagamento registrado — trava certa, e foi ela que pegou este erro.
  --
  -- O único pagamento registrado é artefato da importação: "Parcela Empréstimo Nubank" de
  -- R$ 782,61 em 05/09, quando o extrato mostra R$ 781,64 em 04/09. Apagar devolve o saldo e
  -- decrementa `installments_paid` (trigger `sync_debt_payment`); o UPDATE seguinte repõe a
  -- contagem, que é o que a tela de Dívidas usa para o bloco "Já pagas".
  delete from public.transactions
   where debt_id = (select id from public.debts where workspace_id = ws and name = 'Empréstimo Nubank');

  update public.debts
     set installment_cents = 78164, principal_cents = 781640, remaining_cents = 234492,
         installments_paid = 7, due_day = 4, started_at = '2026-03-04'
   where workspace_id = ws and name = 'Empréstimo Nubank';

  update public.debts
     set installment_cents = 85887, principal_cents = 1030644, remaining_cents = 687096,
         due_day = 4, started_at = '2026-05-04'
   where workspace_id = ws and name = 'Empréstimo Nubank 2';

  update public.recurring_transactions set amount_cents = 42000 where workspace_id = ws and description = 'Pix Winicius';
  update public.recurring_transactions set amount_cents = 35000 where workspace_id = ws and description = 'Pix pai carro';
  -- salário PJ e Fundacred saem/entram no dia 4, não no 5 nem no último dia do mês
  update public.recurring_transactions set rrule = 'FREQ=MONTHLY;BYMONTHDAY=4' where workspace_id = ws and description in ('Salário PJ', 'Fundacred');
  -- o CLT chega no BB
  update public.recurring_transactions set account_id = cc_bb where workspace_id = ws and description = 'Salário';
  -- Manutenção dentista e DAS são Pix no crédito: a cobrança cai no cartão Nubank
  update public.recurring_transactions set account_id = nu where workspace_id = ws and description in ('Manutenção dentista', 'DAS');
  -- o Claude deixou de ser uma assinatura na conta e virou duas no cartão
  delete from public.recurring_transactions where workspace_id = ws and description = 'Claude ProOps';
  insert into public.recurring_transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category, rrule, dtstart, next_run_at)
  values
    (ws, usr, nu, 'expense', 56764, 'Anthropic* Claude Sub',  'assinaturas', 'FREQ=MONTHLY;BYMONTHDAY=4', '2026-09-04', '2026-10-04'),
    (ws, usr, nu, 'expense', 54654, 'Openai *Chatgpt Subscr', 'assinaturas', 'FREQ=MONTHLY;BYMONTHDAY=4', '2026-09-04', '2026-10-04');

  -- ─────────────────────────────────────────────────────────────────────────
  -- 11. As asserções. Qualquer uma que falhe derruba a transação inteira.
  -- ─────────────────────────────────────────────────────────────────────────
  select sum(amount_cents)/100.0 into v from public.transactions where invoice_id = fat_set and kind = 'expense';
  assert v between 3271.70 and 3271.80,
    format('fatura Nubank de setembro deveria dar ~3.271,77 (documento), deu %s', v);

  select sum(amount_cents)/100.0 into v from public.transactions where invoice_id = fat_bb and kind = 'expense';
  assert v = 1432.51, format('fatura BB deveria dar 1.432,51 (documento), deu %s', v);

  -- As parcelas do ciclo de setembro, somadas: 35,88 + 56,42 + 80,01 + 399,00 + 134,16 + 780,96
  -- + 140,12. Sai da lista de "TRANSAÇÕES DE 03 AGO A 03 SET" do PDF.
  select sum(amount_cents)/100.0 into v from public.transactions
   where invoice_id = fat_set and installment_plan_id is not null;
  assert v = 1626.55, format('as parcelas de setembro deveriam somar 1.626,55, somaram %s', v);

  -- E as de outubro: 134,15 + 780,96 + 399,00 + 140,10 + 35,88 + 80,01 = 1.570,10, que é
  -- exatamente o "Saldo em aberto da próxima fatura R$ 1.570,10" impresso na fatura de setembro.
  -- Duas contas independentes do Nubank batendo no mesmo número.
  select sum(amount_cents)/100.0 into v from public.transactions
   where invoice_id = fat_out and installment_plan_id is not null;
  assert v = 1570.10, format('as parcelas de outubro deveriam somar 1.570,10, somaram %s', v);

  select count(*) into v from public.transactions
   where invoice_id = fat_out and installment_plan_id is not null;
  assert v = 6, format('a fatura de outubro deveria ter 6 parcelas, tem %s', v);

  select count(*) into v from public.debts d
   where d.workspace_id = ws
     and d.principal_cents = d.installment_cents * d.installments
     and d.remaining_cents = d.installment_cents * (d.installments - d.installments_paid);
  assert v = 3, format('as 3 dívidas deveriam manter o invariante do contrato, %s mantêm', v);

  raise notice 'setembro, BB, outubro e dívidas: conferidos contra os documentos';
end $$;

commit;
