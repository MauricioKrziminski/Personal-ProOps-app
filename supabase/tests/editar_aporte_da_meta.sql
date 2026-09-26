-- O aporte da meta se edita (`20260926160000`).
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/editar_aporte_da_meta.sql
--
-- 1. Valor, data e nota mudam, e o guardado da meta é refeito.
-- 2. A edição que deixaria a meta com menos que zero é recusada.
-- Roda numa transação e dá rollback.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000005a1';
  w uuid := '00000000-0000-0000-0000-0000000005b1';
  g uuid := '00000000-0000-0000-0000-0000000005c1';
  a1 uuid;
  a2 uuid;
  l record;
begin
  insert into auth.users (id, email) values (u, 'teste-meta@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Teste meta');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.goals (id, workspace_id, user_id, name, target_cents) values (g, w, u, 'Viagem', 500000);
  perform public.goal_deposit(g, 10000, current_date - 10, 'salário');
  perform public.goal_deposit(g, -4000, current_date, 'passagem');
  select id into a1 from public.goal_contributions where goal_id = g and amount_cents = 10000;
  select id into a2 from public.goal_contributions where goal_id = g and amount_cents = -4000;

  -- ── 1. valor, data e nota mudam ────────────────────────────────────────────────────────
  perform public.edit_goal_contribution(a1, 15000, current_date - 20, '13º');
  select amount_cents, occurred_at, note into l from public.goal_contributions where id = a1;
  if l.amount_cents <> 15000 or l.occurred_at <> current_date - 20 or l.note <> '13º' then
    raise exception '1: o aporte ficou % % %', l.amount_cents, l.occurred_at, l.note;
  end if;
  select saved_cents into l from public.goals where id = g;
  if l.saved_cents <> 11000 then raise exception '1: guardado % (11000)', l.saved_cents; end if;

  -- ── 2. não fica com menos que zero ─────────────────────────────────────────────────────
  begin
    perform public.edit_goal_contribution(a2, -20000, current_date, 'passagem');
    raise exception 'FALHOU: meta negativa';
  exception when others then
    if sqlerrm not like 'Não dá para retirar mais do que está guardado%' then raise exception '2: recusa errada: %', sqlerrm; end if;
  end;
end $$;

rollback;
