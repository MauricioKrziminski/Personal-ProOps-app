-- `public.goal_deposit` — retirar mais do que está guardado é recusado (20260922130000).
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/goal_withdraw.sql
--
-- A asserção que carrega a correção é a 3: antes dela, retirar 300 de uma meta com 100 gravava
-- -300 no ledger, o saldo virava 0 pelo `greatest`, e o "Guardar 100" seguinte SUMIA (soma -100).

\set ON_ERROR_STOP on
begin;

do $$
declare
  ws uuid; usr uuid; meta uuid; v bigint; recusou boolean;
begin
  select id into usr from auth.users limit 1;
  insert into public.workspaces (name, owner_id) values ('teste meta', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  insert into public.goals (workspace_id, user_id, name, target_cents)
    values (ws, usr, 'Viagem', 500000) returning id into meta;

  -- 1. guardar soma
  v := public.goal_deposit(meta, 10000, date '2026-09-22');
  if v <> 10000 then raise exception '1. guardar 100 deveria dar 10000, veio %', v; end if;

  -- 2. retirar até o saldo passa (inclusive o saldo inteiro)
  v := public.goal_deposit(meta, -4000, date '2026-09-22');
  if v <> 6000 then raise exception '2. retirar 40 deveria dar 6000, veio %', v; end if;

  -- 3. retirar além do saldo é recusado e NÃO grava nada no ledger
  recusou := false;
  begin
    perform public.goal_deposit(meta, -6001, date '2026-09-22');
  exception when raise_exception then recusou := true;
  end;
  if not recusou then raise exception '3. retirar 60,01 de 60,00 deveria ser recusado'; end if;
  if (select sum(amount_cents) from public.goal_contributions where goal_id = meta) <> 6000 then
    raise exception '3. a recusa não pode deixar linha no ledger';
  end if;

  -- 4. o aporte seguinte não some (era o defeito: o ledger negativo comia o próximo "Guardar")
  v := public.goal_deposit(meta, 10000, date '2026-09-22');
  if v <> 16000 then raise exception '4. guardar 100 depois deveria dar 16000, veio %', v; end if;

  -- 5. retirar TUDO continua valendo
  v := public.goal_deposit(meta, -16000, date '2026-09-22');
  if v <> 0 then raise exception '5. retirar tudo deveria dar 0, veio %', v; end if;

  raise notice 'OK: meta não retira mais que o guardado — 5 asserções';
end $$;

rollback;
