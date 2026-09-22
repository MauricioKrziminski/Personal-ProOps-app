-- Meta: retirar mais do que está guardado é RECUSADO (22/09/2026)
--
-- A `0022` somava o ledger com `greatest(sum, 0)`: retirar R$ 300 de uma meta com R$ 100 gravava
-- -300 em `goal_contributions` e mostrava 0 guardado — sem aviso. O estrago vinha depois: o
-- ledger ficava em -200, e o próximo "Guardar R$ 100" dava soma -100, o saldo continuava 0 e o
-- aporte sumia. A tela não impedia (o "Retirar" só olhava valor > 0).
--
-- Conferido antes de aplicar, nos dois ambientes: nenhuma meta com soma negativa — o defeito
-- ainda não tinha corrompido dado. Por isso o `greatest` pode ficar (é cinto para ledger antigo)
-- e a regra nova é só a recusa, ANTES do insert.
--
-- ⚠️ `for update` na META: dois "Retirar" simultâneos leriam o mesmo saldo e passariam os dois.
-- ⚠️ Mesmo cabeçalho da definição viva (conferida por `pg_get_functiondef` nos dois ambientes:
-- `security invoker`, `search_path=public`, sem fuso — o corpo não usa `current_date`; o default
-- do parâmetro é do CHAMADOR, e todo chamador passa a data local, finance.md).

create or replace function public.goal_deposit(
  p_goal_id uuid,
  p_amount_cents bigint,
  p_occurred_at date default current_date,
  p_note text default null
)
returns bigint
language plpgsql security invoker
set search_path = public
as $$
declare
  meta record;
  guardado bigint;
  novo bigint;
begin
  select g.* into meta from public.goals g where g.id = p_goal_id for update;
  if meta.id is null then
    raise exception 'meta % nao encontrada', p_goal_id;
  end if;
  if p_amount_cents = 0 then
    raise exception 'aporte precisa ser diferente de zero';
  end if;

  if p_amount_cents < 0 then
    select greatest(coalesce(sum(c.amount_cents), 0), 0)::bigint into guardado
    from public.goal_contributions c where c.goal_id = p_goal_id;
    if -p_amount_cents > guardado then
      -- sem o valor na frase: dinheiro formatado mora no app (`formatBRL`), que já avisa antes
      raise exception 'Não dá para retirar mais do que está guardado nessa meta.';
    end if;
  end if;

  insert into public.goal_contributions
    (workspace_id, user_id, goal_id, amount_cents, occurred_at, note)
  values (meta.workspace_id, coalesce((select auth.uid()), meta.user_id),
          p_goal_id, p_amount_cents, p_occurred_at, p_note);

  select greatest(coalesce(sum(c.amount_cents), 0), 0)::bigint into novo
  from public.goal_contributions c where c.goal_id = p_goal_id;

  update public.goals set saved_cents = novo where id = p_goal_id;
  return novo;
end;
$$;
