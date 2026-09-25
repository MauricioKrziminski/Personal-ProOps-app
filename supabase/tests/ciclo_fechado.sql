-- Ciclo FECHADO conta só o que aconteceu (`20260925130000`).
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/ciclo_fechado.sql
--
-- Num mês que já acabou: a despesa PAGA entra em "saiu"; a PENDENTE (o aluguel que ficou sem
-- pagar) vai para "faltou pagar" e nunca para "saiu"; e a recorrente que nunca foi materializada
-- (a regra sozinha, projetada) não inventa movimento num período que já passou. A invariante
-- `confere` (comecei + entrou − saiu = caixa real) tem que dar verdadeiro. Não depende do dado
-- do banco: o workspace é criado aqui e o mês é o anterior ao de hoje, na régua civil.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  ws uuid; usr uuid; conta uuid;
  v_mes date := (date_trunc('month', current_date) - interval '1 month')::date;
  r record;
begin
  select id into usr from auth.users limit 1;
  insert into public.workspaces (name, owner_id) values ('teste ciclo fechado', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Conta', 'checking', 500000) returning id into conta;

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, status, source)
  values (ws, usr, conta, 'expense', 12000, 'Mercado pago', v_mes + 4, 'cleared', 'app'),
         (ws, usr, conta, 'expense', 180000, 'Aluguel sem pagar', v_mes + 5, 'pending', 'app');

  -- A regra de uma recorrente que o cron nunca materializou (no staging ele não roda).
  insert into public.recurring_transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category, rrule,
     dtstart, next_run_at)
    values (ws, usr, conta, 'expense', 9900, 'Assinatura nunca materializada', 'assinaturas',
            'FREQ=MONTHLY;BYMONTHDAY=12', (v_mes - interval '2 months')::timestamptz,
            (v_mes - interval '2 months')::timestamptz);

  select * into r from private.cycle_series_for(array[ws], v_mes, v_mes, 'civil') limit 1;

  if r.estado <> 'fechado' then raise exception 'o mês anterior deveria estar fechado, veio %', r.estado; end if;
  if r.saiu <> 12000 then
    raise exception 'saiu deveria ser só a despesa paga (12000), veio %', r.saiu;
  end if;
  if r.faltou_pagar < 180000 then
    raise exception 'o aluguel sem pagar deveria estar no faltou pagar, veio %', r.faltou_pagar;
  end if;
  if r.confere is distinct from true then
    raise exception 'ciclo fechado não reproduz o caixa: resultado % caixa %', r.resultado, r.caixa_no_fim;
  end if;
  -- A lista do mês fechado conta a mesma história: nem o aluguel nem a projeção aparecem como saída.
  if exists (select 1 from private.cash_events(array[ws], v_mes, (v_mes + interval '1 month' - interval '1 day')::date)
             where title in ('Aluguel sem pagar', 'Assinatura nunca materializada')) then
    raise exception 'a lista do mês fechado mostra como saída o que não saiu';
  end if;

  raise notice 'ok: ciclo fechado conta só o que aconteceu';
end $$;

rollback;
