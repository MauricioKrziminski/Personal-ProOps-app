-- A tela pode alterar os campos da ocorrencia e o calendario da serie numa
-- mesma acao. Duas chamadas RPC deixam metade gravada se a segunda falhar.
-- Uma chamada a esta funcao e uma unica transacao PostgreSQL: qualquer erro
-- no segundo passo desfaz tambem o primeiro.
create or replace function public.update_recurring_occurrence_and_series(
  p_transaction_id uuid,
  p_recurring_id uuid,
  p_line_patch jsonb,
  p_series_patch jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  anchor record;
  serie record;
  changed bigint := 0;
begin
  if (p_line_patch is not null and jsonb_typeof(p_line_patch) <> 'object')
     or (p_series_patch is not null and jsonb_typeof(p_series_patch) <> 'object') then
    raise exception 'Alteracoes precisam ser objetos';
  end if;
  if coalesce(p_line_patch, '{}'::jsonb) = '{}'::jsonb
     and coalesce(p_series_patch, '{}'::jsonb) = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;

  -- RLS continua valendo. Trancar as duas linhas tambem impede que a relacao
  -- entre ocorrencia e serie mude entre a validacao e a edicao.
  select t.recurring_id, t.workspace_id into anchor
  from public.transactions t where t.id = p_transaction_id for update;
  select r.workspace_id into serie
  from public.recurring_transactions r where r.id = p_recurring_id for update;
  if anchor.recurring_id is distinct from p_recurring_id
     or anchor.workspace_id is null or serie.workspace_id is null
     or anchor.workspace_id <> serie.workspace_id then
    raise exception 'Ocorrencia e serie precisam pertencer ao mesmo registro';
  end if;

  if coalesce(p_line_patch, '{}'::jsonb) <> '{}'::jsonb then
    changed := public.update_transaction_scoped(p_transaction_id, 'future', p_line_patch);
  end if;
  if coalesce(p_series_patch, '{}'::jsonb) <> '{}'::jsonb then
    -- true propaga os campos da serie para as ocorrencias em aberto.
    changed := greatest(changed,
      public.update_recurring_series(p_recurring_id, p_series_patch, true));
  end if;
  return changed;
end;
$$;

revoke execute on function public.update_recurring_occurrence_and_series(uuid, uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.update_recurring_occurrence_and_series(uuid, uuid, jsonb, jsonb)
  to authenticated;
