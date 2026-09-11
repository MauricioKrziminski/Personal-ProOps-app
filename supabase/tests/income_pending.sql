-- Receita não vira dinheiro real sozinha (`20260909110000`).
--
--   npx supabase start
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/income_pending.sql
--
-- A regra que o dono do produto enunciou: *"o saldo real não conta com o valor do Winicius ainda
-- pois ele não fez o Pix. O saldo projetado conta. Quando eu marcar recebido, ele sai do projetado
-- e vai para o real."* — e depois: *"não tem que marcar sozinho essas entradas que não for
-- salário"*.
--
-- São TRÊS afirmações independentes, e cada uma quebra sozinha:
--   1. quem tem `auto_confirm=false` não é promovido, nem vencido;
--   2. quem tem `auto_confirm=true` é (senão o salário nunca cairia);
--   3. dar baixa move o dinheiro do projetado para o real SEM mudar o total projetado —
--      se o total mudasse, o valor estaria sendo contado duas vezes em algum lugar.

\set ON_ERROR_STOP on
begin;

set local timezone to 'America/Sao_Paulo';
-- ⚠️ O relógio do teste tem que ser o MESMO do negócio.
-- Desde a `20260911030000` as funções financeiras avaliam `current_date` em BRT
-- (`alter function ... set timezone`), enquanto a sessão continua em UTC. Das 21h à meia-noite
-- as duas datas diferem, e um teste que compara "o dia 0 da projeção" com o `current_date` da
-- SESSÃO falha por um dia — sem nada de errado no código. Foi o que aconteceu com
-- `draft_scenario`, `agent_migrations` e `alert_channels` em 10/09/2026 às 21h.

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000a2';
  w uuid := '00000000-0000-0000-0000-0000000000b2';
  cc uuid := '00000000-0000-0000-0000-0000000000c3';
  serie uuid := '00000000-0000-0000-0000-0000000000f3';
  pix uuid;
  salario uuid;
  boleto uuid;
  promovidas int;
  projetado_antes bigint;
  projetado_depois bigint;
  caixa_antes bigint;
  caixa_depois bigint;
begin
  insert into auth.users (id, email) values (u, 'teste-receita@example.invalid')
    on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste receita');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (cc, w, u, 'Conta teste', 'checking', 500000);

  -- ⚠️ A série do Pix fica com `auto_confirm = TRUE` de propósito.
  --
  -- É a forma do dado ANTIGO: as 6 séries de receita nasceram ligadas (default da `0014`), e a
  -- `20260909110000` desliga a OCORRÊNCIA. Se a promoção voltasse a decidir pela série — que era
  -- como ela funcionava —, o Pix do Winicius seria promovido e o teste passaria despercebido.
  -- Com a série ligada e a linha desligada, só a implementação certa passa.
  insert into public.recurring_transactions
    (id, workspace_id, user_id, account_id, kind, amount_cents, description, category,
     rrule, dtstart, next_run_at, auto_confirm)
    values (serie, w, u, cc, 'income', 42000, 'Pix Winicius', 'outros',
            'FREQ=MONTHLY;BYMONTHDAY=5', now(), now() + interval '30 days', true);

  -- Três linhas VENCIDAS (ontem), que é o caso que morde: o Pix que não chegou.
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, due_at,
     source, status, auto_confirm, recurring_id)
  values
    (w, u, cc, 'income',  42000, 'Pix Winicius', current_date - 1, current_date - 1,
     'recurring', 'pending', false, serie),
    (w, u, cc, 'income', 148802, 'Salário CLT',  current_date - 1, current_date - 1,
     'recurring', 'pending', true, null),
    (w, u, cc, 'expense', 21430, 'Energia',      current_date - 1, current_date - 1,
     'recurring', 'pending', false, null);

  select id into pix     from public.transactions where description = 'Pix Winicius';
  select id into salario from public.transactions where description = 'Salário CLT';
  select id into boleto  from public.transactions where description = 'Energia';

  -- ── 1 e 2: quem é promovido, e quem não é ────────────────────────────────
  promovidas := public._promote_due_transactions();

  assert (select status from public.transactions where id = pix) = 'pending',
    'o Pix virou dinheiro real sem ninguém confirmar: a promoção voltou a olhar a SÉRIE em vez da linha';
  assert (select status from public.transactions where id = salario) = 'cleared',
    'salário com auto_confirm precisa cair sozinho, senão a regra virou burocracia';
  assert (select status from public.transactions where id = boleto) = 'pending',
    'despesa sem auto_confirm continua esperando baixa, como sempre';
  assert promovidas = 1, format('deveria promover só o salário; promoveu %s', promovidas);

  -- ── a regra vale para lançamento AVULSO, não só recorrente ───────────────
  --
  -- O promote antigo era `from recurring_transactions r ... and r.auto_confirm`: linha sem série
  -- nunca era olhada. Agora ele olha a LINHA, e é isso que faz o interruptor do formulário de
  -- lançamento valer alguma coisa.
  declare avulso uuid;
  begin
    insert into public.transactions
      (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, due_at,
       source, status, auto_confirm)
      values (w, u, cc, 'income', 30000, 'Freela avulso', current_date - 1, current_date - 1,
              'app', 'pending', true)
      returning id into avulso;

    perform public._promote_due_transactions();
    assert (select status from public.transactions where id = avulso) = 'cleared',
      'receita avulsa marcada para entrar sozinha também precisa ser promovida';
  end;

  -- ── 3: dar baixa move de coluna, não cria dinheiro ───────────────────────
  select private.cash_total(array[w]) into caixa_antes;
  select balance_cents into projetado_antes
    from public._cash_flow_forecast(u, 90) order by day desc limit 1;

  assert caixa_antes = (select private.cash_total(array[w])),
    'sanidade';
  -- o Pix pendente NÃO está no caixa
  assert caixa_antes = 500000 + 148802 + 30000 - 0,
    format('caixa deveria ter só o que foi confirmado; veio %s', caixa_antes);

  update public.transactions set status = 'cleared', paid_at = current_date where id = pix;

  select private.cash_total(array[w]) into caixa_depois;
  select balance_cents into projetado_depois
    from public._cash_flow_forecast(u, 90) order by day desc limit 1;

  assert caixa_depois = caixa_antes + 42000,
    format('a baixa tinha que entrar no saldo real: %s -> %s', caixa_antes, caixa_depois);
  assert projetado_depois = projetado_antes,
    format('o projetado NÃO pode mudar com a baixa (só trocou de coluna): %s -> %s',
           projetado_antes, projetado_depois);

  raise notice 'ok — receita espera confirmação, e a baixa move sem duplicar';
end $$;

rollback;
