-- Duas mudanças de 11/09/2026, as duas em caminho de DINHEIRO:
--
--   `20260911130000` — ver por mês civil ou pelo ciclo vira escolha (`workspaces.cycle_view`),
--                      aplicada num ponto só (`private.cycle_close_day` devolve null no civil),
--                      e `budgets_status_for` finalmente segue a régua.
--   `20260911140000` — `accounts.closing_day_inclusive` decide em qual fatura cai a compra
--                      feita NO dia do fechamento, porque isso varia por emissor.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/regua_e_dia_do_fechamento.sql

\set ON_ERROR_STOP on
begin;

set local timezone to 'America/Sao_Paulo';
-- ⚠️ Mesmo motivo de `orcamento_e_graca.sql`: as funções financeiras avaliam `current_date` em
-- BRT desde a `20260911030000`, e das 21h à meia-noite a sessão em UTC discorda por um dia.

-- =============================================================================================
-- 1. A borda do dia do fechamento — função pura, sem fixture
-- =============================================================================================
do $$
declare
  w record;
begin
  -- fecha dia 3, vence dia 10.

  -- compra NO dia do fechamento, modo padrão: já é da próxima fatura
  select * into w from private.invoice_window(3, 10, date '2026-09-03', false);
  if w.reference_month <> date '2026-10-01' or w.due_date <> date '2026-10-10' then
    raise exception 'exclusivo: 03/09 devia ir para a fatura de outubro; veio % / %',
      w.reference_month, w.due_date;
  end if;

  -- o MESMO dia, com o cartão marcado como inclusivo: ainda é da fatura que fecha hoje
  select * into w from private.invoice_window(3, 10, date '2026-09-03', true);
  if w.reference_month <> date '2026-09-01' or w.due_date <> date '2026-09-10' then
    raise exception 'inclusivo: 03/09 devia ficar na fatura de setembro; veio % / %',
      w.reference_month, w.due_date;
  end if;

  -- ⚠️ A chave move UM dia, não o ciclo inteiro. Fora do dia do fechamento os dois modos têm
  -- que responder igual — senão trocar a chave remontaria o mês todo.
  for i in 1..28 loop
    if i <> 3 then
      if (select reference_month from private.invoice_window(3, 10, date '2026-09-01' + (i - 1), false))
         is distinct from
         (select reference_month from private.invoice_window(3, 10, date '2026-09-01' + (i - 1), true))
      then
        raise exception 'dia %/09: os dois modos deviam concordar fora do fechamento', i;
      end if;
    end if;
  end loop;

  -- o default da assinatura é o comportamento histórico (`<`), para chamador de 3 args não mudar
  select * into w from private.invoice_window(3, 10, date '2026-09-03');
  if w.reference_month <> date '2026-10-01' then
    raise exception 'o default de p_inclusive tem que ser false; veio %', w.reference_month;
  end if;

  raise notice 'ok 1 — o dia do fechamento é configurável e move exatamente um dia';
end $$;

-- =============================================================================================
-- 2. O trigger lê a chave do CARTÃO — o teste que prova que a coluna está ligada no caminho real
-- =============================================================================================
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000a7';
  w uuid := '00000000-0000-0000-0000-0000000000b7';
  c_excl uuid := '00000000-0000-0000-0000-0000000000c7';
  c_incl uuid := '00000000-0000-0000-0000-0000000000d7';
  venc_excl date; venc_incl date;
begin
  insert into auth.users (id, email) values (u, 'teste-regua@example.invalid') on conflict do nothing;
  insert into public.profiles (id) values (u) on conflict do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste régua');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');

  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day, closing_day_inclusive)
    values (c_excl, w, u, 'Cartão padrão', 'credit_card', 3, 10, false),
           (c_incl, w, u, 'Cartão inclusivo', 'credit_card', 3, 10, true);

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, source)
  values (w, u, c_excl, 'expense', 5000, 'no dia do fechamento', date '2026-09-03', 'app'),
         (w, u, c_incl, 'expense', 5000, 'no dia do fechamento', date '2026-09-03', 'app');

  select ci.due_date into venc_excl
    from public.transactions t join public.card_invoices ci on ci.id = t.invoice_id
    where t.account_id = c_excl;
  select ci.due_date into venc_incl
    from public.transactions t join public.card_invoices ci on ci.id = t.invoice_id
    where t.account_id = c_incl;

  if venc_excl <> date '2026-10-10' then
    raise exception 'cartão padrão: devia cair na fatura de 10/10; veio %', venc_excl;
  end if;
  if venc_incl <> date '2026-09-10' then
    raise exception 'cartão inclusivo: devia cair na fatura de 10/09; veio %', venc_incl;
  end if;

  raise notice 'ok 2 — o trigger usa a chave do cartão, não uma constante';
