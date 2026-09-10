-- Rascunho sem `start` começa HOJE, não no fim da janela (10/09/2026)
--
-- ## O defeito
--
-- Quando a expansão saiu de dentro de `draft_effect(drafts, d)` para
-- `draft_ocorrencias(drafts, ate)` (`20260910234500`), o default do início veio junto na forma
-- errada. Antes era `coalesce(start, d)` — o dia sendo avaliado. Depois virou
-- `coalesce(start, ate)`, e `ate` é o ÚLTIMO dia da projeção.
--
-- Efeito: uma hipótese sem `start` passava a começar daqui a dez anos. Medido no staging,
-- pedindo receita de R$ 1.500/mês por 10 anos sem informar a data: 7 ocorrências, a primeira em
-- 07/09/2036, R$ 1.000 de efeito no saldo em vez dos ~R$ 178.500 esperados. Nenhum erro.
--
-- ## Por que passou pelos testes
--
-- **Todos os chamadores reais mandam `start`** — o `forecast.tsx` ancora no mês escolhido, o
-- `_rascunho` do agente resolve a data, e `affordability` crava `current_date`. As 17 asserções
-- de `draft_scenario.sql` também mandam. O campo é opcional no contrato e ninguém o omitia, o
-- que é exatamente o tipo de caminho que só quebra quando alguém novo chega.
--
-- A asserção 18 fecha isso: sem `start`, a hipótese começa no dia 0.

create or replace function private.draft_ocorrencias(drafts jsonb, ate date)
returns table (kind text, vence date, cents bigint)
language sql
stable
set search_path = public
as $$
  with h as (
    select
      coalesce(x->>'kind', 'expense') as kind,
      coalesce(x->>'mode', 'total') as mode,
      greatest(coalesce((x->>'amount_cents')::bigint, 0), 0) as total,
      least(greatest(coalesce((x->>'installments')::int, 1), 1), 72) as parcelas,
      -- Ausente = HOJE, que é o dia 0 da série. O `greatest` é o piso da `20260910233000`:
      -- parcela datada antes do dia 0 mexeria no saldo sem ter dia na janela para aparecer
      -- em "entra/sai".
      greatest(coalesce((x->>'start')::date, current_date), current_date) as inicio
    from jsonb_array_elements(coalesce(drafts, '[]'::jsonb)) x
  ),
  p as (
    select kind, mode, inicio, total, parcelas,
           case when mode = 'monthly'
                then greatest(
                       (extract(year from age(ate, inicio)) * 12
                        + extract(month from age(ate, inicio)))::int + 1, 0)
                else parcelas end as vezes,
           case when mode = 'monthly' then total else (total / parcelas)::bigint end as valor,
           case when mode = 'monthly' then 0::bigint
                else (total - (total / parcelas)::bigint * parcelas)::bigint end as resto
    from h
  )
  select p.kind,
         private.add_months(p.inicio, i)::date,
         (p.valor + case when p.mode <> 'monthly' and i = p.parcelas - 1 then p.resto else 0 end)
           ::bigint
  from p cross join lateral generate_series(0, greatest(p.vezes - 1, -1)) i
  where p.vezes > 0;
$$;

revoke execute on function private.draft_ocorrencias(jsonb, date) from public, anon;
grant execute on function private.draft_ocorrencias(jsonb, date) to authenticated, service_role;
