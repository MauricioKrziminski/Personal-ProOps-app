-- `20261005200000`: a prévia "Ao salvar" do financiamento mostra as pagas do ciclo que o Salvar lança.
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/preview_counted_debt_payments.sql --repeatable-read </dev/null
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  ws uuid; u uuid; conta uuid; venc date := current_date - 12; dados jsonb; p_sem jsonb; p_com jsonb;
  antes bigint; depois_sem bigint; depois_com bigint; n int;
begin
  select w.id, m.user_id into ws, u
  from public.workspaces w join public.workspace_members m on m.workspace_id = w.id
  order by w.created_at limit 1;
  select id into conta from public.accounts
  where workspace_id = ws and type <> 'credit_card' and not archived limit 1;
  if ws is null or conta is null then raise exception 'sem workspace/conta para testar'; end if;
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  dados := jsonb_build_object('name', 'teste previa contada', 'kind', 'financing',
    'calculation_mode', 'fixed_installments', 'principal_cents', 48*148500, 'remaining_cents', 40*148500,
    'interest_rate_monthly', 0, 'installments', 48, 'installments_paid', 8, 'installment_cents', 148500,
    'account_id', conta, 'due_day', extract(day from venc)::int,
    'first_due_date', private.add_months(venc, -7));
  p_sem := public.preview_finance_write('purchase', jsonb_build_object('p_tipo','financiamento','p_dados',dados), 90);
  p_com := public.preview_finance_write('purchase', jsonb_build_object('p_tipo','financiamento','p_dados',dados,
    'p_ja_sairam', jsonb_build_object('accountId', conta, 'numbers', jsonb_build_array(8))), 90);

  select (b->>'cleared_cents')::bigint into antes
    from jsonb_array_elements(p_sem->'before'->'balances') b where b->>'account_id' = conta::text;
  select (b->>'cleared_cents')::bigint into depois_sem
    from jsonb_array_elements(p_sem->'after'->'balances') b where b->>'account_id' = conta::text;
  select (b->>'cleared_cents')::bigint into depois_com
    from jsonb_array_elements(p_com->'after'->'balances') b where b->>'account_id' = conta::text;
  if depois_sem <> antes then raise exception '1: sem p_ja_sairam a conta mudou (% -> %)', antes, depois_sem; end if;
  if depois_com <> antes - 148500 then raise exception '2: com p_ja_sairam a conta foi % -> %, esperado -148500', antes, depois_com; end if;

  -- a prévia não deixa nada para trás
  select count(*) into n from public.debts where name = 'teste previa contada';
  if n <> 0 then raise exception '3: a prévia deixou a dívida'; end if;

  -- argumentos inválidos são recusados
  begin
    perform public.preview_finance_write('purchase', jsonb_build_object('p_tipo','financiamento','p_dados',dados,
      'p_ja_sairam', jsonb_build_object('accountId', conta, 'numbers', jsonb_build_array(8), 'x', 1)), 90);
    raise exception 'x4';
  exception when others then if sqlerrm = 'x4' then raise exception '4: aceitou chave extra'; end if; end;
  begin
    perform public.preview_finance_write('purchase', jsonb_build_object('p_tipo','parcelada','p_dados','{}'::jsonb,
      'p_ja_sairam', jsonb_build_object('accountId', conta, 'numbers', jsonb_build_array(1))), 90);
    raise exception 'x5';
  exception when others then if sqlerrm = 'x5' then raise exception '5: aceitou em parcelada'; end if; end;
  execute 'reset role';
end $$;

rollback;
