-- Converter um lançamento simples em compra parcelada, e desparcelar de volta.
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/converter_parcelamento.sql
--
-- ⚠️ **`if`/`raise`, nunca `assert`** — como nos seis testes vizinhos. `assert` do plpgsql
-- obedece a GUC `plpgsql.check_asserts`; com ela desligada o arquivo inteiro fica verde sem
-- conferir uma linha. Um teste que pode ser desligado por configuração não é trava.
--
-- ⚠️ **Toda recusa confere a FRASE, e o `raise` de controle é prefixado com `FALHOU:`.** É o
-- padrão de `reparcelar_a_compra.sql`, e ele existe porque o jeito ingênuo passa por acaso: se a
-- frase de controle ("converter dentro de fatura paga deveria ter sido recusado") contém a
-- palavra que o `like` procura ("fatura"), o teste fica VERDE com a trava ausente.
--
-- ⚠️ `set local timezone` na primeira linha: desde a `20260911030000` as funções de finanças
-- avaliam `current_date` em BRT enquanto a sessão fica em UTC, e entre 21h e a meia-noite um
-- teste que compare com o `current_date` da SESSÃO falha por um dia sem nada estar errado.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  usr uuid;
  ws uuid;
  ws_outro uuid;
  cartao uuid;
  corrente uuid;
  conta_outra uuid;
  tx uuid;
  tx_sobrevivente uuid;
  plano uuid;
  serie uuid;
  divida uuid;
  fat uuid;
  n int;
  soma bigint;
  quantas int;
  txt text;
