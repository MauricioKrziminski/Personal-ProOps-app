-- F06: classification extends the existing atomic commands and their full-intent receipts.
-- Financial cores never receive new fields; metadata is committed in the SAME transaction.

create or replace function private.inserir_da_hipotese(p_tabela text,p_linha jsonb,p_permitidas text[])
returns uuid language plpgsql security invoker set search_path=public as $$
declare id uuid;r record;
begin
  if p_tabela in('transactions','recurring_transactions','debts') then
    perform private.expense_classification_patch(p_linha);
    p_permitidas:=p_permitidas||array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
  end if;
  id:=private.inserir_da_hipotese_payment_core(p_tabela,p_linha,p_permitidas);
  execute format('select payment_method,account_id,workspace_id from public.%I where id=$1',p_tabela) into r using id;
  perform private.validate_payment_method(r.payment_method,r.account_id,r.workspace_id);
  return id;
end $$;

alter function private.criar_registro_da_hipotese(text,jsonb) rename to criar_registro_da_hipotese_classification_core;
create function private.criar_registro_da_hipotese(p_tipo text,p_dados jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare p jsonb;result jsonb;parent uuid;ids uuid[];
begin
  p:=case when p_tipo='lancamento' then '{}'::jsonb else private.expense_classification_patch(p_dados) end;
  result:=private.criar_registro_da_hipotese_classification_core(p_tipo,case when p_tipo='parcelada'
    then p_dados-array['expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'] else p_dados end);
  if p_tipo='parcelada' and p<>'{}' then
    parent:=(result->'ids'->>0)::uuid;
    perform private.apply_expense_classification('installment_plans',array[parent],p);
    ids:=array(select id from public.transactions where installment_plan_id=parent or down_payment_plan_id=parent);
    perform private.apply_expense_classification('transactions',ids,p);
  end if;
  return result;
end $$;
revoke execute on function private.criar_registro_da_hipotese(text,jsonb) from public,anon;
grant execute on function private.criar_registro_da_hipotese(text,jsonb) to authenticated;

-- Class-only edits of an occurrence must invalidate a parent editor opened beforehand.
create function private.advance_classification_parent_revision()
returns trigger language plpgsql security invoker set search_path='' as $$ begin
  if row(old.expense_pattern,old.expense_pattern_source,old.expense_necessity,old.expense_necessity_source)
    is distinct from row(new.expense_pattern,new.expense_pattern_source,new.expense_necessity,new.expense_necessity_source) then
    update public.recurring_transactions set expense_pattern=expense_pattern where id=new.recurring_id;
    update public.installment_plans set expense_pattern=expense_pattern where id=new.installment_plan_id;
    update public.debts set expense_pattern=expense_pattern where id=new.debt_id;
  end if;
  return null;
end $$;
revoke execute on function private.advance_classification_parent_revision() from public,anon,authenticated;
create trigger advance_classification_parent_revision after update on public.transactions
  for each row execute function private.advance_classification_parent_revision();

create or replace function public.update_recurring_one(p_transaction_id uuid,p_patch jsonb,p_expected_revision bigint,p_request_id uuid)
returns bigint language plpgsql security invoker set search_path=public as $$
declare result jsonb;r public.transactions%rowtype;changed bigint:=0;p jsonb:=private.expense_classification_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','update_recurring_one','id',p_transaction_id,'patch',p_patch,'revision',p_expected_revision));
  if result is not null then return (result->>'changed')::bigint;end if;
  if not(p_patch?'payment_method') and p='{}' then
    changed:=private.update_recurring_one_payment_core(p_transaction_id,p_patch,p_expected_revision,p_request_id);
  else
    perform 1 from public.recurring_transactions where id=(select recurring_id from public.transactions where id=p_transaction_id) for update;
    select * into r from public.transactions where id=p_transaction_id for update;
    if r.id is null or r.recurring_id is null then raise exception 'Ocorrência recorrente não encontrada';end if;
    if p_expected_revision is null or r.edit_revision is distinct from p_expected_revision then raise exception 'A ocorrência mudou enquanto você editava. Abra de novo';end if;
    if financial<>'{}' then changed:=private.update_recurring_one_payment_core(p_transaction_id,financial,p_expected_revision,p_request_id);end if;
    if p_patch?'payment_method' then changed:=greatest(changed,private.apply_payment_metadata('transactions',array[r.id],p_patch->>'payment_method'));end if;
    changed:=greatest(changed,private.apply_expense_classification('transactions',array[r.id],p));
  end if;
  perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed));return changed;
end $$;

