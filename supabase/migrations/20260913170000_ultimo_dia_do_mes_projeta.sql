-- "Todo último dia do mês" precisa APARECER na projeção.
--
-- O campo "Vence quando" (Dia do mês / Último dia) sai do formulário de recorrentes: a data já
-- diz tudo — escolher 31/10, que é o último dia de outubro, passa a gravar `BYMONTHDAY=-1`
-- sozinho. Só que `-1` era, até aqui, uma forma que a projeção NÃO sabia ler.
--
-- ⚠️ **Sem esta migration, tirar o campo apaga dinheiro da tela em silêncio.**
-- `private.recurring_projection_for` filtrava `'^FREQ=MONTHLY;BYMONTHDAY=[0-9]+$'` — **sem o
-- sinal de menos** — e extraía com `BYMONTHDAY=([0-9]+)`. Uma série "último dia" simplesmente
-- não projetava NADA além de `materialized_until`: um mês com conta a pagar aparecendo sem a
-- conta. A `20260910140000` justificou esse "falha fechada" dizendo que `-1` era 0% da produção;
-- tornar `-1` o PADRÃO inverte exatamente essa premissa.
--
-- ⚠️ **`-1` vira 31, e não é gambiarra:** `private.day_in_month(d, 31)` já clampa para o último
-- dia do mês (`least(31, dias_do_mes)`), que é a definição de `BYMONTHDAY=-1`. Reimplementar a
-- aritmética aqui seria a segunda cópia da regra de "último dia", que é o defeito que a
-- `0013` resolveu.
--
-- ⚠️ **`INTERVAL=` continua fora, de propósito.** `FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=5` segue
-- não projetando — é uma lacuna ANTERIOR a esta mudança e independente dela (pular meses é lógica
-- nova, não um caractere no regex). Falha fechada: número faltando é visível, número errado não.
--
-- ⚠️ `create or replace` APAGA toda cláusula que a definição nova não repetir. `set search_path`
-- e a estabilidade vão no cabeçalho, repetidos — pendurados por `alter`, morrem no próximo
-- replace (a lição da `20260911160000`).

create or replace function private.recurring_projection_for(
  ws_ids uuid[], from_date date, to_date date
)
returns table (
  recurring_id uuid, kind text, amount_cents bigint, category text,
  description text, account_id uuid, due_date date
)
language sql stable
set search_path = public
as $$
  select r.id, r.kind, r.amount_cents, coalesce(r.category, 'outros'),
         coalesce(nullif(r.description, ''), r.category, 'Recorrente'),
         r.account_id, d.due_date
  from public.recurring_transactions r
  cross join lateral (
    select private.day_in_month(
             m::date,
             -- `-1` é "último dia do mês" na RRULE. 31 diz a MESMA coisa para `day_in_month`,
             -- que clampa — fevereiro cai no 28/29 sem nenhum ramo a mais.
             case
               when (regexp_match(r.rrule, 'BYMONTHDAY=(-?[0-9]+)'))[1] = '-1' then 31
               else ((regexp_match(r.rrule, 'BYMONTHDAY=(-?[0-9]+)'))[1])::int
             end
           ) as due_date
    from generate_series(
           date_trunc('month', from_date),
           date_trunc('month', to_date),
           interval '1 month'
         ) m
  ) d
  where r.workspace_id = any(ws_ids)
    and r.active
    -- fail closed: as duas formas que existem de verdade — dia fixo e último dia
    and r.rrule ~ '^FREQ=MONTHLY;BYMONTHDAY=(-1|[0-9]+)$'
    and d.due_date between from_date and to_date
    -- estritamente DEPOIS do que o cron já criou como linha real — é o que impede
    -- a projeção de duplicar uma ocorrência que já existe em `transactions`
    and d.due_date > coalesce(r.materialized_until::date, date '1900-01-01')
    and (r.end_date is null or d.due_date <= r.end_date)
    and (r.dtstart is null or d.due_date >= r.dtstart::date);
$$;

revoke execute on function private.recurring_projection_for(uuid[], date, date) from public, anon;
grant execute on function private.recurring_projection_for(uuid[], date, date) to authenticated, service_role;
