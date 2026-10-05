-- A prévia "Ao salvar" do financiamento mostra também as parcelas pagas do ciclo que o Salvar lança
-- (`p_args.p_ja_sairam = {accountId, numbers[]}`, só em purchase/financiamento). Corpo copiado de
-- 20261003205241 (cabeçalho, isolamento, timeouts, allowlists, rollback); assinatura inalterada, então
-- ACL e dono ficam. Depende de 20261005191000/20261005192000 (register_counted_debt_payments).
CREATE OR REPLACE FUNCTION public.preview_finance_write(p_operation text, p_args jsonb, p_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
 SET default_transaction_isolation TO 'repeatable read'
 SET statement_timeout TO '8s'
 SET lock_timeout TO '1s'
AS $function$
declare
  allowed text[];
  input_allowed text[];
  input jsonb;
  entrada jsonb;
  snapshot_before jsonb;
  snapshot_after jsonb;
  result jsonb;
  response jsonb;
  v_parent_id uuid;
  v_transaction_id uuid;
  v_recurring_id uuid;
  v_plan_id uuid;
  v_debt_id uuid;
  history_from date;
  history_to date;
  schedule_rows jsonb;
  schedule_count bigint;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if current_setting('transaction_isolation') not in ('repeatable read','serializable') then
    raise exception using errcode='25001', message='A prévia exige uma transação repeatable read';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'Informe um horizonte de 1 a 366 dias';
  end if;
  if p_operation is null or p_operation not in ('transaction','purchase','recurring') then
    raise exception 'Operação de prévia inválida';
  end if;
  allowed := case p_operation
    when 'transaction' then array['p_transaction_id','p_input','p_fee_cents','p_expected_revision']
    when 'purchase' then array['p_tipo','p_dados','p_entrada','p_ja_sairam']
    when 'recurring' then array['p_input'] end;
  if jsonb_typeof(p_args) is distinct from 'object' or exists(
      select 1 from jsonb_object_keys(p_args) k where k<>all(allowed)) then
    raise exception 'Argumentos de prévia inválidos';
  end if;
  input := case when p_operation='purchase' then p_args->'p_dados' else p_args->'p_input' end;
  if jsonb_typeof(input) is distinct from 'object' then raise exception 'Dados de prévia inválidos'; end if;
  if p_operation='transaction' then
    input_allowed := array['kind','amount_cents','category','description','merchant','account_id',
      'counterparty_account_id','occurred_at','status','due_at','auto_confirm','payment_method'];
    if p_args?'p_transaction_id' and jsonb_typeof(p_args->'p_transaction_id') not in ('string','null')
      or exists(select 1 from jsonb_each(p_args) x where x.key in('p_fee_cents','p_expected_revision')
        and (jsonb_typeof(x.value) not in('number','null') or
          jsonb_typeof(x.value)='number' and (x.value::text)::numeric<>trunc((x.value::text)::numeric))) then
      raise exception 'Identificador, revisão ou juros inválidos';
    end if;
  elsif p_operation='recurring' then
    input_allowed := array['kind','amount_cents','description','merchant','category','account_id',
      'rrule','next_run_at','dtstart','end_date','auto_confirm','payment_method'];
  else
    if p_args->>'p_tipo' is null or p_args->>'p_tipo' not in('parcelada','financiamento') then
      raise exception 'Tipo de compra inválido';
    end if;
    input_allowed := case p_args->>'p_tipo'
      when 'parcelada' then array['p_account_id','p_total_cents','p_installments','p_occurred_at',
        'p_paid_installments','p_description','p_category','p_merchant','ultimo_dia','p_payment_method','down_payment']
      else array['name','kind','calculation_mode','principal_cents','remaining_cents','interest_rate_monthly',
        'installments','installments_paid','installment_cents','account_id','due_day','first_due_date','payment_method','payment_category','down_payment'] end;
    -- The existing writer accepts either location and rejects conflicting entries.
    foreach entrada in array array[nullif(p_args->'p_entrada','null'::jsonb),nullif(input->'down_payment','null'::jsonb)] loop
      if entrada is not null and (jsonb_typeof(entrada)<>'object' or exists(
        select 1 from jsonb_object_keys(entrada) k
        where k not in('amount_cents','account_id','occurred_at','payment_method'))) then
        raise exception 'Dados da entrada inválidos';
      end if;
    end loop;
  end if;
  -- Parcelas pagas do ciclo atual que o Salvar lança depois do cadastro (register_counted_debt_payments).
  if p_args?'p_ja_sairam' and jsonb_typeof(p_args->'p_ja_sairam')<>'null' then
    if p_operation<>'purchase' or p_args->>'p_tipo'<>'financiamento'
       or jsonb_typeof(p_args->'p_ja_sairam')<>'object'
       or exists(select 1 from jsonb_object_keys(p_args->'p_ja_sairam') k where k not in('accountId','numbers'))
       or jsonb_typeof(p_args->'p_ja_sairam'->'numbers')<>'array'
       or coalesce(p_args->'p_ja_sairam'->>'accountId','')!~'^[0-9a-fA-F-]{36}$' then
      raise exception 'Parcelas já pagas da prévia inválidas';
    end if;
  end if;
  input_allowed := input_allowed || array['expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
  if exists(select 1 from jsonb_object_keys(input) k where k<>all(input_allowed)) then
    raise exception 'Campos de prévia inválidos';
  end if;

  begin
    select jsonb_build_object(
      'balances',coalesce((select jsonb_agg(to_jsonb(b) order by b.account_id) from public.account_balances() b),'[]'::jsonb),
      'limits',coalesce((select jsonb_agg(to_jsonb(l) order by l.account_id) from public.card_limit_context() l),'[]'::jsonb),
      'accounts',public.accounts_horizon(p_days),'cards',public.cards_horizon(p_days)) into snapshot_before;

    if p_operation='transaction' then
      result := public.save_transaction_payment((p_args->>'p_transaction_id')::uuid,input,
        (p_args->>'p_fee_cents')::bigint,(p_args->>'p_expected_revision')::bigint,gen_random_uuid());
      v_transaction_id := (result->>'id')::uuid;
    elsif p_operation='recurring' then
      result := public.create_recurring_payment(input,gen_random_uuid());
      v_recurring_id := (result->>'id')::uuid;
    else
      result := public.create_purchase(p_args->>'p_tipo',input,nullif(p_args->'p_entrada','null'::jsonb),gen_random_uuid());
      v_parent_id := (result->'ids'->>0)::uuid;
      if p_args->>'p_tipo'='parcelada' then v_plan_id:=v_parent_id; else v_debt_id:=v_parent_id; end if;
      -- O mesmo passo do Salvar: lança as pagas do ciclo, dentro desta subtransação desfeita.
      if v_debt_id is not null and jsonb_typeof(p_args->'p_ja_sairam')='object' then
        perform public.register_counted_debt_payments(v_debt_id,(p_args->'p_ja_sairam'->>'accountId')::uuid,
          array(select (x.value)::int from jsonb_array_elements_text(p_args->'p_ja_sairam'->'numbers') x));
      end if;
    end if;
    -- These checks see the COMPLETE compound write, as at an actual commit.
    -- Their deferred mode and queued events are also restored by the rollback.
    set constraints public.payment_method_compatibility, public.owned_fee_graph,
      public.transactions_subcategory_scope_fkey, public.recurring_transactions_subcategory_scope_fkey,
      public.installment_plans_subcategory_scope_fkey, public.debts_subcategory_scope_fkey,
      public.debt_installment_subcategory_scope_fkey, private.recurring_history_versions_subcategory_scope_fkey immediate;

    select jsonb_build_object(
      'balances',coalesce((select jsonb_agg(to_jsonb(b) order by b.account_id) from public.account_balances() b),'[]'::jsonb),
      'limits',coalesce((select jsonb_agg(to_jsonb(l) order by l.account_id) from public.card_limit_context() l),'[]'::jsonb),
      'accounts',public.accounts_horizon(p_days),'cards',public.cards_horizon(p_days)) into snapshot_after;

    if v_debt_id is not null then
      select min(h.due_date),max(h.due_date) into history_from,history_to
      from public.debt_declared_due_dates h where h.debt_id=v_debt_id;
    end if;
    with candidates as (
      select 'transaction'::text as origin,t.id,
        coalesce(t.installment_plan_id,t.recurring_id,t.debt_id,t.down_payment_plan_id,t.down_payment_debt_id,t.id) as ref_id,
        t.occurred_at,coalesce(t.due_at,t.occurred_at) as due_at,t.account_id,t.counterparty_account_id,t.kind,
        t.amount_cents,t.status,t.description,coalesce(t.installment_no,t.debt_payment_no) as installment_no,
        coalesce(p.installments,d.installments) as installments_total,t.invoice_id,
        i.closing_date as invoice_closing_date,i.due_date as invoice_due_date,i.status as invoice_status,
        t.paid_at,i.paid_at as invoice_paid_at,
        (t.down_payment_plan_id is not null or t.down_payment_debt_id is not null) as is_entry,
        t.pix_fee_for_transaction_id is not null as is_fee,t.payment_method,false as estimated,t.expense_pattern,t.expense_pattern_source,t.expense_necessity,t.expense_necessity_source
      from public.transactions t
      left join public.installment_plans p on p.id=t.installment_plan_id
      left join public.debts d on d.id=t.debt_id
      left join public.card_invoices i on i.id=t.invoice_id
      where t.id=v_transaction_id or t.pix_fee_for_transaction_id=v_transaction_id
        or t.installment_plan_id=v_plan_id or t.down_payment_plan_id=v_plan_id
        or t.debt_id=v_debt_id or t.down_payment_debt_id=v_debt_id or t.recurring_id=v_recurring_id
      union all
      select 'recurring',null::uuid,e.ref_id,e.due_date,
        case when a.type='credit_card' then win.due_date else e.due_date end,
        e.account_id,null::uuid,e.kind,e.amount_cents,e.status,e.description,
        e.installment_no,e.installments_total,win.invoice_id,
        case when a.type='credit_card' then win.closing_date end,
        case when a.type='credit_card' then win.due_date end,win.invoice_status,null::date,win.invoice_paid_at,
        false,false,r.payment_method,true,e.expense_pattern,e.expense_pattern_source,e.expense_necessity,e.expense_necessity_source
      from generate_series(0,p_days,62) chunk
      cross join lateral public.ledger_expected_lines_classified(current_date+chunk,
        least(current_date+chunk+61,current_date+p_days),v_recurring_id) e
      join public.recurring_transactions r on r.id=e.ref_id
      left join public.accounts a on a.id=e.account_id
      left join lateral private.invoice_target_for(e.account_id,e.due_date) win on a.type='credit_card'
      where v_recurring_id is not null and e.origin='recurring' and e.ref_id=v_recurring_id
      union all
      select 'debt_schedule',null::uuid,v_debt_id,s.due_date,s.due_date,d.account_id,null::uuid,
        'expense',s.payment_cents,'pending',coalesce(d.payment_description,'Parcela '||d.name),
        s.installment_no,d.installments,null::uuid,null::date,null::date,null::text,null::date,null::date,
        false,false,d.payment_method,true,c.data->>'expense_pattern',c.data->>'expense_pattern_source',c.data->>'expense_necessity',c.data->>'expense_necessity_source'
      from public.debt_schedule(v_debt_id) s join public.debts d on d.id=v_debt_id
      cross join lateral (select private.debt_expense_classification_at(d.id,s.installment_no) as data) c
      where v_debt_id is not null
      union all
      select e.origin,null::uuid,e.ref_id,e.due_date,e.due_date,e.account_id,null::uuid,e.kind,e.amount_cents,
        'declared',e.description,e.installment_no,e.installments_total,
        null::uuid,null::date,null::date,null::text,null::date,null::date,false,false,d.payment_method,true,e.expense_pattern,e.expense_pattern_source,e.expense_necessity,e.expense_necessity_source
      from generate_series(0,history_to-history_from,62) chunk
      cross join lateral public.ledger_expected_lines_classified(history_from+chunk,
        least(history_from+chunk+61,history_to)) e
      join public.debts d on d.id=e.ref_id
      where v_debt_id is not null and e.origin='debt_estimate' and e.ref_id=v_debt_id
    ), ordered as (
      select c.*,row_number() over(order by c.due_at,c.occurred_at,c.is_entry desc,
        c.is_fee,c.installment_no,c.origin,c.id) as pos from candidates c
    )
    select coalesce(jsonb_agg(to_jsonb(o)-'pos' order by o.pos) filter(where o.pos<=366),'[]'::jsonb),count(*)
      into schedule_rows,schedule_count from ordered o;
    response := jsonb_build_object('before',snapshot_before,'after',snapshot_after,
      'write',jsonb_build_object('operation',p_operation,'result',result),'schedule',schedule_rows,
      'schedule_total',schedule_count,'schedule_truncated',schedule_count>366,
      'schedule_scope',case when v_recurring_id is not null then 'horizon' else 'contract' end,
      'horizon_days',p_days,'as_of',current_date,'horizon_end',current_date+p_days);
    raise exception using errcode='PFP04',message='finance write preview rollback';
  exception when sqlstate 'PFP04' then
    -- Never turn a real writer/constraint failure into a partial numeric preview.
    if sqlerrm<>'finance write preview rollback' then raise; end if;
  end;
  return response;
end;
$function$;
