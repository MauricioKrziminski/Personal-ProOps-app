-- F08: the launcher may originate in another member workspace. Keep the
-- existing read model intact and return its actual context for labels/ruler.
alter function public.goal_planning_state(uuid,integer,text,text,jsonb) set schema private;
create function public.goal_planning_state(p_workspace_id uuid,p_days integer,p_view text,p_mode text,p_preview jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
declare result jsonb;context jsonb;
begin
 result:=private.goal_planning_state(p_workspace_id,p_days,p_view,p_mode,p_preview);
 select jsonb_build_object('workspace_name',w.name,'cycle_close_day',w.cycle_close_day)
 into context from public.workspaces w where w.id=p_workspace_id;
 if context is null then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 return result||context;
end $$;
revoke execute on function public.goal_planning_state(uuid,integer,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.goal_planning_state(uuid,integer,text,text,jsonb) to authenticated;
