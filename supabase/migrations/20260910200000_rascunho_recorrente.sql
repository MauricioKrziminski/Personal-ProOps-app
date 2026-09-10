-- Rascunho: hipótese que REPETE, não só que parcela (10/09/2026)
--
-- `draft_effect` nasceu sabendo uma coisa só: pegar um total e dividir em N parcelas — que é o
-- que "Posso comprar isso?" precisava. Mas as duas perguntas são diferentes, e confundi-las
-- erra o valor por um fator de N:
--
--   • `total`   — 3.000 em 6x  → 500 por mês, seis vezes. É uma COMPRA repartida.
--   • `monthly` — 1.500 por mês → 1.500 por mês, todo mês. É uma RECORRÊNCIA.
--
-- Sem o segundo modo, "e se eu passar a receber 1.500 por mês?" só dava para perguntar
-- digitando 18.000 em 12x — que dá o mesmo resultado e obriga o usuário a fazer a conta que o
-- app existe para fazer.
--
-- ⚠️ `mode` é OPCIONAL e cai em `total`: `affordability` não passa o campo e continua
-- funcionando sem tocar em uma linha dela. `supabase/tests/draft_scenario.sql` prende isso.
--
-- ⚠️ **`monthly` não precisa saber onde a projeção termina.** A função é avaliada POR DIA, e
-- "quantas vezes já repetiu até o dia `d`" é aritmética de meses entre `start` e `d`. O
-- horizonte de quem chama (365 dias no forecast) limita naturalmente. Passar o fim da janela
-- para cá seria acoplar a hipótese a quem a consome.

create or replace function private.draft_effect(drafts jsonb, d date)
returns table (in_cents bigint, out_cents bigint, delta_cents bigint)
language sql
immutable
set search_path = public
as $$
  with h as (
    select
      coalesce(x->>'kind', 'expense') as kind,
      coalesce(x->>'mode', 'total') as mode,
      greatest(coalesce((x->>'amount_cents')::bigint, 0), 0) as total,
      least(greatest(coalesce((x->>'installments')::int, 1), 1), 72) as parcelas,
      coalesce((x->>'start')::date, d) as inicio
    from jsonb_array_elements(coalesce(drafts, '[]'::jsonb)) x
  ),
  p as (
    select kind, mode, inicio, total,
           -- em `monthly` a repetição é ilimitada: quem corta é o dia consultado
           case when mode = 'monthly'
                then greatest(
                       (extract(year from age(d, inicio)) * 12
                        + extract(month from age(d, inicio)))::int + 1, 0)
                else parcelas end as vezes,
           case when mode = 'monthly' then total else (total / parcelas)::bigint end as valor,
           case when mode = 'monthly' then 0::bigint
                else (total - (total / parcelas)::bigint * parcelas)::bigint end as resto,
           parcelas
    from h
  ),
  ocorrencias as (
    select p.kind,
           private.add_months(p.inicio, i)::date as vence,
           p.valor + case when p.mode <> 'monthly' and i = p.parcelas - 1 then p.resto else 0 end
             as cents
    from p cross join lateral generate_series(0, greatest(p.vezes - 1, -1)) i
    where p.vezes > 0
  )
  select
    coalesce(sum(cents) filter (where kind = 'income'  and vence = d), 0)::bigint,
    coalesce(sum(cents) filter (where kind <> 'income' and vence = d), 0)::bigint,
    coalesce(sum(case when kind = 'income' then cents else -cents end)
             filter (where vence <= d), 0)::bigint
  from ocorrencias;
$$;
