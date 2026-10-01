-- Preserve the legacy three-argument RPC. The new overload requires a request ID
-- (no default, so PostgREST can distinguish the signatures) and serializes retries
-- before touching the origin, which All may already have deleted on the first call.
create or replace function public.converter_registro(
  p_origem jsonb,p_alcance text,p_destino jsonb,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path = public
set timezone to 'America/Sao_Paulo' as $$
declare
  caller_uid uuid := auth.uid();
  ws uuid;
  payload jsonb;
  pedido private.purchase_write_requests%rowtype;
  feito jsonb;
begin
  if caller_uid is null then raise exception 'Autenticação obrigatória'; end if;
  if p_request_id is null then raise exception 'Identificador da requisição obrigatório'; end if;
  ws := public.my_default_workspace();
  if ws is null or ws not in(select private.my_workspace_ids()) then
    raise exception 'Workspace da conversão não autorizado';
  end if;
  payload := jsonb_build_object('operation','converter_registro',
    'origem',p_origem,'alcance',p_alcance,'destino',p_destino);
  insert into private.purchase_write_requests(user_id,request_id,workspace_id,payload)
    values(caller_uid,p_request_id,ws,payload)
    on conflict(user_id,request_id) do nothing;
  select * into pedido from private.purchase_write_requests
    where user_id=caller_uid and request_id=p_request_id for update;
  if not found then raise exception 'Requisição não encontrada neste workspace'; end if;
  if pedido.payload is distinct from payload then
    raise exception 'Esta tentativa já foi usada com dados diferentes';
  end if;
  if pedido.result is not null then return pedido.result; end if;
  -- Failure propagates, rolling back both the request reservation and the core.
  feito := public.converter_registro(p_origem,p_alcance,p_destino);
  update private.purchase_write_requests set result=feito
    where user_id=caller_uid and request_id=p_request_id;
  return feito;
end $$;
revoke execute on function public.converter_registro(jsonb,text,jsonb,uuid) from public,anon;
grant execute on function public.converter_registro(jsonb,text,jsonb,uuid) to authenticated;
