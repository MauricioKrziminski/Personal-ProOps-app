-- Ramo do FINANCIAMENTO. Pagamentos saem um a um, do MAIS RECENTE para trás, para o gatilho
-- devolver o saldo na ordem certa. "Todos" é o Excluir por completo (delete_debt).
create or replace function private.apagar_pagamentos(
  p_tipo text, p_id uuid, p_alcance text, p_ws uuid, p_apply boolean
) returns jsonb
language plpgsql set search_path = '' set timezone to 'America/Sao_Paulo'
as $$
declare
  divida uuid; ancora public.transactions%rowtype; ids uuid[]; res jsonb; x uuid;
begin
  if p_tipo = 'debt_payment' then
    select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
    if ancora.debt_id is null then
      raise exception using errcode = '22023', message = 'Este lançamento não é pagamento de uma dívida';
    end if;
    divida := ancora.debt_id;
  else
    divida := p_id;
  end if;
  if p_apply then
    perform 1 from public.debts d where d.id = divida and d.workspace_id = p_ws for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
    end if;
    -- relê depois do travamento: outra transação pode ter apagado ou mexido no pagamento
    if p_tipo = 'debt_payment' then
      select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
      if ancora.id is null or ancora.debt_id is distinct from divida then
        raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
      end if;
    end if;
  end if;

  if p_alcance = 'all' then
    select array_agg(t.id) into ids from public.transactions t
      where (t.debt_id = divida or t.down_payment_debt_id = divida) and t.workspace_id = p_ws;
    ids := coalesce(ids, '{}');
    perform private.recusa_fatura_travada(ids);
    res := private.resumo_do_apagar(ids) || jsonb_build_object('apaga_contrato', true);
    if p_apply then perform public.delete_debt(divida); end if;
    return res;
  end if;

  if p_alcance = 'one' then
    ids := array[ancora.id];
  elsif p_tipo = 'debt_payment' then
    select array_agg(t.id) into ids from public.transactions t
      where t.debt_id = divida and t.workspace_id = p_ws
        and (t.debt_payment_no >= ancora.debt_payment_no
             or (ancora.debt_payment_no is null and t.occurred_at >= ancora.occurred_at));
  else
    -- pelo contrato: "dos próximos em diante" = pagamentos registrados com data depois de hoje
    select array_agg(t.id) into ids from public.transactions t
      where t.debt_id = divida and t.workspace_id = p_ws and t.occurred_at > current_date;
  end if;
  ids := coalesce(ids, '{}');
  perform private.recusa_fatura_travada(ids);
  res := private.resumo_do_apagar(ids);
  if not p_apply then return res; end if;
  for x in select t.id from public.transactions t where t.id = any(ids)
           order by t.debt_payment_no desc nulls last, t.occurred_at desc loop
    delete from public.transactions t where t.id = x;
  end loop;
  return res;
end $$;
revoke execute on function private.apagar_pagamentos(text, uuid, text, uuid, boolean) from public, anon, authenticated;
