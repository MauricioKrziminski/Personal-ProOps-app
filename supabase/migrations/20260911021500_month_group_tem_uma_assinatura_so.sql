-- `create or replace` com parâmetro NOVO cria SOBRECARGA, não substitui.
--
-- A `20260911021000` acrescentou `close_day` a `private.month_group` e ficou com as duas
-- versões vivas: a de 1 argumento (a antiga, que ignora o ciclo) e a de 2 com default. Toda
-- chamada de 1 argumento passou a devolver `function is not unique` — foi assim que
-- `supabase/tests/month_forecast.sql` quebrou, e é o modo de falha mais barato possível de
-- descobrir: erro alto, na hora. Se o default tivesse ficado do outro lado, o Postgres teria
-- escolhido a antiga em silêncio e o modo Mês continuaria agrupando por mês civil.
drop function if exists private.month_group(jsonb);
