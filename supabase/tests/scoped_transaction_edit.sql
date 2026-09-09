-- Edição com escopo (`20260909070000`) contra um Postgres de verdade.
--
--   npx supabase start
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/scoped_transaction_edit.sql
--
-- O que este arquivo protege é a única regra que o usuário enunciou em voz alta:
-- **"não edita as passadas"**. Ela vale por DUAS condições que precisam existir juntas
-- (`status = 'pending'` E `occurred_at >= a da âncora`), e cada uma sozinha deixa passar
-- um caso diferente:
--
--   • só o status deixaria passar a parcela ATRASADA de agosto (ainda pending);
--   • só a data deixaria passar a parcela ADIANTADA de dezembro (já paga).
--
-- As duas moram numa condição só no SQL; aqui elas são testadas separadas, senão a
-- remoção de qualquer uma passaria despercebida.
--
-- Roda inteiro dentro de uma transação e dá rollback: não suja o banco.

\set ON_ERROR_STOP on
begin;

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000a1';
  w uuid := '00000000-0000-0000-0000-0000000000b1';
  cc uuid := '00000000-0000-0000-0000-0000000000c1';
  card uuid := '00000000-0000-0000-0000-0000000000d1';
  plano uuid := '00000000-0000-0000-0000-0000000000e1';
  serie uuid := '00000000-0000-0000-0000-0000000000f1';
  ancora uuid;
  atrasada uuid;
  adiantada uuid;
  mexidas bigint;
  v bigint;
