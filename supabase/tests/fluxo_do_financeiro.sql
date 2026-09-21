-- O ciclo de vida COMPLETO de um lançamento financeiro — ponta a ponta, num workspace só.
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/fluxo_do_financeiro.sql
--
-- Pedido literal do dono do produto: *"quero que teste o fluxo completo do financeiro e valide
-- tudo, se está criando correto, se não está duplicando ao editar, mas eu quero testes
-- completos, com parcela, sem parcela, editando colocando parcela, editando tirando parcela,
-- apagando, teste de várias formas"*. `converter_parcelamento.sql` e `reparcelar_a_compra.sql`
-- testam cada operação ISOLADA; nenhum dos dois persegue a mesma compra pelo ciclo inteiro —
-- que é exatamente onde a duplicação apareceu (19/09/2026: duas linhas na fatura para uma
-- compra só).
--
-- ⚠️ **`if`/`raise exception`, nunca `assert`** — como nos dois vizinhos: `assert` do plpgsql
-- obedece à GUC `plpgsql.check_asserts`, e com ela desligada o arquivo fica verde sem conferir
-- nada.
--
-- ⚠️ **Toda recusa confere a FRASE**, com o `raise` de controle prefixado `FALHOU:` — sem isso
-- uma frase de controle que contenha a palavra procurada deixa o teste verde com a trava
-- ausente.
--
-- ⚠️ `set local timezone` na primeira linha: as funções de finanças avaliam `current_date` em
-- BRT enquanto a sessão fica em UTC.
--
-- A PROVA CENTRAL não é "a RPC não estourou" — é a CONTAGEM de lançamentos do workspace em cada
-- passo (`total_esperado`), e o `id` de cada parcela sobrevivente. É isso que torna a duplicação
-- visível: se `convert_transaction_to_installments` um dia voltar a criar uma linha NOVA para a
-- parcela 1 em vez de adotar a que já existe, a contagem do passo 3 sobra em 1 — sem isso, nada
-- no teste veria a diferença entre "1 lançamento virou 3" e "1 lançamento virou 4, um deles
-- órfão".

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

-- A invariante repetida em seis pontos do ciclo: sempre que existe plano, a soma das parcelas É
-- o total. `pg_temp` para não sujar `public` e sumir sozinha com o rollback.
create or replace function pg_temp.confere_plano(p_plano uuid, p_passo text)
returns void
language plpgsql
as $$
declare
  total bigint;
  soma bigint;
begin
  select total_cents into total from public.installment_plans where id = p_plano;
  if total is null then
    raise exception '%: o plano % não existe mais', p_passo, p_plano;
  end if;
  select coalesce(sum(amount_cents), 0) into soma
  from public.transactions where installment_plan_id = p_plano;
  if soma <> total then
    raise exception '%: a soma das parcelas (%) não fecha com o total do plano (%)',
      p_passo, soma, total;
  end if;
end;
$$;

do $$
declare
  usr uuid;
  ws uuid;
  cartao uuid;
  corrente uuid;

  tx1 uuid;    -- à vista → vira 3x → desparcela (passos 1, 3, 4)
  tx8 uuid;    -- à vista → 3x, só para provar idempotência (passo 8)
  tx9 uuid;    -- o ciclo fechado inteiro: à vista → 4x → 2x → à vista (passo 9)

  plano2 uuid; -- parcelado do zero, depois reparcelado e desmontado peça por peça (2, 5, 6, 7)
  plano3 uuid; -- nasce da conversão de tx1 (passo 3), some no passo 4
  plano8 uuid;
  plano9 uuid;

  id2_1 uuid; id2_2 uuid; id2_3 uuid;  -- ids das parcelas 1/2/3 de plano2, capturados na criação
  id9_1 uuid;

  total_esperado int := 0;
  n int;
  soma bigint;
  quantas int;
  txt text;
  d date;
