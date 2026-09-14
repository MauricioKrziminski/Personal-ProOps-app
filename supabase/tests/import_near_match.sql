-- `public._prepare_import_batch` — o casamento APROXIMADO do extrato com o que já está no app.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/import_near_match.sql
--
-- As asserções que carregam esta feature são a 3 e a 4: **na dúvida ele NÃO escolhe**. Um
-- `near_match` é uma oferta de alterar um lançamento real — falso positivo não dá erro, corrompe
-- a data de outra compra e aparece meses depois num mês fechado. Sem 3 e 4 a feature ainda
-- "funciona" nos casos fáceis e erra exatamente onde dói.

\set ON_ERROR_STOP on
begin;

do $$
declare
  ws uuid; usr uuid; cartao uuid; outra uuid; lote uuid;
  t_exata uuid; t_perto uuid;
  n int;
begin
  select id into usr from auth.users limit 1;
  insert into public.workspaces (name, owner_id) values ('teste import', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');

  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, initial_balance_cents)
    values (ws, usr, 'Cartao', 'credit_card', 3, 10, 0) returning id into cartao;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Corrente', 'checking', 100000) returning id into outra;

  -- O que JÁ existe no app.
  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, occurred_at, description, status, source)
    values (ws, usr, cartao, 'expense', 5000, '2026-08-10', 'Mercado', 'cleared', 'app') returning id into t_exata;
  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, occurred_at, description, status, source)
    values (ws, usr, cartao, 'expense', 7000, '2026-08-12', 'Farmacia', 'cleared', 'app') returning id into t_perto;
  -- Mesmo valor do item de baixo, mas em OUTRA conta: não pode casar.
  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, occurred_at, description, status, source)
    values (ws, usr, outra, 'expense', 3300, '2026-08-15', 'Pix', 'cleared', 'app');
  -- DUAS iguais, para o item ambíguo: 2.500 em 20/08 e em 22/08.
  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, occurred_at, description, status, source)
    values (ws, usr, cartao, 'expense', 2500, '2026-08-20', 'Cafe', 'cleared', 'app'),
           (ws, usr, cartao, 'expense', 2500, '2026-08-22', 'Cafe', 'cleared', 'app');

  insert into public.import_batches (workspace_id, user_id, source, filename, account_id, status)
    values (ws, usr, 'ofx', 't.ofx', cartao, 'review') returning id into lote;

  insert into public.import_items (batch_id, workspace_id, kind, amount_cents, occurred_at, description, status) values
    (lote, ws, 'expense', 5000, '2026-08-10', 'Mercado',        'pending'),  -- 1 exato
    (lote, ws, 'expense', 7000, '2026-08-14', 'FARMACIA SA',    'pending'),  -- 2 aproximado (2 dias, nome outro)
    (lote, ws, 'expense', 2500, '2026-08-21', 'CAFE',           'pending'),  -- 3 ambíguo (duas candidatas)
    (lote, ws, 'expense', 3300, '2026-08-16', 'PIX',            'pending'),  -- 4 outra conta
    (lote, ws, 'expense', 7000, '2026-08-15', 'DISPUTA',        'pending'),  -- 5 disputa a mesma de 2
    (lote, ws, 'expense',  111, '2026-08-25', 'NOVA',           'pending');  -- 6 nova

  perform public._prepare_import_batch(lote);

  -- 1. Casamento exato continua virando `duplicate`.
  select count(*) into n from public.import_items
   where batch_id = lote and description = 'Mercado' and status = 'duplicate';
  if n <> 1 then raise exception '1: o casamento exato parou de virar duplicate'; end if;

  -- 2. Data fora por 2 dias vira `near_match` APONTANDO para o lançamento certo. A descrição é
  -- diferente de propósito: exigir nome igual mataria o caso do usuário que renomeou à mão.
  select count(*) into n from public.import_items
   where batch_id = lote and description = 'FARMACIA SA'
     and status = 'near_match' and transaction_id = t_perto;
  if n <> 1 then raise exception '2: a data fora por 2 dias nao casou com o lancamento certo'; end if;

  -- 3. ⚠️ DOIS candidatos = PERGUNTA, não deduz. Fica `pending` e sem alvo.
  select count(*) into n from public.import_items
   where batch_id = lote and description = 'CAFE'
     and status = 'pending' and transaction_id is null;
  if n <> 1 then raise exception '3: com duas candidatas ele escolheu uma — devia ficar pending'; end if;

  -- 4. ⚠️ Uma transação é reivindicada por UM item só: a disputa perde para a mais próxima.
  select count(*) into n from public.import_items
   where batch_id = lote and description = 'DISPUTA' and status = 'pending';
  if n <> 1 then raise exception '4: dois itens casaram com o mesmo lancamento'; end if;
  select count(*) into n from public.import_items
   where batch_id = lote and status = 'near_match';
  if n <> 1 then raise exception '4b: mais de um near_match no lote (esperado 1), veio %', n; end if;

  -- 5. Conta diferente não casa, mesmo com valor e data próximos.
  select count(*) into n from public.import_items
   where batch_id = lote and description = 'PIX' and status = 'pending';
  if n <> 1 then raise exception '5: casou com lancamento de OUTRA conta'; end if;

  -- 6. O que é novo continua novo.
  select count(*) into n from public.import_items
   where batch_id = lote and description = 'NOVA' and status = 'pending';
  if n <> 1 then raise exception '6: o lancamento novo nao ficou pending'; end if;

  -- 7. `duplicados` no retorno continua contando só o EXATO — três telas leem esse número.
  select duplicados into n from public._prepare_import_batch(lote);
  if n <> 1 then raise exception '7: duplicados passou a contar os aproximados, veio %', n; end if;

  -- 8. O índice parcial segura a unicidade mesmo fora da função.
  begin
    insert into public.import_items (batch_id, workspace_id, kind, amount_cents, occurred_at,
                                     description, status, transaction_id)
      values (lote, ws, 'expense', 1, '2026-08-14', 'FORCADO', 'near_match', t_perto);
    raise exception '8: dois near_match no mesmo lancamento passaram';
  exception when unique_violation then null;
  end;

  raise notice 'import_near_match: 8 asserções OK';
end $$;

rollback;
