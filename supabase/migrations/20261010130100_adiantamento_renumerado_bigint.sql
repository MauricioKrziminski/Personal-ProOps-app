-- A renumeração por peso de `apagar_parcelas` soma com `sum() over`, que devolve bigint: a função
-- da 20261010130000 recebia int e a chamada não casava. O número do início passa a ser bigint.
drop function if exists private.adiantamento_renumerado(jsonb, int);
create or replace function private.adiantamento_renumerado(p_adiantamento jsonb, p_inicio bigint)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when p_adiantamento is null or p_adiantamento->>'source' <> 'plan' then p_adiantamento
    else jsonb_set(p_adiantamento, '{parcelas}', (
      select coalesce(jsonb_agg(e || jsonb_build_object('n', (e->>'n')::int + p_inicio - x.menor)
                                order by (e->>'n')::int), '[]'::jsonb)
      from jsonb_array_elements(p_adiantamento->'parcelas') e,
           (select min((y->>'n')::int) as menor
              from jsonb_array_elements(p_adiantamento->'parcelas') y) x))
  end
$$;
revoke execute on function private.adiantamento_renumerado(jsonb, bigint) from public, anon;
grant execute on function private.adiantamento_renumerado(jsonb, bigint) to authenticated, service_role;
