-- Paid history is explicit. Dates never prove payment. Existing rows are untouched.
create or replace function public.create_installment_plan_with_history(
  p_account_id uuid,
  p_total_cents bigint,
  p_installments int,
  p_occurred_at date,
  p_paid_installments int,
  p_description text default null,
  p_category text default null,
  p_merchant text default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  acc record;
  plan_id uuid;
  base_cents bigint;
  parcela_cents bigint;
  data_parcela date;
  i int;
begin
  if p_installments is null or p_installments < 2 or p_installments > 72 then
    raise exception 'parcelas fora do intervalo 2..72: %', p_installments;
  end if;
  if p_total_cents is null or p_total_cents < p_installments then
    raise exception 'total precisa permitir pelo menos um centavo por parcela';
  end if;
  if p_occurred_at is null then raise exception 'Informe a data da primeira parcela'; end if;
  if p_paid_installments is null or p_paid_installments < 0 or p_paid_installments > p_installments then
    raise exception 'Informe quantas parcelas iniciais já foram pagas, entre 0 e %', p_installments;
  end if;

  select a.id, a.workspace_id, a.user_id into acc
  from public.accounts a where a.id = p_account_id and not a.archived;
  if acc.id is null then
    raise exception 'conta % não encontrada', p_account_id;
  end if;

  insert into public.installment_plans
    (workspace_id, user_id, account_id, description, merchant, category,
     total_cents, installments, first_occurred_at)
  values (acc.workspace_id, coalesce((select auth.uid()), acc.user_id), p_account_id,
          p_description, p_merchant, p_category, p_total_cents, p_installments, p_occurred_at)
  returning id into plan_id;

  base_cents := p_total_cents / p_installments;  -- divisão inteira: nunca float
  for i in 1..p_installments loop
    parcela_cents := case when i = p_installments
      then p_total_cents - base_cents * (p_installments - 1)
      else base_cents end;
    data_parcela := private.add_months(p_occurred_at, i - 1);

    insert into public.transactions
      (workspace_id, user_id, kind, amount_cents, category, description, merchant,
       account_id, occurred_at, source, status, installment_plan_id, installment_no)
    values (acc.workspace_id, coalesce((select auth.uid()), acc.user_id), 'expense',
            parcela_cents, p_category,
            coalesce(p_description, 'Compra parcelada') || ' (' || i || '/' || p_installments || ')',
            p_merchant, p_account_id, data_parcela, 'app',
            case when i <= p_paid_installments then 'cleared' else 'pending' end,
            plan_id, i);
  end loop;

  return plan_id;
end;
$$;


-- Keep the old signature for installed apps. Never infer past payments for them.
create or replace function public.create_installment_plan(
  p_account_id uuid, p_total_cents bigint, p_installments int, p_occurred_at date,
  p_description text default null, p_category text default null, p_merchant text default null
) returns uuid language plpgsql security invoker set search_path = public as $$
begin
  if p_occurred_at < current_date then
    raise exception 'Informe o histórico: quantas parcelas já foram pagas? Atualize o app para cadastrar parcelas anteriores.';
  end if;
  return public.create_installment_plan_with_history(p_account_id,p_total_cents,p_installments,
    p_occurred_at,0,p_description,p_category,p_merchant);
end;
$$;

-- Existing explicit recurring auto-confirmation is preserved. Installments await payment.
create or replace function public._promote_due_transactions()
returns int language sql security definer set search_path = public as $$
  with promoted as (
    update public.transactions t set status='cleared'
    from public.recurring_transactions r
    where t.recurring_id=r.id and r.auto_confirm
      and t.installment_plan_id is null and t.status='pending'
      and t.occurred_at <= current_date
    returning t.id
  ) select count(*)::int from promoted;
$$;
revoke execute on function public._promote_due_transactions() from public, anon, authenticated;
revoke execute on function public.create_installment_plan_with_history(uuid,bigint,int,date,int,text,text,text) from public, anon;
grant execute on function public.create_installment_plan_with_history(uuid,bigint,int,date,int,text,text,text) to authenticated, service_role;