begin
  -- ── fixture própria: nada depende do que já existe no banco ───────────────
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'converter-' || gen_random_uuid() || '@proops.test', '',
          now(), now(), now())
  returning id into usr;

  insert into public.profiles (id) values (usr) on conflict do nothing;

  insert into public.workspaces (name, owner_id) values ('Converter', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, usr, 'owner') on conflict do nothing;

  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
  values (ws, usr, 'Cartão', 'credit_card', 3, 10) returning id into cartao;
  insert into public.accounts (workspace_id, user_id, name, type)
  values (ws, usr, 'Corrente', 'checking') returning id into corrente;

  -- ══ 1. converter: 1 linha de R$ 300,00 vira 3x de R$ 100,00 ═══════════════
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, category, description, merchant,
     account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 30000, 'mercado', 'Mercado do mês', 'Zaffari',
          cartao, '2026-06-05', 'app', 'pending')
  returning id into tx;

  plano := public.convert_transaction_to_installments(
    tx, 30000, 3, '2026-06-05', 'Mercado do mês', 'mercado', 'Zaffari', cartao);

  if plano is null then raise exception '1. a conversão não devolveu o plano'; end if;

  -- 1a. a linha ORIGINAL continua existindo, com o MESMO id, como parcela 1. É esta asserção
  --     que torna a duplicação impossível: não há linha nova para a compra virar duas.
  if (select installment_plan_id from public.transactions where id = tx) is distinct from plano then
    raise exception '1a. a transação original não foi adotada pelo plano';
  end if;
  if (select installment_no from public.transactions where id = tx) <> 1 then
    raise exception '1a. a transação original deveria ser a parcela 1';
  end if;
  if (select amount_cents from public.transactions where id = tx) <> 10000 then
    raise exception '1a. parcela 1 deveria valer 10000, veio %',
      (select amount_cents from public.transactions where id = tx);
  end if;
  txt := (select description from public.transactions where id = tx);
  if txt <> 'Mercado do mês (1/3)' then raise exception '1a. parcela 1 com nome errado: %', txt; end if;

  -- 1b. são 3 parcelas e a soma É o total.
  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano;
  if n <> 3 then raise exception '1b. deveriam ser 3 parcelas, vieram %', n; end if;
  if soma <> 30000 then raise exception '1b. a soma deveria ser 30000, veio %', soma; end if;

  -- 1c. as datas andam de mês em mês e 2..N nascem pendentes.
  if (select occurred_at from public.transactions
      where installment_plan_id = plano and installment_no = 3) <> '2026-08-05' then
    raise exception '1c. a parcela 3 deveria cair em 05/08';
  end if;
  if (select count(*) from public.transactions
      where installment_plan_id = plano and installment_no > 1 and status <> 'pending') <> 0 then
    raise exception '1c. as parcelas 2..N deveriam nascer pendentes';
  end if;

  -- 1d. o plano guarda o contrato, e o trigger resolveu a fatura de cada parcela.
  if (select total_cents from public.installment_plans where id = plano) <> 30000 then
    raise exception '1d. o plano não guardou o total';
  end if;
  if (select count(*) from public.transactions
      where installment_plan_id = plano and invoice_id is null) <> 0 then
    raise exception '1d. toda parcela de cartão precisa de fatura';
  end if;

  -- ══ 2. idempotência: converter de novo é RECUSA, nunca segundo plano ══════
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Mercado do mês', 'mercado', 'Zaffari', cartao);
    raise exception 'FALHOU: 2. converter uma parcela tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('já é uma compra parcelada' in sqlerrm) = 0 then
      raise exception '2. recusa errada (esperava «já é uma compra parcelada»): %', sqlerrm;
    end if;
  end;

  -- ══ 3. dissolver: 3x volta a ser UM lançamento de R$ 300,00 ══════════════
  quantas := public.update_installment_plan(
    plano, 30000, 1, '2026-06-05', 'Mercado do mês', 'mercado', 'Zaffari', cartao);
  if quantas <> 1 then raise exception '3. dissolver deveria devolver 1, devolveu %', quantas; end if;

  if (select count(*) from public.installment_plans where id = plano) <> 0 then
    raise exception '3a. o plano deveria ter sumido';
  end if;
  if (select count(*) from public.transactions
      where workspace_id = ws and description like 'Mercado%') <> 1 then
    raise exception '3a. deveria ter sobrado UMA linha';
  end if;

  -- 3b. o SOBREVIVENTE é a linha original — mesmo id —, solta, com o total e sem o "(1/3)".
  --     Esta é a asserção que pega o `on delete cascade` na ordem errada.
  if (select count(*) from public.transactions where id = tx) <> 1 then
    raise exception '3b. o cascade levou a linha que deveria sobreviver';
  end if;
  if (select amount_cents from public.transactions where id = tx) <> 30000 then
    raise exception '3b. a linha solta deveria valer 30000, veio %',
      (select amount_cents from public.transactions where id = tx);
  end if;
  txt := (select description from public.transactions where id = tx);
  if txt <> 'Mercado do mês' then raise exception '3b. a linha solta ficou com o sufixo: %', txt; end if;
  if (select installment_plan_id from public.transactions where id = tx) is not null
     or (select installment_no from public.transactions where id = tx) is not null then
    raise exception '3b. a linha solta continua apontando para o plano';
  end if;

  -- ══ 4. parcela 1 já paga: converte, e ela CONTINUA paga ═════════════════
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 30000, 'Pneu', corrente, '2026-06-05', 'app', 'cleared')
  returning id into tx;

  plano := public.convert_transaction_to_installments(
    tx, 30000, 3, '2026-06-05', 'Pneu', null, null, corrente);
  if (select status from public.transactions where id = tx) <> 'cleared' then
    raise exception '4. a parcela 1 já paga não podia virar pendente';
  end if;
  if (select count(*) from public.transactions
      where installment_plan_id = plano and status = 'pending') <> 2 then
    raise exception '4. as outras duas deveriam ficar pendentes';
  end if;

  -- 4a. e com parcela paga o número de parcelas trava — inclusive para dissolver.
  --     ⚠️ a frase confere 'o número de parcelas não muda mais', não só 'não muda mais': essa
  --     segunda aparece em TRÊS mensagens (número, data, conta) e passaria com qualquer uma.
  begin
    perform public.update_installment_plan(plano, 30000, 1, '2026-06-05', 'Pneu', null, null, corrente);
    raise exception 'FALHOU: 4a. dissolver com parcela paga tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('o número de parcelas não muda mais' in sqlerrm) = 0 then
      raise exception '4a. recusa errada (esperava «o número de parcelas não muda mais»): %', sqlerrm;
    end if;
  end;

  -- ══ 5. fatura FECHADA recusa a conversão ════════════════════════════════
  -- 5a. fatura `paid`.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 30000, 'Geladeira', cartao, '2026-07-05', 'app', 'pending')
  returning id into tx;
  select invoice_id into fat from public.transactions where id = tx;
  update public.card_invoices set status = 'paid', paid_at = current_date where id = fat;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-07-05', 'Geladeira', null, null, cartao);
    raise exception 'FALHOU: 5a. converter dentro de fatura paga tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('já foi paga, adiada ou paga em parte' in sqlerrm) = 0 then
      raise exception '5a. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 5b. fatura `rolled`.
  update public.card_invoices set status = 'rolled', paid_at = null where id = fat;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-07-05', 'Geladeira', null, null, cartao);
    raise exception 'FALHOU: 5b. converter dentro de fatura adiada tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('já foi paga, adiada ou paga em parte' in sqlerrm) = 0 then
      raise exception '5b. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 5c. ⚠️ pagamento PARCIAL: a fatura fica `open` e as linhas `pending`. É o caso que não
  --     aparece em teste nenhum, e o que torna a fatura impossível de fechar se passar.
  update public.card_invoices set status = 'open', paid_cents = 1000 where id = fat;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-07-05', 'Geladeira', null, null, cartao);
    raise exception 'FALHOU: 5c. converter em fatura paga em PARTE tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('já foi paga, adiada ou paga em parte' in sqlerrm) = 0 then
      raise exception '5c. recusa errada: %', sqlerrm;
    end if;
  end;
  update public.card_invoices set status = 'open', paid_cents = 0 where id = fat;

  -- ══ 6. as recusas de forma ══════════════════════════════════════════════
  -- 6a. receita não parcela.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source)
  values (ws, usr, 'income', 30000, 'Salário', corrente, '2026-06-05', 'app')
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Salário', null, null, corrente);
    raise exception 'FALHOU: 6a. receita parcelada tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('Só gasto vira compra parcelada' in sqlerrm) = 0 then
      raise exception '6a. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 6b. ocorrência de série recorrente: quem manda na divisão é a REGRA.
  insert into public.recurring_transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, rrule, dtstart, next_run_at)
  values (ws, usr, 'expense', 30000, 'Vivo', corrente, 'FREQ=MONTHLY;BYMONTHDAY=5',
          '2026-06-01', '2026-07-05')
  returning id into serie;
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at,
     source, recurring_id)
  values (ws, usr, 'expense', 30000, 'Vivo', corrente, '2026-06-05', 'recurring', serie)
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Vivo', null, null, corrente);
    raise exception 'FALHOU: 6b. ocorrência de recorrência tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('série recorrente' in sqlerrm) = 0 then
      raise exception '6b. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 6c. parcela de FINANCIAMENTO: quem manda é o cronograma da dívida.
  insert into public.debts
    (workspace_id, user_id, name, kind, principal_cents, remaining_cents, interest_rate_monthly)
  values (ws, usr, 'Carro', 'financing', 100000, 100000, 0.0199)
  returning id into divida;
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, debt_id)
  values (ws, usr, 'expense', 30000, 'Parcela Carro', corrente, '2026-06-05', 'app', divida)
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Parcela Carro', null, null, corrente);
    raise exception 'FALHOU: 6c. parcela de financiamento tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('financiamento' in sqlerrm) = 0 then
      raise exception '6c. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 6d. ⚠️ saldo ADIADO de fatura: é `expense` comum, sem `debt_id` e sem `recurring_id`, então
  --     passa por todas as guardas de cima. Ele já foi contado quando as compras foram feitas —
  --     `rollover_of_invoice_id` é o que o mantém fora da competência, e as parcelas 2..N não
  --     herdariam a coluna: o principal voltaria como gasto NOVO em N−1 meses.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source,
     status, rollover_of_invoice_id)
  values (ws, usr, 'expense', 30000, 'Saldo em rotativo', cartao, '2026-09-05', 'app', 'pending', fat)
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-09-05', 'Saldo em rotativo', null, null, cartao);
    raise exception 'FALHOU: 6d. saldo adiado tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('saldo adiado' in sqlerrm) = 0 then
      raise exception '6d. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 6e. sem conta não há fatura para resolver.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, occurred_at, source)
  values (ws, usr, 'expense', 30000, 'Avulso', '2026-06-05', 'app')
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Avulso', null, null, null);
    raise exception 'FALHOU: 6e. conversão sem conta tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('Escolha a conta ou o cartão' in sqlerrm) = 0 then
      raise exception '6e. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 6f. conta de OUTRO workspace (IDOR). Para o agente Python, que ignora RLS, esta é a única
  --     barreira.
  insert into public.workspaces (name, owner_id) values ('Outro', usr) returning id into ws_outro;
  insert into public.accounts (workspace_id, user_id, name, type)
  values (ws_outro, usr, 'De outro', 'checking') returning id into conta_outra;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3, '2026-06-05', 'Avulso', null, null, conta_outra);
    raise exception 'FALHOU: 6f. conta de outro workspace tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('conta ativa' in sqlerrm) = 0 then
      raise exception '6f. recusa errada: %', sqlerrm;
    end if;
  end;

  -- ══ 7. os limites de forma ══════════════════════════════════════════════
  -- 7a. 1x não é conversão — 1x já é o que ele é.
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 1, '2026-06-05', 'Avulso', null, null, corrente);
    raise exception 'FALHOU: 7a. converter para 1x tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('pelo menos 2 parcelas' in sqlerrm) = 0 then
      raise exception '7a. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 7b. 73 passa do teto.
  begin
    perform public.convert_transaction_to_installments(
      tx, 730000, 73, '2026-06-05', 'Avulso', null, null, corrente);
    raise exception 'FALHOU: 7b. 73 parcelas tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('no máximo 72' in sqlerrm) = 0 then
      raise exception '7b. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 7c. o total precisa sobrar um centavo por parcela.
  begin
    perform public.convert_transaction_to_installments(
      tx, 2, 3, '2026-06-05', 'Avulso', null, null, corrente);
    raise exception 'FALHOU: 7c. total menor que o número de parcelas tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('centavo' in sqlerrm) = 0 then
      raise exception '7c. recusa errada: %', sqlerrm;
    end if;
  end;

  -- ══ 8. a aritmética: divisão INTEIRA com o resto na ÚLTIMA ══════════════
  -- 8a. 100,00 em 3x = 33,33 / 33,33 / 33,34. Divisão exata (300/3) nunca exercita o resto.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 10000, 'Resto', cartao, '2026-12-05', 'app', 'pending')
  returning id into tx;
  plano := public.convert_transaction_to_installments(
    tx, 10000, 3, '2026-12-05', 'Resto', null, null, cartao);
  if (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 1) <> 3333
     or (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 2) <> 3333
     or (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 3) <> 3334 then
    raise exception '8a. o resto não foi para a última parcela: %/%/%',
      (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 1),
      (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 2),
      (select amount_cents from public.transactions where installment_plan_id = plano and installment_no = 3);
  end if;

  -- 8b. total MÍNIMO: 3 centavos em 3x. Nenhuma parcela pode nascer zero — `amount_cents > 0` é
  --     CHECK de tabela, e um insert que o viole derruba a transação inteira.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 3, 'Mínimo', cartao, '2026-12-05', 'app', 'pending')
  returning id into tx;
  plano := public.convert_transaction_to_installments(tx, 3, 3, '2026-12-05', 'Mínimo', null, null, cartao);
  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano;
  if n <> 3 or soma <> 3 then raise exception '8b. total mínimo: % parcelas somando %', n, soma; end if;

  -- 8c. o TETO (72x), e dissolver de volta.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 100000, 'Teto', cartao, '2026-12-05', 'app', 'pending')
  returning id into tx;
  plano := public.convert_transaction_to_installments(tx, 100000, 72, '2026-12-05', 'Teto', null, null, cartao);
  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano;
  if n <> 72 or soma <> 100000 then raise exception '8c. 72x: % parcelas somando %', n, soma; end if;
  if (select amount_cents from public.transactions
      where installment_plan_id = plano and installment_no = 72) <> 1452 then
    raise exception '8c. o resto da divisão não foi para a última parcela';
  end if;
  quantas := public.update_installment_plan(plano, 100000, 1, '2026-12-05', 'Teto', null, null, cartao);
  if quantas <> 1 or (select amount_cents from public.transactions where id = tx) <> 100000 then
    raise exception '8c. dissolver o 72x não devolveu o total para o sobrevivente';
  end if;
  if (select count(*) from public.transactions where installment_plan_id = plano) <> 0 then
    raise exception '8c. sobraram parcelas depois de dissolver';
  end if;

  -- ══ 9. o pós-check do destino: a data não pode jogar parcela em fatura fechada ══
  --     `travadas = 0` fala do estado de ANTES. Recuar a primeira parcela para dentro de uma
  --     fatura já paga faz a linha sumir de toda leitura de caixa (todas filtram
  --     `status not in ('paid','rolled')`), sem erro nenhum.
  update public.card_invoices set status = 'paid', paid_at = current_date where id = fat;
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 30000, 'Recuar', cartao, '2026-12-05', 'app', 'pending')
  returning id into tx;
  begin
    perform public.convert_transaction_to_installments(
      tx, 30000, 3,
      (select closing_date - 1 from public.card_invoices where id = fat),
      'Recuar', null, null, cartao);
    raise exception 'FALHOU: 9. data caindo em fatura fechada tinha que ser recusada';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('fatura já fechada' in sqlerrm) = 0 then
      raise exception '9. recusa errada: %', sqlerrm;
    end if;
  end;

  -- ══ 10. o pós-check do DISSOLVE, e o piso/teto do `update_installment_plan` ══════
  --     `fat` continua `paid` deste grupo 9. Sem este bloco, apagar o `if
  --     (select private.parcela_travada('pending', t.invoice_id) …) then raise` inteiro do
  --     ramo `p_installments = 1` deixaria `converter_parcelamento.sql` verde do mesmo jeito —
  --     os dissolves dos casos 3 e 8c usam a data ORIGINAL e nunca trocam de fatura.
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 30000, 'Espelho', cartao, '2026-12-05', 'app', 'pending')
  returning id into tx;
  plano := public.convert_transaction_to_installments(tx, 30000, 3, '2026-12-05', 'Espelho', null, null, cartao);

  -- 10a. dissolver jogando o sobrevivente para dentro da fatura de `fat`, que está `paid`.
  begin
    perform public.update_installment_plan(
      plano, 30000, 1,
      (select closing_date - 1 from public.card_invoices where id = fat),
      'Espelho', null, null, cartao);
    raise exception 'FALHOU: 10a. dissolver jogando a linha em fatura fechada tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('fatura já fechada' in sqlerrm) = 0 then
      raise exception '10a. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 10b. o piso: 0 não é "à vista", é ausência de parcela — e sem esta trava
  --      `for i in 1..0 loop` não roda e o `delete` apagaria TODAS as parcelas.
  begin
    perform public.update_installment_plan(plano, 30000, 0, '2026-12-05', 'Espelho', null, null, cartao);
    raise exception 'FALHOU: 10b. 0 parcelas tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('entre 1 e 72' in sqlerrm) = 0 then
      raise exception '10b. recusa errada: %', sqlerrm;
    end if;
  end;

  -- 10c. o teto: 73 passa do limite também na edição, não só na conversão.
  begin
    perform public.update_installment_plan(plano, 730000, 73, '2026-12-05', 'Espelho', null, null, cartao);
    raise exception 'FALHOU: 10c. 73 parcelas tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('entre 1 e 72' in sqlerrm) = 0 then
      raise exception '10c. recusa errada: %', sqlerrm;
    end if;
  end;

  update public.card_invoices set status = 'open', paid_at = null where id = fat;

  raise notice 'OK: converter e dissolver — 10 grupos de asserção';
end $$;

rollback;
