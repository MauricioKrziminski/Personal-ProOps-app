-- Regression for native creation -> later edit: now() is stable inside one test
-- transaction, so seed updated_at explicitly to model an entry saved earlier.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e3a1';
  w uuid := '00000000-0000-0000-0000-00000000e3b1';
  a uuid := gen_random_uuid();
  card uuid := gen_random_uuid();
  entry_account uuid;
  card_entry boolean;
  result jsonb;
  p uuid;
  e uuid;
  survivor uuid;
  old_entry public.transactions;
  future_days int;
  earlier_save boolean;
  cases int := 0;
begin
  insert into auth.users(id,email) values(u,'down-payment-audit-timestamp@example.invalid');
  insert into public.profiles(id) values(u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values(w,u,'Entry audit timestamp',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type) values(a,w,u,'Entry QA','checking');
  insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents,payment_account_id)
    values(card,w,u,'Card entry QA','credit_card',5,12,500000,a);
  perform set_config('request.jwt.claim.sub',u::text,true);
  foreach earlier_save in array array[false,true] loop
    foreach future_days in array array[0,10,-10] loop
      foreach card_entry in array array[false,true] loop
      entry_account := case when card_entry then card else a end;
      result := public.create_purchase('parcelada',jsonb_build_object('p_account_id',a,
        'p_total_cents',100000,'p_installments',5,'p_paid_installments',0,
        'p_occurred_at',current_date+future_days,'p_description','Audit timestamp '||cases),null,gen_random_uuid());
      p := (result->'ids'->>0)::uuid;
      e := gen_random_uuid();
      insert into public.transactions(id,workspace_id,user_id,kind,amount_cents,
        account_id,occurred_at,status,source,description,down_payment_plan_id,updated_at)
        values(e,w,u,'expense',20000,entry_account,current_date,'cleared','app','Entrada histórica',p,
          case when earlier_save then now()-interval '1 day' else now() end);
      select * into strict old_entry from public.transactions where id=e;
      select id into strict survivor from public.transactions where installment_plan_id=p and installment_no=1;
      raise notice 'DA case: earlier-save %, first-date offset %, card %',earlier_save,future_days,card_entry;
      perform public.update_installment_plan(p,100000,1,current_date+future_days,
        'Desfeita','casa','Loja',a,0);
      assert not exists(select 1 from public.installment_plans where id=p);
      assert not exists(select 1 from public.transactions where installment_plan_id=p);
      assert exists(select 1 from public.transactions where id=survivor and installment_plan_id is null
        and amount_cents=100000 and occurred_at=current_date+future_days);
      assert exists(select 1 from public.transactions t where id=e and down_payment_plan_id is null
        and edit_revision=old_entry.edit_revision+1 and updated_at=now()
        and (to_jsonb(t)-'down_payment_plan_id'-'edit_revision'-'updated_at')=
          (to_jsonb(old_entry)-'down_payment_plan_id'-'edit_revision'-'updated_at')),
        'detach preserves the financial row and changes only link/revision/audit timestamp';
      assert (select count(*) from public.transactions where id=e)=1;
      cases := cases+1;
      end loop;
    end loop;
  end loop;
  raise notice 'DA1: % cases, past/today/future x same transaction/earlier saved entry x checking/card',cases;
end $$;

-- Direct UPDATE cannot detach even an empty plan. A nested DELETE cannot use the
-- audit exception to change financial fields along with the link.
create function pg_temp.tamper_entry_before_delete() returns trigger language plpgsql as $$
begin
  update public.transactions set down_payment_plan_id=null,
    amount_cents=amount_cents+1 where down_payment_plan_id=old.id;
  return old;
end $$;
create trigger aa_test_tamper_entry_before_delete before delete on public.installment_plans
  for each row execute function pg_temp.tamper_entry_before_delete();
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e3a1';
  w uuid := '00000000-0000-0000-0000-00000000e3b1';
  a uuid;
  p uuid;
  e uuid;
  result jsonb;
  old_entry jsonb;
  debt_rows int;
  plan_rows int;
