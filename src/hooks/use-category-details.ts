import { useQuery } from '@tanstack/react-query';
import { useRealtimeInvalidate } from '@/hooks/use-items';
import { decodeCategoryDetailBreakdown, decodeSubcategoryFilterStates } from '@/lib/category-detail-breakdown';
import { supabase } from '@/lib/supabase';
export async function fetchCategoryDetailBreakdown(from:string,to:string,parent:string,kind:'expense'|'income',workspaceId?:string,signal?:AbortSignal){
  const request=supabase.rpc('category_detail_breakdown',{p_from:from,p_to:to,p_parent_category:parent,p_kind:kind,...(workspaceId ? {p_workspace_id:workspaceId} : {})});
  const {data,error}=await(signal?request.abortSignal(signal):request);if(error)throw error;
  const state=decodeCategoryDetailBreakdown(data);
  if(state.from!==from||state.to!==to||state.parent_category!==parent||state.kind!==kind||state.workspace_id!==(workspaceId?.toLowerCase()??null))
    throw new Error('Não consegui conferir o período, categoria e espaço destes detalhes.');
  return state;
}
export function useCategoryDetailBreakdown(from:string,to:string,parent:string,kind:'expense'|'income',workspaceId?:string,enabled=true){
  useRealtimeInvalidate('transactions',['category-breakdown']);useRealtimeInvalidate('subcategories',['category-breakdown']);
  return useQuery({queryKey:['category-breakdown',from,to,parent,kind,workspaceId??'all'],
    queryFn:context=>fetchCategoryDetailBreakdown(from,to,parent,kind,workspaceId,context.signal),enabled,placeholderData:undefined});
}
export function useSubcategoryFilterOptions(){
  useRealtimeInvalidate('subcategories',['subcategories','filter-options']);
  useRealtimeInvalidate('transactions',['subcategories','filter-options']);
  useRealtimeInvalidate('workspace_members',['subcategories','filter-options']);
  return useQuery({queryKey:['subcategories','filter-options'],placeholderData:undefined,queryFn:async context=>{
    const {data,error}=await supabase.rpc('subcategory_filter_states').abortSignal(context.signal);
    if(error)throw error;return decodeSubcategoryFilterStates(data);
  }});
}