create function private.join_expense_classification_patches(p_line jsonb,p_series jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare a jsonb:=private.expense_classification_patch(p_line);b jsonb:=private.expense_classification_patch(p_series);k text;
begin
  foreach k in array array['expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'] loop
    if a?k and b?k and a->k is distinct from b->k then raise exception 'Classificação da ocorrência e da regra precisam coincidir';end if;
  end loop;
  return a||b;
end $$;
revoke execute on function private.join_expense_classification_patches(jsonb,jsonb) from public,anon;
grant execute on function private.join_expense_classification_patches(jsonb,jsonb) to authenticated;

create or replace function public.update_recurring_all(p_recurring_id uuid,p_line_patch jsonb,p_series_patch jsonb,p_expected_revision bigint,p_request_id uuid)
returns bigint language plpgsql security invoker set search_path=public as $$
declare result jsonb;r public.recurring_transactions%rowtype;changed bigint:=0;ids uuid[];
  p jsonb:=private.join_expense_classification_patches(p_line_patch,p_series_patch);
  lf jsonb:=p_line_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
  sf jsonb:=p_series_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','update_recurring_all','id',p_recurring_id,'lines',p_line_patch,'series',p_series_patch,'revision',p_expected_revision));
  if result is not null then return (result->>'changed')::bigint;end if;
  if not(p_line_patch?'payment_method' or p_series_patch?'payment_method') and p='{}' then
    changed:=private.update_recurring_all_payment_core(p_recurring_id,p_line_patch,p_series_patch,p_expected_revision,p_request_id);
  else
    if p_line_patch?'payment_method' and p_series_patch?'payment_method' and p_line_patch->'payment_method' is distinct from p_series_patch->'payment_method' then raise exception 'Forma da ocorrência e da regra precisam coincidir';end if;
    select * into r from public.recurring_transactions where id=p_recurring_id for update;
    if r.id is null then raise exception 'Recorrência não encontrada';end if;
    if p_expected_revision is null or r.edit_revision is distinct from p_expected_revision then raise exception 'A recorrência mudou enquanto você editava. Abra de novo';end if;
    perform 1 from public.transactions where recurring_id=r.id order by id for update;
    if lf<>'{}' or sf<>'{}' then changed:=private.update_recurring_all_payment_core(p_recurring_id,lf,sf,p_expected_revision,p_request_id);end if;
    ids:=array(select id from public.transactions where recurring_id=r.id);
    if p_line_patch?'payment_method' or p_series_patch?'payment_method' then
      changed:=greatest(changed,private.apply_recurring_payment(r.id,ids,(p_series_patch||p_line_patch)->>'payment_method',current_date,true));end if;
    changed:=greatest(changed,private.apply_recurring_expense_classification(r.id,ids,p,current_date,true));
  end if;
  perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed));return changed;
end $$;

create or replace function public.update_recurring_future(p_transaction_id uuid,p_recurring_id uuid,p_line_patch jsonb,p_series_patch jsonb,p_expected_revision bigint,p_request_id uuid)
returns bigint language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare result jsonb;r public.recurring_transactions%rowtype;a public.transactions%rowtype;changed bigint:=0;
  ids uuid[];before_ids uuid[];boundary date:=current_date;
  p jsonb:=private.join_expense_classification_patches(p_line_patch,p_series_patch);
  lf jsonb:=p_line_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
  sf jsonb:=p_series_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','update_recurring_future','id',p_recurring_id,'anchor',p_transaction_id,'lines',p_line_patch,'series',p_series_patch,'revision',p_expected_revision));
  if result is not null then return (result->>'changed')::bigint;end if;
  if not(p_line_patch?'payment_method' or p_series_patch?'payment_method') and p='{}' then
    changed:=private.update_recurring_future_payment_core(p_transaction_id,p_recurring_id,p_line_patch,p_series_patch,p_expected_revision,p_request_id);
  else
    if p_transaction_id is null and p_line_patch<>'{}' then raise exception 'Uma alteração de ocorrência precisa da referência';end if;
    if p_line_patch?'payment_method' and p_series_patch?'payment_method' and p_line_patch->'payment_method' is distinct from p_series_patch->'payment_method' then raise exception 'Forma da ocorrência e da regra precisam coincidir';end if;
    select * into r from public.recurring_transactions where id=p_recurring_id for update;
    if r.id is null then raise exception 'Recorrência não encontrada';end if;
    if p_expected_revision is null or r.edit_revision is distinct from p_expected_revision then raise exception 'A recorrência mudou enquanto você editava. Abra de novo';end if;
    ids:=private.recurring_payment_targets(r.id,p_transaction_id);
    before_ids:=array(select id from public.transactions where recurring_id=r.id);
    if p_transaction_id is not null then
      select * into a from public.transactions where id=p_transaction_id;
      boundary:=greatest(current_date,case when a.invoice_id is null then coalesce(a.due_at,a.occurred_at) else a.occurred_at end);
    end if;
    if lf<>'{}' or sf<>'{}' then changed:=private.update_recurring_future_payment_core(p_transaction_id,p_recurring_id,lf,sf,p_expected_revision,p_request_id);end if;
    ids:=ids||array(select id from public.transactions where recurring_id=r.id and not(id=any(before_ids)));
    if p_line_patch?'payment_method' or p_series_patch?'payment_method' then
      changed:=greatest(changed,private.apply_recurring_payment(r.id,ids,(p_series_patch||p_line_patch)->>'payment_method',boundary,false));end if;
    changed:=greatest(changed,private.apply_recurring_expense_classification(r.id,ids,p,boundary,false));
  end if;
  perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed));return changed;
end $$;

