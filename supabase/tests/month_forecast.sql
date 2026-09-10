-- `private.month_group` — as 10 asserções que viviam em `src/lib/forecast-months.test.ts`.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/month_forecast.sql
--
-- O agrupamento saiu do TypeScript para o SQL em 10/09/2026 (`20260911001500`), porque o modo
-- Mês buscava 3.651 linhas diárias para desenhar ~120 números. Aritmética de dinheiro não muda
-- de casa sem a trava junto: estas são as MESMAS asserções, com as MESMAS fixtures.

\set ON_ERROR_STOP on
begin;

do $$
declare
  r jsonb;
  meses jsonb;
begin
  -- fixture: [day, in, out, balance] escritos à mão, para o teste não repetir a implementação
  -- 1. saldo do mês é o do ÚLTIMO dia, nunca a soma dos dias
  r := private.month_group('[
    {"day":"2026-11-01","in_cents":0,"out_cents":0,"balance_cents":10000},
    {"day":"2026-11-02","in_cents":0,"out_cents":0,"balance_cents":10000},
    {"day":"2026-11-30","in_cents":0,"out_cents":0,"balance_cents":10000}]'::jsonb);
  meses := r->'meses';
  if jsonb_array_length(meses) <> 1 then
    raise exception 'devia ser 1 mês; veio %', jsonb_array_length(meses);
  end if;
  if (meses->0->>'saldo')::bigint <> 10000 then
    raise exception 'saldo devia ser o do último dia (10000); veio %', meses->0->>'saldo';
  end if;

  -- 2. entra e sai SOMAM dentro do mês — são fluxo, não acumulado
  r := private.month_group('[
    {"day":"2026-11-05","in_cents":400000,"out_cents":0,"balance_cents":400000},
    {"day":"2026-11-10","in_cents":0,"out_cents":150000,"balance_cents":250000},
    {"day":"2026-11-30","in_cents":0,"out_cents":50000,"balance_cents":200000}]'::jsonb);
  meses := r->'meses';
  if (meses->0->>'entra')::bigint <> 400000 or (meses->0->>'sai')::bigint <> 200000
     or (meses->0->>'saldo')::bigint <> 200000 then
    raise exception 'fluxo/saldo errados: %', meses->0;
  end if;

  -- 3. vários meses saem em ordem, cada um com o próprio acumulado
  r := private.month_group('[
    {"day":"2026-11-30","in_cents":0,"out_cents":0,"balance_cents":20000},
    {"day":"2026-12-31","in_cents":0,"out_cents":0,"balance_cents":-5000},
    {"day":"2027-01-31","in_cents":0,"out_cents":0,"balance_cents":30000}]'::jsonb);
  meses := r->'meses';
  if (meses->0->>'mes') <> '2026-11' or (meses->1->>'mes') <> '2026-12'
     or (meses->2->>'mes') <> '2027-01' then
    raise exception 'ordem dos meses errada: %', meses;
  end if;
  if (meses->0->>'saldo')::bigint <> 20000 or (meses->1->>'saldo')::bigint <> -5000
     or (meses->2->>'saldo')::bigint <> 30000 then
    raise exception 'acumulado por mês errado: %', meses;
  end if;

  -- 4. marca o PRIMEIRO dia do mês em que o acumulado vira negativo (não o pior)
  r := private.month_group('[
    {"day":"2026-12-01","in_cents":0,"out_cents":0,"balance_cents":5000},
    {"day":"2026-12-10","in_cents":0,"out_cents":8000,"balance_cents":-3000},
    {"day":"2026-12-20","in_cents":0,"out_cents":1000,"balance_cents":-4000}]'::jsonb);
  if (r->'meses'->0->>'primeiroNegativo') <> '2026-12-10' then
    raise exception 'devia marcar 2026-12-10 (o primeiro, não o pior); veio %',
      r->'meses'->0->>'primeiroNegativo';
  end if;

  -- 5. mês sem nenhum dia negativo não inventa data
  r := private.month_group('[{"day":"2026-11-30","in_cents":0,"out_cents":0,"balance_cents":100}]'::jsonb);
  if (r->'meses'->0->'primeiroNegativo') <> 'null'::jsonb then
    raise exception 'sem dia negativo devia ser null; veio %', r->'meses'->0->'primeiroNegativo';
  end if;

  -- 6. marca como parcial o mês que começa depois do dia 1
  r := private.month_group('[
    {"day":"2026-11-10","in_cents":0,"out_cents":0,"balance_cents":100},
    {"day":"2026-11-30","in_cents":0,"out_cents":0,"balance_cents":100}]'::jsonb);
  if (r->'meses'->0->>'parcial') <> 'true' then
    raise exception 'mês que começa dia 10 é parcial; veio %', r->'meses'->0;
  end if;

  -- 7. marca como parcial o mês cortado pelo horizonte, e só ele
  r := private.month_group('[
    {"day":"2026-11-01","in_cents":0,"out_cents":0,"balance_cents":100},
    {"day":"2026-11-30","in_cents":0,"out_cents":0,"balance_cents":100},
    {"day":"2026-12-15","in_cents":0,"out_cents":0,"balance_cents":100}]'::jsonb);
  if (r->'meses'->0->>'parcial') <> 'false' or (r->'meses'->1->>'parcial') <> 'true' then
    raise exception 'parcial errado nas pontas: %', r->'meses';
  end if;

  -- 8. mês que termina no último dia NÃO é parcial — inclusive fevereiro
  r := private.month_group('[
    {"day":"2027-02-01","in_cents":0,"out_cents":0,"balance_cents":100},
    {"day":"2027-02-28","in_cents":0,"out_cents":0,"balance_cents":100}]'::jsonb);
  if (r->'meses'->0->>'parcial') <> 'false' then
    raise exception 'fevereiro terminando em 28 não é parcial; veio %', r->'meses'->0;
  end if;

  -- 9. série vazia não quebra
  r := private.month_group('[]'::jsonb);
  if (r->'meses') <> '[]'::jsonb then
    raise exception 'série vazia devia dar lista vazia; veio %', r->'meses';
  end if;

  -- 10. ⚠️ `hoje` é o saldo do dia 0, NÃO o do primeiro mês.
  -- O destaque escreve "TENHO HOJE"; o primeiro mês fecha no fim do mês corrente. Confundir
  -- os dois mostraria o saldo do fim de setembro com o rótulo de hoje.
  r := private.month_group('[
    {"day":"2026-09-10","in_cents":0,"out_cents":0,"balance_cents":4176070},
    {"day":"2026-09-30","in_cents":0,"out_cents":100000,"balance_cents":4076070}]'::jsonb);
  if (r->>'hoje')::bigint <> 4176070 then
    raise exception 'hoje devia ser o saldo do dia 0 (4176070); veio %', r->>'hoje';
  end if;
  if (r->'meses'->0->>'saldo')::bigint <> 4076070 then
    raise exception 'saldo do mês devia ser o do último dia (4076070); veio %',
      r->'meses'->0->>'saldo';
  end if;

  raise notice 'OK: month_group — 10 asserções';
end $$;

rollback;
