-- Importação inteligente (`20260922150000`): gravar o que foi marcado, parcelado inteiro,
-- adoção de parcela antiga, fatura do histórico quitada, idempotência.
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/importacao_inteligente.sql
--
-- `if`/`raise` (nunca `assert`) e toda recusa confere a FRASE — o padrão de `converter_parcelamento.sql`.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  usr uuid; ws uuid; cartao uuid; lote uuid;
  i_novo uuid; i_parc uuid; i_adota uuid; i_dup uuid;
  antiga uuid; alheia uuid; plano uuid; fat_hist uuid; fat_antiga uuid;
  cartao2 uuid; lote2 uuid; i_avista uuid; i_p2 uuid; i_recente uuid; dia date;
  n int; soma bigint; st text; txt text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'import-' || gen_random_uuid() || '@proops.test', '', now(), now(), now())
  returning id into usr;
  insert into public.profiles (id) values (usr) on conflict do nothing;
  insert into public.workspaces (name, owner_id) values ('Import', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner') on conflict do nothing;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
  values (ws, usr, 'Nubank Cartão', 'credit_card', 3, 10) returning id into cartao;

  -- A fatura de junho JÁ EXISTE no app, aberta, com uma compra da pessoa: o histórico não a toca.
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 1000, 'Compra de junho', cartao, '2026-06-10', 'app', 'pending')
  returning id into alheia;
  select invoice_id into fat_antiga from public.transactions where id = alheia;

  -- A parcela 1/4 da King Cell já foi importada SOLTA num mês anterior.
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source)
  values (ws, usr, 'expense', 39900, 'King Cell - Parcela 1/4', cartao, '2026-07-03', 'import')
  returning id into antiga;

  insert into public.import_batches (workspace_id, user_id, source, account_id, status)
  values (ws, usr, 'csv', cartao, 'review') returning id into lote;

  insert into public.import_items (batch_id, workspace_id, kind, amount_cents, occurred_at, description, merchant, status)
  values (lote, ws, 'expense', 3700, '2026-09-04', 'Casa do Acai', null, 'pending') returning id into i_novo;
  insert into public.import_items (batch_id, workspace_id, kind, amount_cents, occurred_at, description, merchant, installment_no, installments, status)
  values (lote, ws, 'expense', 78096, '2026-09-03', 'Luizroberto - Parcela 2/12', 'Luizroberto', 2, 12, 'pending') returning id into i_parc;
  insert into public.import_items (batch_id, workspace_id, kind, amount_cents, occurred_at, description, merchant, installment_no, installments, adopt_ids, status)
  values (lote, ws, 'expense', 39900, '2026-09-03', 'King Cell - Parcela 3/4', 'King Cell', 3, 4, array[antiga, null]::uuid[], 'pending') returning id into i_adota;
  insert into public.import_items (batch_id, workspace_id, kind, amount_cents, occurred_at, description, status, transaction_id)
  values (lote, ws, 'expense', 1000, '2026-06-10', 'Compra de junho', 'duplicate', alheia) returning id into i_dup;

  -- ══ 1. grava só o marcado ═══════════════════════════════════════════════════
  n := public.finish_import_batch(lote, array[i_novo, i_parc, i_adota]);
  if n <> 3 then raise exception '1. esperava 3 gravados, foram %', n; end if;
  if (select status from public.import_items where id = i_dup) <> 'discarded' then
    raise exception '1. o desmarcado tinha que ser descartado';
  end if;
  if (select status from public.import_batches where id = lote) <> 'done' then
    raise exception '1. o lote tinha que fechar';
  end if;

  -- ══ 2. parcelado inteiro: 12 parcelas, 1 paga (histórico), a do arquivo aponta para a 2 ═══
  select installment_plan_id into plano from public.transactions
   where id = (select transaction_id from public.import_items where id = i_parc);
  select count(*), sum(amount_cents) into n, soma from public.transactions where installment_plan_id = plano;
  if n <> 12 or soma <> 78096 * 12 then raise exception '2. plano com % parcelas e soma %', n, soma; end if;
  if (select installment_no from public.transactions where id = (select transaction_id from public.import_items where id = i_parc)) <> 2 then
    raise exception '2. o item tinha que apontar para a parcela 2';
  end if;
  select status, invoice_id into st, fat_hist from public.transactions where installment_plan_id = plano and installment_no = 1;
  if st <> 'cleared' then raise exception '2. a parcela 1 (histórico) tinha que estar paga'; end if;
  if (select occurred_at from public.transactions where installment_plan_id = plano and installment_no = 1) <> '2026-08-03' then
    raise exception '2. a parcela 1 tinha que ser um mês antes';
  end if;
  if (select count(*) from public.transactions where installment_plan_id = plano and status = 'pending') <> 11 then
    raise exception '2. a do arquivo e as futuras ficam pendentes';
  end if;

  -- ══ 3. a fatura criada SÓ pelo histórico nasce quitada; a que já existia, não ═══════
  if (select status from public.card_invoices where id = fat_hist) <> 'paid' then
    raise exception '3. a fatura do histórico nasceu aberta (viraria "Atrasado")';
  end if;
  if (select status from public.card_invoices where id = fat_antiga) <> 'open' then
    raise exception '3. a fatura que já existia não pode ser quitada pelo import';
  end if;
  if (select status from public.card_invoices where id =
      (select invoice_id from public.transactions where id = (select transaction_id from public.import_items where id = i_parc))) <> 'open' then
    raise exception '3. a fatura da parcela do arquivo continua aberta';
  end if;

  -- ══ 4. adoção: a 1/4 solta vira a parcela 1 do plano, MESMO id, sem duplicar ═══════
  select installment_plan_id into plano from public.transactions where id = antiga;
  if plano is null or (select installment_no from public.transactions where id = antiga) <> 1 then
    raise exception '4. a parcela antiga não foi adotada';
  end if;
  if (select count(*) from public.transactions where installment_plan_id = plano) <> 4 then
    raise exception '4. o plano da King Cell tinha que ter 4 parcelas';
  end if;
  if (select count(*) from public.transactions where workspace_id = ws and description ilike 'King Cell%') <> 4 then
    raise exception '4. duplicou a parcela antiga';
  end if;
  select description into txt from public.transactions where id = antiga;
  if txt <> 'King Cell (1/4)' then raise exception '4. nome da adotada: %', txt; end if;

  -- ══ 5. idempotência: fechar de novo não grava nada ═══════════════════════════════
  n := public.finish_import_batch(lote, array[i_novo, i_parc, i_adota]);
  if n <> 0 then raise exception '5. o segundo toque gravou % de novo', n; end if;

  -- ══ 6. o "já pagas" do FORMULÁRIO também não cria fatura vencida aberta ═══════════
  plano := public.create_installment_plan_with_history(cartao, 60000, 6, '2026-03-15', 2, 'Sofá');
  if exists (select 1 from public.card_invoices ci
             join public.transactions t on t.invoice_id = ci.id
             where t.installment_plan_id = plano and t.status = 'cleared' and ci.status <> 'paid') then
    raise exception '6. a fatura das parcelas já pagas do formulário nasceu aberta';
  end if;

  -- ══ 7. fatura do histórico que AINDA VAI VENCER não é quitada, e a parcela fica devida ═══
  --     (revisão da migration: quitá-la tirava da projeção um dinheiro ainda devido)
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
  values (ws, usr, 'Cartão 2', 'credit_card', 28, 5) returning id into cartao2;
  dia := current_date - 1;
  insert into public.import_batches (workspace_id, user_id, source, account_id, status)
  values (ws, usr, 'csv', cartao2, 'review') returning id into lote2;
  insert into public.import_items (batch_id, workspace_id, kind, amount_cents, occurred_at, description, merchant, installment_no, installments, status)
  values (lote2, ws, 'expense', 5000, private.add_months(dia, 1), 'Loja - Parcela 2/2', 'Loja', 2, 2, 'pending')
  returning id into i_recente;
  perform public.finish_import_batch(lote2, array[i_recente]);
  select installment_plan_id into plano from public.transactions
   where id = (select transaction_id from public.import_items where id = i_recente);
  select t.status, ci.status into st, txt from public.transactions t join public.card_invoices ci on ci.id = t.invoice_id
   where t.installment_plan_id = plano and t.installment_no = 1;
  if st <> 'pending' or txt <> 'open' then
    raise exception '7. parcela anterior em fatura a vencer: linha % / fatura % (esperava pending/open)', st, txt;
  end if;

  -- ══ 8. compra à vista do MESMO extrato na fatura do histórico: a fatura não é quitada ════
  insert into public.import_batches (workspace_id, user_id, source, account_id, status)
  values (ws, usr, 'csv', cartao, 'review') returning id into lote2;
  insert into public.import_items (batch_id, workspace_id, kind, amount_cents, occurred_at, description, status)
  values (lote2, ws, 'expense', 2500, '2025-11-05', 'Compra à vista', 'pending') returning id into i_avista;
  insert into public.import_items (batch_id, workspace_id, kind, amount_cents, occurred_at, description, merchant, installment_no, installments, status)
  values (lote2, ws, 'expense', 9000, '2025-12-05', 'Outra - Parcela 2/2', 'Outra', 2, 2, 'pending') returning id into i_p2;
  perform public.finish_import_batch(lote2, array[i_avista, i_p2]);
  if (select ci.status from public.card_invoices ci
       join public.transactions t on t.invoice_id = ci.id
      where t.id = (select transaction_id from public.import_items where id = i_avista)) <> 'open' then
    raise exception '8. a fatura com a compra à vista foi quitada junto com o histórico';
  end if;

  raise notice 'OK: importação inteligente — 8 grupos de asserção';
end $$;

rollback;