-- Existing transaction command with four additional, validated metadata fields.
create or replace function public.save_transaction_payment(
  p_transaction_id uuid,p_input jsonb,p_fee_cents bigint,p_expected_revision bigint,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare r public.transactions%rowtype; fee uuid; result jsonb; payload jsonb; uid uuid:=auth.uid();
  allowed text[]:=array['kind','amount_cents','category','description','merchant','account_id','counterparty_account_id','occurred_at','status','due_at','auto_confirm','payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
begin
  if uid is null then raise exception 'Autenticação obrigatória'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(allowed)) then raise exception 'Campos do lançamento inválidos'; end if;
  if p_fee_cents<0 or p_fee_cents>9007199254740991 then raise exception 'Juro inválido'; end if;
  if p_input ? 'amount_cents' and (jsonb_typeof(p_input->'amount_cents') is distinct from 'number'
    or (p_input->>'amount_cents')::numeric<>trunc((p_input->>'amount_cents')::numeric)
    or (p_input->>'amount_cents')::numeric not between 1 and 9007199254740991) then raise exception 'Valor em centavos inteiros e positivos obrigatório'; end if;
  if p_input ? 'payment_method' and jsonb_typeof(p_input->'payment_method') not in('string','null') then raise exception 'Forma de pagamento inválida'; end if;
  perform private.expense_classification_patch(p_input);
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
      payment_method=case when p_input?'payment_method' then p_input->>'payment_method' else t.payment_method end,
      expense_pattern=case when p_input?'expense_pattern' then p_input->>'expense_pattern' else t.expense_pattern end,
      expense_pattern_source=case when p_input?'expense_pattern_source' then p_input->>'expense_pattern_source' else t.expense_pattern_source end,
      expense_necessity=case when p_input?'expense_necessity' then p_input->>'expense_necessity' else t.expense_necessity end,
      expense_necessity_source=case when p_input?'expense_necessity_source' then p_input->>'expense_necessity_source' else t.expense_necessity_source end
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

create or replace function public.update_installment_occurrence(p_transaction_id uuid,p_patch jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare changed bigint:=0;r public.transactions%rowtype;p jsonb:=private.expense_classification_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
begin
  if not(p_patch?'payment_method') and p='{}' then return private.update_installment_occurrence_payment_core(p_transaction_id,p_patch);end if;
  perform 1 from public.installment_plans where id=(select installment_plan_id from public.transactions where id=p_transaction_id) for update;
  select * into r from public.transactions where id=p_transaction_id for update;
  if r.id is null or r.installment_plan_id is null then raise exception 'Parcela não encontrada';end if;
  if financial<>'{}' then changed:=private.update_installment_occurrence_payment_core(p_transaction_id,financial);end if;
  if p_patch?'payment_method' then changed:=greatest(changed,private.apply_payment_metadata('transactions',array[r.id],p_patch->>'payment_method'));end if;
  return greatest(changed,private.apply_expense_classification('transactions',array[r.id],p));
end $$;
create or replace function public.update_installment_scope(p_transaction_id uuid,p_scope text,p_patch jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare r public.transactions%rowtype;plan public.installment_plans%rowtype;ids uuid[];changed bigint:=0;
  p jsonb:=private.expense_classification_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
begin
  if not(p_patch?'payment_method') and p='{}' then return private.update_installment_scope_payment_core(p_transaction_id,p_scope,p_patch);end if;
  if p_scope is null or p_scope not in('one','future','all') then raise exception 'Escolha quais parcelas editar';end if;
  select * into plan from public.installment_plans where id=(select installment_plan_id from public.transactions where id=p_transaction_id) for update;
  select * into r from public.transactions where id=p_transaction_id for update;
  if plan.id is null or r.id is null or r.installment_plan_id is distinct from plan.id then raise exception 'Parcela não encontrada';end if;
  perform 1 from public.transactions where installment_plan_id=plan.id order by id for update;
  ids:=array(select id from public.transactions where installment_plan_id=plan.id and
    (p_scope='all' or p_scope='one' and id=r.id or p_scope='future' and installment_no>=r.installment_no));
  if financial<>'{}' then changed:=private.update_installment_scope_payment_core(p_transaction_id,p_scope,financial);end if;
  if p_patch?'payment_method' then
    changed:=greatest(changed,private.apply_payment_metadata('transactions',ids,p_patch->>'payment_method'));
    if p_scope<>'one' then perform private.apply_payment_metadata('installment_plans',array[plan.id],p_patch->>'payment_method');end if;
  end if;
  changed:=greatest(changed,private.apply_expense_classification('transactions',ids,p));
  if p_scope<>'one' then perform private.apply_expense_classification('installment_plans',array[plan.id],p);end if;
  return changed;
end $$;

-- First-party installment editing now has the same revision/intent guarantees as recurrence
-- and debt editing. Parent-first locking prevents a repartition between checking and saving.
create function public.update_installment_scope_checked(p_transaction_id uuid,p_scope text,p_patch jsonb,
  p_expected_plan_revision bigint,p_expected_anchor_revision bigint,p_request_id uuid,p_last_day boolean default false)
returns bigint language plpgsql security invoker set search_path='' as $$
declare plan public.installment_plans%rowtype;a public.transactions%rowtype;cached jsonb;changed bigint;
begin
  cached:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','update_installment_scope_checked',
    'id',p_transaction_id,'scope',p_scope,'patch',p_patch,'plan_revision',p_expected_plan_revision,
    'anchor_revision',p_expected_anchor_revision,'last_day',p_last_day));
  if cached is not null then return (cached->>'changed')::bigint;end if;
  if p_last_day is null then raise exception 'Escolha de calendário inválida';end if;
  select * into plan from public.installment_plans where id=(select installment_plan_id from public.transactions where id=p_transaction_id) for update;
  select * into a from public.transactions where id=p_transaction_id for update;
  if plan.id is null or a.id is null or a.installment_plan_id is distinct from plan.id then raise exception 'Parcela não encontrada';end if;
  if p_expected_plan_revision is null or p_expected_anchor_revision is null or plan.edit_revision is distinct from p_expected_plan_revision
    or a.edit_revision is distinct from p_expected_anchor_revision then raise exception 'A compra ou a parcela mudou enquanto você editava. Abra de novo';end if;
  changed:=case when p_last_day and p_scope<>'one' then public.update_installment_scope_last_day(p_transaction_id,p_scope,p_patch)
    else public.update_installment_scope(p_transaction_id,p_scope,p_patch) end;
  perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed));return changed;
end $$;
revoke execute on function public.update_installment_scope_checked(uuid,text,jsonb,bigint,bigint,uuid,boolean) from public,anon;
grant execute on function public.update_installment_scope_checked(uuid,text,jsonb,bigint,bigint,uuid,boolean) to authenticated;

