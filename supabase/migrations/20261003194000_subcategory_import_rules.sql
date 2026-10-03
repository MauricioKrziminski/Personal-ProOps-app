-- F09 import/rules and service scheduler boundary. Static definitions preserve money/idempotency.
alter table public.import_items add column suggested_subcategory_set boolean not null default false;
create function private.import_subcategory_choice() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.suggested_subcategory_id is not null then new.suggested_subcategory_set:=true;
 elsif tg_op='UPDATE' and old.suggested_subcategory_id is not null then new.suggested_subcategory_set:=true;
 end if;
 return new;
end $$;
revoke execute on function private.import_subcategory_choice() from public,anon,authenticated,service_role;
-- Runs after final reference validation (including structural delete and parent edits).
create trigger zzzz_import_subcategory_choice before insert or update on public.import_items
 for each row execute function private.import_subcategory_choice();

-- Preserve _match_rule's published OUT signature. Only the trusted service can query this boundary.
grant execute on function public._match_rule(uuid,text) to service_role;
create function private.match_rule_subcategory(p_workspace uuid,p_text text)
returns table(category text,account_id uuid,rule_id uuid,subcategory_id uuid)
language sql stable security invoker set search_path='' as $$
 select m.category,m.account_id,m.rule_id,r.subcategory_id
 from public._match_rule(p_workspace,p_text) m
 join public.categorization_rules r on r.id=m.rule_id and r.workspace_id=p_workspace;
$$;
revoke execute on function private.match_rule_subcategory(uuid,text) from public,anon,authenticated;
grant execute on function private.match_rule_subcategory(uuid,text) to service_role;

-- Scheduler already has a trusted series ID; null is a genuine version value, not fallback.
create function private.recurring_category_at(p_recurring uuid,p_date date) returns text
language sql stable security invoker set search_path='' as $$
 select case when v.recurring_id is not null then v.category else r.category end
 from public.recurring_transactions r left join lateral (
  select h.recurring_id,h.category from private.recurring_history_versions h
  where h.recurring_id=r.id and h.workspace_id=r.workspace_id and h.valid_from<=p_date
   and (h.valid_through is null or h.valid_through>=p_date)
  order by h.valid_from desc limit 1
 ) v on true where r.id=p_recurring;
$$;
revoke execute on function private.recurring_category_at(uuid,date) from public,anon,authenticated;
grant execute on function private.recurring_category_at(uuid,date) to service_role;

