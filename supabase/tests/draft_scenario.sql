-- `draft_effect` / `forecast_with_drafts` / `affordability` (20260910170000).
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/draft_scenario.sql
--
-- A asserção que MAIS importa é a última: `affordability` trocou de motor e tem que devolver
-- exatamente o que devolvia antes. Substituir a implementação de uma feature que funciona sem
-- provar equivalência é como ela quebra sem ninguém ver.

\set ON_ERROR_STOP on
begin;

do $$
declare
  hoje date := current_date;
  receita jsonb;
  gasto   jsonb;
  ambos   jsonb;
  r record;
  antes bigint;
  depois bigint;
begin
  receita := jsonb_build_array(jsonb_build_object(
    'kind','income','amount_cents',150000,'installments',1,'start', hoje + 30));
  gasto := jsonb_build_array(jsonb_build_object(
    'kind','expense','amount_cents',300000,'installments',3,'start', hoje));
  ambos := receita || gasto;

  -- 1. RECEITA SOMA — é o que o `affordability` nunca soube fazer
  select * into r from private.draft_effect(receita, hoje + 30);
  if r.delta_cents <> 150000 or r.in_cents <> 150000 or r.out_cents <> 0 then
    raise exception 'receita devia somar 150000 no dia; veio delta=% in=% out=%',
      r.delta_cents, r.in_cents, r.out_cents;
  end if;

  -- 2. ...e só a partir da data dela
  select * into r from private.draft_effect(receita, hoje + 29);
  if r.delta_cents <> 0 then
    raise exception 'receita futura vazou para antes da data: %', r.delta_cents;
  end if;

  -- 3. GASTO SUBTRAI, de forma acumulada, uma parcela por mês
  select * into r from private.draft_effect(gasto, hoje);
  if r.delta_cents <> -100000 then
    raise exception '1ª parcela devia ser -100000; veio %', r.delta_cents;
  end if;
  select * into r from private.draft_effect(gasto, private.add_months(hoje, 2));
  if r.delta_cents <> -300000 then
    raise exception 'as 3 parcelas deviam somar -300000; veio %', r.delta_cents;
  end if;

  -- 4. o RESTO da divisão inteira vai na última parcela: 100 em 3x fecha em 100, não 99
  select sum(e.out_cents) into antes
  from generate_series(0, 2) i
  cross join lateral private.draft_effect(
    jsonb_build_array(jsonb_build_object(
      'kind','expense','amount_cents',10000,'installments',3,'start',hoje)),
    private.add_months(hoje, i)) e;
  if antes <> 10000 then
    raise exception '10000 em 3x devia somar 10000 nas parcelas; somou %', antes;
  end if;

  -- 5. hipóteses EMPILHAM — receita e gasto convivem
  select * into r from private.draft_effect(ambos, hoje + 30);
  if r.delta_cents <> 150000 - 200000 then
    raise exception 'receita+gasto no dia 30 devia dar -50000; veio %', r.delta_cents;
  end if;

  -- 6. lista vazia e nula não mexem em nada
  select * into r from private.draft_effect('[]'::jsonb, hoje);
  if r.delta_cents <> 0 then raise exception 'lista vazia mexeu no saldo'; end if;
  select * into r from private.draft_effect(null, hoje);
  if r.delta_cents <> 0 then raise exception 'lista nula mexeu no saldo'; end if;

  -- 7. a série sem rascunho é IDÊNTICA à projeção real
  select count(*) into antes
  from public.cash_flow_forecast(60) f
  join public.forecast_with_drafts(60, '[]'::jsonb) g on g.day = f.day
  where g.balance_cents <> f.balance_cents or g.in_cents <> f.in_cents;
  if antes <> 0 then
    raise exception 'forecast_with_drafts sem hipótese divergiu da projeção em % dias', antes;
  end if;

  -- 8. ⚠️ EQUIVALÊNCIA: `affordability` com o motor novo = a fórmula antiga, literal.
  select worst_balance_cents into depois from public.affordability(300000, 3);
  select min(f.balance_cents - 100000 * (
           select count(*) from generate_series(0, 2) i
           where private.add_months(current_date, i) <= f.day))
    into antes
  from public.cash_flow_forecast(370) f
  where f.day <= private.add_months(current_date, 3);
  if depois is distinct from antes then
    raise exception 'affordability mudou de resultado ao trocar de motor: antes=% depois=%',
      antes, depois;
  end if;

  -- 9. modo MONTHLY: repete o valor CHEIO todo mês, sem dividir
  select * into r from private.draft_effect(
    jsonb_build_array(jsonb_build_object(
      'kind','income','mode','monthly','amount_cents',150000,'start',hoje)), hoje);
  if r.delta_cents <> 150000 then
    raise exception 'monthly no 1º mês devia ser 150000; veio %', r.delta_cents;
  end if;
  select * into r from private.draft_effect(
    jsonb_build_array(jsonb_build_object(
      'kind','income','mode','monthly','amount_cents',150000,'start',hoje)),
    private.add_months(hoje, 3));
  if r.delta_cents <> 600000 then
    raise exception 'monthly no 4º mês devia acumular 600000; veio %', r.delta_cents;
  end if;

  -- 10. o mesmo dinheiro, os dois modos: 12 x 1.500 (monthly) = 18.000 em 12x (total)
  select delta_cents into antes from private.draft_effect(
    jsonb_build_array(jsonb_build_object(
      'kind','income','mode','monthly','amount_cents',150000,'start',hoje)),
    private.add_months(hoje, 11));
  select delta_cents into depois from private.draft_effect(
    jsonb_build_array(jsonb_build_object(
      'kind','income','mode','total','amount_cents',1800000,'installments',12,'start',hoje)),
    private.add_months(hoje, 11));
  if antes <> depois then
    raise exception 'os dois modos deviam convergir em 12 meses: monthly=% total=%', antes, depois;
  end if;

  -- 11. ⚠️ `mode` ausente cai em `total` — é o que mantém `affordability` intacto
  select * into r from private.draft_effect(
    jsonb_build_array(jsonb_build_object(
      'kind','expense','amount_cents',30000,'installments',3,'start',hoje)), hoje);
  if r.delta_cents <> -10000 then
    raise exception 'sem mode, devia dividir (total); veio %', r.delta_cents;
  end if;

  -- 12. monthly não vaza para antes do início
  select * into r from private.draft_effect(
    jsonb_build_array(jsonb_build_object(
      'kind','income','mode','monthly','amount_cents',150000,'start',hoje + 60)), hoje);
  if r.delta_cents <> 0 then
    raise exception 'monthly futuro vazou para hoje: %', r.delta_cents;
  end if;

  raise notice 'OK: rascunho de cenário — 12 asserções';
end $$;

rollback;
