-- Editar um limite de orçamento é editar AQUELE limite (26/09/2026, *"tudo que se cria se edita"*).
--
-- A edição passava por `save_budget`, que é um upsert por (categoria[, mês]): a categoria não
-- mudava (a tela a mostrava só como texto), e trocar "Vale para" ACRESCENTAVA uma linha em vez de
-- mover — pior no caminho "Só este mês" → "Todo mês": o limite novo ia para os outros meses e
-- ESTE mês continuava com o valor velho, porque o limite dele seguia lá por cima.
--
-- `edit_budget` acha o limite editado pela chave dele (categoria + mês, nulo = todo mês) e:
-- - mantém o alcance: muda o próprio limite, inclusive a categoria;
-- - "Todo mês" → "Só este mês": cria o deste mês e o de todo mês FICA (é o que "só este" diz);
-- - "Só este mês" → "Todo mês": grava o de todo mês e APAGA o deste mês — este mês passa a usar o
--   novo;
-- - a categoria que já tem limite no mesmo alcance é recusada, dizendo qual.
-- Teste: `supabase/tests/editar_limite_do_orcamento.sql`.

create or replace function public.edit_budget(
  p_category_antes text,
  p_month_antes date,
  p_category text,
  p_limit_cents bigint,
  p_rollover boolean default false,
  p_month date default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  ws uuid := public.my_default_workspace();
  antes record;
  categoria text := lower(trim(p_category));
  mes date := case when p_month is null then null else date_trunc('month', p_month)::date end;
  mes_antes date := case when p_month_antes is null then null else date_trunc('month', p_month_antes)::date end;
  resultado uuid;
begin
  if ws is null then
    raise exception 'nenhum espaco encontrado para o usuario';
  end if;
  if coalesce(p_limit_cents, 0) <= 0 then
    raise exception 'O limite precisa ser maior que zero';
  end if;
  if coalesce(categoria, '') = '' then
    raise exception 'Escolha a categoria';
  end if;

  select b.* into antes from public.budgets b
   where b.workspace_id = ws and b.category = lower(trim(p_category_antes))
     and b.month is not distinct from mes_antes
   for update;
  if antes.id is null then
    raise exception 'Esse limite não existe mais.';
  end if;

  -- A categoria nova não pode tomar a de outro limite no alcance de destino (o `save_budget`
  -- abaixo é upsert e sobrescreveria calado).
  if categoria <> antes.category and exists (
    select 1 from public.budgets b
     where b.workspace_id = ws and b.category = categoria and b.month is not distinct from mes
  ) then
    raise exception 'Já existe um limite de % %.', categoria,
      case when mes is null then 'para todo mês' else 'para este mês' end;
  end if;

  if mes_antes is not null and mes is null then
    -- "Só este mês" → "Todo mês": o deste mês sai e o de todo mês vale para ele também.
    delete from public.budgets b where b.id = antes.id;
    return public.save_budget(categoria, p_limit_cents, p_rollover, null);
  end if;
  if mes_antes is null and mes is not null then
    -- "Todo mês" → "Só este mês": o de todo mês fica; este mês ganha o próprio.
    return public.save_budget(categoria, p_limit_cents, p_rollover, mes);
  end if;

  -- Mesmo alcance: muda o próprio limite (a categoria já foi conferida acima).
  update public.budgets b set
    category = categoria,
    limit_cents = p_limit_cents,
    rollover = coalesce(p_rollover, false)
   where b.id = antes.id
  returning b.id into resultado;
  return resultado;
end;
$$;

revoke execute on function public.edit_budget(text, date, text, bigint, boolean, date) from public, anon;
grant execute on function public.edit_budget(text, date, text, bigint, boolean, date) to authenticated;
