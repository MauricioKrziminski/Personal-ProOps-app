-- O aporte da meta se edita (26/09/2026, *"tudo que se cria se edita"*).
--
-- O aporte nascia com valor, nota e a data de HOJE (a tela nem perguntava), e depois só tinha
-- "Desfazer" — que lançava um estorno negativo ao lado. Corrigir o valor, a nota ou o dia de um
-- aporte obrigava a desfazer e lançar de novo, com duas linhas a mais no extrato.
--
-- `edit_goal_contribution` muda AQUELE aporte, com a mesma trava do `goal_deposit`: a meta não
-- fica com menos que zero guardado (`for update` na meta, pelo mesmo motivo). `saved_cents` é
-- refeito do ledger, como no aporte. Mesmo cabeçalho do `goal_deposit` (sem fuso: o corpo não usa
-- `current_date`).
-- Teste: `supabase/tests/editar_aporte_da_meta.sql`.

create or replace function public.edit_goal_contribution(
  p_contribution_id uuid,
  p_amount_cents bigint,
  p_occurred_at date,
  p_note text default null
)
returns bigint
language plpgsql security invoker
set search_path = public
as $$
declare
  aporte record;
  meta record;
  novo bigint;
begin
  select c.* into aporte from public.goal_contributions c where c.id = p_contribution_id;
  if aporte.id is null then
    raise exception 'Esse aporte não existe mais.';
  end if;
  select g.* into meta from public.goals g where g.id = aporte.goal_id for update;
  if p_amount_cents is null or p_amount_cents = 0 then
    raise exception 'O valor precisa ser diferente de zero';
  end if;
  if p_occurred_at is null then
    raise exception 'Informe a data do aporte';
  end if;

  select coalesce(sum(c.amount_cents), 0) - aporte.amount_cents + p_amount_cents into novo
  from public.goal_contributions c where c.goal_id = aporte.goal_id;
  if novo < 0 then
    raise exception 'Não dá para retirar mais do que está guardado nessa meta.';
  end if;

  update public.goal_contributions c set
    amount_cents = p_amount_cents,
    occurred_at = p_occurred_at,
    note = nullif(trim(coalesce(p_note, '')), '')
  where c.id = aporte.id;

  update public.goals set saved_cents = novo where id = aporte.goal_id;
  return novo;
end;
$$;

revoke execute on function public.edit_goal_contribution(uuid, bigint, date, text) from public, anon;
grant execute on function public.edit_goal_contribution(uuid, bigint, date, text) to authenticated;
