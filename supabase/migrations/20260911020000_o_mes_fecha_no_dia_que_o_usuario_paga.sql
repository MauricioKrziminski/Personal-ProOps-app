-- O "mês" do app era sempre do dia 1 ao 31, e para quem paga tudo no mesmo dia isso corta o
-- ciclo ao meio.
--
-- O caso que motivou (dono do produto, 10/09/2026): salário cai dia 5 e dia 20, e as DUAS
-- faturas vencem dia 10 — Nubank (fecha dia 3) e BB (fecha no último dia). O período que
-- importa para ele é **11 de agosto a 10 de setembro**: recebe, gasta, e no dia 10 paga tudo.
-- Lido de 1 a 31, o salário do dia 20 aparece num balde e a fatura que ele paga com esse
-- salário aparece no seguinte. A queixa foi literal: *"eu não quero olhar para o mês do dia 1
-- ao 31, eu quero olhar para o ciclo dentro do período do salário"*.
--
-- Isto é padrão do nicho, não invenção: YNAB, Monarch, Mobills e Organizze todos oferecem dia
-- de início/fechamento do mês configurável. No Brasil, assalariado que recebe no dia 5 e paga
-- fatura no dia 10 é o caso MODAL, não a exceção.
--
-- ⚠️ **Isto é parâmetro de LEITURA, e não encosta na regra de fatura.** Quem decide em qual
-- fatura uma compra cai continua sendo o trigger `set_invoice` pelo `closing_day` do cartão, e
-- a projeção continua tirando o dinheiro do caixa na data de VENCIMENTO. Uma compra no Nubank
-- dia 04/09 cai na fatura que vence 10/10 — isso já era verdade e continua sendo, com ou sem
-- ciclo. O ciclo só muda ONDE a régua corta o gráfico.
--
-- `null` = último dia do mês, que é exatamente o comportamento de antes. Ninguém que não mexer
-- na configuração vê diferença nenhuma.

alter table public.workspaces
  add column if not exists cycle_close_day int
    check (cycle_close_day is null or cycle_close_day between 1 and 28);

comment on column public.workspaces.cycle_close_day is
  'Dia em que o mês financeiro FECHA. null = último dia do mês. Teto 28 para o dia existir '
  'em fevereiro — sem isso o ciclo mudaria de tamanho conforme o mês.';

-- O dia de fechamento do espaço. Ordenado por id para ser determinístico com múltiplos
-- workspaces (o caso normal é um só).
create or replace function private.cycle_close_day(ws_ids uuid[])
returns int
language sql stable set search_path = public as $$
  select w.cycle_close_day from public.workspaces w
  where w.id = any(ws_ids) order by w.id limit 1;
$$;

-- As bordas do ciclo ROTULADO por um mês. O rótulo é o mês em que o ciclo TERMINA, que é como
-- o usuário fala: "setembro" é o que ele paga no dia 10 de setembro.
--
--   fecha=null, setembro  ->  01/09 a 30/09   (o mês civil, como sempre foi)
--   fecha=10,   setembro  ->  11/08 a 10/09
create or replace function private.cycle_bounds(close_day int, p_month date)
returns table (ini date, fim date)
language sql immutable set search_path = public as $$
  select
    case when close_day is null then date_trunc('month', p_month)::date
         else (date_trunc('month', p_month) - interval '1 month')::date + close_day end,
    case when close_day is null
         then (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date
         else date_trunc('month', p_month)::date + (close_day - 1) end;
$$;

-- Em qual ciclo cai um DIA — devolve o rótulo (o primeiro dia do mês que nomeia o ciclo).
-- Com fecha=10, 15/09 pertence ao ciclo 11/09–10/10, que se chama "outubro".
create or replace function private.cycle_month_of(close_day int, d date)
returns date
language sql immutable set search_path = public as $$
  select date_trunc('month',
           case when close_day is null or extract(day from d)::int <= close_day
                then d else (d + interval '1 month') end)::date;
$$;

revoke execute on function private.cycle_close_day(uuid[]) from public, anon;
grant execute on function private.cycle_close_day(uuid[]) to authenticated, service_role;
