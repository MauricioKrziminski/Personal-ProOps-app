-- A revision conflict is a business refusal, not a transient serialization failure.
-- PostgREST 14 retries custom 40001 indefinitely; PT409 returns HTTP 409 immediately.
-- Keep the sealed receipt check, advisory lock, all validation and write effects identical.
create or replace function private.save_emergency_reserve(p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='America/Sao_Paulo' as $$
declare
 ws uuid;uid uuid:=auth.uid();cached jsonb;snapshot jsonb;r public.emergency_reserves%rowtype;
 sealed private.emergency_reserve_write_receipts%rowtype;intent jsonb;
 x jsonb;s jsonb;k text;sourceid uuid;monthdate date;amount numeric;total numeric:=0;rev bigint;months_seen date[]:='{}';
 ids_seen text[]:='{}';maxsafe constant numeric:=9007199254740991;monthly numeric;observed_total numeric;
 keys constant text[]:=array['workspace_id','expected_revision','base_mode','manual_monthly_cents','target_months','unassigned_goals_ack_cents','allocations','reviewed_months'];
begin
 if uid is null then raise exception using errcode='42501',message='Sessão obrigatória';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input?&keys)
  or exists(select 1 from jsonb_object_keys(p_input) j where not(j=any(keys)))
 then raise exception using errcode='22023',message='Configuração de reserva inválida';end if;
 if jsonb_typeof(p_input->'workspace_id') is distinct from 'string' then raise exception using errcode='22023',message='Workspace inválido';end if;
 begin ws:=(p_input->>'workspace_id')::uuid;
 exception when invalid_text_representation then raise exception using errcode='22023',message='Workspace inválido';end;
 if ws is null or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=uid)
 then raise exception using errcode='42501',message='Workspace não autorizado';end if;
 if p_request_id is null then raise exception using errcode='22023',message='Identificador de requisição obrigatório';end if;
 -- Serialize allocation/config writers by workspace. KEY SHARE keeps the workspace
 -- alive without blocking legacy goal_deposit's FK insert (that command locks goals first).
 -- Sources/goals use sorted SHARE locks: their current values stay stable through this
 -- command, while actual later spending/depreciation is free to reduce backing.
 -- Existing consumption rows being reviewed stay stable; a concurrent new consumption
 -- insert is permitted and invalidates the saved fingerprint on the next read.
 -- Do not lock contribution rows: legacy edit_goal_contribution acquires them before
 -- goals, and reversing that order here would introduce a deadlock.
 perform pg_advisory_xact_lock(hashtextextended('financial-allocations:'||ws::text,0));
 perform 1 from public.workspaces where id=ws for key share;
 perform 1 from public.workspace_members where workspace_id=ws and user_id=uid for share;
 if not found then raise exception using errcode='42501',message='Workspace não autorizado';end if;
 intent:=jsonb_build_object('operation','save_emergency_reserve','input',p_input);
 select * into sealed from private.emergency_reserve_write_receipts where user_id=uid and request_id=p_request_id;
 if sealed.request_id is not null then
  if sealed.workspace_id<>ws or sealed.payload is distinct from intent
  then raise exception using errcode='22023',message='Identificador de requisição reutilizado com dados diferentes';end if;
  return sealed.result;
 end if;
 cached:=private.reserve_payment_request(p_request_id,intent);
 if cached is not null then raise exception using errcode='42501',message='Recibo não confirmado pelo comando da reserva';end if;
 select * into r from public.emergency_reserves where workspace_id=ws for update;
 if jsonb_typeof(p_input->'expected_revision') not in('null','number') then raise exception using errcode='22023',message='Revisão inválida';end if;
 if p_input->'expected_revision'<>'null'::jsonb and ((p_input->>'expected_revision')!~'^[0-9]+$' or (p_input->>'expected_revision')::numeric not between 1 and maxsafe)
 then raise exception using errcode='22023',message='Revisão inválida';end if;
 if (r.workspace_id is null and p_input->'expected_revision'<>'null'::jsonb)
  or (r.workspace_id is not null and (p_input->'expected_revision'='null'::jsonb or (p_input->>'expected_revision')::numeric<>r.edit_revision))
 then raise exception using errcode='PT409',message='Reserva alterada; confira novamente';end if;
 if jsonb_typeof(p_input->'base_mode') is distinct from 'string' or p_input->>'base_mode' not in('manual','observed')
 then raise exception using errcode='22023',message='Base inválida';end if;
 foreach k in array array['target_months','unassigned_goals_ack_cents'] loop
  if jsonb_typeof(p_input->k) is distinct from 'number' or (p_input->>k)!~'^[0-9]+$' or (p_input->>k)::numeric>maxsafe
  then raise exception using errcode='22023',message='Valor inteiro inválido';end if;
 end loop;
 if (p_input->>'target_months')::numeric not between 1 and 60 then raise exception using errcode='22023',message='Meses inválidos';end if;
 if p_input->>'base_mode'='manual' then
  if jsonb_typeof(p_input->'manual_monthly_cents') is distinct from 'number' or (p_input->>'manual_monthly_cents')!~'^[0-9]+$'
    or (p_input->>'manual_monthly_cents')::numeric not between 1 and maxsafe
  then raise exception using errcode='22023',message='Base mensal inválida';end if;
  monthly:=(p_input->>'manual_monthly_cents')::numeric;
  if monthly*(p_input->>'target_months')::numeric>maxsafe then raise exception using errcode='22023',message='Alvo ultrapassa centavos seguros';end if;
 elsif p_input->'manual_monthly_cents'<>'null'::jsonb then raise exception using errcode='22023',message='Base observada exige valor manual nulo';end if;
 if jsonb_typeof(p_input->'allocations') is distinct from 'array' or jsonb_typeof(p_input->'reviewed_months') is distinct from 'array'
 then raise exception using errcode='22023',message='Listas inválidas';end if;
 perform 1 from public.accounts where workspace_id=ws order by id for share;
 perform 1 from public.assets where workspace_id=ws order by id for share;
 perform 1 from public.goals where workspace_id=ws order by id for share;
 if jsonb_array_length(p_input->'reviewed_months')>0 then
  perform 1 from public.transactions where workspace_id=ws and kind='expense'
   and occurred_at>=(date_trunc('month',current_date)-interval '3 months')::date
   and occurred_at<date_trunc('month',current_date)::date order by id for share;
 end if;
 perform 1 from public.financial_allocations where workspace_id=ws order by id for update;
 perform 1 from public.reserve_month_reviews where workspace_id=ws order by month for update;
 snapshot:=public.emergency_reserve_state(ws,current_date);
 if (p_input->>'unassigned_goals_ack_cents')::numeric<>(snapshot->>'unassigned_goals_cents')::numeric
 then raise exception using errcode='22023',message='Metas sem origem mudaram; confira novamente';end if;
 for x in select value from jsonb_array_elements(p_input->'allocations') loop
  if jsonb_typeof(x) is distinct from 'object' or not(x?&array['kind','id','amount_cents','liquidity_confirmed'])
   or exists(select 1 from jsonb_object_keys(x) j where not(j=any(array['kind','id','amount_cents','liquidity_confirmed'])))
   or jsonb_typeof(x->'kind') is distinct from 'string' or x->>'kind' not in('account','asset')
   or jsonb_typeof(x->'id') is distinct from 'string'
   or jsonb_typeof(x->'amount_cents') is distinct from 'number' or (x->>'amount_cents')!~'^[0-9]+$'
   or (x->>'amount_cents')::numeric not between 1 and maxsafe or x->'liquidity_confirmed' is distinct from 'true'::jsonb
  then raise exception using errcode='22023',message='Alocação inválida';end if;
  begin sourceid:=(x->>'id')::uuid;
  exception when invalid_text_representation then raise exception using errcode='22023',message='Fonte inválida';end;
  k:=(x->>'kind')||':'||sourceid::text;
  if k=any(ids_seen) then raise exception using errcode='22023',message='Fonte duplicada';end if;ids_seen:=array_append(ids_seen,k);
  select value into s from jsonb_array_elements(snapshot->'sources') where value->>'kind'=x->>'kind' and value->>'id'=sourceid::text;
  amount:=(x->>'amount_cents')::numeric;total:=total+amount;
  if s is null or s->'eligible'<>'true'::jsonb or amount+(s->>'other_allocated_cents')::numeric>(s->>'available_cents')::numeric or total>maxsafe
  then raise exception using errcode='22023',message='Fonte sem lastro disponível';end if;
 end loop;
 for x in select value from jsonb_array_elements(p_input->'reviewed_months') loop
  if jsonb_typeof(x) is distinct from 'object' or not(x?&array['month','fingerprint'])
   or exists(select 1 from jsonb_object_keys(x) j where not(j=any(array['month','fingerprint'])))
   or jsonb_typeof(x->'month') is distinct from 'string' or (x->>'month')!~'^\d{4}-\d{2}-01$'
   or jsonb_typeof(x->'fingerprint') is distinct from 'string' or (x->>'fingerprint')!~'^[a-f0-9]{32}$'
  then raise exception using errcode='22023',message='Revisão mensal inválida';end if;
  begin monthdate:=(x->>'month')::date;
  exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='Mês inválido';end;
  if monthdate=any(months_seen) then raise exception using errcode='22023',message='Mês duplicado';end if;months_seen:=array_append(months_seen,monthdate);
  select value into s from jsonb_array_elements(snapshot->'months') where value->>'month'=monthdate::text;
  if s is null or s->>'fingerprint'<>x->>'fingerprint' or (s->>'unclassified_count')::numeric<>0
  then raise exception using errcode='22023',message='Consumo mudou ou está sem classificação';end if;
 end loop;
 if cardinality(months_seen)=3 then
  select sum((value->>'essential_cents')::numeric) into observed_total from jsonb_array_elements(snapshot->'months');
  if ceil(observed_total/3)*(p_input->>'target_months')::numeric>maxsafe then raise exception using errcode='22023',message='Alvo ultrapassa centavos seguros';end if;
 end if;
 if coalesce(r.edit_revision,0)>=maxsafe then raise exception using errcode='22023',message='Limite de revisão atingido';end if;
 rev:=coalesce(r.edit_revision,0)+1;
 insert into public.emergency_reserves(workspace_id,user_id,base_mode,manual_monthly_cents,target_months,edit_revision)
 values(ws,uid,p_input->>'base_mode',monthly::bigint,(p_input->>'target_months')::integer,rev)
 on conflict(workspace_id) do update set user_id=excluded.user_id,base_mode=excluded.base_mode,
  manual_monthly_cents=excluded.manual_monthly_cents,target_months=excluded.target_months,edit_revision=excluded.edit_revision,updated_at=now();
 delete from public.financial_allocations where workspace_id=ws and purpose='reserve';
 insert into public.financial_allocations(workspace_id,user_id,purpose,account_id,asset_id,amount_cents,liquidity_confirmed)
 select ws,uid,'reserve',case when elem.value->>'kind'='account' then (elem.value->>'id')::uuid end,
  case when elem.value->>'kind'='asset' then (elem.value->>'id')::uuid end,(elem.value->>'amount_cents')::bigint,true
 from jsonb_array_elements(p_input->'allocations') elem;
 delete from public.reserve_month_reviews where workspace_id=ws;
 insert into public.reserve_month_reviews(workspace_id,month,fingerprint,user_id)
 select ws,(elem.value->>'month')::date,elem.value->>'fingerprint',uid from jsonb_array_elements(p_input->'reviewed_months') elem;
 cached:=jsonb_build_object('workspace_id',ws,'edit_revision',rev);
 insert into private.emergency_reserve_write_receipts(user_id,request_id,workspace_id,payload,result)
 values(uid,p_request_id,ws,intent,cached);
 perform private.finish_payment_request(p_request_id,cached);return cached;
end $$;
revoke execute on function private.save_emergency_reserve(jsonb,uuid) from public,anon;
grant execute on function private.save_emergency_reserve(jsonb,uuid) to authenticated;