begin
  insert into auth.users (id, email) values (u, 'teste-escopo@example.invalid')
    on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste escopo');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta teste', 'checking', 500000);
  insert into public.accounts (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (card, w, u, 'Cartão teste', 'credit_card', 3, 10, 5000000);

  -- ── compra parcelada com as quatro situações que importam ─────────────────
  insert into public.installment_plans
    (id, workspace_id, user_id, account_id, description, total_cents, installments, first_occurred_at)
    -- Dia 3 DE PROPÓSITO: é o dia de fechamento do cartão acima, e é a forma do dado
    -- real (Nubank fecha dia 3, parcelas caem dia 3). É só nessa forma que um
    -- `set_invoice` disparado à toa move a parcela de fatura.
    values (plano, w, u, card, 'Notebook', 40000, 4, '2026-08-03');

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, source, status,
     installment_plan_id, installment_no)
  values
    -- 1/4: passada e paga
    (w, u, card, 'expense', 10000, 'Notebook', '2026-08-03', 'app', 'cleared', plano, 1),
    -- 2/4: passada e AINDA EM ABERTO (atrasada) — o caso que só o status deixaria passar
    (w, u, card, 'expense', 10000, 'Notebook', '2026-09-03', 'app', 'pending', plano, 2),
    -- 3/4: a âncora, futura e em aberto
    (w, u, card, 'expense', 10000, 'Notebook', '2026-10-03', 'app', 'pending', plano, 3),
    -- 4/4: futura mas JÁ PAGA (adiantada) — o caso que só a data deixaria passar
    (w, u, card, 'expense', 10000, 'Notebook', '2026-11-03', 'app', 'cleared', plano, 4);

  select id into ancora from public.transactions
    where installment_plan_id = plano and installment_no = 3;
  select id into atrasada from public.transactions
    where installment_plan_id = plano and installment_no = 2;
  select id into adiantada from public.transactions
    where installment_plan_id = plano and installment_no = 4;

  -- ── escopo "one": mexe só na linha aberta ────────────────────────────────
  mexidas := public.update_transaction_scoped(ancora, 'one', '{"amount_cents": 12000}'::jsonb);
  assert mexidas = 1, format('escopo one deveria mexer em 1 linha, mexeu em %s', mexidas);
  assert (select amount_cents from public.transactions where id = ancora) = 12000,
    'a âncora não recebeu o valor novo';
  assert (select amount_cents from public.transactions where id = atrasada) = 10000,
    'escopo one não pode encostar em outra parcela';

  -- ── escopo "future": a âncora e as futuras EM ABERTO, mais nada ──────────
  mexidas := public.update_transaction_scoped(ancora, 'future', '{"amount_cents": 15000}'::jsonb);
  assert mexidas = 1,
    format('só a âncora estava futura e em aberto; deveria mexer em 1, mexeu em %s', mexidas);

  assert (select amount_cents from public.transactions
          where installment_plan_id = plano and installment_no = 1) = 10000,
    'parcela 1/4 (passada e paga) não podia mudar';
  assert (select amount_cents from public.transactions where id = atrasada) = 10000,
    'parcela 2/4 está ATRASADA: é passado para o usuário e não podia mudar';
  assert (select amount_cents from public.transactions where id = adiantada) = 10000,
    'parcela 4/4 foi paga ADIANTADA: já aconteceu e não podia mudar';

  -- ── o contrato acompanha as parcelas ─────────────────────────────────────
  select total_cents into v from public.installment_plans where id = plano;
  assert v = (select sum(amount_cents) from public.transactions where installment_plan_id = plano),
    format('total do plano (%s) não é a soma das parcelas', v);

  -- ── recusas ──────────────────────────────────────────────────────────────
  begin
    perform public.update_transaction_scoped(ancora, 'todas', '{"amount_cents": 1}'::jsonb);
    raise exception 'escopo inválido deveria ter sido recusado';
  exception when others then
    assert sqlerrm like '%Escopo inválido%', format('erro inesperado: %s', sqlerrm);
  end;

  begin
    -- nome de coluna nunca chega solto num `set`: fora da allowlist é sempre erro
    perform public.update_transaction_scoped(ancora, 'one', '{"workspace_id": "x"}'::jsonb);
    raise exception 'campo fora da allowlist deveria ter sido recusado';
  exception when others then
    assert sqlerrm like '%não permitido%', format('erro inesperado: %s', sqlerrm);
  end;

  begin
    perform public.update_transaction_scoped(ancora, 'one', '{"amount_cents": 0}'::jsonb);
    raise exception 'valor zero deveria ter sido recusado';
  exception when others then
    assert sqlerrm like '%maior que zero%', format('erro inesperado: %s', sqlerrm);
  end;

  -- ── a correção de TEXTO não pode remanejar fatura ────────────────────────
  --
  -- Mencionar `account_id` no `set` já dispara `set_invoice` — o Postgres olha as
  -- colunas do `set`, não as que mudaram de valor. Com dado recém-inserido isso é
  -- inofensivo: o gatilho recalcula e chega no mesmo lugar.
  --
  -- O caso que MORDE é a linha cuja fatura gravada discorda do que a regra calcula
  -- HOJE — dado escrito antes da `20260909050000`, que corrigiu o dia do fechamento
  -- por um caractere. A `050000` diz explicitamente que remanejar as linhas existentes
  -- é "decisão separada, feita linha a linha"; fazer isso em lote como efeito colateral
  -- de uma correção de texto é o oposto. Aqui a divergência é forçada à mão, que é a
  -- única forma de reproduzir dado antigo num banco novo.
  declare
    fatura_antes uuid;
    outra uuid;
  begin
    select id into outra from public.card_invoices
      where account_id = card and id is distinct from
            (select invoice_id from public.transactions where id = ancora)
      limit 1;
    if outra is null then
      -- só há uma fatura no cartão: cria a do mês seguinte movendo uma compra solta
      insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents,
                                       description, occurred_at, source, status)
        values (w, u, card, 'expense', 100, 'semente', '2026-12-20', 'app', 'cleared');
      select invoice_id into outra from public.transactions
        where account_id = card and description = 'semente';
    end if;

    update public.transactions set invoice_id = outra where id = ancora;
    fatura_antes := outra;

    perform public.update_transaction_scoped(ancora, 'one', '{"description": "Notebook novo"}'::jsonb);
    assert (select invoice_id from public.transactions where id = ancora) is not distinct from fatura_antes,
      'corrigir a descrição remanejou a parcela de fatura — set_invoice disparou à toa';
  end;

  -- e o contrato do plano acompanha o que a TELA mostra, não só o total
  assert (select description from public.installment_plans where id = plano) = 'Notebook novo',
    'a lista de Parcelamentos ficaria com o nome velho sobre parcelas já renomeadas';

  -- ── transferência não troca de conta por aqui ────────────────────────────
  --
  -- Ela tem DUAS contas e um check que proíbe as duas iguais: por aqui daria 23514 cru
  -- (que a tela não traduz) ou, com null, uma transferência sem origem.
  declare
    poupanca uuid := '00000000-0000-0000-0000-0000000000c2';
    transf uuid;
  begin
    insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
      values (poupanca, w, u, 'Poupança teste', 'savings', 0);
    insert into public.transactions
      (workspace_id, user_id, account_id, counterparty_account_id, kind, amount_cents,
       description, occurred_at, source, status)
      values (w, u, cc, poupanca, 'transfer', 20000, 'Reserva', '2026-09-01', 'app', 'cleared')
      returning id into transf;

    perform public.update_transaction_scoped(transf, 'one', format('{"account_id": "%s"}', poupanca)::jsonb);
    raise exception 'transferência deveria ter sido recusada';
  exception when others then
    assert sqlerrm like '%ransfer%', format('erro inesperado: %s', sqlerrm);
  end;

  -- ── conta de outro workspace não entra ───────────────────────────────────
  begin
    perform public.update_transaction_scoped(
      ancora, 'one', '{"account_id": "00000000-0000-0000-0000-0000000000ff"}'::jsonb);
    raise exception 'conta fora do workspace deveria ter sido recusada';
  exception when others then
    assert sqlerrm like '%mesmo workspace%', format('erro inesperado: %s', sqlerrm);
  end;

  -- ── série recorrente: a regra E as ocorrências futuras ───────────────────
  insert into public.recurring_transactions
    (id, workspace_id, user_id, account_id, kind, amount_cents, description, category,
     rrule, dtstart, next_run_at, auto_confirm)
    values (serie, w, u, cc, 'expense', 150000, 'Aluguel', 'moradia',
            'FREQ=MONTHLY;BYMONTHDAY=5', now(), now() + interval '30 days', true);

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, source,
     status, recurring_id)
  values
    (w, u, cc, 'expense', 150000, 'Aluguel', current_date - 30, 'recurring', 'cleared', serie),
    (w, u, cc, 'expense', 150000, 'Aluguel', current_date + 30, 'recurring', 'pending', serie),
    (w, u, cc, 'expense', 150000, 'Aluguel', current_date + 60, 'recurring', 'pending', serie);

  mexidas := public.update_recurring_series(serie, '{"amount_cents": 160000}'::jsonb, true);
  assert mexidas = 2, format('deveria propagar para as 2 futuras, propagou para %s', mexidas);

  assert (select amount_cents from public.recurring_transactions where id = serie) = 160000,
    'a REGRA precisa mudar: é ela que gera os meses além do horizonte materializado';
  assert (select count(*) from public.transactions
          where recurring_id = serie and amount_cents = 160000) = 2,
    'as duas ocorrências futuras deveriam ter o valor novo';
  assert (select amount_cents from public.transactions
          where recurring_id = serie and occurred_at < current_date) = 150000,
    'a ocorrência do mês passado não podia mudar';

  raise notice 'ok — edição com escopo respeita o passado nos dois sentidos';
end $$;

rollback;
