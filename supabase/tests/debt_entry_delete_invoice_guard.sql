-- A debt entry is an invoice purchase, not a debt installment. Complete deletion
-- and conversion All must refuse after invoice payment/rollover, atomically.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e4a1';
  w uuid := '00000000-0000-0000-0000-00000000e4b1';
  other_u uuid := '00000000-0000-0000-0000-00000000e4a2';
  other_w uuid := '00000000-0000-0000-0000-00000000e4b2';
begin
  insert into auth.users(id,email) values(u,'debt-entry-delete@example.invalid'),
    (other_u,'debt-entry-delete-foreign@example.invalid');
  insert into public.profiles(id) values(u),(other_u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values
    (w,u,'Debt entry delete rollback',now()-interval '2 days'),
    (other_w,other_u,'Foreign debt entry delete rollback',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(other_w,other_u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type)
    values('00000000-0000-0000-0000-00000000e4c1',w,u,'Cash QA','checking');
  insert into public.debts(id,workspace_id,user_id,name,principal_cents,remaining_cents)
    values('00000000-0000-0000-0000-00000000e4d2',other_w,other_u,'Foreign QA',100000,100000);
  raise notice 'Transaction DELETE triggers currently installed: %',
    (select string_agg(tgname,', ' order by tgname) from pg_trigger
      where tgrelid='public.transactions'::regclass and not tgisinternal and (tgtype::int & 8)<>0);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000e4a1',true);
do $$
declare
  u uuid := auth.uid();
  w uuid := '00000000-0000-0000-0000-00000000e4b1';
  a uuid := '00000000-0000-0000-0000-00000000e4c1';
  c uuid;
  d uuid;
  e uuid;
  inv uuid;
  state text;
  path text;
  protected boolean;
  refused boolean;
  missing_guards int := 0;
  before_debt jsonb;
  before_transactions jsonb;
  before_invoices jsonb;
  before_series jsonb;
  result jsonb;
begin
  foreach state in array array['paid','rolled','partial','open','closed'] loop
    foreach path in array array['delete_debt','converter_all'] loop
      c := gen_random_uuid(); d := gen_random_uuid();
      insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents,payment_account_id)
        values(c,w,u,'Invoice guard QA '||c,'credit_card',5,12,500000,a);
      insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,
        principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,
        installment_cents,account_id,due_day,first_due_date)
        values(d,w,u,'Entry invoice guard '||d,'financing','fixed_installments',40000,40000,0,4,0,10000,a,4,current_date+10);
      e := private.insert_purchase_down_payment('financiamento',d,
        jsonb_build_object('amount_cents',20000,'account_id',c,'occurred_at',current_date-40));
      perform public.pay_debt_installment(d,10000,a,current_date-3);
      perform public.pay_debt_installment(d,10000,a,current_date-2);
      select invoice_id into strict inv from public.transactions where id=e;
      if state='paid' then
        perform public.pay_invoice(inv,a,current_date,20000);
        assert (select status from public.card_invoices where id=inv)='paid';
      elsif state='partial' then
        perform public.pay_invoice(inv,a,current_date,5000);
        assert (select paid_cents from public.card_invoices where id=inv)=5000;
      elsif state='rolled' then
        perform public.roll_invoice(inv,0,0);
        assert (select status from public.card_invoices where id=inv)='rolled';
        assert (select rolled_into_invoice_id from public.card_invoices where id=inv) is not null;
      elsif state='closed' then
        update public.card_invoices set status='closed' where id=inv;
      end if;
      protected := state in ('paid','rolled','partial');
      select to_jsonb(t) into before_debt from public.debts t where id=d;
      select jsonb_agg(to_jsonb(t) order by t.id) into before_transactions from public.transactions t where workspace_id=w;
      select jsonb_agg(to_jsonb(t) order by t.id) into before_invoices from public.card_invoices t where workspace_id=w;
      select jsonb_agg(to_jsonb(t) order by t.id) into before_series from public.recurring_transactions t where workspace_id=w;
      refused := false;
      begin
        if path='delete_debt' then
          assert public.delete_debt(d)=2,'return value remains the number of recorded debt payments removed';
        else
          result := public.converter_registro(jsonb_build_object('tipo','divida','id',d),'todas',
            jsonb_build_object('tipo','recorrente','dados',jsonb_build_object(
              'kind','expense','description','Guard destination '||d,'amount_cents',30000,
              'account_id',a,'rrule','FREQ=MONTHLY;BYMONTHDAY=4',
              'next_run_at',(current_date+30)::text||'T12:00:00-03:00')));
          assert jsonb_array_length(result->'ids')>0;
        end if;
        if protected then
          raise notice 'RED missing guard: state %, path %, entry vanished %, invoice transfer/rollover retained',
            state,path,not exists(select 1 from public.transactions where id=e);
          -- Undo successful but incorrect deletion before checking the next case.
          raise exception using errcode='ZX004',message='undo missing guard reproduction';
        end if;
      exception
        when raise_exception then
          assert protected,'open/closed unpaid invoice must allow explicit deletion';
          assert sqlerrm='Há lançamento numa fatura paga, adiada ou paga em parte. Desfaça o pagamento da fatura antes.',sqlerrm;
          refused := true;
        when sqlstate 'ZX004' then null;
      end;
      if protected then
        assert (select to_jsonb(t) from public.debts t where id=d)=before_debt;
        assert (select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t where workspace_id=w)=before_transactions;
        assert (select jsonb_agg(to_jsonb(t) order by t.id) from public.card_invoices t where workspace_id=w)=before_invoices;
        assert (select jsonb_agg(to_jsonb(t) order by t.id) from public.recurring_transactions t where workspace_id=w)
          is not distinct from before_series;
        if not refused then
          -- PL/pgSQL variables survive subtransaction rollback; count each refusal missing once.
          missing_guards := missing_guards+1;
        end if;
      else
        assert not exists(select 1 from public.debts where id=d);
        assert not exists(select 1 from public.transactions where debt_id=d or down_payment_debt_id=d);
        assert (select coalesce(sum(amount_cents),0) from public.transactions where invoice_id=inv)=0;
        assert (select paid_cents from public.card_invoices where id=inv)=0;
        assert public.delete_debt(d)=0,'delete is idempotent after deletion or conversion';
      end if;
    end loop;
  end loop;
  assert public.delete_debt('00000000-0000-0000-0000-00000000e4d2')=0,'RLS hides foreign debt';
  assert missing_guards=0,format('%s protected invoice deletions were incorrectly accepted',missing_guards);
  raise notice 'DE1: paid/rolled/partial x delete/conversion refuse atomically; open/closed unpaid allow; payment history return/RLS/idempotence preserved';
end $$;
reset role;
do $$ begin
  assert exists(select 1 from public.debts where id='00000000-0000-0000-0000-00000000e4d2');
end $$;
rollback;
