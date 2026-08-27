-- Salvar orçamento passa a ser RPC.
--
-- Motivo: a `0022` criou DOIS unique PARCIAIS (um `where month is null`, outro
-- `where month is not null`, porque no Postgres NULL não colide com NULL). O
-- Postgres só casa um índice parcial se o ON CONFLICT repetir o MESMO predicado
-- — e o PostgREST não tem como mandar isso pelo `on_conflict` da query string.
-- Resultado: todo upsert de orçamento vindo do app morria com 42P10
-- ("there is no unique or exclusion constraint matching the ON CONFLICT
-- specification"), e a tela só mostrava "Não deu para salvar".
--
-- Com a RPC, o predicado fica onde ele pode existir: no SQL.
create or replace function public.save_budget(
  p_category text,
  p_limit_cents bigint,
  p_rollover boolean default false,
  p_month date default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  ws uuid := public.my_default_workspace();
  autor uuid := (select auth.uid());
  resultado uuid;
begin
  if ws is null then
    raise exception 'nenhum espaco encontrado para o usuario';
  end if;
  if coalesce(p_limit_cents, 0) <= 0 then
    raise exception 'limite precisa ser positivo';
  end if;
  if coalesce(trim(p_category), '') = '' then
    raise exception 'categoria obrigatoria';
  end if;

  if p_month is null then
    -- limite padrão: vale para todo mês que não tiver override
    insert into public.budgets (workspace_id, user_id, category, limit_cents, rollover, month)
    values (ws, autor, lower(trim(p_category)), p_limit_cents, coalesce(p_rollover, false), null)
    on conflict (workspace_id, category) where month is null
    do update set limit_cents = excluded.limit_cents,
                  rollover = excluded.rollover
    returning id into resultado;
  else
    -- override de um mês: sempre ancorado no dia 1
    insert into public.budgets (workspace_id, user_id, category, limit_cents, rollover, month)
    values (ws, autor, lower(trim(p_category)), p_limit_cents, coalesce(p_rollover, false),
            date_trunc('month', p_month)::date)
    on conflict (workspace_id, category, month) where month is not null
    do update set limit_cents = excluded.limit_cents,
                  rollover = excluded.rollover
    returning id into resultado;
  end if;

  return resultado;
end;
$$;
