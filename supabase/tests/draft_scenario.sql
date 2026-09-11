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

set local timezone to 'America/Sao_Paulo';
-- ⚠️ O relógio do teste tem que ser o MESMO do negócio.
-- Desde a `20260911030000` as funções financeiras avaliam `current_date` em BRT
-- (`alter function ... set timezone`), enquanto a sessão continua em UTC. Das 21h à meia-noite
-- as duas datas diferem, e um teste que compara "o dia 0 da projeção" com o `current_date` da
-- SESSÃO falha por um dia — sem nada de errado no código. Foi o que aconteceu com
-- `draft_scenario`, `agent_migrations` e `alert_channels` em 10/09/2026 às 21h.

do $$
declare
  hoje date := current_date;
  receita jsonb;
  gasto   jsonb;
  ambos   jsonb;
  r record;
  antes bigint;
  depois bigint;
  antes_d date;
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

  -- 13. ⚠️ A HIPÓTESE NUNCA COMEÇA ANTES DO DIA 0 (20260910233000).
  --
  -- A série é `generate_series(current_date, ...)` — data do SERVIDOR, que roda em UTC. O app
  -- monta `start` com a data de SÃO PAULO. Das 21h à meia-noite os dois discordam e a
  -- hipótese caía antes do primeiro dia da janela: `delta` contava (soma tudo `vence <= d`)
  -- mas nenhum dia casava `vence = d`, então o SALDO mudava e "entra/sai" ficava zerado.
  select * into r from private.draft_effect(
    jsonb_build_array(jsonb_build_object(
      'kind','expense','amount_cents',50000,'installments',1,'start', hoje - 30)), hoje);
  if r.out_cents <> 50000 then
    raise exception 'parcela do passado devia aparecer em "sai" no dia 0; veio out=%', r.out_cents;
  end if;
  if r.delta_cents <> -50000 then
    raise exception 'e continuar valendo no saldo; veio delta=%', r.delta_cents;
  end if;

  -- 14. ...e o piso não empurra nada que já estava no futuro
  select * into r from private.draft_effect(
    jsonb_build_array(jsonb_build_object(
      'kind','income','amount_cents',50000,'installments',1,'start', hoje + 10)), hoje + 10);
  if r.in_cents <> 50000 then
    raise exception 'hipótese futura foi movida pelo piso; veio in=%', r.in_cents;
  end if;

  -- 15. o piso é no-op para `affordability`, que já passa `start = current_date`
  select * into r from private.draft_effect(
    jsonb_build_array(jsonb_build_object(
      'kind','expense','amount_cents',300000,'installments',3,'start', current_date)), hoje);
  if r.delta_cents <> -100000 then
    raise exception 'affordability mudou de comportamento; veio %', r.delta_cents;
  end if;

  -- 16. ⚠️ INVARIANTE DO QUAL A OTIMIZAÇÃO DEPENDE (20260910234500).
  --
  -- `forecast_with_drafts` deixou de chamar `draft_effect` por dia e passou a acumular com
  -- `sum(...) over (order by day)` sobre a série. Isso só é correto porque NENHUMA ocorrência
  -- cai antes do dia 0 — uma que caísse não teria linha para somar e sumiria do saldo, em
  -- silêncio. Quem garante é o piso da `20260910233000`.
  --
  -- Se alguém tirar o piso, ESTA asserção quebra ANTES de o saldo ficar errado na tela. A
  -- alternativa seria um termo de arraste ("o que venceu antes entra como constante"), e ela
  -- foi recusada de propósito: ele devolve o dinheiro ao SALDO sem devolvê-lo a "entra/sai" —
  -- que é exatamente o defeito invisível que o piso saiu matando.
  select min(vence) into antes_d from private.draft_ocorrencias(
    jsonb_build_array(jsonb_build_object(
      'kind','expense','amount_cents',30000,'installments',3,
      'start', hoje - 60)), hoje + 30);
  if antes_d < current_date then
    raise exception 'ocorrência antes do dia 0 (%): o acumulado por janela perde dinheiro', antes_d;
  end if;

  -- 17. ...e a parcela empurrada para hoje APARECE em "sai", não só no saldo
  select * into r from private.draft_effect(
    jsonb_build_array(jsonb_build_object(
      'kind','expense','amount_cents',30000,'installments',3,'start', hoje - 60)), hoje);
  if r.out_cents <> 10000 or r.delta_cents <> -10000 then
    raise exception 'hipótese do passado devia virar 1 parcela HOJE, visível; veio out=% delta=%',
      r.out_cents, r.delta_cents;
  end if;

  -- 18. ⚠️ SEM `start`, a hipótese começa HOJE — não no fim da janela (20260911000500).
  --
  -- `start` é opcional no contrato e todo chamador real o manda, então o default nunca era
  -- exercitado. Quando a expansão saiu para `draft_ocorrencias(drafts, ate)`, o default virou
  -- `ate` — o ÚLTIMO dia da projeção. Medido: receita de 1.500/mês por 10 anos sem data
  -- rendia 7 ocorrências a partir de 2036 e R$ 1.000 de efeito, em vez de ~178.500.
  select min(vence), count(*) into antes_d, antes from private.draft_ocorrencias(
    jsonb_build_array(jsonb_build_object(
      'kind','income','mode','monthly','amount_cents',150000)), hoje + 365);
  if antes_d <> current_date then
    raise exception 'sem start devia começar hoje (%); começou em %', current_date, antes_d;
  end if;
  if antes < 12 then
    raise exception 'monthly de um ano devia render ~13 ocorrências; veio %', antes;
  end if;

  raise notice 'OK: rascunho de cenário — 18 asserções';
end $$;

rollback;