begin
  -- ── fixture própria: um workspace, um cartão, uma conta corrente ───────────
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'fluxo-' || gen_random_uuid() || '@proops.test', '',
          now(), now(), now())
  returning id into usr;
  insert into public.profiles (id) values (usr) on conflict do nothing;
  insert into public.workspaces (name, owner_id) values ('Fluxo do financeiro', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, usr, 'owner') on conflict do nothing;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
  values (ws, usr, 'Cartão', 'credit_card', 3, 10) returning id into cartao;
  insert into public.accounts (workspace_id, user_id, name, type)
  values (ws, usr, 'Corrente', 'checking') returning id into corrente;

  -- ══ 1. À VISTA, SEM PARCELA ════════════════════════════════════════════════
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, category, description, merchant,
     account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 5500, 'mercado', 'Mercado do mês', 'Zaffari',
          cartao, '2026-06-05', 'app', 'pending')
  returning id into tx1;
  total_esperado := total_esperado + 1;

  if (select installment_plan_id from public.transactions where id = tx1) is not null then
    raise exception '1. um lançamento à vista não pode nascer com plano';
  end if;
  if (select invoice_id from public.transactions where id = tx1) is null then
    raise exception '1. compra no cartão precisa de fatura resolvida pelo trigger';
  end if;
  if (select count(*) from public.transactions where workspace_id = ws) <> total_esperado then
    raise exception '1. sobrou (ou faltou) lançamento no workspace: esperava %', total_esperado;
  end if;

  -- ══ 2. PARCELADO DO ZERO ════════════════════════════════════════════════
  -- 10000 em 3x não divide exato: 3333 / 3333 / 3334 — o resto exercitado logo de cara.
  plano2 := public.create_installment_plan_with_history(
    cartao, 10000, 3, '2026-07-05', 0, 'Academia', 'saude', null);
  total_esperado := total_esperado + 3;

  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano2;
  if n <> 3 then raise exception '2. deveriam ser 3 parcelas, vieram %', n; end if;
  if soma <> 10000 then raise exception '2. a soma deveria ser 10000, veio %', soma; end if;

  select id into id2_1 from public.transactions where installment_plan_id = plano2 and installment_no = 1;
  select id into id2_2 from public.transactions where installment_plan_id = plano2 and installment_no = 2;
  select id into id2_3 from public.transactions where installment_plan_id = plano2 and installment_no = 3;

  if (select amount_cents from public.transactions where id = id2_1) <> 3333
     or (select amount_cents from public.transactions where id = id2_2) <> 3333
     or (select amount_cents from public.transactions where id = id2_3) <> 3334 then
    raise exception '2. o resto não caiu na última parcela';
  end if;
  if (select occurred_at from public.transactions where id = id2_3) <> '2026-09-05' then
    raise exception '2. a parcela 3 deveria cair em 05/09, mês a mês desde 05/07';
  end if;
  if (select count(*) from public.transactions
      where installment_plan_id = plano2 and installment_no > 1 and status <> 'pending') <> 0 then
    raise exception '2. as parcelas 2..N deveriam nascer pendentes';
  end if;
  perform pg_temp.confere_plano(plano2, '2');
  if (select count(*) from public.transactions where workspace_id = ws) <> total_esperado then
    raise exception '2. sobrou (ou faltou) lançamento no workspace: esperava %', total_esperado;
  end if;

  -- ══ 3. EDITAR PONDO PARCELA — o caso da queixa ═══════════════════════════
  -- tx1 (o lançamento do passo 1) vira a parcela 1 de uma compra em 3x. 10001 em 3x:
  -- 3333 / 3333 / 3335 — o resto exercitado de novo, com outro total.
  plano3 := public.convert_transaction_to_installments(
    tx1, 10001, 3, '2026-06-05', 'Mercado corrigido', 'mercado', 'Zaffari', cartao);
  total_esperado := total_esperado + 2;  -- só as parcelas 2 e 3 são NOVAS

  -- 3a. o id de tx1 CONTINUA existindo, como parcela 1 do plano novo. É esta asserção que torna
  --     a duplicação impossível: não há linha nova para a compra virar duas.
  if (select installment_plan_id from public.transactions where id = tx1) is distinct from plano3 then
    raise exception '3a. a transação original não foi adotada pelo plano';
  end if;
  if (select installment_no from public.transactions where id = tx1) <> 1 then
    raise exception '3a. a transação original deveria ser a parcela 1';
  end if;
  if (select amount_cents from public.transactions where id = tx1) <> 3333 then
    raise exception '3a. parcela 1 deveria valer 3333, veio %',
      (select amount_cents from public.transactions where id = tx1);
  end if;
  txt := (select description from public.transactions where id = tx1);
  if txt <> 'Mercado corrigido (1/3)' then raise exception '3a. nome errado: %', txt; end if;

  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano3;
  if n <> 3 then raise exception '3b. deveriam ser 3 parcelas, vieram %', n; end if;
  if soma <> 10001 then raise exception '3b. a soma deveria ser 10001, veio %', soma; end if;
  if (select amount_cents from public.transactions where installment_plan_id = plano3 and installment_no = 3) <> 3335 then
    raise exception '3b. o resto não caiu na última parcela';
  end if;
  perform pg_temp.confere_plano(plano3, '3b');

  -- 3c. a PROVA CENTRAL: o workspace tem exatamente os lançamentos esperados — sem sobra.
  --     Se a conversão um dia voltasse a inserir uma linha nova para a parcela 1 em vez de
  --     adotar tx1, esta contagem sobraria em 1 e nada mais no arquivo pegaria isso sozinho.
  if (select count(*) from public.transactions where workspace_id = ws) <> total_esperado then
    raise exception '3c. o workspace não tem exatamente os % lançamentos esperados, tem %',
      total_esperado, (select count(*) from public.transactions where workspace_id = ws);
  end if;
  if (select count(*) from public.installment_plans where workspace_id = ws) <> 2 then
    raise exception '3c. deveriam existir 2 planos (plano2 e plano3)';
  end if;

  -- ══ 4. EDITAR TIRANDO PARCELA — dissolve plano3 de volta a um lançamento à vista ══
  quantas := public.update_installment_plan(
    plano3, 10001, 1, '2026-06-05', 'Mercado corrigido', 'mercado', 'Zaffari', cartao);
  total_esperado := total_esperado - 2;  -- as parcelas 2 e 3 somem; a 1 sobrevive

  if quantas <> 1 then raise exception '4. dissolver deveria devolver 1, devolveu %', quantas; end if;
  if (select count(*) from public.installment_plans where id = plano3) <> 0 then
    raise exception '4. o plano deveria ter sumido';
  end if;

  -- 4a. o sobrevivente é a linha ORIGINAL — mesmo id de tx1 —, solta, com o total e sem sufixo.
  if (select count(*) from public.transactions where id = tx1) <> 1 then
    raise exception '4a. o cascade levou a linha que deveria sobreviver';
  end if;
  if (select amount_cents from public.transactions where id = tx1) <> 10001 then
    raise exception '4a. a linha solta deveria valer 10001, veio %',
      (select amount_cents from public.transactions where id = tx1);
  end if;
  txt := (select description from public.transactions where id = tx1);
  if txt <> 'Mercado corrigido' then raise exception '4a. a linha solta ficou com o sufixo: %', txt; end if;
  if (select installment_plan_id from public.transactions where id = tx1) is not null
     or (select installment_no from public.transactions where id = tx1) is not null then
    raise exception '4a. a linha solta continua apontando para o plano';
  end if;
  if (select count(*) from public.transactions where workspace_id = ws) <> total_esperado then
    raise exception '4. sobrou (ou faltou) lançamento no workspace: esperava %', total_esperado;
  end if;
  if (select count(*) from public.installment_plans where workspace_id = ws) <> 1 then
    raise exception '4. deveria sobrar só o plano2';
  end if;

  -- ══ 5. REPARCELAR — plano2 de 3x para 6x, e de 6x para 2x ═══════════════
  -- 5a. 3x → 6x, total 12007: 2001 × 5 + 2002 — o resto muda de tamanho, não só de valor.
  perform public.update_installment_plan(plano2, 12007, 6, '2026-07-05', 'Academia', 'saude', null, cartao);
  total_esperado := total_esperado + 3;  -- só as parcelas 4, 5 e 6 são novas

  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano2;
  if n <> 6 then raise exception '5a. deveriam ser 6 parcelas, vieram %', n; end if;
  if soma <> 12007 then raise exception '5a. a soma deveria ser 12007, veio %', soma; end if;
  if (select amount_cents from public.transactions where installment_plan_id = plano2 and installment_no = 6) <> 2002 then
    raise exception '5a. o resto não caiu na última parcela';
  end if;
  -- as parcelas que JÁ existiam mantêm o id — é o contrato que protege o `last_write_id`.
  if (select id from public.transactions where installment_plan_id = plano2 and installment_no = 1) <> id2_1
     or (select id from public.transactions where installment_plan_id = plano2 and installment_no = 2) <> id2_2
     or (select id from public.transactions where installment_plan_id = plano2 and installment_no = 3) <> id2_3 then
    raise exception '5a. a RPC recriou parcelas que já existiam — os ids deveriam ter sido preservados';
  end if;
  perform pg_temp.confere_plano(plano2, '5a');
  if (select count(*) from public.transactions where workspace_id = ws) <> total_esperado then
    raise exception '5a. sobrou (ou faltou) lançamento no workspace: esperava %', total_esperado;
  end if;

  -- 5b. 6x → 2x, total 9999: 4999 / 5000 — o resto muda de lado de novo.
  perform public.update_installment_plan(plano2, 9999, 2, '2026-07-05', 'Academia', 'saude', null, cartao);
  total_esperado := total_esperado - 4;  -- as parcelas 3..6 somem

  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano2;
  if n <> 2 then raise exception '5b. deveriam sobrar 2 parcelas, vieram %', n; end if;
  if soma <> 9999 then raise exception '5b. a soma deveria ser 9999, veio %', soma; end if;
  if (select amount_cents from public.transactions where id = id2_1) <> 4999
     or (select amount_cents from public.transactions where id = id2_2) <> 5000 then
    raise exception '5b. o resto não caiu na última parcela em aberto';
  end if;
  -- as duas que sobrevivem continuam com o MESMO id da criação, três resizes atrás.
  if (select id from public.transactions where installment_plan_id = plano2 and installment_no = 1) <> id2_1
     or (select id from public.transactions where installment_plan_id = plano2 and installment_no = 2) <> id2_2 then
    raise exception '5b. a RPC recriou parcelas que já existiam — os ids deveriam ter sido preservados';
  end if;
  if (select count(*) from public.transactions where id = id2_3) <> 0 then
    raise exception '5b. a parcela 3 do 3x original deveria ter sido apagada no encolhimento';
  end if;
  perform pg_temp.confere_plano(plano2, '5b');
  if (select count(*) from public.transactions where workspace_id = ws) <> total_esperado then
    raise exception '5b. sobrou (ou faltou) lançamento no workspace: esperava %', total_esperado;
  end if;

  -- ══ 6. APAGAR UMA PARCELA SÓ ═════════════════════════════════════════════
  -- O mesmo caminho de `useDeleteTransaction`: um `delete` cru na linha, sem tocar no plano.
  -- ⚠️ Por isso NÃO se confere `pg_temp.confere_plano` aqui: a soma das parcelas cai abaixo do
  -- total do plano de propósito — é o comportamento real do app (o total só se corrige editando
  -- a compra inteira), não um bug deste teste.
  delete from public.transactions where id = id2_2;
  total_esperado := total_esperado - 1;

  if (select count(*) from public.transactions where id = id2_1) <> 1 then
    raise exception '6. a parcela que devia sobrar sumiu';
  end if;
  if (select count(*) from public.transactions where id = id2_2) <> 0 then
    raise exception '6. a parcela apagada continua existindo';
  end if;
  if (select count(*) from public.installment_plans where id = plano2) <> 1 then
    raise exception '6. apagar uma parcela não pode apagar o plano';
  end if;
  if (select count(*) from public.transactions where installment_plan_id = plano2) <> 1 then
    raise exception '6. deveria sobrar exatamente 1 parcela presa ao plano';
  end if;
  if (select count(*) from public.transactions where workspace_id = ws) <> total_esperado then
    raise exception '6. sobrou (ou faltou) lançamento no workspace: esperava %', total_esperado;
  end if;

  -- ══ 7. APAGAR A COMPRA INTEIRA ═══════════════════════════════════════════
  -- O mesmo caminho de `useDeleteInstallmentPlan`: apaga o PLANO, o cascade leva o resto.
  delete from public.installment_plans where id = plano2;
  total_esperado := total_esperado - 1;  -- a última parcela (id2_1) cai pelo cascade

  if (select count(*) from public.installment_plans where id = plano2) <> 0 then
    raise exception '7. o plano deveria ter sumido';
  end if;
  if (select count(*) from public.transactions where installment_plan_id = plano2) <> 0 then
    raise exception '7. sobraram parcelas presas a um plano que não existe mais';
  end if;
  if (select count(*) from public.transactions where id = id2_1) <> 0 then
    raise exception '7. a última parcela deveria ter caído pelo cascade';
  end if;
  if (select count(*) from public.transactions where workspace_id = ws) <> total_esperado then
    raise exception '7. sobrou (ou faltou) lançamento no workspace: esperava %', total_esperado;
  end if;
  if (select count(*) from public.installment_plans where workspace_id = ws) <> 0 then
    raise exception '7. não deveria sobrar plano nenhum neste ponto';
  end if;

  -- ══ 8. IDEMPOTÊNCIA — converter duas vezes é recusa, nunca um segundo plano ══
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 4200, 'Streaming', cartao, '2026-10-05', 'app', 'pending')
  returning id into tx8;
  total_esperado := total_esperado + 1;

  plano8 := public.convert_transaction_to_installments(
    tx8, 4200, 3, '2026-10-05', 'Streaming', 'assinaturas', null, cartao);
  total_esperado := total_esperado + 2;
  perform pg_temp.confere_plano(plano8, '8');

  begin
    perform public.convert_transaction_to_installments(
      tx8, 4200, 3, '2026-10-05', 'Streaming', 'assinaturas', null, cartao);
    raise exception 'FALHOU: 8. converter uma parcela pela segunda vez tinha que ser recusado';
  exception when others then
    if sqlerrm like 'FALHOU:%' or position('já é uma compra parcelada' in sqlerrm) = 0 then
      raise exception '8. recusa errada (esperava «já é uma compra parcelada»): %', sqlerrm;
    end if;
  end;

  -- a recusa não criou um segundo plano nem uma parcela a mais.
  if (select count(*) from public.installment_plans where workspace_id = ws) <> 1 then
    raise exception '8. a recusa deveria ter deixado exatamente 1 plano (plano8), achou %',
      (select count(*) from public.installment_plans where workspace_id = ws);
  end if;
  if (select count(*) from public.transactions where workspace_id = ws) <> total_esperado then
    raise exception '8. a recusa não podia mudar a contagem de lançamentos: esperava %', total_esperado;
  end if;

  -- ══ 9. O CICLO FECHADO — à vista → 4x → 2x → à vista, e nada se perde nem multiplica ══
  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, source, status)
  values (ws, usr, 'expense', 8001, 'Presente', corrente, '2026-01-05', 'app', 'pending')
  returning id into tx9;
  total_esperado := total_esperado + 1;

  -- 9a. à vista → 4x. 8001 em 4x: 2000 / 2000 / 2000 / 2001.
  plano9 := public.convert_transaction_to_installments(
    tx9, 8001, 4, '2026-01-05', 'Presente', null, null, corrente);
  total_esperado := total_esperado + 3;
  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano9;
  if n <> 4 or soma <> 8001 then raise exception '9a. 4x: % parcelas somando %', n, soma; end if;
  perform pg_temp.confere_plano(plano9, '9a');

  -- 9b. 4x → 2x. 8001 em 2x: 4000 / 4001.
  perform public.update_installment_plan(plano9, 8001, 2, '2026-01-05', 'Presente', null, null, corrente);
  total_esperado := total_esperado - 2;
  select count(*), coalesce(sum(amount_cents), 0) into n, soma
  from public.transactions where installment_plan_id = plano9;
  if n <> 2 or soma <> 8001 then raise exception '9b. 2x: % parcelas somando %', n, soma; end if;
  select id into id9_1 from public.transactions where installment_plan_id = plano9 and installment_no = 1;
  if id9_1 <> tx9 then
    raise exception '9b. a parcela 1 deveria continuar sendo o lançamento original';
  end if;
  perform pg_temp.confere_plano(plano9, '9b');

  -- 9c. 2x → à vista. É A PROVA DO CICLO FECHADO: nada se perde nem multiplica.
  quantas := public.update_installment_plan(plano9, 8001, 1, '2026-01-05', 'Presente', null, null, corrente);
  total_esperado := total_esperado - 1;

  if quantas <> 1 then raise exception '9c. desparcelar deveria devolver 1, devolveu %', quantas; end if;
  if (select count(*) from public.installment_plans where id = plano9) <> 0 then
    raise exception '9c. o plano deveria ter sumido';
  end if;
  -- o sobrevivente é o `id` ORIGINAL de tx9, com o VALOR original, sem plano e sem sufixo.
  if (select count(*) from public.transactions where id = tx9) <> 1 then
    raise exception '9c. o lançamento original sumiu — o ciclo perdeu dado';
  end if;
  if (select amount_cents from public.transactions where id = tx9) <> 8001 then
    raise exception '9c. o valor voltou errado: %',
      (select amount_cents from public.transactions where id = tx9);
  end if;
  txt := (select description from public.transactions where id = tx9);
  if txt <> 'Presente' then raise exception '9c. o nome ficou com sufixo: %', txt; end if;
  if (select installment_plan_id from public.transactions where id = tx9) is not null
     or (select installment_no from public.transactions where id = tx9) is not null then
    raise exception '9c. o lançamento continua preso a um plano que não existe mais';
  end if;
  if (select count(*) from public.transactions where workspace_id = ws) <> total_esperado then
    raise exception '9c. sobrou (ou faltou) lançamento no workspace: esperava %', total_esperado;
  end if;
  if (select count(*) from public.installment_plans where workspace_id = ws) <> 1 then
    raise exception '9c. só o plano8 deveria continuar existindo';
  end if;

  raise notice 'OK: fluxo do financeiro — 9 grupos de asserção';
end $$;

rollback;
