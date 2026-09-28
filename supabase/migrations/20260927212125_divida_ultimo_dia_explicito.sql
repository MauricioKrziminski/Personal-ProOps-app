-- Nas dívidas, -1 é a escolha explícita "último dia de cada mês". 30 e 31
-- continuam dias fixos, ajustados só quando o mês não contém o número.
-- Antes dessa migração, a UI chamava due_day=31 de último dia. O intento
-- numérico de um 31 antigo não é recuperável; preservar o significado exibido.
update public.debts set due_day = -1 where due_day = 31;

alter table public.debts drop constraint if exists debts_due_day_check;
alter table public.debts add constraint debts_due_day_check
  check (due_day = -1 or due_day between 1 and 31);

create or replace function private.day_in_month(d date, day_of_month int)
returns date
language sql immutable
set search_path = public
as $$
  select date_trunc('month', d)::date + (
    case when day_of_month = -1
      then extract(day from (date_trunc('month', d) + interval '1 month' - interval '1 day'))::int
      else least(day_of_month,
        extract(day from (date_trunc('month', d) + interval '1 month' - interval '1 day'))::int)
    end - 1
  );
$$;
