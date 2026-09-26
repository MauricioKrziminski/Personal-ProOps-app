-- Editar um limite de orçamento é editar AQUELE limite (`20260926150000`).
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/editar_limite_do_orcamento.sql
--
-- 1. Mesmo alcance: a categoria muda (a linha é a mesma), e não toma a de outro limite.
-- 2. "Só este mês" → "Todo mês": o deste mês sai e o de todo mês passa a valer para ele.
-- 3. "Todo mês" → "Só este mês": o deste mês nasce e o de todo mês fica.
-- 4. Trocando o alcance, a categoria nova não sobrescreve outro limite.
-- Roda numa transação e dá rollback.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000004a1', 'teste-orcamento@example.invalid')
  on conflict (id) do nothing;
insert into public.profiles (id) values ('00000000-0000-0000-0000-0000000004a1') on conflict (id) do nothing;
insert into public.workspaces (id, owner_id, name)
  values ('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-0000000004a1', 'Teste orçamento');
insert into public.workspace_members (workspace_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000004b1', '00000000-0000-0000-0000-0000000004a1', 'owner');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000004a1', true);
set local role authenticated;

do $$
declare
  mes date := date_trunc('month', current_date)::date;
  id_antes uuid;
  l record;
  n int;
begin
  perform public.save_budget('mercado', 80000, false, null);
  perform public.save_budget('lazer', 30000, false, null);
  select id into id_antes from public.budgets where category = 'mercado' and month is null;

  -- ── 1. mesmo alcance: a categoria muda, a linha é a mesma ──────────────────────────────
  perform public.edit_budget('mercado', null, 'supermercado', 90000, true, null);
  select id, category, limit_cents, rollover into l from public.budgets where id = id_antes;
  if l.category <> 'supermercado' or l.limit_cents <> 90000 or not l.rollover then
    raise exception '1: o limite ficou % % %', l.category, l.limit_cents, l.rollover;
  end if;
  begin
    perform public.edit_budget('supermercado', null, 'lazer', 90000, false, null);
    raise exception 'FALHOU: tomou a categoria de outro limite';
  exception when others then
    if sqlerrm not like 'Já existe um limite de lazer para todo mês%' then raise exception '1: recusa errada: %', sqlerrm; end if;
  end;

  -- ── 2. "Só este mês" → "Todo mês" ─────────────────────────────────────────────────────
  perform public.save_budget('lazer', 50000, false, mes);
  perform public.edit_budget('lazer', mes, 'lazer', 45000, false, null);
  select count(*) into n from public.budgets where category = 'lazer' and month is not null;
  if n <> 0 then raise exception '2: o limite deste mês devia ter saído (%)', n; end if;
  select limit_cents into l from public.budgets where category = 'lazer' and month is null;
  if l.limit_cents <> 45000 then raise exception '2: o de todo mês ficou % (45000)', l.limit_cents; end if;

  -- ── 3. "Todo mês" → "Só este mês" ─────────────────────────────────────────────────────
  perform public.edit_budget('lazer', null, 'lazer', 20000, false, mes);
  select count(*) filter (where month is null and limit_cents = 45000) as todo,
         count(*) filter (where month = mes and limit_cents = 20000) as deste into l
    from public.budgets where category = 'lazer';
  if l.todo <> 1 or l.deste <> 1 then raise exception '3: todo mês % (1), este mês % (1)', l.todo, l.deste; end if;

  -- ── 4. trocando o alcance, a categoria nova não toma a de outro limite ────────────────
  begin
    perform public.edit_budget('lazer', mes, 'supermercado', 10000, false, null);
    raise exception 'FALHOU: sobrescreveu o limite de supermercado';
  exception when others then
    if sqlerrm not like 'Já existe um limite de supermercado para todo mês%' then raise exception '4: recusa errada: %', sqlerrm; end if;
  end;
end $$;

rollback;
