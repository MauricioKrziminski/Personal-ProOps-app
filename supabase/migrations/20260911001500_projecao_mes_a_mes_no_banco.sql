-- Projeção mês a mês no BANCO: ~120 linhas em vez de 3.651 (10/09/2026)
--
-- ## Por quê
--
-- O modo "Mês" da Projeção buscava a série DIÁRIA e jogava fora 97% dela: 10 anos são 3.651
-- dias (~200 KB) para desenhar ~120 números. Agrupar no cliente também obriga o app a carregar
-- o dia inteiro só para somar, e o agrupamento — que é aritmética de dinheiro — ficava numa
-- segunda linguagem, longe da projeção que o produz.
--
-- ## O desenho
--
--   public.forecast_json(days, drafts)        ← a série diária, já numa linha só
--        └── private.month_group(dias jsonb)  ← o agrupamento, função PURA
--              └── public.month_forecast_json(days, drafts)
--
-- `month_group` recebe a série e devolve os meses. Ser pura é o que a torna testável com
-- fixtures escritas à mão, exatamente como as 10 asserções que viviam em
-- `src/lib/forecast-months.test.ts` — elas foram portadas para
-- `supabase/tests/month_forecast.sql` e o TypeScript foi apagado. Aritmética de dinheiro não
-- pode ficar sem trava, e a trava tem que morar onde a implementação mora.
--
-- ## As regras, que não são óbvias e por isso são testadas
--
--   • **saldo do mês = o do ÚLTIMO dia.** `balance_cents` já vem acumulado; somar os dias
--     contaria o mesmo dinheiro N vezes (100+100+100 daria 300 onde o saldo é 100).
--   • **entra/sai SOMAM.** Esses são fluxo do dia, não acumulado.
--   • **`primeiroNegativo` é o PRIMEIRO dia negativo do mês, não o pior.** É a data em que a
--     pessoa precisa agir.
--   • **`parcial` só existe no primeiro e no último mês** — a série começa HOJE e termina no
--     horizonte. Rotular "novembro" um pedaço de novembro é o tipo de mentira que só aparece
--     quando o número não bate com a planilha.
--
-- ⚠️ **`hoje` vem junto, e é obrigatório.** O destaque da tela mostra "TENHO HOJE", que é o
-- saldo do dia 0 — não o do primeiro MÊS, que é o fim do mês corrente. Sem esse campo o modo
-- Mês teria que buscar a série diária de volta só para ler um número, e o ganho evaporava.

create or replace function private.month_group(dias jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  with d as (
    select (x->>'day')::date as day,
           (x->>'in_cents')::bigint as in_cents,
           (x->>'out_cents')::bigint as out_cents,
           (x->>'balance_cents')::bigint as balance_cents
    from jsonb_array_elements(coalesce(dias, '[]'::jsonb)) x
  ),
  lim as (select min(day) as primeiro, max(day) as ultimo from d),
  m as (
    select to_char(day, 'YYYY-MM') as mes,
           sum(in_cents)::bigint as entra,
           sum(out_cents)::bigint as sai,
           -- o ÚLTIMO dia do mês, nunca a soma
           (array_agg(balance_cents order by day desc))[1]::bigint as saldo,
           min(day) filter (where balance_cents < 0) as neg,
           min(day) as ini,
           max(day) as fim
    from d
    group by to_char(day, 'YYYY-MM')
  )
  select jsonb_build_object(
    'hoje', (select balance_cents from d order by day limit 1),
    'meses', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'mes', m.mes,
                'entra', m.entra,
                'sai', m.sai,
                'saldo', m.saldo,
                'primeiroNegativo', m.neg,
                -- parcial só na ponta: no meio da série todo mês está inteiro
                'parcial',
                  (m.ini = (select primeiro from lim) and extract(day from m.ini)::int > 1)
                  or (m.fim = (select ultimo from lim)
                      and m.fim < (date_trunc('month', m.fim)
                                   + interval '1 month' - interval '1 day')::date)
              ) order by m.mes)
       from m),
      '[]'::jsonb)
  );
$$;

revoke execute on function private.month_group(jsonb) from public, anon;
grant execute on function private.month_group(jsonb) to authenticated, service_role;


-- A porta do app. Mesma casca de transporte do `forecast_json`: uma linha, sem teto do
-- PostgREST — e aqui o corpo já vem 30× menor.
create or replace function public.month_forecast_json(days integer, drafts jsonb default '[]'::jsonb)
returns jsonb
language sql stable
set search_path = public
as $$
  select private.month_group(public.forecast_json(days, drafts));
$$;

revoke execute on function public.month_forecast_json(integer, jsonb) from public, anon;
grant execute on function public.month_forecast_json(integer, jsonb) to authenticated, service_role;