begin
  select id into a from public.accounts where workspace_id=w and type='checking';
  result := public.create_purchase('parcelada',jsonb_build_object('p_account_id',a,
    'p_total_cents',100000,'p_installments',5,'p_paid_installments',0,
    'p_occurred_at',current_date+10,'p_description','Security audit'),null,gen_random_uuid());
  p := (result->'ids'->>0)::uuid; e := gen_random_uuid();
  insert into public.transactions(id,workspace_id,user_id,kind,amount_cents,account_id,
    occurred_at,status,source,description,down_payment_plan_id,updated_at)
    values(e,w,u,'expense',20000,a,current_date,'cleared','app','Entrada protegida',p,now()-interval '1 day');
  delete from public.transactions where installment_plan_id=p;
  select to_jsonb(t) into old_entry from public.transactions t where id=e;
  begin
    update public.transactions set down_payment_plan_id=null where id=e;
    assert false,'direct UPDATE must not detach';
  exception when raise_exception then
    assert sqlerrm='O vínculo da entrada não pode ser alterado: apague e registre uma nova entrada';
  end;
  begin
    update public.transactions set down_payment_plan_id=null,amount_cents=amount_cents+1,
      updated_at=now() where id=e;
    assert false,'direct detach with forged audit timestamp and amount must refuse';
  exception when raise_exception then
    assert sqlerrm='O vínculo da entrada não pode ser alterado: apague e registre uma nova entrada';
  end;
  begin
    delete from public.installment_plans where id=p;
    assert false,'nested tampering must not detach';
  exception when raise_exception then
    assert sqlerrm='O vínculo da entrada não pode ser alterado: apague e registre uma nova entrada';
  end;
  assert (select to_jsonb(t) from public.transactions t where id=e)=old_entry;
  assert exists(select 1 from public.installment_plans where id=p);
  -- Restore five pending rows so conversion reaches DELETE of a plan emptied by
  -- that operation, rather than the separate "empty purchase" domain refusal.
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,account_id,
    occurred_at,status,source,description,installment_plan_id,installment_no)
    select w,u,'expense',20000,a,private.add_months(current_date+10,n-1),
      'pending','app','Pending security fixture',p,n from generate_series(1,5) n;
  select count(*) into debt_rows from public.debts;
  select count(*) into plan_rows from public.installment_plans;
  begin
    perform public.converter_registro(jsonb_build_object('tipo','plano','id',p),'desta_em_diante',
      jsonb_build_object('tipo','financiamento','dados',jsonb_build_object(
        'name','Must roll back destination','kind','financing','calculation_mode','fixed_installments',
        'principal_cents',100000,'remaining_cents',100000,'installment_cents',20000,
        'installments',5,'installments_paid',0,'interest_rate_monthly',0,'account_id',a,
        'due_day',4,'first_due_date',current_date+10)));
    assert false,'tampered conversion must roll back destination and origin';
  exception when raise_exception then
    assert sqlerrm='O vínculo da entrada não pode ser alterado: apague e registre uma nova entrada',sqlerrm;
  end;
  assert (select count(*) from public.debts)=debt_rows;
  assert (select count(*) from public.installment_plans)=plan_rows;
  assert (select to_jsonb(t) from public.transactions t where id=e)=old_entry;
  -- Explicit complete deletion still deletes the entry before deleting the empty plan.
  assert public.delete_installment_purchase(p)=1;
  assert not exists(select 1 from public.transactions where id=e);
  assert public.delete_installment_purchase(p)=0;
  raise notice 'DA2: direct detach and nested economic tampering refused atomically; complete delete remains explicit';
end $$;
drop trigger aa_test_tamper_entry_before_delete on public.installment_plans;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e3a1';
  w uuid := '00000000-0000-0000-0000-00000000e3b1';
  a uuid;
  p uuid;
  result jsonb;
  old_rows jsonb;
begin
  select id into a from public.accounts where workspace_id=w and type='checking';
  result := public.create_purchase('parcelada',jsonb_build_object('p_account_id',a,
    'p_total_cents',100000,'p_installments',5,'p_paid_installments',1,
    'p_occurred_at',current_date-40,'p_description','Already paid cannot collapse'),
    jsonb_build_object('amount_cents',20000,'account_id',a,'occurred_at',current_date),gen_random_uuid());
  p := (result->'ids'->>0)::uuid;
  select jsonb_agg(to_jsonb(t) order by t.id) into old_rows from public.transactions t
    where installment_plan_id=p or down_payment_plan_id=p;
  begin
    perform public.update_installment_plan(p,100000,1,current_date-40,'Paid purchase','casa','Loja',a,1);
    assert false,'actual cleared installment retains the paid-history refusal';
  exception when raise_exception then
    assert sqlerrm='Esta compra já tem parcela paga: à vista seria um pagamento só, e uma parte já foi paga.';
  end;
  assert exists(select 1 from public.installment_plans where id=p);
  assert (select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t
    where installment_plan_id=p or down_payment_plan_id=p)=old_rows;
  raise notice 'DA3: overdue pending can collapse; cleared payment still refuses with atomic rollback';
end $$;
rollback;
