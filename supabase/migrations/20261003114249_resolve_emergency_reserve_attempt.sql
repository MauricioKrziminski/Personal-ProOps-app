-- F07: resolve an unknown write without allowing a delayed original to apply later.
-- The save command already reads this sealed receipt before generic receipts or CAS.
create or replace function private.resolve_emergency_reserve_attempt(p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='America/Sao_Paulo' as $$
declare
 ws uuid;uid uuid:=auth.uid();intent jsonb;result jsonb;
 sealed private.emergency_reserve_write_receipts%rowtype;
 keys constant text[]:=array['workspace_id','expected_revision','base_mode','manual_monthly_cents','target_months','unassigned_goals_ack_cents','allocations','reviewed_months'];
begin
 if uid is null then raise exception using errcode='42501',message='Sessão obrigatória';end if;
 -- Resolve the exact closed intent, even when its revision, backing or months are stale.
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input?&keys)
  or exists(select 1 from jsonb_object_keys(p_input) j where not(j=any(keys)))
 then raise exception using errcode='22023',message='Configuração de reserva inválida';end if;
 if jsonb_typeof(p_input->'workspace_id') is distinct from 'string'
 then raise exception using errcode='22023',message='Workspace inválido';end if;
 begin ws:=(p_input->>'workspace_id')::uuid;
 exception when invalid_text_representation then raise exception using errcode='22023',message='Workspace inválido';end;
 if ws is null or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=uid)
 then raise exception using errcode='42501',message='Workspace não autorizado';end if;
 if p_request_id is null then raise exception using errcode='22023',message='Identificador de requisição obrigatório';end if;
 -- Exactly the same lock and membership lifetime as save_emergency_reserve.
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
 -- A committed cancellation is terminal for this identity. No financial row changes,
 -- and the caller-writable generic receipt cannot establish or undo this decision.
 result:=jsonb_build_object('workspace_id',ws,'cancelled',true);
 insert into private.emergency_reserve_write_receipts(user_id,request_id,workspace_id,payload,result)
 values(uid,p_request_id,ws,intent,result);
 return result;
end $$;
revoke execute on function private.resolve_emergency_reserve_attempt(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.resolve_emergency_reserve_attempt(jsonb,uuid) to authenticated;
create or replace function public.resolve_emergency_reserve_attempt(p_input jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
 select private.resolve_emergency_reserve_attempt(p_input,p_request_id);
$$;
revoke execute on function public.resolve_emergency_reserve_attempt(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.resolve_emergency_reserve_attempt(jsonb,uuid) to authenticated;