-- One statement can create a purchase and attach proven rule metadata atomically.
create function private.attach_import_rule_purchase(p_plan uuid,p_workspace uuid,p_child uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare parent text;begin
 select category into parent from public.installment_plans where id=p_plan and workspace_id=p_workspace for update;
 if not found then raise exception 'Compra fora do espaço esperado';end if;
 perform private.validate_subcategory_reference(p_workspace,parent,p_child);
 update public.installment_plans set subcategory_id=p_child where id=p_plan;
 update public.transactions set subcategory_id=p_child,subcategory_snapshot_set=true
 where installment_plan_id=p_plan and workspace_id=p_workspace
  and private.subcategory_compatible(workspace_id,category,p_child);
 return p_plan;
end $$;
revoke execute on function private.attach_import_rule_purchase(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.attach_import_rule_purchase(uuid,uuid,uuid) to service_role;

create or replace function public._prepare_import_batch(p_batch_id uuid)
returns table (total integer, categorizados integer, duplicados integer)
language plpgsql security definer set search_path = public
as $function$
declare
  ws_id uuid;
begin
  select b.workspace_id into ws_id from public.import_batches b where b.id = p_batch_id;
  if ws_id is null then
    raise exception 'lote % não encontrado', p_batch_id;
  end if;

  update public.import_items i
  set suggested_category = m.category,
      suggested_subcategory_id = m.subcategory_id,
      suggested_subcategory_set = m.subcategory_id is not null,
      suggested_account_id = coalesce(i.suggested_account_id, m.account_id)
  from (
    select it.id, r.category, r.account_id, r.subcategory_id
    from public.import_items it
    cross join lateral private.match_rule_subcategory(ws_id, it.description) r
    where it.batch_id = p_batch_id and it.suggested_category is null
  ) m
  where i.id = m.id and m.category is not null;

  return query
  select count(*)::int,
         count(*) filter (where i.suggested_category is not null)::int,
         -- continua contando só o casamento EXATO (`20260914160000`): três leitores o leem assim
         count(*) filter (where i.status = 'duplicate')::int
  from public.import_items i
  where i.batch_id = p_batch_id;
end;
$function$;

create or replace function private.importar_parcelado(p_item_id uuid, p_account_id uuid)
returns uuid
language plpgsql security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  it record;
  plano uuid;
  primeira date;
  nome text;
  i int;
  alvo uuid;
  adotado uuid;
  tx_k uuid;
  tx_i uuid;
  soma bigint;
begin
  select * into it from public.import_items where id = p_item_id;
  if it.installments is null or it.installment_no is null then
    raise exception 'item % não é parcela', p_item_id;
  end if;
  if it.status in ('approved', 'discarded') then
    raise exception 'item % já foi decidido', p_item_id;
  end if;

  perform private.validate_subcategory_reference(it.workspace_id,it.suggested_category,it.suggested_subcategory_id);
  -- O extrato diz o valor de UMA parcela; o total é estimativa (a última pode diferir centavos).
  primeira := private.add_months(it.occurred_at, -(it.installment_no - 1));
  nome := coalesce(nullif(it.merchant, ''), nullif(it.description, ''), 'Compra parcelada');

  insert into public.installment_plans
    (workspace_id, user_id, account_id, description, merchant, category, subcategory_id,
     total_cents, installments, first_occurred_at)
  values (it.workspace_id, coalesce((select auth.uid()),
          (select b.user_id from public.import_batches b where b.id = it.batch_id)),
          p_account_id, nome, nome, it.suggested_category, it.suggested_subcategory_id,
          it.amount_cents * it.installments, it.installments, primeira)
  returning id into plano;

  for i in 1..it.installments loop
    adotado := null;
    if i < it.installment_no and it.adopt_ids is not null and array_length(it.adopt_ids, 1) >= i then
      alvo := it.adopt_ids[i];
      -- ADOTA a linha solta que já está no app (id preservado), só se ela ainda é um gasto solto
      -- deste workspace: entre a prévia e o "Importar" ela pode ter sido apagada ou parcelada.
      update public.transactions t set
        installment_plan_id = plano,
        installment_no      = i,
        amount_cents        = it.amount_cents,
        description         = nome || ' (' || i || '/' || it.installments || ')',
        merchant            = nome,
        account_id          = p_account_id,
        category            = coalesce(it.suggested_category, t.category),
        subcategory_id      = case when it.suggested_subcategory_set or it.suggested_subcategory_id is not null then it.suggested_subcategory_id
                                   when private.subcategory_compatible(t.workspace_id,coalesce(it.suggested_category,t.category),t.subcategory_id) then t.subcategory_id end,
        subcategory_snapshot_set = true,
        status              = 'cleared'
      where t.id = alvo and t.workspace_id = it.workspace_id
        and t.installment_plan_id is null and t.kind = 'expense'
        -- as travas de `convert_transaction_to_installments`: linha de outro contrato, saldo
        -- adiado, ou dentro de fatura paga/adiada/paga em parte não é adotada — vira linha nova
        and t.recurring_id is null and t.debt_id is null and t.rollover_of_invoice_id is null
        and not private.parcela_travada('pending', t.invoice_id)
      returning t.id into adotado;
    end if;

    if adotado is null then
      insert into public.transactions
        (workspace_id, user_id, kind, amount_cents, category, description, merchant,
         account_id, occurred_at, source, status, installment_plan_id, installment_no, subcategory_id, subcategory_snapshot_set)
      values (it.workspace_id, coalesce((select auth.uid()),
              (select b.user_id from public.import_batches b where b.id = it.batch_id)),
              'expense', it.amount_cents, it.suggested_category,
              nome || ' (' || i || '/' || it.installments || ')', nome, p_account_id,
              -- a parcela do ARQUIVO fica no dia do arquivo; as outras, de mês em mês
              case when i = it.installment_no then it.occurred_at
                   else private.add_months(primeira, i - 1) end,
              'import',
              -- antes da do arquivo: já pagas. A do arquivo e as futuras: a fatura baixa.
              case when i < it.installment_no then 'cleared' else 'pending' end,
              plano, i, it.suggested_subcategory_id, true)
      returning id into tx_i;
    else
      tx_i := adotado;
    end if;
    if i = it.installment_no then tx_k := tx_i; end if;
  end loop;

  -- "Anterior como paga" só vale se a fatura dela JÁ VENCEU: a parcela 1 de uma "2/12" pode cair
  -- na fatura que fechou e ainda vai vencer — ali ela é devida, não paga.
  update public.transactions t
     set status = 'pending', paid_at = null
    from public.card_invoices ci
   where t.invoice_id = ci.id and t.installment_plan_id = plano
     and t.installment_no < it.installment_no and t.status = 'cleared'
     and ci.status not in ('paid', 'rolled') and ci.due_date >= current_date;

  -- E o espelho: parcela que caiu numa fatura que o app JÁ tem como paga foi paga junto com ela.
  -- `pending` ali sumiria de toda leitura de caixa (elas filtram fatura paga), sem ser baixa.
  update public.transactions t
     set status = 'cleared', paid_at = coalesce(ci.paid_at, ci.due_date)
    from public.card_invoices ci
   where t.invoice_id = ci.id and t.installment_plan_id = plano
     and t.status = 'pending' and ci.status = 'paid';

  select coalesce(sum(t.amount_cents), 0) into soma
  from public.transactions t where t.installment_plan_id = plano;
  if soma <> it.amount_cents * it.installments then
    raise exception 'a soma das parcelas (%) não fecha com o total (%)', soma, it.amount_cents * it.installments;
  end if;

  perform private.quitar_faturas_do_historico(plano);
  return tx_k;
end;
$$;

create or replace function public.finish_import_batch(p_batch_id uuid, p_item_ids uuid[])
returns int
language plpgsql security invoker
set search_path = public
as $$
declare
  lote record;
  conta record;
  item record;
  tx_id uuid;
  criadas int := 0;
begin
  -- `for update`: dois toques em "Importar" (ou a rede que cai e o app que tenta de novo) não
  -- gravam o lote duas vezes — o segundo espera o primeiro e encontra `done`.
  select b.* into lote from public.import_batches b where b.id = p_batch_id for update;
  if lote.id is null then
    raise exception 'lote não encontrado';
  end if;
  if lote.status = 'done' then
    return 0;
  end if;
  if lote.status <> 'review' then
    raise exception 'esse lote não está em revisão';
  end if;
  select a.id, a.type into conta from public.accounts a where a.id = lote.account_id;

  for item in
    select i.* from public.import_items i
    where i.batch_id = p_batch_id and i.id = any(p_item_ids)
      and i.status in ('pending', 'duplicate', 'near_match', 'uncertain')
    order by i.occurred_at, i.created_at
  loop
    perform private.validate_subcategory_reference(item.workspace_id,item.suggested_category,item.suggested_subcategory_id);
    if item.installments is not null and item.kind = 'expense'
       and conta.type = 'credit_card' then
      tx_id := private.importar_parcelado(item.id, conta.id);
    else
      insert into public.transactions
        (workspace_id, user_id, kind, amount_cents, category, description, merchant,
         account_id, occurred_at, source, status, subcategory_id, subcategory_snapshot_set)
      values (item.workspace_id, coalesce((select auth.uid()), lote.user_id),
              item.kind, item.amount_cents, item.suggested_category, item.description,
              nullif(item.merchant, ''),
              coalesce(item.suggested_account_id, lote.account_id),
              item.occurred_at, 'import', 'cleared',item.suggested_subcategory_id,true)
      returning id into tx_id;
    end if;

    update public.import_items set status = 'approved', transaction_id = tx_id where id = item.id;
    criadas := criadas + 1;
  end loop;

  -- O que ficou desmarcado não entra — e não fica pendurado esperando decisão.
  update public.import_items
     set status = 'discarded'
   where batch_id = p_batch_id
     and status in ('pending', 'duplicate', 'near_match', 'uncertain');

  update public.import_batches set status = 'done' where id = p_batch_id;
  return criadas;
end;
$$;

create or replace function public.approve_import_items(p_item_ids uuid[])
returns int
language plpgsql security invoker
set search_path = public
as $$
declare
  item record;
  tx_id uuid;
  criadas int := 0;
begin
  for item in
    select i.*, b.account_id as batch_account_id, b.user_id as batch_user_id
    from public.import_items i
    join public.import_batches b on b.id = i.batch_id
    where i.id = any(p_item_ids) and i.status in ('pending','duplicate')
    order by i.id for update of i
  loop
    perform private.validate_subcategory_reference(item.workspace_id,item.suggested_category,item.suggested_subcategory_id);
    insert into public.transactions
      (workspace_id, user_id, kind, amount_cents, category, description, merchant,
       account_id, occurred_at, source, status, subcategory_id, subcategory_snapshot_set)
    values (item.workspace_id, coalesce((select auth.uid()), item.batch_user_id),
            item.kind, item.amount_cents, item.suggested_category, item.description,
            item.merchant,
            coalesce(item.suggested_account_id, item.batch_account_id),
            item.occurred_at, 'import', 'cleared',item.suggested_subcategory_id,true)
    returning id into tx_id;

    update public.import_items
    set status = 'approved', transaction_id = tx_id
    where id = item.id;
    criadas := criadas + 1;
  end loop;

  return criadas;
end;
$$;
revoke execute on function public.approve_import_items(uuid[]) from public,anon;
grant execute on function public.approve_import_items(uuid[]) to authenticated,service_role;
