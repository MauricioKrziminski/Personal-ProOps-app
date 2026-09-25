-- `public._prepare_import_batch` — o que sobrou dela depois da importação inteligente.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/import_near_match.sql
--
-- ⚠️ **O casamento com o que já está no app NÃO mora mais aqui** (`20260922150000`). Ele foi para
-- `agent/app/domain/reconcile.py`, em cascata e 1-para-1, e os casos que este arquivo testava
-- (exato, data fora por 2 dias, empate que pergunta, 1-para-1, outra conta, novo) estão em
-- `agent/tests/test_reconcile.py`. Este teste afirmava que a função ainda marcava duplicata — o
-- contrário da decisão escrita na migration: duas réguas de "já está no app" divergiriam, e
-- divergir aqui é duplicar dinheiro. Ele falhava desde 22/09 (25/09/2026).
--
-- O contrato de hoje, que é o que se prende: aplica a REGRA do usuário (categoria e conta
-- sugeridas), não sobrescreve o que o agente já sugeriu, e não toca no status que o agente gravou.

\set ON_ERROR_STOP on
begin;

do $$
declare
  ws uuid; usr uuid; cartao uuid; outra uuid; lote uuid;
  r record;
begin
  select id into usr from auth.users limit 1;
  insert into public.workspaces (name, owner_id) values ('teste import', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, initial_balance_cents)
    values (ws, usr, 'Cartao', 'credit_card', 3, 10, 0) returning id into cartao;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Corrente', 'checking', 100000) returning id into outra;

  insert into public.categorization_rules (workspace_id, user_id, pattern, category, account_id)
    values (ws, usr, 'farmacia', 'saúde', outra);

  insert into public.import_batches (workspace_id, user_id, source, filename, account_id, status)
    values (ws, usr, 'ofx', 't.ofx', cartao, 'review') returning id into lote;
  insert into public.import_items (batch_id, workspace_id, kind, amount_cents, occurred_at, description,
                                   status, suggested_category) values
    (lote, ws, 'expense', 7000, '2026-08-14', 'FARMACIA SA', 'pending',   null),      -- 1 regra
    (lote, ws, 'expense', 5000, '2026-08-10', 'Mercado',     'duplicate', null),      -- 2 o agente disse
    (lote, ws, 'expense', 3000, '2026-08-11', 'FARMACIA 2',  'pending',   'mercado'); -- 3 já sugerido

  select * into r from public._prepare_import_batch(lote);

  -- 1. A regra do usuário categoriza e sugere a conta.
  if not exists (select 1 from public.import_items where batch_id = lote and description = 'FARMACIA SA'
                   and suggested_category = 'saúde' and suggested_account_id = outra) then
    raise exception '1: a regra do usuário não foi aplicada';
  end if;
  -- 2. O status que o agente gravou fica — a função não decide mais o que é duplicata.
  if not exists (select 1 from public.import_items where batch_id = lote and description = 'Mercado'
                   and status = 'duplicate') then
    raise exception '2: a função mexeu no status que a conciliação do agente gravou';
  end if;
  if exists (select 1 from public.import_items where batch_id = lote and description = 'FARMACIA SA'
               and status <> 'pending') then
    raise exception '2b: a função voltou a marcar duplicata — são duas réguas de "já está no app"';
  end if;
  -- 3. Categoria que já veio sugerida não é sobrescrita.
  if not exists (select 1 from public.import_items where batch_id = lote and description = 'FARMACIA 2'
                   and suggested_category = 'mercado') then
    raise exception '3: a regra sobrescreveu a categoria já sugerida';
  end if;
  -- A contagem que três leitores usam.
  if r.total <> 3 or r.categorizados <> 2 or r.duplicados <> 1 then
    raise exception 'contagem: total % categorizados % duplicados %', r.total, r.categorizados, r.duplicados;
  end if;

  raise notice 'ok: _prepare_import_batch aplica as regras e não decide duplicata';
end $$;

rollback;
