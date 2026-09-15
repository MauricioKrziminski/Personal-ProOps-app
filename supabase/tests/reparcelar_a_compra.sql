-- Reparcelar (`20260915210000`) contra um Postgres de verdade.
--
--   npx supabase start
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/reparcelar_a_compra.sql
--
-- O que este arquivo protege são as três regras que o usuário enunciou e as duas armadilhas
-- que a revisão da migration achou:
--
--   1. nada pago → o contrato inteiro é reescrito (total, número, datas, nome);
--   2. com parcela paga → só o saldo EM ABERTO se redistribui, e número/data/conta travam;
--   3. a soma das parcelas é SEMPRE o total;
--   4. fatura parcialmente paga trava a parcela (senão o "quanto falta" da fatura fica negativo);
--   5. mudar a data não pode empurrar parcela para dentro de uma fatura já fechada.
--
-- Roda inteiro dentro de uma transação e dá rollback: não suja o banco.

\set ON_ERROR_STOP on
begin;

set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000a9';
  w uuid := '00000000-0000-0000-0000-0000000000b9';
  card uuid := '00000000-0000-0000-0000-0000000000d9';
  outro uuid := '00000000-0000-0000-0000-0000000000d8';
  plano uuid;
  fatura uuid;
  n int;
  v bigint;
  txt text;
  d date;
