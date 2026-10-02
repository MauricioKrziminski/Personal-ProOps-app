-- F01: payment is metadata. Existing kinds, balances, invoices and signatures remain authoritative.
alter table public.transactions add column payment_method text,
  add column pix_fee_for_transaction_id uuid references public.transactions(id) on delete cascade;
alter table public.recurring_transactions add column payment_method text;
alter table public.installment_plans add column payment_method text,
  add column edit_revision bigint not null default 0;
alter table public.debts add column payment_method text;
alter table public.import_items add column payment_method text;
alter table private.recurring_history_versions add column payment_method text;
create unique index transactions_one_pix_fee on public.transactions(pix_fee_for_transaction_id)
  where pix_fee_for_transaction_id is not null;
create trigger zz_edit_revision before update on public.installment_plans
  for each row execute function public.tg_finance_edit_revision();
do $$ declare tab text; begin
  foreach tab in array array['transactions','recurring_transactions','installment_plans','debts','import_items'] loop
    execute format('alter table public.%I add constraint %I check (payment_method in (''pix'',''credit'',''debit'',''cash'',''bank_transfer'',''boleto''))',tab,tab||'_payment_method_check');
  end loop;
end $$;

create function private.validate_payment_method(p_method text,p_account uuid,p_workspace uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare typ text; account_ws uuid;
begin
  if p_method is not null and p_method not in('pix','credit','debit','cash','bank_transfer','boleto') then
    raise exception 'Forma de pagamento inválida';
  end if;
  if p_account is not null then
    select type,workspace_id into typ,account_ws from public.accounts where id=p_account;
    if typ is null or account_ws is distinct from p_workspace then raise exception 'Conta precisa pertencer ao mesmo workspace'; end if;
  end if;
  if p_method is null then return; end if;
  if p_method='credit' and typ is distinct from 'credit_card' then raise exception 'Escolha um cartão para pagar no crédito'; end if;
  if p_method='debit' and typ is not null and typ not in('checking','savings','investment') then raise exception 'Escolha uma conta para pagar no débito'; end if;
  if p_method='cash' and typ is not null and typ<>'cash' then raise exception 'Escolha uma carteira para pagar em dinheiro'; end if;
  if p_method in('pix','boleto','bank_transfer') and typ is not null and typ not in('checking','savings','investment','credit_card') then
    raise exception 'Escolha uma conta ou cartão para esta forma de pagamento';
  end if;
end $$;
revoke execute on function private.validate_payment_method(text,uuid,uuid) from public,anon;
grant execute on function private.validate_payment_method(text,uuid,uuid) to authenticated,service_role;

-- Compound adapters may update account and metadata in separate existing SQL statements.
-- Check the final locked row, not an intermediate NEW event, at the transaction boundary.
create function private.check_payment_method_row()
returns trigger language plpgsql security invoker set search_path=public as $$
declare r record;
begin
  execute format('select payment_method,account_id,workspace_id from public.%I where id=$1',tg_table_name) into r using new.id;
  if r.workspace_id is not null then perform private.validate_payment_method(r.payment_method,r.account_id,r.workspace_id); end if;
  return null;
end $$;
revoke execute on function private.check_payment_method_row() from public,anon,authenticated;
do $$ declare tab text; begin
  foreach tab in array array['transactions','recurring_transactions','installment_plans','debts'] loop
    execute format('create constraint trigger payment_method_compatibility after insert or update on public.%I deferrable initially deferred for each row execute function private.check_payment_method_row()',tab);
  end loop;
end $$;

create function private.payment_method_at(p_recurring_id uuid,p_date date)
returns text language sql stable security invoker set search_path=public as $$
  select v.payment_method from private.recurring_history_versions v
  where v.recurring_id=p_recurring_id and v.valid_from<=p_date and (v.valid_through is null or v.valid_through>=p_date)
  order by v.valid_from desc limit 1
$$;
revoke execute on function private.payment_method_at(uuid,date) from public,anon;
grant execute on function private.payment_method_at(uuid,date) to authenticated,service_role;
create function private.payment_history_default()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  new.payment_method := (select payment_method from public.recurring_transactions where id=new.recurring_id);
  return new;
end $$;
revoke execute on function private.payment_history_default() from public,anon,authenticated;
create trigger payment_history_default before insert on private.recurring_history_versions
  for each row execute function private.payment_history_default();

-- A metadata-only scope splits the already authoritative calendar/version; it never rebuilds it.
create function private.payment_history_scope(p_recurring uuid,p_method text,p_boundary date,p_all boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v private.recurring_history_versions%rowtype;
begin
  if not exists(select 1 from public.recurring_transactions r where r.id=p_recurring
      and r.workspace_id in(select private.my_workspace_ids())) then raise exception 'Recorrência não autorizada'; end if;
  if p_all then
    update private.recurring_history_versions set payment_method=p_method where recurring_id=p_recurring;
  else
    select * into v from private.recurring_history_versions where recurring_id=p_recurring
      and valid_from<p_boundary and (valid_through is null or valid_through>=p_boundary)
      order by valid_from desc limit 1 for update;
    if v.recurring_id is not null then
      update private.recurring_history_versions set valid_through=p_boundary-1 where recurring_id=v.recurring_id and valid_from=v.valid_from;
      insert into private.recurring_history_versions(recurring_id,workspace_id,valid_from,valid_through,
        anchor_date,rrule,kind,amount_cents,category,description,account_id,end_date,inferred_before,payment_method)
      values(v.recurring_id,v.workspace_id,p_boundary,v.valid_through,v.anchor_date,v.rrule,v.kind,
        v.amount_cents,v.category,v.description,v.account_id,v.end_date,v.inferred_before,p_method);
    end if;
    update private.recurring_history_versions set payment_method=p_method where recurring_id=p_recurring and valid_from>=p_boundary;
  end if;
end $$;
revoke execute on function private.payment_history_scope(uuid,text,date,boolean) from public,anon;
grant execute on function private.payment_history_scope(uuid,text,date,boolean) to authenticated;
create function private.track_payment_history()
returns trigger language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$ begin
  if old.payment_method is distinct from new.payment_method and coalesce(current_setting('proops.payment_scope_adapter',true),'')<>'on' then
    perform private.payment_history_scope(new.id,new.payment_method,current_date,false);
  end if;
  return null;
end $$;
revoke execute on function private.track_payment_history() from public,anon,authenticated;
create trigger zz_track_payment_history after update of payment_method on public.recurring_transactions
  for each row execute function private.track_payment_history();

create table private.payment_write_requests(
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,payload jsonb not null,result jsonb,created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
alter table private.payment_write_requests enable row level security;
create policy payment_write_requests_own on private.payment_write_requests for all to authenticated
  using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select,insert,update on private.payment_write_requests to authenticated;
create function private.reserve_payment_request(p_request uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r private.payment_write_requests%rowtype;
begin
  if auth.uid() is null or p_request is null then raise exception 'Sessão e identificador da requisição obrigatórios'; end if;
  insert into private.payment_write_requests(user_id,request_id,payload) values(auth.uid(),p_request,p_payload) on conflict do nothing;
  select * into r from private.payment_write_requests where user_id=auth.uid() and request_id=p_request for update;
  if r.payload is distinct from p_payload then raise exception 'Identificador de requisição reutilizado com dados diferentes'; end if;
  return r.result;
end $$;
revoke execute on function private.reserve_payment_request(uuid,jsonb) from public,anon;
grant execute on function private.reserve_payment_request(uuid,jsonb) to authenticated;
create function private.finish_payment_request(p_request uuid,p_result jsonb)
returns void language sql security invoker set search_path=public as $$
  update private.payment_write_requests set result=p_result where user_id=auth.uid() and request_id=p_request
$$;
revoke execute on function private.finish_payment_request(uuid,jsonb) from public,anon;
grant execute on function private.finish_payment_request(uuid,jsonb) to authenticated;

create function private.check_pix_fee_parent()
returns trigger language plpgsql security invoker set search_path=public as $$
declare p public.transactions%rowtype; typ text;
begin
  if new.pix_fee_for_transaction_id is null then return new; end if;
  select * into p from public.transactions where id=new.pix_fee_for_transaction_id for share;
  select type into typ from public.accounts where id=p.account_id;
  if p.id is null or p.id=new.id or p.workspace_id is distinct from new.workspace_id
    or p.pix_fee_for_transaction_id is not null or p.kind not in('expense','transfer')
    or typ is distinct from 'credit_card' or new.kind<>'expense'
    or new.account_id is distinct from p.account_id or new.occurred_at is distinct from p.occurred_at
    or new.counterparty_account_id is not null then raise exception 'Juro do Pix precisa pertencer à compra do mesmo cartão e workspace'; end if;
  return new;
end $$;
revoke execute on function private.check_pix_fee_parent() from public,anon,authenticated;
create trigger check_pix_fee_parent before insert or update on public.transactions
  for each row execute function private.check_pix_fee_parent();

create function public.save_transaction_payment(
  p_transaction_id uuid,p_input jsonb,p_fee_cents bigint,p_expected_revision bigint,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare r public.transactions%rowtype; fee uuid; result jsonb; payload jsonb; uid uuid:=auth.uid();
  allowed text[]:=array['kind','amount_cents','category','description','merchant','account_id','counterparty_account_id','occurred_at','status','due_at','auto_confirm','payment_method'];
begin
  if uid is null then raise exception 'Autenticação obrigatória'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(allowed)) then raise exception 'Campos do lançamento inválidos'; end if;
  if p_fee_cents<0 or p_fee_cents>9007199254740991 then raise exception 'Juro inválido'; end if;
  if p_input ? 'amount_cents' and (jsonb_typeof(p_input->'amount_cents') is distinct from 'number'
    or (p_input->>'amount_cents')::numeric<>trunc((p_input->>'amount_cents')::numeric)
    or (p_input->>'amount_cents')::numeric not between 1 and 9007199254740991) then raise exception 'Valor em centavos inteiros e positivos obrigatório'; end if;
  if p_input ? 'payment_method' and jsonb_typeof(p_input->'payment_method') not in('string','null') then raise exception 'Forma de pagamento inválida'; end if;
  payload:=jsonb_build_object('operation','save_transaction_payment','id',p_transaction_id,'input',p_input,'fee',p_fee_cents,'revision',p_expected_revision);
  result:=private.reserve_payment_request(p_request_id,payload); if result is not null then return result; end if;
  if p_transaction_id is null then
    if p_expected_revision is not null then raise exception 'Criação não recebe revisão anterior'; end if;
    p_transaction_id:=private.inserir_da_hipotese('transactions',p_input||'{"source":"app"}'::jsonb,allowed||array['source']);
  else
    select * into r from public.transactions where id=p_transaction_id for update;
    if r.id is null then raise exception 'Lançamento não encontrado'; end if;
    if p_expected_revision is null or r.edit_revision is distinct from p_expected_revision then raise exception 'O lançamento mudou enquanto você editava. Abra de novo'; end if;
    if r.pix_fee_for_transaction_id is not null then raise exception 'Edite o juro pela compra à qual ele pertence'; end if;
    if r.recurring_id is not null or r.installment_plan_id is not null or r.debt_id is not null then raise exception 'Edite este lançamento pelo alcance da série, compra ou dívida'; end if;
    update public.transactions t set
      kind=case when p_input?'kind' then p_input->>'kind' else t.kind end,
      amount_cents=case when p_input?'amount_cents' then (p_input->>'amount_cents')::bigint else t.amount_cents end,
      category=case when p_input?'category' then p_input->>'category' else t.category end,
      description=case when p_input?'description' then p_input->>'description' else t.description end,
      merchant=case when p_input?'merchant' then p_input->>'merchant' else t.merchant end,
      status=case when p_input?'status' then p_input->>'status' else t.status end,
      due_at=case when p_input?'due_at' then (p_input->>'due_at')::date else t.due_at end,
      auto_confirm=case when p_input?'auto_confirm' then (p_input->>'auto_confirm')::boolean else t.auto_confirm end,
      counterparty_account_id=case when p_input?'counterparty_account_id' then (p_input->>'counterparty_account_id')::uuid else t.counterparty_account_id end,
      payment_method=case when p_input?'payment_method' then p_input->>'payment_method' else t.payment_method end
      where t.id=p_transaction_id;
    if p_input?'account_id' then update public.transactions set account_id=(p_input->>'account_id')::uuid where id=p_transaction_id; end if;
    if p_input?'occurred_at' then update public.transactions set occurred_at=(p_input->>'occurred_at')::date where id=p_transaction_id; end if;
  end if;
  select * into r from public.transactions where id=p_transaction_id;
  perform private.validate_payment_method(r.payment_method,r.account_id,r.workspace_id);
  if r.counterparty_account_id is not null then perform private.validate_payment_method(null,r.counterparty_account_id,r.workspace_id); end if;
  select id into fee from public.transactions where pix_fee_for_transaction_id=r.id for update;
  if fee is not null and p_fee_cents is distinct from 0 and (r.payment_method is not null and r.payment_method<>'pix' or not exists(select 1 from public.accounts where id=r.account_id and type='credit_card')) then raise exception 'Zere o juro do Pix antes de mudar esta forma ou origem'; end if;
  if coalesce(p_fee_cents,0)>0 then
    if r.kind not in('expense','transfer') or r.installment_plan_id is not null or r.recurring_id is not null or r.debt_id is not null
      or r.payment_method is not null and r.payment_method<>'pix'
      or not exists(select 1 from public.accounts where id=r.account_id and type='credit_card') then raise exception 'Juro só vale para Pix no crédito avulso'; end if;
    if fee is null then
      insert into public.transactions(user_id,workspace_id,kind,amount_cents,category,description,account_id,occurred_at,source,status,payment_method,pix_fee_for_transaction_id)
      values(uid,r.workspace_id,'expense',p_fee_cents,'juros','Juros do Pix no crédito',r.account_id,r.occurred_at,'app',r.status,'pix',r.id) returning id into fee;
    else
      update public.transactions set amount_cents=p_fee_cents,account_id=r.account_id,occurred_at=r.occurred_at,payment_method='pix',status=r.status where id=fee;
    end if;
  elsif p_fee_cents=0 and fee is not null then delete from public.transactions where id=fee; fee:=null;
  elsif fee is not null then
    -- Fee omission preserves its amount but follows the explicitly owned parent account/date.
    update public.transactions set account_id=r.account_id,occurred_at=r.occurred_at where id=fee;
  end if;
  select * into r from public.transactions where id=p_transaction_id;
  result:=jsonb_build_object('id',r.id,'revision',r.edit_revision,'fee_id',fee);
  perform private.finish_payment_request(p_request_id,result); return result;
end $$;
revoke execute on function public.save_transaction_payment(uuid,jsonb,bigint,bigint,uuid) from public,anon;
grant execute on function public.save_transaction_payment(uuid,jsonb,bigint,bigint,uuid) to authenticated;

-- Small adapters extend metadata while the existing domain cores keep all money/calendar rules.
create function private.apply_payment_metadata(p_table text,p_ids uuid[],p_method text)
returns bigint language plpgsql security invoker set search_path=public as $$
declare row record; changed bigint; previous text;
begin
  if p_table not in('transactions','recurring_transactions','installment_plans','debts') then raise exception 'Tipo de registro inválido'; end if;
  if p_table='transactions' then
    -- Parent-first locks match the financial cores and invalidate stale compound editors.
    perform 1 from public.recurring_transactions where id in(select recurring_id from public.transactions where id=any(p_ids)) order by id for update;
    perform 1 from public.installment_plans where id in(select installment_plan_id from public.transactions where id=any(p_ids)) order by id for update;
  end if;
  previous:=current_setting('proops.payment_scope_adapter',true);
  perform set_config('proops.payment_scope_adapter','on',true);
  execute format('update public.%I set payment_method=$1 where id=any($2) and payment_method is distinct from $1',p_table)
    using p_method,p_ids;
  get diagnostics changed=row_count;
  if p_table='transactions' and changed>0 then
    update public.recurring_transactions set payment_method=payment_method
      where id in(select recurring_id from public.transactions where id=any(p_ids));
    update public.installment_plans set payment_method=payment_method
      where id in(select installment_plan_id from public.transactions where id=any(p_ids));
  end if;
  perform set_config('proops.payment_scope_adapter',coalesce(previous,''),true);
  for row in execute format('select payment_method,account_id,workspace_id from public.%I where id=any($1)',p_table) using p_ids loop
    perform private.validate_payment_method(row.payment_method,row.account_id,row.workspace_id);
  end loop;
  return changed;
end $$;
revoke execute on function private.apply_payment_metadata(text,uuid[],text) from public,anon;
grant execute on function private.apply_payment_metadata(text,uuid[],text) to authenticated,service_role;

alter function private.insert_purchase_down_payment(text,uuid,jsonb) rename to insert_purchase_down_payment_payment_core;
create function private.insert_purchase_down_payment(p_tipo text,p_parent_id uuid,p_entrada jsonb)
returns uuid language plpgsql security invoker set search_path=public as $$ declare id uuid; begin
  id:=private.insert_purchase_down_payment_payment_core(p_tipo,p_parent_id,p_entrada-'payment_method');
  if p_entrada?'payment_method' then perform private.apply_payment_metadata('transactions',array[id],p_entrada->>'payment_method'); end if;
  return id;
end $$;
revoke execute on function private.insert_purchase_down_payment(text,uuid,jsonb) from public,anon;
grant execute on function private.insert_purchase_down_payment(text,uuid,jsonb) to authenticated;

alter function private.criar_registro_da_hipotese(text,jsonb) rename to criar_registro_da_hipotese_payment_core;
create function private.criar_registro_da_hipotese(p_tipo text,p_dados jsonb)
returns jsonb language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare result jsonb; ids uuid[]; created_id uuid; key text; tab text; boundary date; fee uuid;
begin
  key:=case when p_tipo='parcelada' then 'p_payment_method' else 'payment_method' end;
  result:=private.criar_registro_da_hipotese_payment_core(p_tipo,p_dados-key);
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(result->'ids');
  created_id:=(result->'ids'->>0)::uuid;
  if p_dados?key then
    tab:=case p_tipo when 'parcelada' then 'installment_plans' when 'recorrente' then 'recurring_transactions' when 'financiamento' then 'debts' end;
    if tab is not null then perform private.apply_payment_metadata(tab,array[created_id],p_dados->>key); end if;
    if p_tipo='parcelada' then
      perform private.apply_payment_metadata('transactions',array(select t.id from public.transactions t where t.installment_plan_id=created_id),p_dados->>key);
    elsif p_tipo='recorrente' then
      select min(valid_from) into boundary from private.recurring_history_versions where recurring_id=created_id;
      perform private.payment_history_scope(created_id,p_dados->>key,boundary,true);
    end if;
  end if;
  if p_dados?'fee_cents' then
    if p_tipo<>'lancamento' or jsonb_array_length(p_dados->'linhas')<>1 then raise exception 'Juro explícito exige um lançamento principal'; end if;
    fee:=private.set_owned_pix_fee(created_id,(p_dados->>'fee_cents')::bigint);
    if fee is not null then result:=jsonb_set(result,'{ids}',(result->'ids')||to_jsonb(fee)); end if;
  end if;
  return result;
end $$;
revoke execute on function private.criar_registro_da_hipotese(text,jsonb) from public,anon;
grant execute on function private.criar_registro_da_hipotese(text,jsonb) to authenticated;

-- The insert core receives an explicit allowlist. Extend only the two owned financial resources.
alter function private.inserir_da_hipotese(text,jsonb,text[]) rename to inserir_da_hipotese_payment_core;
create function private.inserir_da_hipotese(p_tabela text,p_linha jsonb,p_permitidas text[])
returns uuid language plpgsql security invoker set search_path=public as $$
declare id uuid; r record; previous text;
begin
  if p_tabela in('transactions','recurring_transactions','debts') then p_permitidas:=p_permitidas||array['payment_method']; end if;
  -- Metadata goes into the same INSERT, preserving the original calendar/version anchor.
  id:=private.inserir_da_hipotese_payment_core(p_tabela,p_linha,p_permitidas);
  execute format('select payment_method,account_id,workspace_id from public.%I where id=$1',p_tabela) into r using id;
  perform private.validate_payment_method(r.payment_method,r.account_id,r.workspace_id);
  return id;
end $$;
revoke execute on function private.inserir_da_hipotese(text,jsonb,text[]) from public,anon;
grant execute on function private.inserir_da_hipotese(text,jsonb,text[]) to authenticated;

create function public.create_recurring_payment(p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; created jsonb; created_id uuid;
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','create_recurring_payment','input',p_input));
  if result is not null then return result; end if;
  created:=private.criar_registro_da_hipotese('recorrente',p_input);
  created_id:=(created->'ids'->>0)::uuid;
  select jsonb_build_object('id',created_id,'revision',edit_revision) into result from public.recurring_transactions where recurring_transactions.id=created_id;
  perform private.finish_payment_request(p_request_id,result); return result;
end $$;
revoke execute on function public.create_recurring_payment(jsonb,uuid) from public,anon;
grant execute on function public.create_recurring_payment(jsonb,uuid) to authenticated;

create function public.update_installment_plan_payment(p_input jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare plan public.installment_plans%rowtype; changed bigint; cached jsonb; request uuid;
  method text; explicit boolean; ids uuid[];
begin
  if auth.uid() is null or p_input is null or jsonb_typeof(p_input)<>'object'
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in('p_plan_id','p_total_cents','p_installments','p_first_occurred_at','p_description','p_category','p_merchant','p_account_id','p_paid_installments','p_payment_method','p_expected_revision','p_request_id')) then raise exception 'Dados da compra inválidos'; end if;
  request:=(p_input->>'p_request_id')::uuid;
  if request is not null then
    cached:=private.reserve_payment_request(request,jsonb_build_object('operation','update_installment_plan_payment','input',p_input));
    if cached is not null then return (cached->>'changed')::bigint; end if;
  end if;
  select * into plan from public.installment_plans where id=(p_input->>'p_plan_id')::uuid for update;
  if plan.id is null then raise exception 'Compra parcelada não encontrada'; end if;
  if p_input?'p_expected_revision' and (p_input->>'p_expected_revision')::bigint is distinct from plan.edit_revision then raise exception 'A compra mudou enquanto você editava. Abra de novo'; end if;
  explicit:=p_input?'p_payment_method'; method:=case when explicit then p_input->>'p_payment_method' else plan.payment_method end;
  select array_agg(id) into ids from public.transactions where installment_plan_id=plan.id;
  changed:=public.update_installment_plan(plan.id,(p_input->>'p_total_cents')::bigint,(p_input->>'p_installments')::integer,
    (p_input->>'p_first_occurred_at')::date,p_input->>'p_description',p_input->>'p_category',p_input->>'p_merchant',
    (p_input->>'p_account_id')::uuid,(p_input->>'p_paid_installments')::integer);
  if exists(select 1 from public.installment_plans where id=plan.id) then
    perform private.apply_payment_metadata('installment_plans',array[plan.id],method);
    -- Structural rebuild may replace pending IDs; include all current plan rows.
    ids:=array(select id from public.transactions where installment_plan_id=plan.id);
  end if;
  if explicit then changed:=greatest(changed,private.apply_payment_metadata('transactions',ids,method)); end if;
  if request is not null then perform private.finish_payment_request(request,jsonb_build_object('changed',changed)); end if;
  return changed;
end $$;
revoke execute on function public.update_installment_plan_payment(jsonb) from public,anon;
grant execute on function public.update_installment_plan_payment(jsonb) to authenticated;

create function private.recurring_payment_targets(p_series uuid,p_anchor uuid default null)
returns uuid[] language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare r public.recurring_transactions%rowtype; a public.transactions%rowtype; cutoff date:=current_date; ids uuid[];
begin
  select * into r from public.recurring_transactions where id=p_series for update;
  if r.id is null then raise exception 'Recorrência não encontrada'; end if;
  if p_anchor is not null then
    select * into a from public.transactions where id=p_anchor for update;
    if a.id is null or a.recurring_id is distinct from r.id or a.workspace_id is distinct from r.workspace_id then raise exception 'Ocorrência não pertence à recorrência'; end if;
    cutoff:=case when a.invoice_id is null then coalesce(a.due_at,a.occurred_at) else a.occurred_at end;
    if a.status<>'pending' or cutoff<current_date then cutoff:=a.occurred_at; end if;
  end if;
  perform 1 from public.transactions where recurring_id=r.id order by id for update;
  select array_agg(t.id) into ids from public.transactions t where t.recurring_id=r.id and t.workspace_id=r.workspace_id
    and ((t.status='pending' and case when a.id is not null and a.status='pending' and cutoff>=current_date
      then case when t.invoice_id is null then coalesce(t.due_at,t.occurred_at) else t.occurred_at end
      else t.occurred_at end >=cutoff) or t.id=p_anchor);
  return coalesce(ids,'{}'::uuid[]);
end $$;
revoke execute on function private.recurring_payment_targets(uuid,uuid) from public,anon;
grant execute on function private.recurring_payment_targets(uuid,uuid) to authenticated;

create function private.apply_recurring_payment(p_series uuid,p_ids uuid[],p_method text,p_boundary date,p_all boolean)
returns bigint language plpgsql security invoker set search_path=public as $$ declare changed bigint; begin
  changed:=private.apply_payment_metadata('recurring_transactions',array[p_series],p_method);
  perform private.payment_history_scope(p_series,p_method,p_boundary,p_all);
  return changed+private.apply_payment_metadata('transactions',p_ids,p_method);
end $$;
revoke execute on function private.apply_recurring_payment(uuid,uuid[],text,date,boolean) from public,anon;
grant execute on function private.apply_recurring_payment(uuid,uuid[],text,date,boolean) to authenticated;

alter function public.update_recurring_one(uuid,jsonb,bigint,uuid) set schema private;
alter function private.update_recurring_one(uuid,jsonb,bigint,uuid) rename to update_recurring_one_payment_core;
create function public.update_recurring_one(p_transaction_id uuid,p_patch jsonb,p_expected_revision bigint,p_request_id uuid)
returns bigint language plpgsql security invoker set search_path=public as $$
declare result jsonb; row public.transactions%rowtype; changed bigint:=0;
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','update_recurring_one','id',p_transaction_id,'patch',p_patch,'revision',p_expected_revision));
  if result is not null then return (result->>'changed')::bigint; end if;
  if not(p_patch?'payment_method') then
    changed:=private.update_recurring_one_payment_core(p_transaction_id,p_patch,p_expected_revision,p_request_id);
    perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed)); return changed;
  end if;
  perform 1 from public.recurring_transactions where id=(select recurring_id from public.transactions where id=p_transaction_id) for update;
  select * into row from public.transactions where id=p_transaction_id for update;
  if row.id is null or row.recurring_id is null then raise exception 'Ocorrência recorrente não encontrada'; end if;
  if p_expected_revision is null or row.edit_revision is distinct from p_expected_revision then raise exception 'A ocorrência mudou enquanto você editava. Abra de novo'; end if;
  if p_patch-'payment_method'<>'{}'::jsonb then changed:=private.update_recurring_one_payment_core(p_transaction_id,p_patch-'payment_method',p_expected_revision,p_request_id); end if;
  changed:=greatest(changed,private.apply_payment_metadata('transactions',array[p_transaction_id],p_patch->>'payment_method'));
  perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed)); return changed;
end $$;
revoke execute on function public.update_recurring_one(uuid,jsonb,bigint,uuid) from public,anon;
grant execute on function public.update_recurring_one(uuid,jsonb,bigint,uuid) to authenticated;

alter function public.update_recurring_all(uuid,jsonb,jsonb,bigint,uuid) set schema private;
alter function private.update_recurring_all(uuid,jsonb,jsonb,bigint,uuid) rename to update_recurring_all_payment_core;
create function public.update_recurring_all(p_recurring_id uuid,p_line_patch jsonb,p_series_patch jsonb,p_expected_revision bigint,p_request_id uuid)
returns bigint language plpgsql security invoker set search_path=public as $$
declare result jsonb; row public.recurring_transactions%rowtype; changed bigint:=0; method text; ids uuid[];
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','update_recurring_all','id',p_recurring_id,'lines',p_line_patch,'series',p_series_patch,'revision',p_expected_revision));
  if result is not null then return (result->>'changed')::bigint; end if;
  if not(p_line_patch?'payment_method' or p_series_patch?'payment_method') then
    changed:=private.update_recurring_all_payment_core(p_recurring_id,p_line_patch,p_series_patch,p_expected_revision,p_request_id);
    perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed)); return changed;
  end if;
  if p_line_patch?'payment_method' and p_series_patch?'payment_method' and p_line_patch->'payment_method' is distinct from p_series_patch->'payment_method' then raise exception 'Forma da ocorrência e da regra precisam coincidir'; end if;
  select * into row from public.recurring_transactions where id=p_recurring_id for update;
  if row.id is null then raise exception 'Recorrência não encontrada'; end if;
  if p_expected_revision is null or row.edit_revision is distinct from p_expected_revision then raise exception 'A recorrência mudou enquanto você editava. Abra de novo'; end if;
  perform 1 from public.transactions where recurring_id=row.id order by id for update;
  if (p_line_patch-'payment_method')<>'{}'::jsonb or (p_series_patch-'payment_method')<>'{}'::jsonb then
    changed:=private.update_recurring_all_payment_core(p_recurring_id,p_line_patch-'payment_method',p_series_patch-'payment_method',p_expected_revision,p_request_id);
  end if;
  method:=(p_series_patch||p_line_patch)->>'payment_method';
  ids:=array(select id from public.transactions where recurring_id=row.id);
  changed:=greatest(changed,private.apply_recurring_payment(row.id,ids,method,current_date,true));
  perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed)); return changed;
