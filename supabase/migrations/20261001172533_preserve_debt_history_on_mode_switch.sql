-- A decisão de 26/09 permite trocar o modo: o contrato novo não reescreve pagamentos
-- nem entrada. Derive o contrato pelo DESTINO, preservando os locks, RLS, revisões e requests.
-- Todas com pagamentos reais mantém a recusa de revisão econômica do histórico, inclusive
-- quando a mudança de principal/juros está implícita no modo; use futuras nesse caso.
create or replace function public.update_debt_contract_scoped(
  p_debt_id uuid, p_anchor_no integer, p_scope text, p_patch jsonb,
  p_expected_revision bigint, p_expected_payment_versions jsonb, p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  caller_uid uuid := auth.uid();
  request_row record;
  d record;
  payment record;
  destination_mode text;
  mode_changed boolean;
  new_contract record;
  new_amount bigint;
  new_day int;
  new_due_date date;
  old_estimate bigint;
  changed_count int := 0;
  response jsonb;
begin
  if caller_uid is null then raise exception 'Sessão autenticada obrigatória'; end if;
  if p_request_id is null then raise exception 'Identificador da requisição obrigatório'; end if;
  if p_scope not in ('one','future','all') then raise exception 'Escopo da dívida inválido'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch='{}'::jsonb then
    raise exception 'Nenhuma alteração da dívida informada';
  end if;
  insert into private.debt_contract_edit_requests
    (user_id,request_id,debt_id,anchor_no,scope,patch,expected_revision,expected_payment_versions)
  values (caller_uid,p_request_id,p_debt_id,p_anchor_no,p_scope,p_patch,
    p_expected_revision,p_expected_payment_versions)
  on conflict (user_id,request_id) do nothing;
  select * into request_row from private.debt_contract_edit_requests
    where user_id=caller_uid and request_id=p_request_id for update;
  if request_row.debt_id is distinct from p_debt_id
    or request_row.anchor_no is distinct from p_anchor_no
    or request_row.scope is distinct from p_scope
    or request_row.patch is distinct from p_patch
    or request_row.expected_revision is distinct from p_expected_revision
    or request_row.expected_payment_versions is distinct from p_expected_payment_versions then
    raise exception 'Identificador da requisição reutilizado com dados diferentes';
  end if;
  if request_row.result is not null then return request_row.result; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k not in
    ('name','kind','calculation_mode','principal_cents','remaining_cents','interest_rate_monthly',
     'installments','installments_paid','installment_cents','account_id','due_day',
     'first_due_date','due_date')) then
    raise exception 'Campo não permitido na edição do contrato';
  end if;
  if p_scope='one' and exists (select 1 from jsonb_object_keys(p_patch) k
    where k not in ('installment_cents','due_date')) then
    raise exception 'Nesta parcela só é possível editar valor e vencimento';
  end if;
  -- "Das próximas em diante" (future) muda o CONTRATO em qualquer campo e não reescreve os
  -- pagamentos feitos (28/09/2026). Recusar nome, conta e saldo aqui deixava a opção sem saída.
  if p_scope<>'one' and p_patch ? 'due_date' then
    raise exception 'Para próximas parcelas, informe a regra do dia e a âncora do contrato';
  end if;
  if p_patch ? 'calculation_mode' and (jsonb_typeof(p_patch->'calculation_mode') is distinct from 'string'
    or (p_patch->>'calculation_mode') not in ('fixed_installments','amortized')) then
    raise exception 'Modo de cálculo inválido';
  end if;
  if p_patch ? 'installment_cents' and p_patch->'installment_cents'<>'null'::jsonb then
    if jsonb_typeof(p_patch->'installment_cents') <> 'number'
      or (p_patch->>'installment_cents')::numeric <> trunc((p_patch->>'installment_cents')::numeric)
      or (p_patch->>'installment_cents')::numeric <= 0 then
      raise exception 'Valor da parcela deve ser inteiro e maior que zero';
    end if;
    new_amount := (p_patch->>'installment_cents')::bigint;
  end if;
  if p_patch ? 'due_day' then
    if jsonb_typeof(p_patch->'due_day') <> 'number' then raise exception 'Dia inválido'; end if;
    new_day := (p_patch->>'due_day')::int;
    if new_day <> -1 and (new_day < 1 or new_day > 31) then raise exception 'Dia inválido'; end if;
  end if;
  if p_patch ? 'due_date' then
    if jsonb_typeof(p_patch->'due_date') <> 'string' then raise exception 'Vencimento inválido'; end if;
    new_due_date := (p_patch->>'due_date')::date;
  end if;
  select * into d from public.debts where id=p_debt_id for update;
  if d.id is null or d.archived then raise exception 'Dívida ativa não encontrada'; end if;
  destination_mode := coalesce(p_patch->>'calculation_mode',d.calculation_mode);
  mode_changed := destination_mode is distinct from d.calculation_mode;
  if p_patch->'installment_cents'='null'::jsonb and (destination_mode<>'amortized' or not mode_changed) then
    raise exception 'Valor da parcela deve ser inteiro e maior que zero';
  end if;
  if d.edit_revision is distinct from p_expected_revision then
    raise exception 'A dívida mudou enquanto você editava';
  end if;
  if d.installments is null or p_anchor_no is null
    or p_anchor_no <> d.installments_paid+1
    or (p_scope <> 'all' and p_anchor_no > d.installments) then
    raise exception 'Abra novamente a próxima parcela para editar esta dívida';
  end if;
  if p_scope='one' and p_patch ? 'installment_cents' and d.calculation_mode <> 'fixed_installments' then
    raise exception 'Valor individual de dívida com juros exige recálculo Price; edite Todas';
  end if;
  if p_patch ? 'name' and nullif(btrim(p_patch->>'name'), '') is null then
    raise exception 'Informe o nome da dívida';
  end if;
  if p_scope='all' and mode_changed
    and exists(select 1 from public.transactions where debt_id=d.id) then
    raise exception 'Para alterar o modo com pagamentos registrados, aplique às próximas parcelas; Todas exige revisão do histórico';
  end if;
  if mode_changed and coalesce((p_patch->>'installments_paid')::int,d.installments_paid)
    < coalesce((select max(debt_payment_no) from public.transactions where debt_id=d.id),0) then
    raise exception 'As parcelas já pagas não podem ficar abaixo dos pagamentos registrados';
  end if;
  if p_scope='all' and (p_patch ? 'principal_cents' or p_patch ? 'remaining_cents'
    or p_patch ? 'interest_rate_monthly')
    and exists (select 1 from public.transactions where debt_id=d.id) then
    raise exception 'Saldo, principal e juros com pagamentos registrados exigem revisão do histórico; não foram alterados';
  end if;
  if not mode_changed and d.calculation_mode <> 'fixed_installments' and p_patch ? 'installment_cents' and (p_patch ? 'installments'
    or p_patch ? 'installments_paid' or p_patch ? 'principal_cents'
    or p_patch ? 'remaining_cents') then
    raise exception 'Altere o valor da parcela separadamente do prazo e do saldo';
  end if;
  if p_scope='all' and (p_patch ? 'installment_cents' or p_patch ? 'account_id' or p_patch ? 'name') then
    perform 1 from public.transactions t where t.debt_id=d.id
      order by t.debt_payment_no,t.id for update;
    if p_expected_payment_versions is null or jsonb_typeof(p_expected_payment_versions)<>'object'
      or (select count(*) from jsonb_object_keys(p_expected_payment_versions)) <>
         (select count(*) from public.transactions where debt_id=d.id)
      or exists (select 1 from public.transactions t where t.debt_id=d.id and
        (not p_expected_payment_versions ? t.id::text
         or t.edit_revision is distinct from (p_expected_payment_versions->>t.id::text)::bigint)) then
      raise exception 'Outro pagamento mudou enquanto você editava';
    end if;
    for payment in select * from public.transactions where debt_id=d.id order by debt_payment_no,id loop
      if payment.debt_payment_no is null or payment.debt_principal_cents is null
        or payment.invoice_id is not null or payment.pays_invoice_id is not null then
        raise exception 'Histórico de pagamento incompleto; nenhuma parcela foi alterada';
      end if;
      if (p_patch ? 'installment_cents' and payment.amount_cents is distinct from new_amount)
         or (p_patch ? 'account_id' and payment.account_id is distinct from (p_patch->>'account_id')::uuid) then
        update public.transactions set
          amount_cents=case when p_patch ? 'installment_cents' then new_amount else amount_cents end,
          account_id=case when p_patch ? 'account_id' then (p_patch->>'account_id')::uuid else account_id end
        where id=payment.id;
        changed_count := changed_count+1;
      end if;
      -- Generated titles follow a contract rename; titles edited by the person remain theirs.
      if p_patch ? 'name' and payment.description = 'Parcela ' || d.name
         and payment.description is distinct from 'Parcela ' || btrim(p_patch->>'name') then
        update public.transactions set description='Parcela ' || btrim(p_patch->>'name')
        where id=payment.id;
        changed_count := changed_count+1;
      end if;
    end loop;
    if p_patch ? 'installment_cents' then
      delete from public.debt_declared_estimates where debt_id=d.id;
    end if;
  end if;
  if p_scope='future' and (mode_changed or p_patch ? 'installment_cents') and d.installments_paid>0 then
    old_estimate := coalesce(d.installment_cents,
      (select s.payment_cents from public.debt_schedule(d.id) s order by s.installment_no limit 1));
    if old_estimate is null or old_estimate<=0 then
      raise exception 'Não é possível preservar as estimativas das parcelas anteriores';
    end if;
    insert into public.debt_declared_estimates(debt_id,installment_no,amount_cents)
    select d.id,n,old_estimate
    from generate_series(1,d.installments_paid) n
    where not exists (select 1 from public.transactions t
      where t.debt_id=d.id and t.debt_payment_no=n)
    on conflict (debt_id,installment_no) do nothing;
  end if;
  if p_scope='one' then
    insert into public.debt_installment_edits(debt_id,installment_no,due_date,amount_cents)
    values (d.id,p_anchor_no,new_due_date,new_amount)
    on conflict (debt_id,installment_no) do update set
      due_date=coalesce(excluded.due_date,public.debt_installment_edits.due_date),
      amount_cents=coalesce(excluded.amount_cents,public.debt_installment_edits.amount_cents);
  else
    delete from public.debt_installment_edits where debt_id=d.id and installment_no>=p_anchor_no;
    update public.debts set
      name=case when p_patch ? 'name' then p_patch->>'name' else name end,
      kind=case when p_patch ? 'kind' then p_patch->>'kind' else kind end,
      calculation_mode=destination_mode,
      principal_cents=case when destination_mode='fixed_installments'
          and (mode_changed or p_patch ? 'installment_cents' or p_patch ? 'installments' or p_patch ? 'installments_paid')
        then coalesce(new_amount,d.installment_cents)
          *coalesce((p_patch->>'installments')::int,installments)
        when p_patch ? 'principal_cents' then (p_patch->>'principal_cents')::bigint
        else principal_cents end,
      remaining_cents=case when destination_mode='fixed_installments'
          and (mode_changed or p_patch ? 'installment_cents' or p_patch ? 'installments' or p_patch ? 'installments_paid')
        then coalesce(new_amount,d.installment_cents)
          *(coalesce((p_patch->>'installments')::int,installments)
            -coalesce((p_patch->>'installments_paid')::int,installments_paid))
        when p_patch ? 'remaining_cents' then (p_patch->>'remaining_cents')::bigint
        else remaining_cents end,
      interest_rate_monthly=case when destination_mode='fixed_installments' and mode_changed
          and not p_patch ? 'interest_rate_monthly' then 0
        when p_patch ? 'interest_rate_monthly'
        then (p_patch->>'interest_rate_monthly')::numeric else interest_rate_monthly end,
      installments=case when p_patch ? 'installments' then (p_patch->>'installments')::int else installments end,
      installments_paid=case when p_patch ? 'installments_paid'
        then (p_patch->>'installments_paid')::int else installments_paid end,
      installment_cents=case when p_patch ? 'installment_cents' then new_amount else installment_cents end,
      account_id=case when p_patch ? 'account_id' then (p_patch->>'account_id')::uuid else account_id end,
      due_day=case when p_patch ? 'due_day' then new_day else due_day end,
      first_due_date=case when p_patch ? 'first_due_date'
        then (p_patch->>'first_due_date')::date else first_due_date end
    where id=d.id;
  end if;
  select * into new_contract from public.debts where id=d.id;
  if destination_mode='amortized' and (mode_changed or p_patch ? 'installment_cents')
    and new_contract.installments>new_contract.installments_paid and
    ((select count(*) from public.debt_schedule(d.id))<>new_contract.installments-new_contract.installments_paid
      or exists (select 1 from public.debt_schedule(d.id) s where s.principal_cents<=0)) then
    raise exception 'O valor não mantém o cronograma de parcelas com juros';
  end if;
  response := jsonb_build_object('scope',p_scope,'anchor_no',p_anchor_no,
    'recorded_changed',changed_count,'contract_changed',p_scope<>'one');
  update private.debt_contract_edit_requests set result=response
    where user_id=caller_uid and request_id=p_request_id;
  return response;
end;
$$;
revoke execute on function public.update_debt_contract_scoped(uuid,integer,text,jsonb,bigint,jsonb,uuid)
  from public,anon;
grant execute on function public.update_debt_contract_scoped(uuid,integer,text,jsonb,bigint,jsonb,uuid)
  to authenticated,service_role;

