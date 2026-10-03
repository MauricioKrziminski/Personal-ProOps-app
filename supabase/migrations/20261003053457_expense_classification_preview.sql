-- F06: collect classification while the canonical simulated write still exists.
-- A wrapper after the F04 rollback cannot read the hypothetical IDs/snapshots.
-- Transform the live definition narrowly, preserving its validation, reads,
-- ordering/cap, deferred constraints, RLS and rollback boundary without a fork.
do $$
declare
  target regprocedure:='public.preview_finance_write(text,jsonb,integer)'::regprocedure;
  definition text:=pg_get_functiondef(target);
  before_attributes jsonb;
  replacement jsonb;
  old_text text;
  new_text text;
begin
  select to_jsonb(p)-array['prosrc','xmin','cmin','xmax','cmax','ctid'] into before_attributes
    from pg_proc p where p.oid=target;
  if (select prosecdef from pg_proc where oid=target) then
    raise exception 'Classification preview requires the existing SECURITY INVOKER boundary';
  end if;
  -- Every anchor must occur exactly once; schema drift must abort, never apply
  -- a partial extension or broaden the original allowlists by accident.
  for replacement in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_array(
      '  if exists(select 1 from jsonb_object_keys(input) k where k<>all(input_allowed)) then',
      E'  input_allowed := input_allowed || array[''expense_pattern'',''expense_pattern_source'',''expense_necessity'',''expense_necessity_source''];\n  if exists(select 1 from jsonb_object_keys(input) k where k<>all(input_allowed)) then'),
    jsonb_build_array(
      't.pix_fee_for_transaction_id is not null as is_fee,t.payment_method,false as estimated',
      't.pix_fee_for_transaction_id is not null as is_fee,t.payment_method,false as estimated,t.expense_pattern,t.expense_pattern_source,t.expense_necessity,t.expense_necessity_source'),
    jsonb_build_array(
      'false,false,r.payment_method,true',
      'false,false,r.payment_method,true,e.expense_pattern,e.expense_pattern_source,e.expense_necessity,e.expense_necessity_source'),
    jsonb_build_array(
      'public.ledger_expected_lines(current_date+chunk,',
      'public.ledger_expected_lines_classified(current_date+chunk,'),
    jsonb_build_array(
      E'false,false,d.payment_method,true\n      from public.debt_schedule(v_debt_id) s join public.debts d on d.id=v_debt_id',
      E'false,false,d.payment_method,true,c.data->>''expense_pattern'',c.data->>''expense_pattern_source'',c.data->>''expense_necessity'',c.data->>''expense_necessity_source''\n      from public.debt_schedule(v_debt_id) s join public.debts d on d.id=v_debt_id\n      cross join lateral (select private.debt_expense_classification_at(d.id,s.installment_no) as data) c'),
    jsonb_build_array(
      E'null::uuid,null::date,null::date,null::text,null::date,null::date,false,false,d.payment_method,true\n      from generate_series(0,history_to-history_from,62) chunk',
      E'null::uuid,null::date,null::date,null::text,null::date,null::date,false,false,d.payment_method,true,e.expense_pattern,e.expense_pattern_source,e.expense_necessity,e.expense_necessity_source\n      from generate_series(0,history_to-history_from,62) chunk'),
    jsonb_build_array(
      'public.ledger_expected_lines(history_from+chunk,',
      'public.ledger_expected_lines_classified(history_from+chunk,')
  )) loop
    old_text:=replacement->>0;
    new_text:=replacement->>1;
    if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
      raise exception 'Classification preview definition drift: expected one anchor %',old_text;
    end if;
    definition:=replace(definition,old_text,new_text);
  end loop;
  execute definition;
  -- CREATE OR REPLACE retains the same identity, owner and grants; prove all
  -- pg_proc attributes (including signature/security/search_path/timeouts) did.
  if (select to_jsonb(p)-array['prosrc','xmin','cmin','xmax','cmax','ctid'] from pg_proc p where p.oid=target)
    is distinct from before_attributes then
    raise exception 'Classification preview changed function attributes or privileges';
  end if;
end $$;