end $$;
revoke execute on function public.update_recurring_all(uuid,jsonb,jsonb,bigint,uuid) from public,anon;
grant execute on function public.update_recurring_all(uuid,jsonb,jsonb,bigint,uuid) to authenticated;

alter function public.update_recurring_future(uuid,uuid,jsonb,jsonb,bigint,uuid) set schema private;
alter function private.update_recurring_future(uuid,uuid,jsonb,jsonb,bigint,uuid) rename to update_recurring_future_payment_core;
create function public.update_recurring_future(p_transaction_id uuid,p_recurring_id uuid,p_line_patch jsonb,p_series_patch jsonb,p_expected_revision bigint,p_request_id uuid)
returns bigint language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare result jsonb; row public.recurring_transactions%rowtype; anchor public.transactions%rowtype;
  changed bigint:=0; method text; ids uuid[]; before_ids uuid[]; boundary date:=current_date;
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','update_recurring_future','id',p_recurring_id,'anchor',p_transaction_id,'lines',p_line_patch,'series',p_series_patch,'revision',p_expected_revision));
  if result is not null then return (result->>'changed')::bigint; end if;
  if not(p_line_patch?'payment_method' or p_series_patch?'payment_method') then
    changed:=private.update_recurring_future_payment_core(p_transaction_id,p_recurring_id,p_line_patch,p_series_patch,p_expected_revision,p_request_id);
    perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed)); return changed;
  end if;
  if p_transaction_id is null and p_line_patch<>'{}'::jsonb then raise exception 'Uma alteração de ocorrência precisa da referência'; end if;
  if p_line_patch?'payment_method' and p_series_patch?'payment_method' and p_line_patch->'payment_method' is distinct from p_series_patch->'payment_method' then raise exception 'Forma da ocorrência e da regra precisam coincidir'; end if;
  select * into row from public.recurring_transactions where id=p_recurring_id for update;
  if row.id is null then raise exception 'Recorrência não encontrada'; end if;
  if p_expected_revision is null or row.edit_revision is distinct from p_expected_revision then raise exception 'A recorrência mudou enquanto você editava. Abra de novo'; end if;
  ids:=private.recurring_payment_targets(row.id,p_transaction_id);
  before_ids:=array(select id from public.transactions where recurring_id=row.id);
  if p_transaction_id is not null then
    select * into anchor from public.transactions where id=p_transaction_id;
    boundary:=greatest(current_date,case when anchor.invoice_id is null then coalesce(anchor.due_at,anchor.occurred_at) else anchor.occurred_at end);
  end if;
  if (p_line_patch-'payment_method')<>'{}'::jsonb or (p_series_patch-'payment_method')<>'{}'::jsonb then
    changed:=private.update_recurring_future_payment_core(p_transaction_id,p_recurring_id,p_line_patch-'payment_method',p_series_patch-'payment_method',p_expected_revision,p_request_id);
  end if;
  ids:=ids||array(select id from public.transactions where recurring_id=row.id and not(id=any(before_ids)));
  method:=(p_series_patch||p_line_patch)->>'payment_method';
  changed:=greatest(changed,private.apply_recurring_payment(row.id,ids,method,boundary,false));
  perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed)); return changed;