end $$;

-- =============================================================================================
-- 3. A régua de leitura: uma preferência, aplicada num ponto só
-- =============================================================================================
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000a8';
  w uuid := '00000000-0000-0000-0000-0000000000b8';
  cc uuid := '00000000-0000-0000-0000-0000000000c8';
  ini date; fim date; dia int;
  gasto bigint; limite bigint;
begin
  insert into auth.users (id, email) values (u, 'teste-regua2@example.invalid') on conflict do nothing;
  insert into public.profiles (id) values (u) on conflict do nothing;
  insert into public.workspaces (id, owner_id, name, cycle_close_day, cycle_view)
    values (w, u, 'Teste ciclo', 10, 'cycle');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta', 'checking', 1000000);

  -- duas despesas de 'casa': uma em 15/08 (só no ciclo), outra em 20/09 (só no mês civil)
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, category, description, occurred_at, source, status)
  values (w, u, cc, 'expense', 10000, 'casa', 'dentro do ciclo', date '2026-08-15', 'app', 'cleared'),
         (w, u, cc, 'expense', 70000, 'casa', 'dentro do mês civil', date '2026-09-20', 'app', 'cleared');

  -- ⚠️ o override do mês é chaveado pelo RÓTULO (01/09), não pelo início da janela (11/08)
  insert into public.budgets (workspace_id, user_id, category, limit_cents, month)
    values (w, u, 'casa', 123400, date '2026-09-01');

  -- --- modo ciclo: setembro é 11/08 a 10/09 ---------------------------------------------------
  dia := private.cycle_close_day(array[w]);
  if dia is distinct from 10 then
    raise exception 'modo cycle: cycle_close_day devia ser 10; veio %', dia;
  end if;
  select b.ini, b.fim into ini, fim from private.cycle_bounds(dia, date '2026-09-01') b;
  if ini <> date '2026-08-11' or fim <> date '2026-09-10' then
    raise exception 'ciclo de setembro devia ser 11/08–10/09; veio %–%', ini, fim;
  end if;

  select spent_cents, limit_cents into gasto, limite
    from private.budgets_status_for(array[w], date '2026-09-01') where category = 'casa';
  if gasto <> 10000 then
    raise exception 'ciclo: o gasto de setembro devia ser só o de 15/08 (10000); veio %', gasto;
  end if;
  if limite <> 123400 then
    raise exception 'ciclo: o override do rótulo 01/09 devia valer; veio %', limite;
  end if;

  -- `ref_month` é um DIA qualquer do período, e 05/09 cai no MESMO ciclo que 01/09
  select spent_cents into gasto
    from private.budgets_status_for(array[w], date '2026-09-05') where category = 'casa';
  if gasto <> 10000 then
    raise exception 'ciclo: 05/09 devia responder pelo mesmo ciclo; veio %', gasto;
  end if;

  -- ...e 15/09 já pertence ao ciclo SEGUINTE (11/09–10/10), que não tem nenhuma das duas
  select coalesce(sum(spent_cents), 0) into gasto
    from private.budgets_status_for(array[w], date '2026-09-15') where category = 'casa';
  if gasto <> 0 then
    raise exception 'ciclo: 15/09 já é outubro e não devia ter gasto; veio %', gasto;
  end if;

  -- --- modo civil: a MESMA configuração, lida do dia 1 ao 30 ----------------------------------
  update public.workspaces set cycle_view = 'civil' where id = w;

  if private.cycle_close_day(array[w]) is not null then
    raise exception 'modo civil: cycle_close_day tinha que ser null';
  end if;
  -- ⚠️ e o dia configurado NÃO foi apagado — é o que deixa o caminho de volta existir
  if (select cycle_close_day from public.workspaces where id = w) is distinct from 10 then
    raise exception 'trocar a régua não pode apagar o dia configurado';
  end if;

  select b.ini, b.fim into ini, fim
    from private.cycle_bounds(private.cycle_close_day(array[w]), date '2026-09-01') b;
  if ini <> date '2026-09-01' or fim <> date '2026-09-30' then
    raise exception 'civil: setembro devia ser 01/09–30/09; veio %–%', ini, fim;
  end if;

  select spent_cents into gasto
    from private.budgets_status_for(array[w], date '2026-09-01') where category = 'casa';
  if gasto <> 70000 then
    raise exception 'civil: o gasto de setembro devia ser o de 20/09 (70000); veio %', gasto;
  end if;

  raise notice 'ok 3 — a régua é uma preferência, e o orçamento obedece ela';