create or replace function public.update_installment_plan_payment(p_input jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare plan public.installment_plans%rowtype;changed bigint;cached jsonb;request uuid;method text;explicit boolean;
  ids uuid[];p jsonb;snapshots jsonb;r record;restore jsonb;
begin
  if auth.uid() is null or p_input is null or jsonb_typeof(p_input)<>'object'
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in('p_plan_id','p_total_cents','p_installments',
      'p_first_occurred_at','p_description','p_category','p_merchant','p_account_id','p_paid_installments','p_payment_method',
      'p_expected_revision','p_request_id','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source')) then raise exception 'Dados da compra inválidos';end if;
  p:=private.expense_classification_patch(p_input);request:=(p_input->>'p_request_id')::uuid;
  if request is not null then
    cached:=private.reserve_payment_request(request,jsonb_build_object('operation','update_installment_plan_payment','input',p_input));
    if cached is not null then return (cached->>'changed')::bigint;end if;
  end if;
  select * into plan from public.installment_plans where id=(p_input->>'p_plan_id')::uuid for update;
  if plan.id is null then raise exception 'Compra parcelada não encontrada';end if;
  if p_input?'p_expected_revision' and (p_input->>'p_expected_revision')::bigint is distinct from plan.edit_revision then raise exception 'A compra mudou enquanto você editava. Abra de novo';end if;
  explicit:=p_input?'p_payment_method';method:=case when explicit then p_input->>'p_payment_method' else plan.payment_method end;
  select jsonb_agg(jsonb_build_object('n',installment_no,'id',id,'expense_pattern',expense_pattern,
    'expense_pattern_source',expense_pattern_source,'expense_necessity',expense_necessity,'expense_necessity_source',expense_necessity_source))
    into snapshots from public.transactions where installment_plan_id=plan.id;
  select array_agg(id) into ids from public.transactions where installment_plan_id=plan.id;
  -- New children inherit the updated contract; saved numbered snapshots restore omitted dims.
  perform private.apply_expense_classification('installment_plans',array[plan.id],p);
  changed:=public.update_installment_plan(plan.id,(p_input->>'p_total_cents')::bigint,(p_input->>'p_installments')::integer,
    (p_input->>'p_first_occurred_at')::date,p_input->>'p_description',p_input->>'p_category',p_input->>'p_merchant',
    (p_input->>'p_account_id')::uuid,(p_input->>'p_paid_installments')::integer);
  if exists(select 1 from public.installment_plans where id=plan.id) then
    perform private.apply_payment_metadata('installment_plans',array[plan.id],method);
    ids:=array(select id from public.transactions where installment_plan_id=plan.id);
    for r in select value from jsonb_array_elements(coalesce(snapshots,'[]'::jsonb)) loop
      restore:='{}';
      if not(p?'expense_pattern') then restore:=restore||jsonb_build_object('expense_pattern',r.value->'expense_pattern','expense_pattern_source',r.value->'expense_pattern_source');end if;
      if not(p?'expense_necessity') then restore:=restore||jsonb_build_object('expense_necessity',r.value->'expense_necessity','expense_necessity_source',r.value->'expense_necessity_source');end if;
      perform private.apply_expense_classification('transactions',array(select id from public.transactions
        where installment_plan_id=plan.id and installment_no=(r.value->>'n')::integer),restore);
    end loop;
  end if;
  if explicit then changed:=greatest(changed,private.apply_payment_metadata('transactions',ids,method));end if;
  changed:=greatest(changed,private.apply_expense_classification('transactions',ids,p));
  if request is not null then perform private.finish_payment_request(request,jsonb_build_object('changed',changed));end if;
  return changed;
end $$;

