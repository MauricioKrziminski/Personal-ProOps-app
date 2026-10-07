-- Ramo da COMPRA PARCELADA. "Esta e as próximas" encurta; a partir da 1ª é a compra inteira.
-- Sobrando UMA parcela, ela vira lançamento à vista (o plano tem check 2..72); sobrando DUAS ou
-- mais, as que ficam são RENUMERADAS 1..N (update_installment_plan assume 1..N); sem nenhuma, vale
-- o caminho da compra inteira (a entrada vai junto e é contada na prévia).
-- Renumerar só mexe em installment_no e description: não toca data nem conta, então nenhuma
-- parcela travada sai da fatura em que está (set_invoice só acorda com occurred_at/account_id).
create or replace function private.apagar_parcelas(
  p_tipo text, p_id uuid, p_alcance text, p_ws uuid, p_apply boolean
) returns jsonb
language plpgsql set search_path = '' set timezone to 'America/Sao_Paulo'
as $$
declare
  plano public.installment_plans%rowtype;
  ancora public.transactions%rowtype;
  n_ancora int; ids uuid[]; res jsonb; total int; restantes int; soma bigint; sobra uuid; nome text;
  contrato boolean := false;
begin
  if p_tipo = 'installment' then
    select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
    if ancora.installment_plan_id is null then
      raise exception using errcode = '22023', message = 'Este lançamento não é parcela de uma compra';
    end if;
    select * into plano from public.installment_plans p where p.id = ancora.installment_plan_id;
  else
    select * into plano from public.installment_plans p where p.id = p_id;
  end if;
  if plano.id is null or plano.workspace_id <> p_ws then
    raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
  end if;
  if p_apply then
    perform 1 from public.installment_plans p where p.id = plano.id for update;
    perform 1 from public.transactions t where t.installment_plan_id = plano.id order by t.id for update;
    -- relê depois do travamento: outra transação pode ter apagado ou mexido
    select * into plano from public.installment_plans p where p.id = plano.id;
    if plano.id is null then
      raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
    end if;
    if p_tipo = 'installment' then
      select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
      if ancora.id is null or ancora.installment_plan_id is distinct from plano.id then
        raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
      end if;
    end if;
  end if;

  if p_tipo = 'installment' then
    n_ancora := ancora.installment_no;
  else
    -- pelo contrato, "próximas" = a primeira parcela em aberto fora de fatura travada
    select min(t.installment_no) into n_ancora from public.transactions t
      where t.installment_plan_id = plano.id and t.workspace_id = p_ws and t.status = 'pending'
        and not private.parcela_travada('pending', t.invoice_id);
    if n_ancora is null and p_alcance = 'future' then
      return private.resumo_do_apagar('{}');
    end if;
  end if;

  select count(*) into total from public.transactions t where t.installment_plan_id = plano.id;
  if p_alcance = 'all' or (p_alcance = 'future' and n_ancora <= 1) then
    contrato := true;
  else
    if p_alcance = 'one' then
      ids := array[ancora.id];
    else
      select array_agg(t.id) into ids from public.transactions t
        where t.installment_plan_id = plano.id and t.workspace_id = p_ws and t.installment_no >= n_ancora;
    end if;
    ids := coalesce(ids, '{}');
    -- não sobra parcela: é a compra inteira, com a entrada
    contrato := cardinality(ids) >= total;
  end if;

  if contrato then
    select array_agg(t.id) into ids from public.transactions t
      where (t.installment_plan_id = plano.id or t.down_payment_plan_id = plano.id) and t.workspace_id = p_ws;
    ids := coalesce(ids, '{}');
    perform private.recusa_fatura_travada(ids);
    res := private.resumo_do_apagar(ids) || jsonb_build_object('apaga_contrato', true);
    if p_apply then perform public.delete_installment_purchase(plano.id); end if;
    return res;
  end if;

  perform private.recusa_fatura_travada(ids);
  restantes := total - cardinality(ids);
  res := private.resumo_do_apagar(ids) || jsonb_build_object('vira_avista', restantes = 1);
  if not p_apply then return res; end if;

  delete from public.transactions t where t.id = any(ids);
  if restantes = 1 then
    select t.id into sobra from public.transactions t where t.installment_plan_id = plano.id;
    update public.transactions t set installment_plan_id = null, installment_no = null,
           description = coalesce(plano.description, plano.merchant, t.description)
     where t.id = sobra;
    delete from public.installment_plans p where p.id = plano.id;
  else
    nome := coalesce(plano.description, plano.merchant, 'Compra parcelada');
    update public.transactions t set installment_no = s.k,
           description = nome || ' (' || s.k || '/' || restantes || ')'
      from (select x.id, row_number() over (order by x.installment_no) k
              from public.transactions x where x.installment_plan_id = plano.id) s
     where t.id = s.id;
    select sum(t.amount_cents) into soma from public.transactions t where t.installment_plan_id = plano.id;
    update public.installment_plans p set installments = restantes, total_cents = soma,
           first_occurred_at = (select t.occurred_at from public.transactions t
                                 where t.installment_plan_id = plano.id and t.installment_no = 1)
     where p.id = plano.id;
  end if;
  return res;
end $$;
revoke execute on function private.apagar_parcelas(text, uuid, text, uuid, boolean) from public, anon, authenticated;
