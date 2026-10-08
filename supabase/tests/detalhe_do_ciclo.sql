-- "Como chego nesse valor" (`20261010110000`): o detalhe SOMA até o número do ciclo.
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/detalhe_do_ciclo.sql
--
-- Para o ciclo anterior (fechado), o atual (aberto) e o seguinte (previsto), nas duas réguas:
--   partida + entra − sai = resultado de `cycle_series_for`;
--   no aberto, a partida é o caixa de HOJE e as contas somam a partida;
--   `por_origem` soma `entra` e `sai`.
-- Roda num espaço criado aqui (com ciclo fechando no dia 10, para as réguas divergirem) e, por
-- cima, em todo espaço que já existe no banco — a identidade não pode depender do dado.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  ws uuid; usr uuid; conta uuid; poup uuid;
  w uuid; v text; m date; b jsonb; s record; n int := 0; soma bigint;
begin
  usr := '00000000-0000-0000-0000-000000000d01';
  insert into auth.users (id, email) values (usr, 'teste-detalhe-ciclo@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  insert into public.workspaces (name, owner_id, cycle_close_day) values ('teste detalhe do ciclo', usr, 10) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Corrente', 'checking', 300000) returning id into conta;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Poupança', 'savings', 120000) returning id into poup;

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, status, source)
  values (ws, usr, conta, 'expense', 4500, 'Mercado de hoje', current_date, 'cleared', 'app'),
         (ws, usr, conta, 'expense', 15000, 'Mercado do mês passado', current_date - 35, 'cleared', 'app'),
         (ws, usr, conta, 'expense', 90000, 'Aluguel a pagar', current_date + 3, 'pending', 'app'),
         (ws, usr, conta, 'income', 250000, 'Salário a receber', current_date + 5, 'pending', 'app'),
         (ws, usr, conta, 'expense', 30000, 'Conta do mês que vem', current_date + 40, 'pending', 'app'),
         (ws, usr, null, 'expense', 2000, 'Sem conta, pelo WhatsApp', current_date, 'cleared', 'whatsapp');

  for w in select id from public.workspaces loop
    foreach v in array array['cycle', 'civil'] loop
      for s in select * from private.cycle_series_for(array[w], current_date - 40, current_date + 40, v) loop
        m := s.mes;
        b := private.cycle_breakdown_for(array[w], m, v);
        n := n + 1;
        if b->>'estado' <> s.estado then
          raise exception 'ws % % %: estado % ≠ %', w, v, m, b->>'estado', s.estado;
        end if;
        if (b->'partida'->>'cents')::bigint + (b->>'entra')::bigint - (b->>'sai')::bigint <> s.resultado then
          raise exception 'ws % % % (%): partida % + entra % − sai % ≠ resultado %',
            w, v, m, s.estado, b->'partida'->>'cents', b->>'entra', b->>'sai', s.resultado;
        end if;
        if (b->>'resultado')::bigint <> s.resultado then
          raise exception 'ws % % %: resultado do detalhe % ≠ %', w, v, m, b->>'resultado', s.resultado;
        end if;
        select coalesce(sum((o->>'in_cents')::bigint), 0) into soma from jsonb_array_elements(b->'por_origem') o;
        if soma <> (b->>'entra')::bigint then raise exception 'ws % % %: por_origem não soma o entra', w, v, m; end if;
        select coalesce(sum((o->>'out_cents')::bigint), 0) into soma from jsonb_array_elements(b->'por_origem') o;
        if soma <> (b->>'sai')::bigint then raise exception 'ws % % %: por_origem não soma o sai', w, v, m; end if;
        if s.estado = 'aberto' then
          if (b->'partida'->>'cents')::bigint <> private.cash_total(array[w], current_date) then
            raise exception 'ws % % %: a partida do aberto não é o caixa de hoje', w, v, m;
          end if;
          select coalesce(sum((k->>'cents')::bigint), 0) into soma from jsonb_array_elements(b->'partida'->'contas') k;
          if soma <> (b->'partida'->>'cents')::bigint then
            raise exception 'ws % % %: as contas somam % e a partida é %', w, v, m, soma, b->'partida'->>'cents';
          end if;
        elsif (b->'partida'->>'cents')::bigint <> s.comecei_com then
          raise exception 'ws % % %: a partida do % não é o comecei_com', w, v, m, s.estado;
        end if;
      end loop;
    end loop;
  end loop;

  -- O espaço daqui: o aberto mostra as duas contas e a linha "Sem conta".
  b := private.cycle_breakdown_for(array[ws], private.cycle_month_of(10, current_date), 'cycle');
  if jsonb_array_length(b->'partida'->'contas') <> 3 then
    raise exception 'esperava Corrente, Poupança e Sem conta, veio %', b->'partida'->'contas';
  end if;
  if not exists (select 1 from jsonb_array_elements(b->'partida'->'contas') k
                 where k->>'nome' = 'Sem conta' and (k->>'cents')::bigint = -2000) then
    raise exception 'o lançamento sem conta não apareceu como "Sem conta": %', b->'partida'->'contas';
  end if;

  raise notice 'ok: o detalhe soma até o ciclo em % leituras', n;
end $$;

rollback;
