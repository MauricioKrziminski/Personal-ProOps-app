-- F02: creation receipts do not rewrite an account after response loss, edits or deletion.
-- Keep accounts_ws_name_key: a name collision is an error, never an identity lookup.
create function public.create_account(p_input jsonb, p_request_id uuid)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  receipt jsonb;
  created_id uuid;
  current_account public.accounts%rowtype;
  account_name text;
  account_type text;
  ws uuid;
  initial_cents bigint;
  limit_cents bigint;
  close_day int;
  payment_day int;
  payer uuid;
  rate numeric;
  inclusive boolean;
  automatic boolean;
  field text;
  value numeric;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception using errcode='22023', message='Dados da conta inválidos';
  end if;
  receipt:=private.reserve_payment_request(p_request_id,
    jsonb_build_object('operation','create_account','input',p_input));
  if receipt is null then
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in
      ('name','type','initial_balance_cents','closing_day','due_day','credit_limit_cents',
       'payment_account_id','closing_day_inclusive','rotativo_auto','rotativo_rate_monthly'))
      or jsonb_typeof(p_input->'name') is distinct from 'string'
      or jsonb_typeof(p_input->'type') is distinct from 'string' then
      raise exception using errcode='22023', message='Dados da conta inválidos';
    end if;
    account_name:=regexp_replace(p_input->>'name','^[[:space:]]+|[[:space:]]+$','','g');
    account_type:=p_input->>'type';
    if account_name='' or account_type not in('checking','savings','credit_card','cash','investment') then
      raise exception using errcode='22023', message='Informe um nome e um tipo de conta válidos';
    end if;
    if jsonb_typeof(p_input->'initial_balance_cents') is distinct from 'number' then
      raise exception using errcode='22023', message='Saldo da conta precisa ser informado em centavos inteiros';
    end if;
    value:=(p_input->>'initial_balance_cents')::numeric;
    if value<>trunc(value) or abs(value)>9007199254740991 or (value<0 and account_type<>'checking') then
      raise exception using errcode='22023', message='Saldo da conta inválido';
    end if;
    initial_cents:=value::bigint;
    foreach field in array array['closing_day_inclusive','rotativo_auto'] loop
      if p_input ? field and jsonb_typeof(p_input->field) is distinct from 'boolean' then
        raise exception using errcode='22023', message='Opção do cartão inválida';
      end if;
    end loop;
    inclusive:=coalesce((p_input->>'closing_day_inclusive')::boolean,false);
    automatic:=coalesce((p_input->>'rotativo_auto')::boolean,false);
    if account_type='credit_card' then
      if initial_cents<>0 then
        raise exception using errcode='22023', message='Um novo cartão começa sem saldo inicial';
      end if;
      foreach field in array array['closing_day','due_day'] loop
        if jsonb_typeof(p_input->field) is distinct from 'number' then
          raise exception using errcode='22023', message='Informe os dias de fechamento e vencimento, de 1 a 31';
        end if;
        value:=(p_input->>field)::numeric;
        if value<>trunc(value) or value<1 or value>31 then
          raise exception using errcode='22023', message='Dias do cartão precisam ser inteiros de 1 a 31';
        end if;
      end loop;
      close_day:=(p_input->>'closing_day')::numeric::int;
      payment_day:=(p_input->>'due_day')::numeric::int;
      limit_cents:=0;
      if p_input->>'credit_limit_cents' is not null then
        if jsonb_typeof(p_input->'credit_limit_cents') is distinct from 'number' then
          raise exception using errcode='22023', message='Limite do cartão inválido';
        end if;
        value:=(p_input->>'credit_limit_cents')::numeric;
        if value<>trunc(value) or value<0 or value>9007199254740991 then
          raise exception using errcode='22023', message='Limite do cartão precisa ser informado em centavos inteiros';
        end if;
        limit_cents:=value::bigint;
      end if;
      if p_input->>'rotativo_rate_monthly' is not null then
        if jsonb_typeof(p_input->'rotativo_rate_monthly') is distinct from 'number' then
          raise exception using errcode='22023', message='Taxa mensal do cartão inválida';
        end if;
        rate:=(p_input->>'rotativo_rate_monthly')::numeric;
        if rate<0 or rate>1 then
          raise exception using errcode='22023', message='Taxa mensal do cartão precisa estar entre 0 e 100%';
        end if;
      end if;
      if p_input->>'payment_account_id' is not null then
        if jsonb_typeof(p_input->'payment_account_id') is distinct from 'string' then
          raise exception using errcode='22023', message='Conta pagadora inválida';
        end if;
        begin
          payer:=(p_input->>'payment_account_id')::uuid;
        exception when invalid_text_representation then
          raise exception using errcode='22023', message='Conta pagadora inválida';
        end;
      end if;
    else
      if p_input->>'closing_day' is not null or p_input->>'due_day' is not null
        or p_input->>'credit_limit_cents' is not null or p_input->>'payment_account_id' is not null
        or p_input->>'rotativo_rate_monthly' is not null or inclusive or automatic then
        raise exception using errcode='22023', message='Campos de cartão não se aplicam a esta conta';
      end if;
    end if;
    ws:=public.my_default_workspace();
    if ws is null then
      raise exception using errcode='42501', message='Nenhum espaço disponível para criar a conta';
    end if;
    if payer is not null then
      -- Lock the eligible payer until insertion completes; this is creation-only validation.
      perform 1 from public.accounts a where a.id=payer and a.workspace_id=ws
        and a.type<>'credit_card' and not a.archived for share;
      if not found then
        raise exception using errcode='22023', message='Escolha uma conta pagadora ativa deste espaço que não seja cartão';
      end if;
    end if;
    insert into public.accounts(user_id,workspace_id,name,type,initial_balance_cents,
      closing_day,due_day,credit_limit_cents,payment_account_id,closing_day_inclusive,rotativo_auto,rotativo_rate_monthly)
    values(auth.uid(),ws,account_name,account_type,initial_cents,close_day,payment_day,
      limit_cents,payer,inclusive,automatic,rate) returning id into created_id;
    receipt:=jsonb_build_object('id',created_id);
    perform private.finish_payment_request(p_request_id,receipt);
  end if;
  created_id:=(receipt->>'id')::uuid;
  -- Read mutable state under current RLS. A receipt survives deletion and never recreates it.
  select * into current_account from public.accounts a where a.id=created_id;
  if not found then
    return jsonb_build_object('id',created_id,'availability','unavailable','account',null);
  end if;
  return jsonb_build_object('id',created_id,'availability',
    case when current_account.archived then 'archived' else 'active' end,
    'account',to_jsonb(current_account));
end;
$$;
revoke execute on function public.create_account(jsonb,uuid) from public, anon;
grant execute on function public.create_account(jsonb,uuid) to authenticated;