create function private.restore_debt_classification_exceptions(p_debt uuid,p_snapshots jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare e record;maximum_no integer;
begin
  select greatest(installments,installments_paid) into maximum_no from public.debts where id=p_debt;
  for e in select * from jsonb_populate_recordset(null::public.debt_installment_edits,coalesce(p_snapshots,'[]'::jsonb)) loop
    if e.installment_no<=maximum_no and (e.expense_pattern_set or e.expense_necessity_set) then
      insert into public.debt_installment_edits(debt_id,installment_no,expense_pattern,expense_pattern_source,
        expense_pattern_set,expense_necessity,expense_necessity_source,expense_necessity_set)
      values(p_debt,e.installment_no,e.expense_pattern,e.expense_pattern_source,e.expense_pattern_set,
        e.expense_necessity,e.expense_necessity_source,e.expense_necessity_set)
      on conflict(debt_id,installment_no) do update set
        expense_pattern=excluded.expense_pattern,expense_pattern_source=excluded.expense_pattern_source,
        expense_pattern_set=excluded.expense_pattern_set,expense_necessity=excluded.expense_necessity,
        expense_necessity_source=excluded.expense_necessity_source,expense_necessity_set=excluded.expense_necessity_set;
    end if;
  end loop;
end $$;
revoke execute on function private.restore_debt_classification_exceptions(uuid,jsonb) from public,anon;
grant execute on function private.restore_debt_classification_exceptions(uuid,jsonb) to authenticated;

-- Only touched dimensions are frozen/cleared. This preserves an explicit-null exception in
-- predictability while necessity changes, and retains unknown past installments as unknown.
create function private.apply_debt_expense_classification(p_debt uuid,p_ids uuid[],p_anchor integer,p_scope text,p_input jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare p jsonb:=private.expense_classification_patch(p_input);d public.debts%rowtype;changed bigint;
begin
  if p='{}' then return 0;end if;
  if p_scope is null or p_scope not in('one','future','all') then raise exception 'Alcance da classificação da dívida inválido';end if;
  select * into d from public.debts where id=p_debt for update;
  if d.id is null then raise exception 'Dívida não encontrada';end if;
  if p_scope='one' then
    insert into public.debt_installment_edits(debt_id,installment_no,expense_pattern,expense_pattern_source,
      expense_pattern_set,expense_necessity,expense_necessity_source,expense_necessity_set)
    values(d.id,p_anchor,p->>'expense_pattern',p->>'expense_pattern_source',p?'expense_pattern',
      p->>'expense_necessity',p->>'expense_necessity_source',p?'expense_necessity')
    on conflict(debt_id,installment_no) do update set
      expense_pattern=case when p?'expense_pattern' then excluded.expense_pattern else debt_installment_edits.expense_pattern end,
      expense_pattern_source=case when p?'expense_pattern' then excluded.expense_pattern_source else debt_installment_edits.expense_pattern_source end,
      expense_pattern_set=debt_installment_edits.expense_pattern_set or excluded.expense_pattern_set,
      expense_necessity=case when p?'expense_necessity' then excluded.expense_necessity else debt_installment_edits.expense_necessity end,
      expense_necessity_source=case when p?'expense_necessity' then excluded.expense_necessity_source else debt_installment_edits.expense_necessity_source end,
      expense_necessity_set=debt_installment_edits.expense_necessity_set or excluded.expense_necessity_set;
    update public.debts set expense_pattern=expense_pattern where id=d.id;
  else
    if p_scope='future' then
      insert into public.debt_installment_edits(debt_id,installment_no,expense_pattern,expense_pattern_source,
        expense_pattern_set,expense_necessity,expense_necessity_source,expense_necessity_set)
      select d.id,n,case when p?'expense_pattern' then d.expense_pattern end,
        case when p?'expense_pattern' then d.expense_pattern_source end,p?'expense_pattern',
        case when p?'expense_necessity' then d.expense_necessity end,
        case when p?'expense_necessity' then d.expense_necessity_source end,p?'expense_necessity'
        from generate_series(1,p_anchor-1) n
      on conflict(debt_id,installment_no) do update set
        expense_pattern=case when debt_installment_edits.expense_pattern_set then debt_installment_edits.expense_pattern else excluded.expense_pattern end,
        expense_pattern_source=case when debt_installment_edits.expense_pattern_set then debt_installment_edits.expense_pattern_source else excluded.expense_pattern_source end,
        expense_pattern_set=debt_installment_edits.expense_pattern_set or excluded.expense_pattern_set,
        expense_necessity=case when debt_installment_edits.expense_necessity_set then debt_installment_edits.expense_necessity else excluded.expense_necessity end,
        expense_necessity_source=case when debt_installment_edits.expense_necessity_set then debt_installment_edits.expense_necessity_source else excluded.expense_necessity_source end,
        expense_necessity_set=debt_installment_edits.expense_necessity_set or excluded.expense_necessity_set;
    end if;
    delete from public.debt_installment_edits where debt_id=d.id and due_date is null and amount_cents is null
      and not payment_method_set and (not expense_pattern_set or p?'expense_pattern')
      and (not expense_necessity_set or p?'expense_necessity') and (p_scope='all' or installment_no>=p_anchor);
    update public.debt_installment_edits set
      expense_pattern=case when p?'expense_pattern' then null else expense_pattern end,
      expense_pattern_source=case when p?'expense_pattern' then null else expense_pattern_source end,
      expense_pattern_set=case when p?'expense_pattern' then false else expense_pattern_set end,
      expense_necessity=case when p?'expense_necessity' then null else expense_necessity end,
      expense_necessity_source=case when p?'expense_necessity' then null else expense_necessity_source end,
      expense_necessity_set=case when p?'expense_necessity' then false else expense_necessity_set end
      where debt_id=d.id and (p_scope='all' or installment_no>=p_anchor);
    delete from public.debt_installment_edits where debt_id=d.id and due_date is null and amount_cents is null
      and not payment_method_set and not expense_pattern_set and not expense_necessity_set;
    -- Advance the revision even if resetting exceptions retains the same parent values.
    update public.debts set
      expense_pattern=case when p?'expense_pattern' then p->>'expense_pattern' else expense_pattern end,
      expense_pattern_source=case when p?'expense_pattern' then p->>'expense_pattern_source' else expense_pattern_source end,
      expense_necessity=case when p?'expense_necessity' then p->>'expense_necessity' else expense_necessity end,
      expense_necessity_source=case when p?'expense_necessity' then p->>'expense_necessity_source' else expense_necessity_source end
      where id=d.id;
  end if;
  changed:=private.apply_expense_classification('transactions',p_ids,p);
  return changed;
end $$;
revoke execute on function private.apply_debt_expense_classification(uuid,uuid[],integer,text,jsonb) from public,anon;
grant execute on function private.apply_debt_expense_classification(uuid,uuid[],integer,text,jsonb) to authenticated;

create or replace function public.update_debt_contract_scoped(p_debt_id uuid,p_anchor_no integer,p_scope text,p_patch jsonb,
  p_expected_revision bigint,p_expected_payment_versions jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;d public.debts%rowtype;ids uuid[];method text;changed bigint:=0;saved jsonb;classes jsonb;e record;
  p jsonb:=private.expense_classification_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','debt_contract','id',p_debt_id,
    'anchor',p_anchor_no,'scope',p_scope,'patch',p_patch,'revision',p_expected_revision,'versions',p_expected_payment_versions));
  if result is not null then return result;end if;
  select * into d from public.debts where id=p_debt_id for update;
  select jsonb_agg(to_jsonb(x)) into classes from public.debt_installment_edits x where debt_id=p_debt_id;
  select jsonb_agg(jsonb_build_object('n',installment_no,'method',payment_method)) into saved
    from public.debt_installment_edits where debt_id=p_debt_id and payment_method_set;
  if not(p_patch?'payment_method') and p='{}' then
    result:=private.update_debt_contract_scoped_payment_core(p_debt_id,p_anchor_no,p_scope,p_patch,p_expected_revision,p_expected_payment_versions,p_request_id);
  else
    if p_scope is null or p_scope not in('one','future','all') then raise exception 'Escopo da dívida inválido';end if;
    if d.id is null or d.archived then raise exception 'Dívida ativa não encontrada';end if;
    if d.edit_revision is distinct from p_expected_revision then raise exception 'A dívida mudou enquanto você editava';end if;
    if d.installments is null or p_anchor_no is null or p_anchor_no<>d.installments_paid+1
      or (p_scope<>'all' and p_anchor_no>d.installments) then raise exception 'Abra novamente a próxima parcela para editar esta dívida';end if;
    ids:=array(select id from public.transactions where debt_id=d.id);
    if p_scope='all' then perform private.check_payment_versions(ids,p_expected_payment_versions);end if;
    if financial<>'{}' then
      result:=private.update_debt_contract_scoped_payment_core(p_debt_id,p_anchor_no,p_scope,financial,p_expected_revision,p_expected_payment_versions,p_request_id);
    else result:=jsonb_build_object('scope',p_scope,'anchor_no',p_anchor_no,'recorded_changed',0,'contract_changed',p_scope<>'one');end if;
  end if;
  perform private.restore_debt_classification_exceptions(p_debt_id,classes);
  if not(p_patch?'payment_method') then
    for e in select value from jsonb_array_elements(coalesce(saved,'[]'::jsonb)) loop
      insert into public.debt_installment_edits(debt_id,installment_no,payment_method,payment_method_set)
        values(p_debt_id,(e.value->>'n')::int,e.value->>'method',true) on conflict(debt_id,installment_no)
        do update set payment_method=excluded.payment_method,payment_method_set=true;
    end loop;
  else
    method:=p_patch->>'payment_method';select * into d from public.debts where id=p_debt_id;
    perform private.validate_payment_method(method,d.account_id,d.workspace_id);
    if p_scope='one' then
      insert into public.debt_installment_edits(debt_id,installment_no,payment_method,payment_method_set)
        values(d.id,p_anchor_no,method,true) on conflict(debt_id,installment_no) do update set payment_method=excluded.payment_method,payment_method_set=true;
      update public.debts set payment_method=payment_method where id=d.id;
    else
      if p_scope='future' then
        insert into public.debt_installment_edits(debt_id,installment_no,payment_method,payment_method_set)
          select d.id,n,d.payment_method,true from generate_series(1,p_anchor_no-1) n
          on conflict(debt_id,installment_no) do update set payment_method=case when debt_installment_edits.payment_method_set
            then debt_installment_edits.payment_method else excluded.payment_method end,payment_method_set=true;
      end if;
      delete from public.debt_installment_edits where debt_id=d.id and payment_method_set and due_date is null and amount_cents is null
        and not expense_pattern_set and not expense_necessity_set and (p_scope='all' or installment_no>=p_anchor_no);
      update public.debt_installment_edits set payment_method=null,payment_method_set=false
        where debt_id=d.id and (p_scope='all' or installment_no>=p_anchor_no);
      delete from public.debt_installment_edits where debt_id=d.id and due_date is null and amount_cents is null
        and not payment_method_set and not expense_pattern_set and not expense_necessity_set;
      perform private.apply_payment_metadata('debts',array[d.id],method);
      if p_scope='all' then changed:=private.apply_payment_metadata('transactions',ids,method);end if;
    end if;
  end if;
  if p<>'{}' then changed:=greatest(changed,private.apply_debt_expense_classification(p_debt_id,
    case when p_scope='all' then ids else '{}'::uuid[] end,p_anchor_no,p_scope,p));end if;
  result:=jsonb_set(result,'{recorded_changed}',to_jsonb(greatest(changed,(result->>'recorded_changed')::bigint)));
  perform private.finish_payment_request(p_request_id,result);return result;
end $$;

create or replace function public.update_debt_payment_scoped(p_anchor_id uuid,p_scope text,p_patch jsonb,p_expected_debt_revision bigint,
  p_expected_anchor_revision bigint,p_expected_payment_versions jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;a public.transactions%rowtype;d public.debts%rowtype;ids uuid[];changed bigint:=0;method text;classes jsonb;
  p jsonb:=private.expense_classification_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','debt_payment','id',p_anchor_id,
    'scope',p_scope,'patch',p_patch,'debt_revision',p_expected_debt_revision,'revision',p_expected_anchor_revision,'versions',p_expected_payment_versions));
  if result is not null then return result;end if;
  select * into a from public.transactions where id=p_anchor_id;
  select * into d from public.debts where id=a.debt_id for update;
  select jsonb_agg(to_jsonb(x)) into classes from public.debt_installment_edits x where debt_id=d.id;
  if not(p_patch?'payment_method') and p='{}' then
    result:=private.update_debt_payment_scoped_payment_core(p_anchor_id,p_scope,p_patch,p_expected_debt_revision,p_expected_anchor_revision,p_expected_payment_versions,p_request_id);
  else
    if p_scope is null or p_scope not in('one','from_here','all') then raise exception 'Escopo de pagamento inválido';end if;
    select * into a from public.transactions where id=p_anchor_id for update;
    if d.id is null or d.archived or a.debt_payment_no is null or a.kind<>'expense' or a.status<>'cleared'
      or a.debt_principal_cents is null or a.invoice_id is not null or a.pays_invoice_id is not null then raise exception 'Pagamento de dívida inválido';end if;
    if d.edit_revision is distinct from p_expected_debt_revision or a.edit_revision is distinct from p_expected_anchor_revision then
      raise exception 'A dívida ou o pagamento mudou enquanto você editava';end if;
    if p_scope<>'one' and exists(select 1 from public.transactions where debt_id=d.id and debt_payment_no is null) then raise exception 'Há pagamento sem número da parcela';end if;
    ids:=array(select id from public.transactions where debt_id=d.id and
      (p_scope='all' or p_scope='from_here' and debt_payment_no>=a.debt_payment_no or p_scope='one' and id=a.id));
    perform private.check_payment_versions(ids,p_expected_payment_versions);
    if financial<>'{}' then
      result:=private.update_debt_payment_scoped_payment_core(p_anchor_id,p_scope,financial,p_expected_debt_revision,p_expected_anchor_revision,p_expected_payment_versions,p_request_id);
    else result:=jsonb_build_object('recorded_changed',0,'contract_changed',false,'future_installments',greatest(d.installments-d.installments_paid,0));end if;
  end if;
  perform private.restore_debt_classification_exceptions(d.id,classes);
  if p_patch?'payment_method' then
    method:=p_patch->>'payment_method';changed:=private.apply_payment_metadata('transactions',ids,method);
    if p_scope<>'one' then
      -- Method changes must freeze past numbered defaults without erasing class exceptions.
      if p_scope='from_here' then
        insert into public.debt_installment_edits(debt_id,installment_no,payment_method,payment_method_set)
          select d.id,n,d.payment_method,true from generate_series(1,a.debt_payment_no-1) n
          on conflict(debt_id,installment_no) do update set payment_method=case when debt_installment_edits.payment_method_set
            then debt_installment_edits.payment_method else excluded.payment_method end,payment_method_set=true;
      end if;
      perform private.apply_payment_metadata('debts',array[d.id],method);
      delete from public.debt_installment_edits where debt_id=d.id and payment_method_set and due_date is null and amount_cents is null
        and not expense_pattern_set and not expense_necessity_set and (p_scope='all' or installment_no>=a.debt_payment_no);
      update public.debt_installment_edits set payment_method=null,payment_method_set=false
        where debt_id=d.id and (p_scope='all' or installment_no>=a.debt_payment_no);
      delete from public.debt_installment_edits where debt_id=d.id and due_date is null and amount_cents is null
        and not payment_method_set and not expense_pattern_set and not expense_necessity_set;
      result:=jsonb_set(result,'{contract_changed}','true');
    end if;
  end if;
  if p<>'{}' then
    if p_scope='one' then changed:=greatest(changed,private.apply_expense_classification('transactions',ids,p));
    else
      changed:=greatest(changed,private.apply_debt_expense_classification(d.id,ids,a.debt_payment_no,
        case when p_scope='all' then 'all' else 'future' end,p));
      result:=jsonb_set(result,'{contract_changed}','true');
    end if;
  end if;
  result:=jsonb_set(result,'{recorded_changed}',to_jsonb(greatest(changed,(result->>'recorded_changed')::bigint)));
  perform private.finish_payment_request(p_request_id,result);return result;
