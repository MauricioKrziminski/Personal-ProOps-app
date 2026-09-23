-- O mês financeiro pode fechar em qualquer dia, até o 31.
--
-- A `20260911020000` pôs teto de 28 "para o dia existir em fevereiro", e a grade do Perfil parava
-- no 28. A queixa (23/09/2026): *"o mês vai só até o dia 28 em vez de ir até o 31"*. Quem recebe
-- no dia 30 não tinha como dizer isso.
--
-- O teto existia porque `cycle_bounds` SOMAVA o dia ao início do mês: com 31, o ciclo de março
-- começaria em 01/02 + 31 = 04/03. O cartão já resolve o mesmo problema desde a `0013`, com
-- `private.day_in_month` (dia 31 em fevereiro cai no último dia). Aqui é a mesma regra: quem
-- fecha no 30 fecha no 28 de fevereiro, e o ciclo de março começa no dia 1º.
--
-- ⚠️ **O 31 não é gravado.** Com o clamp, "fecha no dia 31" É "fecha no último dia do mês", que já
-- é o `null` (o comportamento de sempre). Dois valores para a mesma coisa são duas leituras que
-- um dia divergem — a grade grava `null` quando a pessoa toca no 31. Daí o teto de 30 no `check`.
--
-- `private.cycle_month_of` NÃO muda, e isso foi conferido: `extract(day) <= close_day` já dá o
-- rótulo certo com o clamp (31/01 com fechamento no 30 pertence a fevereiro, cujo ciclo começa em
-- 31/01; 28/02 pertence a fevereiro, cujo ciclo termina em 28/02). As 18 leituras de ciclo passam
-- por estas duas funções — nenhuma outra soma o dia.

alter table public.workspaces
  drop constraint if exists workspaces_cycle_close_day_check;
alter table public.workspaces
  add constraint workspaces_cycle_close_day_check
    check (cycle_close_day is null or cycle_close_day between 1 and 30);

comment on column public.workspaces.cycle_close_day is
  'Dia em que o mês financeiro FECHA, 1 a 30. null = último dia do mês (é o que o 31 grava). '
  'Em mês mais curto, 29 e 30 fecham no último dia (private.day_in_month).';

-- `create or replace` apaga o que não for repetido: o cabeçalho repete `immutable` e o
-- `search_path` da versão anterior.
create or replace function private.cycle_bounds(close_day int, p_month date)
returns table (ini date, fim date)
language sql immutable set search_path = public as $$
  select
    case when close_day is null then date_trunc('month', p_month)::date
         else private.day_in_month((date_trunc('month', p_month) - interval '1 month')::date,
                                   close_day) + 1 end,
    case when close_day is null
         then (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date
         else private.day_in_month(date_trunc('month', p_month)::date, close_day) end;
$$;