end $$;
revoke execute on function public.update_recurring_future(uuid,uuid,jsonb,jsonb,bigint,uuid) from public,anon;
grant execute on function public.update_recurring_future(uuid,uuid,jsonb,jsonb,bigint,uuid) to authenticated;

alter function public.update_recurring_series(uuid,jsonb,boolean) set schema private;
alter function private.update_recurring_series(uuid,jsonb,boolean) rename to update_recurring_series_payment_core;
create function public.update_recurring_series(p_recurring_id uuid,p_patch jsonb,p_propagate boolean default true)
returns bigint language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare ids uuid[]; before_ids uuid[]; changed bigint:=0;
begin
  if not(p_patch?'payment_method') then return private.update_recurring_series_payment_core(p_recurring_id,p_patch,p_propagate); end if;
  ids:=private.recurring_payment_targets(p_recurring_id,null);
  before_ids:=array(select id from public.transactions where recurring_id=p_recurring_id);
  if p_patch-'payment_method'<>'{}'::jsonb then changed:=private.update_recurring_series_payment_core(p_recurring_id,p_patch-'payment_method',p_propagate); end if;
  ids:=case when p_propagate then ids||array(select id from public.transactions where recurring_id=p_recurring_id and not(id=any(before_ids))) else '{}'::uuid[] end;
  return greatest(changed,private.apply_recurring_payment(p_recurring_id,ids,p_patch->>'payment_method',current_date,false));
