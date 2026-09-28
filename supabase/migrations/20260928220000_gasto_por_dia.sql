-- O gasto e a entrada de CADA DIA — a semana da Hoje (spec 2026-09-28-hoje-o-dia-design.md).
--
-- ⚠️ **A MESMA régua de `transactions_summary`, e é de propósito.** A barra de hoje tem de ser
-- exatamente o "saiu hoje" que a Hoje sempre escreveu com `transactions_summary(hoje, hoje)`:
-- sem transferência, pela data do lançamento (`occurred_at`) e com o previsto dentro (o total,
-- não o realizado). Uma régua própria aqui seria a segunda cópia que um dia discorda — e o modo de
-- falha é mudo: a barra de hoje diria um número e a lista de Lançamentos daquele dia, outro.
-- `supabase/tests/gasto_por_dia.sql` prende a igualdade dia a dia.
--
-- **Todo dia da janela volta, inclusive o zerado** (`generate_series`): um dia sem gasto é uma
-- barra baixa, não uma coluna que falta — e o app não precisa inventar zero.
--
-- **Janela de no máximo 62 dias, recusada acima disso** (22023), nunca cortada em silêncio: quem
-- pede demais recebe erro, não uma série menor que ele não sabe que é menor (a lição das 1000
-- linhas do PostgREST na Projeção, `finance.md`). Janela invertida ou nula também é recusada —
-- devolver vazio seria o mesmo silêncio.
--
-- Sem `current_date` e sem timestamp: as datas chegam prontas do chamador (o dia LOCAL,
-- `localISODate`) e a série é aritmética de DATA (`p_from + i`) — `generate_series(date, date,
-- interval)` escolheria a versão `timestamptz` e o `::date` dependeria do fuso da sessão.
--
-- Padrão duplo (`supabase.md`): `_daily_spending(uid, …)` para o agente, que conecta sem
-- `auth.uid()`; `daily_spending(…)` para o app, sob RLS. A query se repete nas duas de propósito.

create or replace function public._daily_spending(uid uuid, p_from date, p_to date)
returns table(day date, expense_cents bigint, income_cents bigint)
language plpgsql stable
security definer
set search_path = public
as $fn$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 61 then
    raise exception using errcode = '22023', message = 'daily_spending: janela inválida ou maior que 62 dias';
  end if;
  return query
    select p_from + i,
           coalesce(sum(t.amount_cents) filter (where t.kind = 'expense'), 0)::bigint,
           coalesce(sum(t.amount_cents) filter (where t.kind = 'income'), 0)::bigint
    from generate_series(0, p_to - p_from) i
    left join public.transactions t
      on t.occurred_at = p_from + i
     and t.occurred_at between p_from and p_to
     and t.kind <> 'transfer'
     and t.workspace_id in (select public._workspace_ids(uid))
    group by i
    order by i;
end
$fn$;
revoke execute on function public._daily_spending(uuid, date, date) from public, anon, authenticated;

create or replace function public.daily_spending(p_from date, p_to date)
returns table(day date, expense_cents bigint, income_cents bigint)
language plpgsql stable
security invoker
set search_path = public
as $fn$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 61 then
    raise exception using errcode = '22023', message = 'daily_spending: janela inválida ou maior que 62 dias';
  end if;
  return query
    select p_from + i,
           coalesce(sum(t.amount_cents) filter (where t.kind = 'expense'), 0)::bigint,
           coalesce(sum(t.amount_cents) filter (where t.kind = 'income'), 0)::bigint
    from generate_series(0, p_to - p_from) i
    left join public.transactions t
      on t.occurred_at = p_from + i
     and t.occurred_at between p_from and p_to
     and t.kind <> 'transfer'
     and t.workspace_id in (select private.my_workspace_ids())
    group by i
    order by i;
end
$fn$;
revoke execute on function public.daily_spending(date, date) from public, anon;
grant execute on function public.daily_spending(date, date) to authenticated;
