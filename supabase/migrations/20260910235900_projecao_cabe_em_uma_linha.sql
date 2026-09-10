-- A projeção volta INTEIRA: uma linha de JSON em vez de uma linha por dia (10/09/2026)
--
-- ## O defeito, achado na tela e medido
--
-- `cash_flow_forecast(days)` devolve `setof` — uma linha por dia. **O PostgREST corta a
-- resposta em 1000 linhas** (`db-max-rows`), e o corte é SILENCIOSO: nenhum erro, nenhum
-- aviso, a lista simplesmente chega menor. O app então soma "entra/sai", tira o saldo do fim e
-- procura o primeiro dia negativo sobre uma série truncada, e escreve o rótulo do horizonte que
-- o usuário pediu em cima disso.
--
-- Medido no staging, com o horizonte de 10 anos:
--
--   | rótulo  | saldo real no fim | o que a tela mostrava |     erro   | mostrava até |
--   |---------|-------------------|-----------------------|------------|--------------|
--   | 2 anos  |        −11.256,50 |            −11.256,50 |         —  |   09/09/2028 |
--   | 3 anos  |        −26.876,55 |            −26.263,25 |   +613,30  |   05/06/2029 |
--   | 5 anos  |        −31.335,75 |            −26.263,25 | +5.072,50  |   05/06/2029 |
--   | 10 anos |        −42.427,85 |            −26.263,25 | +16.164,60 |   05/06/2029 |
--
-- Três coisas tornam isso grave, e nenhuma delas aparece num teste de SQL:
--
--   1. **O erro é sempre OTIMISTA** — mostra mais dinheiro do que existe, num app de dinheiro.
--   2. **A data congela.** 3, 5 e 10 anos mostram todos 05/06/2029: o rótulo muda, o número não.
--   3. **Já estava em produção** desde o teto de 3 anos (`20260910220000`), que passou de 1000
--      linhas (1.096) — R$ 613,30 de erro para quem escolhesse "3 anos" no APK v1.3.17.
--
-- ## O conserto
--
-- O teto do PostgREST é por LINHA, não por tamanho. Uma função que devolve `jsonb` devolve UMA
-- linha, e a série inteira vai dentro dela. Nada de paginar e costurar faixas no cliente: a
-- emenda entre faixas é onde o saldo acumulado volta a errar.
--
-- ⚠️ **`drafts` tem default `'[]'`, e é isso que faz UMA função servir as duas telas.** Com a
-- lista vazia, `draft_ocorrencias` não produz ocorrência nenhuma e o resultado é idêntico ao
-- `cash_flow_forecast` puro — a projeção real e o Rascunho passam pelo MESMO caminho, então
-- não há como um deles truncar e o outro não.
--
-- ⚠️ **Sem par interna/wrapper aqui, de propósito** (contra o padrão de `supabase.md`). A
-- interna existe para o AGENTE, que fala com o Postgres direto e por isso nunca passou pelo
-- teto de linhas do PostgREST — ele segue em `_forecast_with_drafts`. Uma gêmea `_forecast_json`
-- nasceria sem chamador, e função sem chamador é o que diverge em silêncio.
--
-- ⚠️ **`cash_flow_forecast` e `forecast_with_drafts` continuam intactas.** APK antigo em campo
-- chama as duas, e `affordability` chama a segunda por dentro. Esta função é uma CASCA de
-- transporte sobre elas — a aritmética continua num lugar só, e a RLS continua valendo porque
-- ela chama o wrapper `security invoker`, não a interna.

create or replace function public.forecast_json(days integer, drafts jsonb default '[]'::jsonb)
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'day', f.day,
        'in_cents', f.in_cents,
        'out_cents', f.out_cents,
        'balance_cents', f.balance_cents
      )
      order by f.day
    ),
    '[]'::jsonb
  )
  from public.forecast_with_drafts(days, drafts) f;
$$;

revoke execute on function public.forecast_json(integer, jsonb) from public, anon;
grant execute on function public.forecast_json(integer, jsonb) to authenticated, service_role;
