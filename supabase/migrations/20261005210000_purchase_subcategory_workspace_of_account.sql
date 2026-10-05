-- Lote C: o detalhe de uma compra parcelada é validado no espaço da CONTA, não no espaço padrão de
-- quem chama. A `20261003193000` usava `public.my_default_workspace()`: quem tem dois espaços e
-- parcela no cartão do segundo via o detalhe do segundo recusado (ou, pior, validado contra o
-- catálogo do primeiro). Corpo, cabeçalho e permissões idênticos aos de antes; muda só o espaço.
create or replace function private.criar_registro_da_hipotese(p_tipo text,p_dados jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare p jsonb;result jsonb;parent uuid;ids uuid[];
begin
  p:=case when p_tipo='lancamento' then '{}'::jsonb else private.financial_metadata_patch(p_dados) end;
  if p_tipo='parcelada' and p?'subcategory_id' then
    perform private.validate_subcategory_reference(
      (select a.workspace_id from public.accounts a where a.id=(p_dados->>'p_account_id')::uuid),
      p_dados->>'p_category',(p->>'subcategory_id')::uuid);
  end if;
  result:=private.criar_registro_da_hipotese_classification_core(p_tipo,case when p_tipo='parcelada'
    then p_dados-array['expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'] else p_dados end);
  if p_tipo='parcelada' and p<>'{}' then
    parent:=(result->'ids'->>0)::uuid;
    perform private.apply_financial_metadata('installment_plans',array[parent],p);
    ids:=array(select id from public.transactions where installment_plan_id=parent or down_payment_plan_id=parent);
    perform private.apply_financial_metadata('transactions',ids,p);
  end if;
  return result;
end $$;
revoke execute on function private.criar_registro_da_hipotese(text,jsonb) from public,anon;
grant execute on function private.criar_registro_da_hipotese(text,jsonb) to authenticated;