end $$;
revoke execute on function public.update_recurring_series(uuid,jsonb,boolean) from public,anon;
grant execute on function public.update_recurring_series(uuid,jsonb,boolean) to authenticated;

alter function public.update_installment_occurrence(uuid,jsonb) set schema private;
alter function private.update_installment_occurrence(uuid,jsonb) rename to update_installment_occurrence_payment_core;
create function public.update_installment_occurrence(p_transaction_id uuid,p_patch jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$ declare changed bigint:=0; row public.transactions%rowtype; begin
  if not(p_patch?'payment_method') then return private.update_installment_occurrence_payment_core(p_transaction_id,p_patch); end if;
  perform 1 from public.installment_plans where id=(select installment_plan_id from public.transactions where id=p_transaction_id) for update;
  select * into row from public.transactions where id=p_transaction_id for update;
  if row.id is null or row.installment_plan_id is null then raise exception 'Parcela não encontrada'; end if;
  if p_patch-'payment_method'<>'{}'::jsonb then changed:=private.update_installment_occurrence_payment_core(p_transaction_id,p_patch-'payment_method'); end if;
  return greatest(changed,private.apply_payment_metadata('transactions',array[p_transaction_id],p_patch->>'payment_method'));
end $$;
revoke execute on function public.update_installment_occurrence(uuid,jsonb) from public,anon;
grant execute on function public.update_installment_occurrence(uuid,jsonb) to authenticated;

alter function public.update_installment_scope(uuid,text,jsonb) set schema private;
alter function private.update_installment_scope(uuid,text,jsonb) rename to update_installment_scope_payment_core;
create function public.update_installment_scope(p_transaction_id uuid,p_scope text,p_patch jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare row public.transactions%rowtype; plan public.installment_plans%rowtype; ids uuid[]; changed bigint:=0;
begin
  if not(p_patch?'payment_method') then return private.update_installment_scope_payment_core(p_transaction_id,p_scope,p_patch); end if;
  if p_scope not in('one','future','all') or p_scope is null then raise exception 'Escolha quais parcelas editar'; end if;
  select * into plan from public.installment_plans where id=(select installment_plan_id from public.transactions where id=p_transaction_id) for update;
  select * into row from public.transactions where id=p_transaction_id for update;
  if plan.id is null or row.id is null or row.installment_plan_id is distinct from plan.id then raise exception 'Parcela não encontrada'; end if;
  perform 1 from public.transactions where installment_plan_id=plan.id order by id for update;
  ids:=array(select id from public.transactions where installment_plan_id=plan.id and
    (p_scope='all' or p_scope='one' and id=row.id or p_scope='future' and installment_no>=row.installment_no));
  if p_patch-'payment_method'<>'{}'::jsonb then changed:=private.update_installment_scope_payment_core(p_transaction_id,p_scope,p_patch-'payment_method'); end if;
  changed:=greatest(changed,private.apply_payment_metadata('transactions',ids,p_patch->>'payment_method'));
  if p_scope<>'one' then perform private.apply_payment_metadata('installment_plans',array[plan.id],p_patch->>'payment_method'); end if;
  return changed;
end $$;
revoke execute on function public.update_installment_scope(uuid,text,jsonb) from public,anon;
grant execute on function public.update_installment_scope(uuid,text,jsonb) to authenticated;

alter function public.update_transaction_scoped(uuid,text,jsonb) set schema private;
alter function private.update_transaction_scoped(uuid,text,jsonb) rename to update_transaction_scoped_payment_core;
create function public.update_transaction_scoped(p_transaction_id uuid,p_scope text,p_patch jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare row public.transactions%rowtype; ids uuid[]; changed bigint:=0;
begin
  if not(p_patch?'payment_method') then return private.update_transaction_scoped_payment_core(p_transaction_id,p_scope,p_patch); end if;
  if p_scope not in('one','future') or p_scope is null then raise exception 'Escopo inválido'; end if;
  perform 1 from public.recurring_transactions where id=(select recurring_id from public.transactions where id=p_transaction_id) for update;
  perform 1 from public.installment_plans where id=(select installment_plan_id from public.transactions where id=p_transaction_id) for update;
  select * into row from public.transactions where id=p_transaction_id for update;
  if row.id is null then raise exception 'Lançamento não encontrado'; end if;
  if p_scope='future' and row.recurring_id is null and row.installment_plan_id is null then raise exception 'Esse lançamento não faz parte de uma série'; end if;
  ids:=array(select t.id from public.transactions t where t.workspace_id=row.workspace_id and
    (t.id=row.id or p_scope='future' and t.status='pending' and t.occurred_at>=row.occurred_at
      and (row.recurring_id is not null and t.recurring_id=row.recurring_id or row.installment_plan_id is not null and t.installment_plan_id=row.installment_plan_id)));
  perform 1 from public.transactions where id=any(ids) order by id for update;
  if p_patch-'payment_method'<>'{}'::jsonb then changed:=private.update_transaction_scoped_payment_core(p_transaction_id,p_scope,p_patch-'payment_method'); end if;
  changed:=greatest(changed,private.apply_payment_metadata('transactions',ids,p_patch->>'payment_method'));
  if p_scope='future' and row.recurring_id is not null then
    perform private.apply_recurring_payment(row.recurring_id,'{}'::uuid[],p_patch->>'payment_method',greatest(current_date,row.occurred_at),false);
  elsif p_scope='future' and row.installment_plan_id is not null then
    perform private.apply_payment_metadata('installment_plans',array[row.installment_plan_id],p_patch->>'payment_method');
  end if;
  return changed;
end $$;
revoke execute on function public.update_transaction_scoped(uuid,text,jsonb) from public,anon;
grant execute on function public.update_transaction_scoped(uuid,text,jsonb) to authenticated;

alter function public.convert_transaction_to_installments(uuid,bigint,integer,date,text,text,text,uuid,integer) set schema private;
alter function private.convert_transaction_to_installments(uuid,bigint,integer,date,text,text,text,uuid,integer) rename to convert_transaction_to_installments_payment_core;
create function public.convert_transaction_to_installments(p_transaction_id uuid,p_total_cents bigint,p_installments integer,
  p_first_occurred_at date,p_description text default null,p_category text default null,p_merchant text default null,
  p_account_id uuid default null,p_paid_installments integer default null)
returns uuid language plpgsql security invoker set search_path=public as $$ declare method text; plan uuid; begin
  select payment_method into method from public.transactions where id=p_transaction_id for update;
  if exists(select 1 from public.transactions where pix_fee_for_transaction_id=p_transaction_id) then raise exception 'Zere o juro vinculado antes de converter esta compra'; end if;
  plan:=private.convert_transaction_to_installments_payment_core(p_transaction_id,p_total_cents,p_installments,
    p_first_occurred_at,p_description,p_category,p_merchant,p_account_id,p_paid_installments);
  perform private.apply_payment_metadata('installment_plans',array[plan],method);
  perform private.apply_payment_metadata('transactions',array(select id from public.transactions where installment_plan_id=plan),method);
  return plan;
end $$;
revoke execute on function public.convert_transaction_to_installments(uuid,bigint,integer,date,text,text,text,uuid,integer) from public,anon;
grant execute on function public.convert_transaction_to_installments(uuid,bigint,integer,date,text,text,text,uuid,integer) to authenticated;

alter function public.converter_registro(jsonb,text,jsonb) set schema private;
alter function private.converter_registro(jsonb,text,jsonb) rename to converter_registro_payment_core;
create function public.converter_registro(p_origem jsonb,p_alcance text,p_destino jsonb)
returns jsonb language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare result jsonb; method text; explicit boolean; tipo text:=p_destino->>'tipo'; data jsonb:=p_destino->'dados';
  created_id uuid; ids uuid[]; tab text; source_tab text; fee uuid;
begin
  source_tab:=case p_origem->>'tipo' when 'transacao' then 'transactions' when 'serie' then 'recurring_transactions' when 'plano' then 'installment_plans' when 'divida' then 'debts' end;
  if source_tab is not null then execute format('select payment_method from public.%I where id=$1 for update',source_tab) into method using (p_origem->>'id')::uuid; end if;
  explicit:=case when tipo='parcelada' then data?'p_payment_method' when tipo='lancamento' then data->'linhas'->0?'payment_method' else data?'payment_method' end;
  if explicit then method:=case when tipo='parcelada' then data->>'p_payment_method' when tipo='lancamento' then data->'linhas'->0->>'payment_method' else data->>'payment_method' end; end if;
  -- The adopted first line changes in place; the existing converter doesn't insert it via
  -- the generic builder. Apply method to every returned financial id after the core finishes.
  if p_origem->>'tipo'='transacao' and exists(select 1 from public.transactions where pix_fee_for_transaction_id=(p_origem->>'id')::uuid)
    and (tipo<>'lancamento' or not(data?'fee_cents')) then
    raise exception 'Zere o juro vinculado antes de converter esta compra';
  end if;
  result:=private.converter_registro_payment_core(p_origem,p_alcance,p_destino);
  created_id:=(result->'ids'->>0)::uuid;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(result->'ids');
  tab:=case tipo when 'parcelada' then 'installment_plans' when 'recorrente' then 'recurring_transactions' when 'financiamento' then 'debts' end;
  if tab is not null then perform private.apply_payment_metadata(tab,array[created_id],method); end if;
  if tipo='parcelada' then perform private.apply_payment_metadata('transactions',array(select t.id from public.transactions t where t.installment_plan_id=created_id),method);
  elsif tipo='recorrente' then
    perform private.apply_payment_metadata('transactions',array(select t.id from public.transactions t where t.recurring_id=created_id),method);
    perform private.payment_history_scope(created_id,method,current_date,true);
  elsif tipo='lancamento' then
    perform private.apply_payment_metadata('transactions',array[(result->'ids'->>0)::uuid],method);
  end if;
  if data?'fee_cents' then
    if tipo<>'lancamento' or jsonb_array_length(data->'linhas')<>1 then raise exception 'Juro explícito exige um lançamento principal'; end if;
    fee:=private.set_owned_pix_fee(created_id,(data->>'fee_cents')::bigint);
    if fee is not null and not(result->'ids' @> jsonb_build_array(fee)) then result:=jsonb_set(result,'{ids}',(result->'ids')||to_jsonb(fee)); end if;
  end if;
  return result;
end $$;
revoke execute on function public.converter_registro(jsonb,text,jsonb) from public,anon;
grant execute on function public.converter_registro(jsonb,text,jsonb) to authenticated;

-- Imported evidence fills only a known method. Unknown imports preserve already known metadata.
create function private.import_payment_metadata()
returns trigger language plpgsql security invoker set search_path=public as $$ declare plan uuid; begin
  if new.status='approved' and new.transaction_id is not null and new.payment_method is not null then
    if not exists(select 1 from public.transactions where id=new.transaction_id and workspace_id=new.workspace_id) then
      raise exception 'Importação e lançamento precisam pertencer ao mesmo workspace'; end if;
    perform private.apply_payment_metadata('transactions',array[new.transaction_id],new.payment_method);
    select installment_plan_id into plan from public.transactions where id=new.transaction_id;
    if plan is not null then
      perform private.apply_payment_metadata('installment_plans',array[plan],new.payment_method);
      perform private.apply_payment_metadata('transactions',array(select id from public.transactions where installment_plan_id=plan and payment_method is null),new.payment_method);
    end if;
  end if;
  return null;
end $$;
revoke execute on function private.import_payment_metadata() from public,anon,authenticated;
create trigger import_payment_metadata after insert or update of status,transaction_id,payment_method on public.import_items
  for each row execute function private.import_payment_metadata();

create function private.set_owned_pix_fee(p_parent uuid,p_cents bigint)
returns uuid language plpgsql security invoker set search_path=public as $$
declare parent public.transactions%rowtype; fee uuid;
begin
  select * into parent from public.transactions where id=p_parent for update;
  if parent.id is null then raise exception 'Compra do juro não encontrada'; end if;
  if p_cents is null or p_cents<0 or p_cents>9007199254740991 then raise exception 'Juro inválido'; end if;
  select id into fee from public.transactions where pix_fee_for_transaction_id=parent.id for update;
  if p_cents=0 then
    if fee is not null then delete from public.transactions where id=fee; end if;
    return null;
  end if;
  if parent.kind not in('expense','transfer') or parent.installment_plan_id is not null or parent.recurring_id is not null or parent.debt_id is not null
    or parent.payment_method is not null and parent.payment_method<>'pix'
    or not exists(select 1 from public.accounts where id=parent.account_id and type='credit_card') then raise exception 'Juro só vale para Pix no crédito avulso'; end if;
  if fee is null then
    insert into public.transactions(user_id,workspace_id,kind,amount_cents,category,description,account_id,occurred_at,
      source,status,payment_method,pix_fee_for_transaction_id)
    values(auth.uid(),parent.workspace_id,'expense',p_cents,'juros','Juros do Pix no crédito',parent.account_id,
      parent.occurred_at,'app',parent.status,'pix',parent.id) returning id into fee;
  else
    update public.transactions set amount_cents=p_cents,account_id=parent.account_id,occurred_at=parent.occurred_at,
      status=parent.status,payment_method='pix' where id=fee;
  end if;
  return fee;
end $$;
revoke execute on function private.set_owned_pix_fee(uuid,bigint) from public,anon;
grant execute on function private.set_owned_pix_fee(uuid,bigint) to authenticated;

-- Numbered debt overrides distinguish an explicit unknown method from no override.
alter table public.debt_installment_edits add column payment_method text
  check(payment_method in('pix','credit','debit','cash','bank_transfer','boleto'));
alter table public.debt_installment_edits add column payment_method_set boolean not null default false;
alter table public.debt_installment_edits drop constraint debt_installment_edits_check;
alter table public.debt_installment_edits add constraint debt_installment_edits_check
  check(due_date is not null or amount_cents is not null or payment_method_set);
create function private.debt_payment_method_at(p_debt uuid,p_no integer)
returns text language sql stable security invoker set search_path=public as $$
  select case when e.payment_method_set then e.payment_method else d.payment_method end
  from public.debts d left join public.debt_installment_edits e
    on e.debt_id=d.id and e.installment_no=p_no where d.id=p_debt
$$;
revoke execute on function private.debt_payment_method_at(uuid,integer) from public,anon;
grant execute on function private.debt_payment_method_at(uuid,integer) to authenticated,service_role;

create function private.check_payment_versions(p_ids uuid[],p_versions jsonb)
returns void language plpgsql security invoker set search_path=public as $$ begin
  perform 1 from public.transactions where id=any(p_ids) order by debt_payment_no,id for update;
  if p_versions is null or jsonb_typeof(p_versions)<>'object'
    or (select count(*) from jsonb_object_keys(p_versions))<>cardinality(p_ids)
    or exists(select 1 from public.transactions t where t.id=any(p_ids) and
      (not p_versions?t.id::text or t.edit_revision is distinct from (p_versions->>t.id::text)::bigint)) then
    raise exception 'Outro pagamento mudou enquanto você editava';
  end if;
end $$;
revoke execute on function private.check_payment_versions(uuid[],jsonb) from public,anon;
grant execute on function private.check_payment_versions(uuid[],jsonb) to authenticated;

alter function public.update_debt_contract_scoped(uuid,integer,text,jsonb,bigint,jsonb,uuid) set schema private;
alter function private.update_debt_contract_scoped(uuid,integer,text,jsonb,bigint,jsonb,uuid) rename to update_debt_contract_scoped_payment_core;
create function public.update_debt_contract_scoped(p_debt_id uuid,p_anchor_no integer,p_scope text,p_patch jsonb,
  p_expected_revision bigint,p_expected_payment_versions jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; d public.debts%rowtype; ids uuid[]; method text; changed bigint:=0; saved jsonb; e record;
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','debt_contract','id',p_debt_id,
    'anchor',p_anchor_no,'scope',p_scope,'patch',p_patch,'revision',p_expected_revision,'versions',p_expected_payment_versions));
  if result is not null then return result; end if;
  if not(p_patch?'payment_method') then
    -- Legacy financial edits may delete numbered exceptions; preserve their method metadata.
    perform 1 from public.debts where id=p_debt_id for update;
    select jsonb_agg(jsonb_build_object('n',installment_no,'method',payment_method)) into saved
      from public.debt_installment_edits where debt_id=p_debt_id and payment_method_set;
    result:=private.update_debt_contract_scoped_payment_core(p_debt_id,p_anchor_no,p_scope,p_patch,p_expected_revision,p_expected_payment_versions,p_request_id);
    for e in select value from jsonb_array_elements(coalesce(saved,'[]'::jsonb)) loop
      insert into public.debt_installment_edits(debt_id,installment_no,payment_method,payment_method_set)
      values(p_debt_id,(e.value->>'n')::int,e.value->>'method',true) on conflict(debt_id,installment_no)
      do update set payment_method=excluded.payment_method,payment_method_set=true;
    end loop;
    perform private.finish_payment_request(p_request_id,result); return result;
  end if;
  if p_scope not in('one','future','all') then raise exception 'Escopo da dívida inválido'; end if;
  select * into d from public.debts where id=p_debt_id for update;
  if d.id is null or d.archived then raise exception 'Dívida ativa não encontrada'; end if;
  if d.edit_revision is distinct from p_expected_revision then raise exception 'A dívida mudou enquanto você editava'; end if;
  if d.installments is null or p_anchor_no is null or p_anchor_no<>d.installments_paid+1
    or (p_scope<>'all' and p_anchor_no>d.installments) then raise exception 'Abra novamente a próxima parcela para editar esta dívida'; end if;
  ids:=array(select id from public.transactions where debt_id=d.id);
  if p_scope='all' then perform private.check_payment_versions(ids,p_expected_payment_versions); end if;
  if p_patch-'payment_method'<>'{}'::jsonb then
    result:=private.update_debt_contract_scoped_payment_core(p_debt_id,p_anchor_no,p_scope,p_patch-'payment_method',p_expected_revision,p_expected_payment_versions,p_request_id);
  else result:=jsonb_build_object('scope',p_scope,'anchor_no',p_anchor_no,'recorded_changed',0,'contract_changed',p_scope<>'one'); end if;
  method:=p_patch->>'payment_method';
  select * into d from public.debts where id=p_debt_id;
  perform private.validate_payment_method(method,d.account_id,d.workspace_id);
  if p_scope='one' then
    insert into public.debt_installment_edits(debt_id,installment_no,payment_method,payment_method_set)
      values(d.id,p_anchor_no,method,true) on conflict(debt_id,installment_no) do update
      set payment_method=excluded.payment_method,payment_method_set=true;
    -- A virtual exception must also advance the revision used by the contract editor.
    update public.debts set payment_method=payment_method where id=d.id;
  else
    if p_scope='future' then
      -- Retain known metadata for previously declared installments when the default changes.
      insert into public.debt_installment_edits(debt_id,installment_no,payment_method,payment_method_set)
        select d.id,n,d.payment_method,true from generate_series(1,p_anchor_no-1) n
        on conflict(debt_id,installment_no) do nothing;
    end if;
    delete from public.debt_installment_edits where debt_id=d.id and payment_method_set
      and due_date is null and amount_cents is null and (p_scope='all' or installment_no>=p_anchor_no);
    update public.debt_installment_edits set payment_method=null,payment_method_set=false
      where debt_id=d.id and (p_scope='all' or installment_no>=p_anchor_no);
    perform private.apply_payment_metadata('debts',array[d.id],method);
    if p_scope='all' then changed:=private.apply_payment_metadata('transactions',ids,method); end if;
    result:=jsonb_set(result,'{recorded_changed}',to_jsonb(greatest(changed,(result->>'recorded_changed')::bigint)));
  end if;
  perform private.finish_payment_request(p_request_id,result); return result;
end $$;
revoke execute on function public.update_debt_contract_scoped(uuid,integer,text,jsonb,bigint,jsonb,uuid) from public,anon;
grant execute on function public.update_debt_contract_scoped(uuid,integer,text,jsonb,bigint,jsonb,uuid) to authenticated,service_role;

alter function public.update_debt_payment_scoped(uuid,text,jsonb,bigint,bigint,jsonb,uuid) set schema private;
alter function private.update_debt_payment_scoped(uuid,text,jsonb,bigint,bigint,jsonb,uuid) rename to update_debt_payment_scoped_payment_core;
create function public.update_debt_payment_scoped(p_anchor_id uuid,p_scope text,p_patch jsonb,p_expected_debt_revision bigint,
  p_expected_anchor_revision bigint,p_expected_payment_versions jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; a public.transactions%rowtype; d public.debts%rowtype; ids uuid[]; changed bigint; method text;
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','debt_payment','id',p_anchor_id,
    'scope',p_scope,'patch',p_patch,'debt_revision',p_expected_debt_revision,'revision',p_expected_anchor_revision,'versions',p_expected_payment_versions));
  if result is not null then return result; end if;
  if not(p_patch?'payment_method') then
    result:=private.update_debt_payment_scoped_payment_core(p_anchor_id,p_scope,p_patch,p_expected_debt_revision,p_expected_anchor_revision,p_expected_payment_versions,p_request_id);
    perform private.finish_payment_request(p_request_id,result); return result;
  end if;
  if p_scope not in('one','from_here','all') then raise exception 'Escopo de pagamento inválido'; end if;
  select * into a from public.transactions where id=p_anchor_id;
  select * into d from public.debts where id=a.debt_id for update;
  select * into a from public.transactions where id=p_anchor_id for update;
  if d.id is null or d.archived or a.debt_payment_no is null or a.kind<>'expense' or a.status<>'cleared'
    or a.debt_principal_cents is null or a.invoice_id is not null or a.pays_invoice_id is not null then raise exception 'Pagamento de dívida inválido'; end if;
  if d.edit_revision is distinct from p_expected_debt_revision or a.edit_revision is distinct from p_expected_anchor_revision then
    raise exception 'A dívida ou o pagamento mudou enquanto você editava'; end if;
  if p_scope<>'one' and exists(select 1 from public.transactions where debt_id=d.id and debt_payment_no is null) then raise exception 'Há pagamento sem número da parcela'; end if;
  ids:=array(select id from public.transactions where debt_id=d.id and
    (p_scope='all' or p_scope='from_here' and debt_payment_no>=a.debt_payment_no or p_scope='one' and id=a.id));
  perform private.check_payment_versions(ids,p_expected_payment_versions);
  if p_patch-'payment_method'<>'{}'::jsonb then
    result:=private.update_debt_payment_scoped_payment_core(p_anchor_id,p_scope,p_patch-'payment_method',p_expected_debt_revision,p_expected_anchor_revision,p_expected_payment_versions,p_request_id);
  else result:=jsonb_build_object('recorded_changed',0,'contract_changed',false,'future_installments',greatest(d.installments-d.installments_paid,0)); end if;
  method:=p_patch->>'payment_method';
  changed:=private.apply_payment_metadata('transactions',ids,method);
  if p_scope<>'one' then
    perform private.apply_payment_metadata('debts',array[d.id],method);
    delete from public.debt_installment_edits where debt_id=d.id and payment_method_set
      and due_date is null and amount_cents is null and (p_scope='all' or installment_no>=a.debt_payment_no);
    update public.debt_installment_edits set payment_method=null,payment_method_set=false
      where debt_id=d.id and (p_scope='all' or installment_no>=a.debt_payment_no);
    result:=jsonb_set(result,'{contract_changed}','true');
  end if;
  result:=jsonb_set(result,'{recorded_changed}',to_jsonb(greatest(changed,(result->>'recorded_changed')::bigint)));
  perform private.finish_payment_request(p_request_id,result); return result;
end $$;
revoke execute on function public.update_debt_payment_scoped(uuid,text,jsonb,bigint,bigint,jsonb,uuid) from public,anon;
grant execute on function public.update_debt_payment_scoped(uuid,text,jsonb,bigint,bigint,jsonb,uuid) to authenticated,service_role;

create function private.inherit_payment_method()
returns trigger language plpgsql security invoker set search_path=public as $$ begin
  if new.recurring_id is not null and not exists(select 1 from public.recurring_transactions where id=new.recurring_id and workspace_id=new.workspace_id)
    or new.installment_plan_id is not null and not exists(select 1 from public.installment_plans where id=new.installment_plan_id and workspace_id=new.workspace_id)
    or new.debt_id is not null and not exists(select 1 from public.debts where id=new.debt_id and workspace_id=new.workspace_id) then
    raise exception 'Origem do lançamento precisa pertencer ao mesmo workspace';
  end if;
  -- Adoption fills unknown metadata; ordinary explicit null edits remain null.
  if new.payment_method is null and (tg_op='INSERT' or
    new.recurring_id is distinct from old.recurring_id or new.installment_plan_id is distinct from old.installment_plan_id
    or new.debt_id is distinct from old.debt_id) then
    if new.recurring_id is not null then new.payment_method:=private.payment_method_at(new.recurring_id,new.occurred_at);
    elsif new.installment_plan_id is not null then new.payment_method:=(select payment_method from public.installment_plans where id=new.installment_plan_id);
    elsif new.debt_id is not null then new.payment_method:=private.debt_payment_method_at(new.debt_id,new.debt_payment_no);
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.inherit_payment_method() from public,anon,authenticated;
-- sync_debt_payment assigns the installment number first.
create trigger zy_inherit_payment_method before insert or update of recurring_id,installment_plan_id,debt_id,workspace_id on public.transactions
  for each row execute function private.inherit_payment_method();
-- Existing readers keep their return shape; this adds one named metadata field.
create function public.ledger_expected_lines_payment(p_from date,p_to date,p_recurring_id uuid default null)
returns table(origin text,ref_id uuid,due_date date,amount_cents bigint,kind text,description text,category text,
  account_id uuid,installment_no integer,installments_total integer,inferred_start boolean,status text,payment_method text)
language sql stable security invoker set search_path=public as $$
  select l.*,case when l.origin='recurring' then private.payment_method_at(l.ref_id,l.due_date)
    else private.debt_payment_method_at(l.ref_id,l.installment_no) end
  from public.ledger_expected_lines(p_from,p_to,p_recurring_id) l
$$;
revoke execute on function public.ledger_expected_lines_payment(date,date,uuid) from public,anon;
grant execute on function public.ledger_expected_lines_payment(date,date,uuid) to authenticated;

-- Validate the FINAL fee graph also when an old client edits the parent directly. Deferred
-- checks let the atomic API move purchase and fee together without accepting orphan metadata.
create function private.validate_owned_fee_graph()
returns trigger language plpgsql security invoker set search_path=public as $$
declare p public.transactions%rowtype; f public.transactions%rowtype;
begin
  for f in select * from public.transactions where pix_fee_for_transaction_id=new.id
    or id=new.id and pix_fee_for_transaction_id is not null loop
    select * into p from public.transactions where id=f.pix_fee_for_transaction_id;
    if p.id is null or p.workspace_id is distinct from f.workspace_id or p.kind not in('expense','transfer')
      or p.recurring_id is not null or p.installment_plan_id is not null or p.debt_id is not null
      or p.payment_method is not null and p.payment_method<>'pix'
      or p.pix_fee_for_transaction_id is not null or f.kind<>'expense'
      or f.account_id is distinct from p.account_id or f.occurred_at is distinct from p.occurred_at
      or not exists(select 1 from public.accounts where id=p.account_id and type='credit_card') then
      raise exception 'Juro vinculado exige Pix avulso no mesmo cartão, dia e workspace';
    end if;
  end loop;
  return null;
end $$;
revoke execute on function private.validate_owned_fee_graph() from public,anon,authenticated;
create constraint trigger owned_fee_graph after insert or update on public.transactions
  deferrable initially deferred for each row execute function private.validate_owned_fee_graph();

-- Financial history reconstruction is owned by the existing trigger. Save the independent
-- method timeline before it runs, then overlay it on the newly authoritative calendar windows.
-- This covers legacy/raw updates too: omitting method never turns old boleto into current Pix.
alter table private.recurring_history_versions add constraint recurring_history_payment_method_check
  check(payment_method in('pix','credit','debit','cash','bank_transfer','boleto'));
create function private.capture_payment_history()
returns trigger language plpgsql security invoker set search_path=public as $$
declare timeline jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('from',valid_from,'method',payment_method) order by valid_from),'[]'::jsonb)
    into timeline from private.recurring_history_versions where recurring_id=old.id;
  perform set_config('proops.payment_history_'||replace(old.id::text,'-',''),timeline::text,true);
  return new;