end $$;

create or replace function public.update_recurring_series(p_recurring_id uuid,p_patch jsonb,p_propagate boolean default true)
returns bigint language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare ids uuid[];before_ids uuid[];changed bigint:=0;p jsonb:=private.expense_classification_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
begin
  if not(p_patch?'payment_method') and p='{}' then return private.update_recurring_series_payment_core(p_recurring_id,p_patch,p_propagate);end if;
  ids:=private.recurring_payment_targets(p_recurring_id,null);
  before_ids:=array(select id from public.transactions where recurring_id=p_recurring_id);
  if financial<>'{}' then changed:=private.update_recurring_series_payment_core(p_recurring_id,financial,p_propagate);end if;
  ids:=case when p_propagate then ids||array(select id from public.transactions where recurring_id=p_recurring_id and not(id=any(before_ids))) else '{}'::uuid[] end;
  if p_patch?'payment_method' then changed:=greatest(changed,private.apply_recurring_payment(p_recurring_id,ids,p_patch->>'payment_method',current_date,false));end if;
  return greatest(changed,private.apply_recurring_expense_classification(p_recurring_id,ids,p,current_date,false));
end $$;

create or replace function public.update_transaction_scoped(p_transaction_id uuid,p_scope text,p_patch jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare r public.transactions%rowtype;ids uuid[];changed bigint:=0;p jsonb:=private.expense_classification_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'];
begin
  if not(p_patch?'payment_method') and p='{}' then return private.update_transaction_scoped_payment_core(p_transaction_id,p_scope,p_patch);end if;
  if p_scope is null or p_scope not in('one','future') then raise exception 'Escopo inválido';end if;
  perform 1 from public.recurring_transactions where id=(select recurring_id from public.transactions where id=p_transaction_id) for update;
  perform 1 from public.installment_plans where id=(select installment_plan_id from public.transactions where id=p_transaction_id) for update;
  select * into r from public.transactions where id=p_transaction_id for update;
  if r.id is null then raise exception 'Lançamento não encontrado';end if;
  if p_scope='future' and r.recurring_id is null and r.installment_plan_id is null then raise exception 'Esse lançamento não faz parte de uma série';end if;
  ids:=array(select t.id from public.transactions t where t.workspace_id=r.workspace_id and
    (t.id=r.id or p_scope='future' and t.status='pending' and t.occurred_at>=r.occurred_at
      and (r.recurring_id is not null and t.recurring_id=r.recurring_id or r.installment_plan_id is not null and t.installment_plan_id=r.installment_plan_id)));
  perform 1 from public.transactions where id=any(ids) order by id for update;
  if financial<>'{}' then changed:=private.update_transaction_scoped_payment_core(p_transaction_id,p_scope,financial);end if;
  if p_patch?'payment_method' then
    changed:=greatest(changed,private.apply_payment_metadata('transactions',ids,p_patch->>'payment_method'));
    if p_scope='future' and r.recurring_id is not null then perform private.apply_recurring_payment(r.recurring_id,'{}'::uuid[],p_patch->>'payment_method',greatest(current_date,r.occurred_at),false);
    elsif p_scope='future' and r.installment_plan_id is not null then perform private.apply_payment_metadata('installment_plans',array[r.installment_plan_id],p_patch->>'payment_method');end if;
  end if;
  changed:=greatest(changed,private.apply_expense_classification('transactions',ids,p));
  if p_scope='future' and r.recurring_id is not null then perform private.apply_recurring_expense_classification(r.recurring_id,'{}'::uuid[],p,greatest(current_date,r.occurred_at),false);
  elsif p_scope='future' and r.installment_plan_id is not null then perform private.apply_expense_classification('installment_plans',array[r.installment_plan_id],p);end if;
  return changed;
end $$;

create or replace function public.convert_transaction_to_installments(p_transaction_id uuid,p_total_cents bigint,p_installments integer,
  p_first_occurred_at date,p_description text default null,p_category text default null,p_merchant text default null,
  p_account_id uuid default null,p_paid_installments integer default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r public.transactions%rowtype;plan uuid;p jsonb;
begin
  select * into r from public.transactions where id=p_transaction_id for update;
  p:=private.expense_classification_patch(to_jsonb(r));
  if exists(select 1 from public.transactions where pix_fee_for_transaction_id=p_transaction_id) then raise exception 'Zere o juro vinculado antes de converter esta compra';end if;
  plan:=private.convert_transaction_to_installments_payment_core(p_transaction_id,p_total_cents,p_installments,
    p_first_occurred_at,p_description,p_category,p_merchant,p_account_id,p_paid_installments);
  perform private.apply_payment_metadata('installment_plans',array[plan],r.payment_method);
  perform private.apply_payment_metadata('transactions',array(select id from public.transactions where installment_plan_id=plan),r.payment_method);
  perform private.apply_expense_classification('installment_plans',array[plan],p);
  perform private.apply_expense_classification('transactions',array(select id from public.transactions where installment_plan_id=plan),p);
  return plan;
end $$;

-- Named read API keeps the existing payment reader's shape compatible with older builds.
create function public.ledger_expected_lines_classified(p_from date,p_to date,p_recurring_id uuid default null)
returns table(origin text,ref_id uuid,due_date date,amount_cents bigint,kind text,description text,category text,
  account_id uuid,installment_no integer,installments_total integer,inferred_start boolean,status text,payment_method text,
  expense_pattern text,expense_pattern_source text,expense_necessity text,expense_necessity_source text)
language sql stable security invoker set search_path='' as $$
  select l.*,case when l.kind='expense' then c.data->>'expense_pattern' end,
    case when l.kind='expense' then c.data->>'expense_pattern_source' end,
    case when l.kind='expense' then c.data->>'expense_necessity' end,
    case when l.kind='expense' then c.data->>'expense_necessity_source' end
  from public.ledger_expected_lines_payment(p_from,p_to,p_recurring_id) l
  cross join lateral (select case when l.origin='recurring' then private.recurring_expense_classification_at(l.ref_id,l.due_date)
    else private.debt_expense_classification_at(l.ref_id,l.installment_no) end as data) c
$$;
revoke execute on function public.ledger_expected_lines_classified(date,date,uuid) from public,anon;
grant execute on function public.ledger_expected_lines_classified(date,date,uuid) to authenticated;

-- Existing converter adopts source snapshots per dimension, with explicit destination overrides.
create or replace function public.converter_registro(p_origem jsonb,p_alcance text,p_destino jsonb)
returns jsonb language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare result jsonb; method text; explicit boolean; tipo text:=p_destino->>'tipo'; data jsonb:=p_destino->'dados';
  created_id uuid; ids uuid[]; tab text; source_tab text; fee uuid; classification jsonb; explicit_class jsonb; source_record jsonb;
begin
  source_tab:=case p_origem->>'tipo' when 'transacao' then 'transactions' when 'serie' then 'recurring_transactions' when 'plano' then 'installment_plans' when 'divida' then 'debts' end;
  if source_tab is not null then execute format('select payment_method from public.%I where id=$1 for update',source_tab) into method using (p_origem->>'id')::uuid; end if;
  if source_tab is not null then execute format('select to_jsonb(t) from public.%I t where id=$1',source_tab) into source_record using (p_origem->>'id')::uuid; end if;
  classification:=private.expense_classification_patch(coalesce(source_record,'{}'::jsonb));
  explicit_class:=private.expense_classification_patch(case when tipo='lancamento' then data->'linhas'->0 else data end);
  classification:=classification||explicit_class;
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
  if tipo='recorrente' and (select kind from public.recurring_transactions where id=created_id)<>'expense' then
    classification:=jsonb_build_object('expense_pattern',null,'expense_pattern_source',null,'expense_necessity',null,'expense_necessity_source',null);
  end if;
  if tab is not null then perform private.apply_expense_classification(tab,array[created_id],classification); end if;
  if tipo='parcelada' then
    perform private.apply_expense_classification('transactions',array(select id from public.transactions
      where installment_plan_id=created_id or down_payment_plan_id=created_id),classification);
  elsif tipo='recorrente' then
    perform private.apply_recurring_expense_classification(created_id,array(select id from public.transactions where recurring_id=created_id),classification,current_date,true);
  elsif tipo='financiamento' then
    perform private.apply_expense_classification('transactions',array(select id from public.transactions
      where debt_id=created_id or down_payment_debt_id=created_id),classification);
  elsif tipo='lancamento' then
    if (select kind from public.transactions where id=created_id)<>'expense' then
      classification:=jsonb_build_object('expense_pattern',null,'expense_pattern_source',null,'expense_necessity',null,'expense_necessity_source',null);
    end if;
    perform private.apply_expense_classification('transactions',array[created_id],classification);
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
