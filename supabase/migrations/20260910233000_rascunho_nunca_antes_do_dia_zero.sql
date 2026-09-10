-- Rascunho: a hipótese nunca começa antes do dia 0 da projeção (10/09/2026)
--
-- ## O defeito
--
-- `_cash_flow_forecast` gera os dias com `generate_series(current_date, ...)` — o dia 0 é a
-- data do SERVIDOR, que roda em **UTC**. O app monta a hipótese com `start = localISODate()`,
-- que é a data em **São Paulo**. Das 21h à meia-noite de Brasília os dois discordam:
-- `current_date` já é amanhã e `start` ainda é hoje.
--
-- Nessas 3 horas por dia a hipótese começa ANTES do primeiro dia da série. O efeito não é erro
-- nenhum na tela — é pior: `delta_cents` conta (ele soma tudo que vence `<= d`), então o SALDO
-- muda; mas nenhum dia da janela casa `vence = d`, então `in_cents`/`out_cents` ficam zerados.
-- O destaque sobe e a linha de "entra/sai" continua vazia.
--
-- ⚠️ **Não é a trava do `forecast.tsx` estar errada.** O `primeiroDia < localISODate()` de lá
-- resolve OUTRA coisa, e resolve bem: o usuário escolher um mês que já começou. Ela compara
-- com a data LOCAL, então não tem como enxergar o dia 0 do SERVIDOR já ter virado — são dois
-- buracos diferentes, e só um deles dava para ver de dentro do app.
--
-- ## Por que o conserto mora aqui
--
-- "Uma hipótese não começa antes de a projeção começar" é invariante do MOTOR, não de quem o
-- chama. Consertar no app deixaria o agente com o mesmo buraco no dia em que ele passasse a
-- mandar `start` (que é agora). Uma trava, no lugar por onde todo mundo passa.
--
-- ⚠️ `immutable` → `stable`: `current_date` é STABLE. Manter a função marcada `immutable`
-- enquanto ela lê o relógio é mentir para o planejador — ele poderia dobrar a chamada numa
-- constante. `stable` é o que `cross join lateral` já esperava.
--
-- ⚠️ **É no-op para `affordability`**, que já passa `start = current_date`. A prova de
-- equivalência de `supabase/tests/draft_scenario.sql` continua valendo palavra por palavra.

create or replace function private.draft_effect(drafts jsonb, d date)
returns table (in_cents bigint, out_cents bigint, delta_cents bigint)
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
      -- o piso: a série começa em `current_date` e uma parcela datada antes disso não teria
      -- dia na janela para aparecer em "entra/sai", só mexeria no saldo
      greatest(coalesce((x->>'start')::date, d), current_date) as inicio
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

revoke execute on function private.draft_effect(jsonb, date) from public, anon;
grant execute on function private.draft_effect(jsonb, date) to authenticated, service_role;