end $$;

-- =============================================================================================
-- 4. `p_view` manda na leitura, e `null` continua obedecendo o padrão gravado
-- =============================================================================================
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000a9';
  w uuid := '00000000-0000-0000-0000-0000000000b9';
  cc uuid := '00000000-0000-0000-0000-0000000000c9';
  g_padrao bigint; g_civil bigint; g_ciclo bigint;
begin
  insert into auth.users (id, email) values (u, 'teste-pview@example.invalid') on conflict do nothing;
  insert into public.profiles (id) values (u) on conflict do nothing;
  -- padrão GRAVADO = ciclo, fechamento no dia 10
  insert into public.workspaces (id, owner_id, name, cycle_close_day, cycle_view)
    values (w, u, 'Teste p_view', 10, 'cycle');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta', 'checking', 1000000);
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, category, description, occurred_at, source, status)
  values (w, u, cc, 'expense', 10000, 'casa', 'só no ciclo', date '2026-08-15', 'app', 'cleared'),
         (w, u, cc, 'expense', 70000, 'casa', 'só no mês civil', date '2026-09-20', 'app', 'cleared');
  insert into public.budgets (workspace_id, user_id, category, limit_cents, month)
    values (w, u, 'casa', 500000, null);

  -- null = o padrão gravado (ciclo)
  select spent_cents into g_padrao
    from private.budgets_status_for(array[w], date '2026-09-01') where category = 'casa';
  -- 'civil' IGNORA o padrão gravado
  select spent_cents into g_civil
    from private.budgets_status_for(array[w], date '2026-09-01', 'civil') where category = 'casa';
  -- 'cycle' pede o ciclo explicitamente
  select spent_cents into g_ciclo
    from private.budgets_status_for(array[w], date '2026-09-01', 'cycle') where category = 'casa';

  if g_padrao <> 10000 then
    raise exception 'p_view null devia seguir o padrão gravado (ciclo, 10000); veio %', g_padrao;
  end if;
  if g_civil <> 70000 then
    raise exception 'p_view civil devia ignorar o padrão gravado (70000); veio %', g_civil;
  end if;
  if g_ciclo <> 10000 then
    raise exception 'p_view cycle devia dar o ciclo (10000); veio %', g_ciclo;
  end if;

  -- ⚠️ a mesma régua tem que valer nas OUTRAS leituras, não só no orçamento
  if (select count(*) from private.month_lines_for(array[w], date '2026-09-01', 'civil')
      where title = 'só no mês civil') <> 1 then
    raise exception 'month_lines_for não respeitou p_view civil';
  end if;
  if (select count(*) from private.month_lines_for(array[w], date '2026-09-01', 'cycle')
      where title = 'só no ciclo') <> 1 then
    raise exception 'month_lines_for não respeitou p_view cycle';
  end if;
  if (select expense_cents from private.month_summary_for(array[w], date '2026-09-01', 'civil')) <> 70000 then
    raise exception 'month_summary_for não respeitou p_view civil';
  end if;

  raise notice 'ok 4 — p_view manda na leitura e null continua obedecendo o padrão gravado';
end $$;

rollback;