end $$;
revoke execute on function private.capture_payment_history() from public,anon,authenticated;
create trigger aa_capture_payment_history before update on public.recurring_transactions
  for each row execute function private.capture_payment_history();
create function private.restore_payment_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare timeline jsonb; boundary date; v private.recurring_history_versions%rowtype;
begin
  timeline:=nullif(current_setting('proops.payment_history_'||replace(new.id::text,'-',''),true),'')::jsonb;
  if timeline is null then return null; end if;
  for boundary in select (x.value->>'from')::date from jsonb_array_elements(timeline) x order by 1 loop
    select * into v from private.recurring_history_versions where recurring_id=new.id and valid_from<boundary
      and (valid_through is null or valid_through>=boundary) order by valid_from desc limit 1 for update;
    if v.recurring_id is not null then
      update private.recurring_history_versions set valid_through=boundary-1
        where recurring_id=v.recurring_id and valid_from=v.valid_from;
      insert into private.recurring_history_versions(recurring_id,workspace_id,valid_from,valid_through,
        anchor_date,inferred_before,rrule,kind,amount_cents,category,description,account_id,end_date,payment_method)
      values(v.recurring_id,v.workspace_id,boundary,v.valid_through,v.anchor_date,v.inferred_before,v.rrule,
        v.kind,v.amount_cents,v.category,v.description,v.account_id,v.end_date,v.payment_method);
    end if;
  end loop;
  update private.recurring_history_versions h set payment_method=(select x.value->>'method'
    from jsonb_array_elements(timeline) x where (x.value->>'from')::date<=h.valid_from
    order by (x.value->>'from')::date desc limit 1) where h.recurring_id=new.id;
  return null;
