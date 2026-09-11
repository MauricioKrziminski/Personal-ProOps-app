-- `public.roll_invoice` — adiar o saldo de uma fatura vencida para a próxima.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/roll_invoice.sql
--
-- A asserção que carrega esta feature é a 5: **o dinheiro sai do caixa UMA vez**. Sem ela, a
-- fatura adiada continuaria pesando no vencimento (ela é `status <> 'paid'`) e o principal
-- entraria de novo na fatura seguinte — o mesmo valor cobrado duas vezes, sem erro na tela.

\set ON_ERROR_STOP on
begin;

do $$
declare
  ws uuid; usr uuid; cartao uuid; conta uuid;
  fat uuid; destino uuid;
  r jsonb;
  n int; v bigint;
begin
  select id into usr from auth.users limit 1;
  insert into public.workspaces (name, owner_id) values ('teste rotativo', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');

  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Conta', 'checking', 500000) returning id into conta;
  insert into public.accounts
    (workspace_id, user_id, name, type, closing_day, due_day, payment_account_id)
    values (ws, usr, 'Cartao', 'credit_card', 3, 10, conta) returning id into cartao;

  -- uma compra que cai na fatura que fechou 03/08 e venceu 10/08 (já vencida)
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, category, description, occurred_at, status)
    values (ws, usr, cartao, 'expense', 100000, 'outros', 'Compra', '2026-07-15', 'pending');
  select invoice_id into fat from public.transactions
    where workspace_id = ws and description = 'Compra';
  update public.card_invoices set status = 'closed' where id = fat;

  -- 1. adiar devolve principal, IOF calculado e nenhum juro (o cartão não tem taxa)
  r := public.roll_invoice(fat);
  if (r->>'principal_cents')::bigint <> 100000 then
    raise exception '1. principal deveria ser 100000, veio %', r->>'principal_cents';
  end if;
  if (r->>'juros_cents')::bigint <> 0 or (r->>'sem_taxa')::boolean is not true then
    raise exception '1. sem taxa no cartão o app NÃO pode inventar juros: %', r;
  end if;
  -- IOF: 0,38% + 0,0082%/dia sobre 31 dias = 0,6342% -> 634
  if (r->>'iof_cents')::bigint <> 634 then
    raise exception '1. IOF é lei e deveria ser 634 (0,38%% + 0,0082%%/dia x 31), veio %', r->>'iof_cents';
  end if;

  -- 2. a origem ficou adiada e aponta para o destino
  select rolled_into_invoice_id into destino from public.card_invoices where id = fat;
  if destino is null then raise exception '2. a fatura adiada tem que apontar para o destino'; end if;
  if (select status from public.card_invoices where id = fat) <> 'rolled' then
    raise exception '2. a origem deveria ficar rolled';
  end if;

  -- 3. o destino é a fatura SEGUINTE, resolvida pelo trigger do ciclo (fecha 3, vence 10)
  if (select due_date from public.card_invoices where id = destino) <> '2026-09-10' then
    raise exception '3. o destino deveria vencer 10/09, veio %',
      (select due_date from public.card_invoices where id = destino);
  end if;

  -- 4. o principal entrou no destino e está marcado como dívida que mudou de fatura
  select count(*), coalesce(sum(amount_cents),0) into n, v from public.transactions
    where invoice_id = destino and rollover_of_invoice_id = fat;
  if n <> 1 or v <> 100000 then
    raise exception '4. esperava 1 linha de 100000 no destino, veio % linha(s) de %', n, v;
  end if;

  -- 5. ⚠️ O CAIXA SAI UMA VEZ SÓ. A origem some da projeção; o destino carrega o valor.
  select coalesce(sum(out_cents),0) into v from public._cash_flow_forecast(usr, 400)
    where day between '2026-08-01' and '2026-12-31';
  if v <> 100634 then
    raise exception '5. o caixa deveria sair UMA vez (100000 + 634 de IOF), saiu %', v;
  end if;

  -- 6. COMPETÊNCIA CONTA A COMPRA UMA VEZ SÓ, no mês em que ela foi feita.
  --    Julho vê os 100000 da compra. Agosto (onde o adiamento acontece, na data de vencimento
  --    da origem) vê só o IOF — o principal está lá como lançamento, para o total da fatura
  --    fechar, mas `rollover_of_invoice_id` o tira das visões de competência. Sem isso a mesma
  --    compra inflaria dois meses e comeria o orçamento duas vezes.
  select coalesce(sum(amount_cents),0) into v
    from private.month_lines_for(array[ws], '2026-07-01') where kind = 'expense';
  if v <> 100000 then
    raise exception '6a. julho (mês da compra) deveria ver 100000, viu %', v;
  end if;
  select coalesce(sum(amount_cents),0) into v
    from private.month_lines_for(array[ws], '2026-08-01') where kind = 'expense';
  if v <> 634 then
    raise exception '6b. agosto deveria ver só o IOF (634) — o principal não é compra nova, viu %', v;
  end if;

  -- 6c. o orçamento segue a mesma régua
  insert into public.budgets (workspace_id, user_id, category, limit_cents)
    values (ws, usr, 'contas', 500000);
  select coalesce(sum(spent_cents),0) into v
    from private.budgets_status_for(array[ws], '2026-08-01') where category = 'contas';
  if v <> 0 then
    raise exception '6c. o principal adiado não pode comer o orçamento de novo, comeu %', v;
  end if;

  -- 7. adiar a MESMA fatura de novo é recusado (duplicaria o saldo)
  begin
    r := public.roll_invoice(fat);
    raise exception '7. adiar a mesma fatura duas vezes tinha que falhar';
  exception when others then
    if sqlerrm not like '%já foi para a próxima%' then raise; end if;
  end;

  -- 8. adiar a fatura SEGUINTE é PERMITIDO e avisa que é o segundo ciclo.
  --    O Nubank faz isso; a Resolução 4.549 obriga o BANCO, não o app. Travar aqui tornaria
  --    impossível registrar o que de fato aconteceu na conta da pessoa.
  update public.card_invoices set status = 'closed' where id = destino;
  r := public.roll_invoice(destino);
  if (r->>'segundo_ciclo')::boolean is not true then
    raise exception '8. o segundo adiamento seguido tem que ser sinalizado: %', r;
  end if;

  raise notice 'OK: roll_invoice — 10 asserções';
end $$;

rollback;