begin
  insert into auth.users (id, email) values (u, 'teste-reparcelar@example.invalid')
    on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste reparcelar');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (card, w, u, 'Cartão teste', 'credit_card', 3, 10, 5000000);
  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (outro, w, u, 'Outro cartão', 'credit_card', 3, 10, 5000000);

  -- ── 1. nada pago: total, número, datas e nome são reescritos ─────────────
  plano := public.create_installment_plan_with_history(card, 10499, 2, date '2026-10-05', 0, 'Nuuvem Wardog', 'lazer', null);

  perform public.update_installment_plan(
    p_plan_id => plano, p_total_cents => 15001, p_installments => 3,
    p_first_occurred_at => date '2026-11-05',
    p_description => 'Nuuvem anual', p_category => 'assinaturas', p_merchant => 'Nuuvem',
    p_account_id => card);

  select count(*) into n from public.transactions where installment_plan_id = plano;
  if n <> 3 then raise exception 'esperava 3 parcelas depois de reparcelar, achei %', n; end if;

  select sum(amount_cents) into v from public.transactions where installment_plan_id = plano;
  if v <> 15001 then raise exception 'a soma das parcelas devia ser 15001, deu %', v; end if;

  -- resto da divisão na ÚLTIMA, igual à criação
  select amount_cents into v from public.transactions where installment_plan_id = plano and installment_no = 3;
  if v <> 5001 then raise exception 'a última parcela devia fechar em 5001, deu %', v; end if;

  select occurred_at into d from public.transactions where installment_plan_id = plano and installment_no = 3;
  if d <> date '2027-01-05' then raise exception 'a 3ª parcela devia cair em 05/01/2027, caiu em %', d; end if;

  select description into txt from public.transactions where installment_plan_id = plano and installment_no = 1;
  if txt <> 'Nuuvem anual (1/3)' then raise exception 'o texto da parcela não foi reescrito com o N novo: %', txt; end if;

  select total_cents, installments into v, n from public.installment_plans where id = plano;
  if v <> 15001 or n <> 3 then raise exception 'o contrato não acompanhou: % / %', v, n; end if;

  -- ── 2. encolher apaga só o excedente ─────────────────────────────────────
  perform public.update_installment_plan(plano, 8000, 2, date '2026-11-05', 'Nuuvem anual', 'assinaturas', 'Nuuvem', card);
  select count(*) into n from public.transactions where installment_plan_id = plano;
  if n <> 2 then raise exception 'encolher para 2x devia deixar 2 parcelas, deixou %', n; end if;
  select sum(amount_cents) into v from public.transactions where installment_plan_id = plano;
  if v <> 8000 then raise exception 'soma depois de encolher devia ser 8000, deu %', v; end if;

  -- ── 3. com parcela paga, só o saldo em aberto se redistribui ─────────────
  update public.transactions set status = 'cleared'
   where installment_plan_id = plano and installment_no = 1;

  perform public.update_installment_plan(plano, 12000, 2, date '2026-11-05', 'Nuuvem anual', 'assinaturas', 'Nuuvem', card);

  select amount_cents into v from public.transactions where installment_plan_id = plano and installment_no = 1;
  if v <> 4000 then raise exception 'a parcela PAGA mudou de valor: %', v; end if;
  select amount_cents into v from public.transactions where installment_plan_id = plano and installment_no = 2;
  if v <> 8000 then raise exception 'a parcela em aberto devia absorver a diferença (8000), deu %', v; end if;

  -- o nome continua sendo da COMPRA: a paga também é renomeada
  perform public.update_installment_plan(plano, 12000, 2, date '2026-11-05', 'Nuuvem mensal', 'assinaturas', 'Nuuvem', card);
  select description into txt from public.transactions where installment_plan_id = plano and installment_no = 1;
  if txt <> 'Nuuvem mensal (1/2)' then raise exception 'a parcela paga não foi renomeada: %', txt; end if;

  -- ── 4. com parcela paga: número, data e conta TRAVAM ─────────────────────
  begin
    perform public.update_installment_plan(plano, 12000, 3, date '2026-11-05', 'Nuuvem mensal', 'assinaturas', 'Nuuvem', card);
    raise exception 'FALHOU: mudar o número de parcelas com uma paga tinha que ser recusado';
  exception when others then
    -- ⚠️ Conferir a FRASE, não só que levantou: um `when others` mudo passa por um typo de
    -- coluna do mesmo jeito que pela recusa, e o teste ficaria verde sem a trava existir.
    if sqlerrm like 'FALHOU:%' or position('o número de parcelas não muda mais' in sqlerrm) = 0 then
      raise exception 'recusa errada (esperava «o número de parcelas não muda mais»): %', sqlerrm;
    end if;
  end;

  begin
    perform public.update_installment_plan(plano, 12000, 2, date '2026-12-05', 'Nuuvem mensal', 'assinaturas', 'Nuuvem', card);
    raise exception 'FALHOU: mudar a data com uma parcela paga tinha que ser recusado';
  exception when others then
    -- ⚠️ Conferir a FRASE, não só que levantou: um `when others` mudo passa por um typo de
    -- coluna do mesmo jeito que pela recusa, e o teste ficaria verde sem a trava existir.
    if sqlerrm like 'FALHOU:%' or position('a data da primeira parcela não muda mais' in sqlerrm) = 0 then
      raise exception 'recusa errada (esperava «a data da primeira parcela não muda mais»): %', sqlerrm;
    end if;
  end;

  begin
    perform public.update_installment_plan(plano, 12000, 2, date '2026-11-05', 'Nuuvem mensal', 'assinaturas', 'Nuuvem', outro);
    raise exception 'FALHOU: trocar a conta com uma parcela paga tinha que ser recusado';
  exception when others then
    -- ⚠️ Conferir a FRASE, não só que levantou: um `when others` mudo passa por um typo de
    -- coluna do mesmo jeito que pela recusa, e o teste ficaria verde sem a trava existir.
    if sqlerrm like 'FALHOU:%' or position('a conta não muda mais' in sqlerrm) = 0 then
      raise exception 'recusa errada (esperava «a conta não muda mais»): %', sqlerrm;
    end if;
  end;

  -- total que não cobre o que já foi pago
  begin
    perform public.update_installment_plan(plano, 4000, 2, date '2026-11-05', 'Nuuvem mensal', 'assinaturas', 'Nuuvem', card);
    raise exception 'FALHOU: total menor que o pago tinha que ser recusado';
  exception when others then
    -- ⚠️ Conferir a FRASE, não só que levantou: um `when others` mudo passa por um typo de
    -- coluna do mesmo jeito que pela recusa, e o teste ficaria verde sem a trava existir.
    if sqlerrm like 'FALHOU:%' or position('O total precisa cobrir' in sqlerrm) = 0 then
      raise exception 'recusa errada (esperava «O total precisa cobrir»): %', sqlerrm;
    end if;
  end;

  -- e nada disso deixou estado parcial
  select sum(amount_cents) into v from public.transactions where installment_plan_id = plano;
  if v <> 12000 then raise exception 'uma recusa deixou as parcelas em %, e não em 12000', v; end if;

  -- ── 5. a conta não some em silêncio ──────────────────────────────────────
  -- Plano NOVO de propósito: com parcela paga quem recusaria seria a trava da conta travada,
  -- e o teste passaria sem nunca exercitar esta guarda. (Foi o que aconteceu na primeira
  -- escrita deste arquivo — e só apareceu porque a asserção confere a FRASE.)
  plano := public.create_installment_plan_with_history(card, 6000, 2, date '2027-01-05', 0, 'Sem conta', null, null);
  begin
    perform public.update_installment_plan(plano, 6000, 2, date '2027-01-05', 'Sem conta', null, null, null);
    raise exception 'FALHOU: apagar a conta da compra tinha que ser recusado';
  exception when others then
    -- ⚠️ Conferir a FRASE, não só que levantou: um `when others` mudo passa por um typo de
    -- coluna do mesmo jeito que pela recusa, e o teste ficaria verde sem a trava existir.
    if sqlerrm like 'FALHOU:%' or position('Informe a conta desta compra' in sqlerrm) = 0 then
      raise exception 'recusa errada (esperava «Informe a conta desta compra»): %', sqlerrm;
    end if;
  end;

  -- ── 6. fatura PARCIALMENTE paga trava a parcela ──────────────────────────
  -- Sem isto a soma das linhas cai abaixo de `paid_cents`, `invoice_open_cents` fica negativo
  -- e `pay_invoice` recusa a quitação para sempre — e nada disso aparece na tela.
  plano := public.create_installment_plan_with_history(card, 10000, 2, date '2027-03-05', 0, 'Parcial', null, null);
  select invoice_id into fatura from public.transactions where installment_plan_id = plano and installment_no = 1;
  if fatura is null then raise exception 'a parcela devia ter caído numa fatura'; end if;
  update public.card_invoices set paid_cents = 1000 where id = fatura;

  begin
    perform public.update_installment_plan(plano, 20000, 4, date '2027-03-05', 'Parcial', null, null, card);
    raise exception 'FALHOU: parcela em fatura parcialmente paga tinha que travar o número';
  exception when others then
    -- ⚠️ Conferir a FRASE, não só que levantou: um `when others` mudo passa por um typo de
    -- coluna do mesmo jeito que pela recusa, e o teste ficaria verde sem a trava existir.
    if sqlerrm like 'FALHOU:%' or position('o número de parcelas não muda mais' in sqlerrm) = 0 then
      raise exception 'recusa errada (esperava «o número de parcelas não muda mais»): %', sqlerrm;
    end if;
  end;

  -- ── 7. a data nova não pode jogar parcela em fatura já fechada ───────────
  plano := public.create_installment_plan_with_history(card, 10000, 2, date '2027-07-05', 0, 'Fechada', null, null);
  -- uma compra avulsa em maio cria a fatura daquele ciclo; ela é marcada como paga
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
    values (w, u, 'expense', 500, 'Compra antiga', card, date '2027-05-05', 'app', 'cleared');
  select invoice_id into fatura from public.transactions
   where account_id = card and occurred_at = date '2027-05-05' limit 1;
  update public.card_invoices set status = 'paid' where id = fatura;

  begin
    perform public.update_installment_plan(plano, 10000, 2, date '2027-05-05', 'Fechada', null, null, card);
    raise exception 'FALHOU: a data nova jogou uma parcela numa fatura paga e passou';
  exception when others then
    -- ⚠️ Conferir a FRASE, não só que levantou: um `when others` mudo passa por um typo de
    -- coluna do mesmo jeito que pela recusa, e o teste ficaria verde sem a trava existir.
    if sqlerrm like 'FALHOU:%' or position('fatura já fechada' in sqlerrm) = 0 then
      raise exception 'recusa errada (esperava «fatura já fechada»): %', sqlerrm;
    end if;
  end;

  -- a recusa desfez a reescrita inteira: as parcelas continuam em julho/agosto
  select min(occurred_at) into d from public.transactions where installment_plan_id = plano;
  if d <> date '2027-07-05' then raise exception 'a recusa deixou a data em %', d; end if;

  -- ── 8. só o estabelecimento: a parcela herda o nome dele ─────────────────
  plano := public.create_installment_plan_with_history(card, 6000, 2, date '2027-09-05', 0, null, null, 'Padaria');
  perform public.update_installment_plan(plano, 9000, 3, date '2027-09-05', null, null, 'Padaria', card);
  select description into txt from public.transactions where installment_plan_id = plano and installment_no = 2;
  if txt <> 'Padaria (2/3)' then raise exception 'sem título, o nome tinha que vir do estabelecimento: %', txt; end if;

  raise notice 'reparcelar: todas as asserções passaram';
end $$;

rollback;