end $$;
revoke execute on function private.restore_payment_history() from public,anon,authenticated;
-- Alphabetically follows track_recurring_history and precedes zz_track_payment_history.
create trigger zz_restore_payment_history after update on public.recurring_transactions
  for each row execute function private.restore_payment_history();

-- Fee rows can still be edited/deleted by existing ledger flows. Their explicit owner must
-- become stale, so a form opened before that action cannot recreate or overwrite the fee.
create function private.advance_pix_fee_parent_revision()
returns trigger language plpgsql security invoker set search_path=public as $$
declare parents uuid[];
begin
  if tg_op='INSERT' then parents:=array[new.pix_fee_for_transaction_id];
  elsif tg_op='DELETE' then parents:=array[old.pix_fee_for_transaction_id];
  else parents:=array[old.pix_fee_for_transaction_id,new.pix_fee_for_transaction_id]; end if;
  -- Parent cascade deletion simply finds no surviving parent. Updating revision never changes
  -- ownership, and avulso parents have no fee-owner of their own, preventing recursion.
  update public.transactions set edit_revision=edit_revision+1 where id=any(parents);
  return null;
end $$;
revoke execute on function private.advance_pix_fee_parent_revision() from public,anon,authenticated;
create trigger advance_pix_fee_parent_revision after insert or update or delete on public.transactions
  for each row execute function private.advance_pix_fee_parent_revision();
