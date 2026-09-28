-- O gasto por dia é a MESMA régua de `transactions_summary`, dia a dia (a barra de hoje da semana
-- da Hoje é o "saiu hoje"), todo dia da janela volta, e ninguém enxerga o dia de outro workspace.
-- Roda como `authenticated`, nunca como dono do banco (a lição da `20260911220000`).
--
--     agent/.venv/bin/python scripts/sql-test.py supabase/tests/gasto_por_dia.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000d1a1';
  stranger uuid := '00000000-0000-0000-0000-00000000d1a2';
  w uuid := '00000000-0000-0000-0000-00000000d1b1';
  w2 uuid := '00000000-0000-0000-0000-00000000d1b2';
  -- Um ano sem dado de ninguém: o teste roda no staging, com dado real ao lado.
  d0 date := '1990-03-10';
  dia record;
  resumo bigint;
  linhas int;
begin
  insert into auth.users(id,email) values
    (u,'gasto-por-dia-owner@example.invalid'),
    (stranger,'gasto-por-dia-stranger@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values (u),(stranger) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Gasto por dia'),(w2,stranger,'Outro');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner'),(w2,stranger,'owner');

  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,occurred_at,source,status) values
    (w,u,'expense',1000,'mercado',d0 + 1,'app','cleared'),
    -- previsto entra, como no `transactions_summary`: a régua é o total, não o realizado
    (w,u,'expense',500,'luz',d0 + 1,'app','pending'),
    (w,u,'income',3000,'pix',d0 + 1,'app','cleared'),
    (w,u,'expense',250,'café',d0 + 2,'app','cleared'),
    -- fora da janela e de outro workspace: não podem aparecer
    (w,u,'expense',777,'antes',d0 - 1,'app','cleared'),
    (w2,stranger,'expense',9999,'alheio',d0 + 1,'app','cleared');
  -- Transferência não é gasto nem entrada (precisa de conta de origem e destino).
  insert into public.accounts(id,workspace_id,user_id,name,type) values
    ('00000000-0000-0000-0000-00000000d1c1',w,u,'Corrente','checking'),
    ('00000000-0000-0000-0000-00000000d1c2',w,u,'Poupança','savings');
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,occurred_at,source,status,account_id,counterparty_account_id)
  values (w,u,'transfer',4242,'guardar',d0 + 1,'app','cleared',
    '00000000-0000-0000-0000-00000000d1c1','00000000-0000-0000-0000-00000000d1c2');

  -- A interna é do agente: o app não a executa.
  assert not has_function_privilege('authenticated','public._daily_spending(uuid,date,date)','execute'),
    'authenticated não pode executar a interna';
  assert (select count(*) from public._daily_spending(u, d0, d0 + 2) where expense_cents = 1500 and day = d0 + 1) = 1,
    'a interna responde pelo uid';
  begin
    perform 1 from public._daily_spending(u, d0, d0 + 62);
    raise exception 'janela sem teto aceita na interna';
  exception when others then
    if sqlerrm = 'janela sem teto aceita na interna' then raise; end if;
    assert sqlstate = '22023', sqlstate;
  end;

  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);

  select count(*) into linhas from public.daily_spending(d0, d0 + 2);
  assert linhas = 3, format('todo dia da janela volta, inclusive o zerado (veio %s)', linhas);
  assert (select expense_cents = 0 and income_cents = 0 from public.daily_spending(d0, d0 + 2) where day = d0),
    'o dia sem nada é zero, não some';
  assert (select expense_cents = 1500 and income_cents = 3000 from public.daily_spending(d0, d0 + 2) where day = d0 + 1),
    'gasto com o previsto, entrada à parte, sem a transferência nem o dia de fora';

  -- A MESMA régua do "saiu hoje": cada dia bate com `transactions_summary(dia, dia)`, nos dois lados.
  for dia in select * from public.daily_spending(d0, d0 + 2) loop
    select coalesce(sum(total_cents) filter (where kind = 'expense'), 0) into resumo
    from public.transactions_summary(dia.day, dia.day);
    assert dia.expense_cents = resumo,
      format('%s: gasto %s vs transactions_summary %s', dia.day, dia.expense_cents, resumo);
    select coalesce(sum(total_cents) filter (where kind = 'income'), 0) into resumo
    from public.transactions_summary(dia.day, dia.day);
    assert dia.income_cents = resumo,
      format('%s: entrada %s vs transactions_summary %s', dia.day, dia.income_cents, resumo);
  end loop;

  begin
    perform 1 from public.daily_spending(d0, d0 + 62);
    raise exception 'janela sem teto aceita';
  exception when others then
    if sqlerrm = 'janela sem teto aceita' then raise; end if;
    assert sqlstate = '22023', sqlstate;
  end;
  -- Invertida ou nula é recusada, nunca devolvida vazia em silêncio.
  begin
    perform 1 from public.daily_spending(d0 + 2, d0);
    raise exception 'janela invertida aceita';
  exception when others then
    if sqlerrm = 'janela invertida aceita' then raise; end if;
    assert sqlstate = '22023', sqlstate;
  end;
  begin
    perform 1 from public.daily_spending(null, d0);
    raise exception 'janela nula aceita';
  exception when others then
    if sqlerrm = 'janela nula aceita' then raise; end if;
    assert sqlstate = '22023', sqlstate;
  end;
  assert (select count(*) from public.daily_spending(d0, d0)) = 1, 'um dia só é uma linha';
  assert (select count(*) from public.daily_spending(d0, d0 + 61)) = 62, 'o teto é 62 dias, inclusive';

  perform set_config('request.jwt.claim.sub',stranger::text,true);
  assert (select expense_cents from public.daily_spending(d0 + 1, d0 + 1)) = 9999,
    'o estranho só vê o dia do workspace dele';
end $$;
rollback;
