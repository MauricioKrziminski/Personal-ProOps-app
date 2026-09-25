-- `public._roll_overdue_invoices` — o adiamento AUTOMÁTICO, o que roda sem ninguém olhando.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/roll_overdue_cron.sql
--
-- O caminho manual é conferido por quem toca no botão; este não tem revisor. Ele decide sozinho,
-- de hora em hora, mexer no saldo e na projeção de quem ligou a opção — e as três formas de
-- errar aqui são caras e silenciosas: pegar cartão de quem NÃO ligou, adiar no PRÓPRIO dia do
-- vencimento (quando pagar ainda é o normal), e adiar de novo o que já foi adiado.

\set ON_ERROR_STOP on
begin;

set local timezone to 'America/Sao_Paulo';
-- O cron avalia `current_date` em BRT (`alter function ... set timezone`, `20260911030000`).
-- Com a sessão em UTC, das 21h à meia-noite o teste compara dois dias diferentes.

do $$
declare
  ws uuid; usr uuid; conta uuid; com_auto uuid; sem_auto uuid;
  n int;
  -- ⚠️ A compra é datada a partir de HOJE (25/09/2026). Cravada em 15/07, ela servia enquanto a
  -- fatura SEGUINTE (10/09) ainda não tinha vencido; depois disso a 2ª passada do cron adiava
  -- aquela outra fatura, com razão, e o passo 3 acusava falta de idempotência sem defeito nenhum.
  -- `vencida` é o último dia 10 ANTES de hoje; a compra cai no dia 15 do mês anterior a ele, que
  -- é exatamente a fatura que fecha no dia 3 e vence nesse dia 10 — e a seguinte ainda não venceu.
  vencida date := (date_trunc('month', current_date - 10) + interval '9 days')::date;
  compra date := (date_trunc('month', (date_trunc('month', current_date - 10) + interval '9 days')::date
                  - interval '1 month') + interval '14 days')::date;
begin
  select id into usr from auth.users limit 1;
  insert into public.workspaces (name, owner_id) values ('teste cron rotativo', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Conta', 'checking', 1000000) returning id into conta;

  -- Dois cartões idênticos; só um tem o interruptor ligado.
  insert into public.accounts
    (workspace_id, user_id, name, type, closing_day, due_day, payment_account_id, rotativo_auto)
    values (ws, usr, 'Com auto', 'credit_card', 3, 10, conta, true) returning id into com_auto;
  insert into public.accounts
    (workspace_id, user_id, name, type, closing_day, due_day, payment_account_id, rotativo_auto)
    values (ws, usr, 'Sem auto', 'credit_card', 3, 10, conta, false) returning id into sem_auto;

  -- Uma compra vencida em cada: a fatura dela fecha no dia 3 e venceu em `vencida`.
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, category, description, occurred_at, status)
  values (ws, usr, com_auto, 'expense', 50000, 'outros', 'Compra A', compra, 'pending'),
         (ws, usr, sem_auto, 'expense', 50000, 'outros', 'Compra B', compra, 'pending');
  if not exists (select 1 from public.card_invoices where account_id = com_auto and due_date = vencida) then
    raise exception '0. a compra de % não caiu na fatura que vence em %', compra, vencida;
  end if;
  update public.card_invoices set status = 'closed'
    where account_id in (com_auto, sem_auto);

  -- 1. Roda o cron: adia UMA fatura, a do cartão que optou.
  n := public._roll_overdue_invoices();
  if n < 1 then raise exception '1. o cron deveria ter adiado ao menos uma fatura, adiou %', n; end if;
  if not exists (select 1 from public.card_invoices
                 where account_id = com_auto and status = 'rolled') then
    raise exception '1a. a fatura do cartão COM auto deveria ter sido adiada';
  end if;

  -- 2. ⚠️ Cartão sem o interruptor NÃO é tocado. Ligado para todos, um cartão pago em dia
  --    nunca mais apareceria como atrasado — o aviso sumiria de quem não precisa da feature.
  if exists (select 1 from public.card_invoices
             where account_id = sem_auto and status = 'rolled') then
    raise exception '2. o cron mexeu num cartão que não pediu adiamento automático';
  end if;

  -- 3. Idempotente: a segunda passada não acha mais nada naquele cartão.
  --    Sem isso, um cron que roda duas vezes (ou é reprocessado) empilharia saldo em cima de
  --    saldo, com juros e IOF em cima de cada um.
  select count(*) into n from public.card_invoices
    where account_id = com_auto and status = 'rolled';
  perform public._roll_overdue_invoices();
  if (select count(*) from public.card_invoices
      where account_id = com_auto and status = 'rolled') <> n then
    raise exception '3. rodar o cron de novo adiou fatura outra vez — não é idempotente';
  end if;

  -- 4. Fatura que vence HOJE não é adiada. Pagar no próprio dia do vencimento é o normal, e
  --    adiar às 00h05 seria o app decidindo por quem ainda vai pagar à tarde. É a diferença
  --    entre `due_date < current_date` e `<=`.
  update public.card_invoices set due_date = current_date, status = 'closed'
    where account_id = sem_auto;
  update public.accounts set rotativo_auto = true where id = sem_auto;
  perform public._roll_overdue_invoices();
  if exists (select 1 from public.card_invoices
             where account_id = sem_auto and status = 'rolled') then
    raise exception '4. fatura que vence HOJE não pode ser adiada pelo cron';
  end if;

  -- 5. Fatura vencida mas sem saldo em aberto não vira lançamento de R$ 0,00.
  update public.card_invoices
     set due_date = current_date - 5, paid_cents = 50000
   where account_id = sem_auto;
  perform public._roll_overdue_invoices();
  if exists (select 1 from public.card_invoices
             where account_id = sem_auto and status = 'rolled') then
    raise exception '5. fatura sem saldo em aberto não tem o que adiar';
  end if;

  raise notice 'OK: _roll_overdue_invoices — 6 asserções';
end $$;

rollback;
