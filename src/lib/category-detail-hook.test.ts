import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { decodeCategoryDetailBreakdown, decodeSubcategoryFilterStates } from './category-detail-breakdown.ts';
const ws='10000000-0000-4000-8000-000000000001';
function mount(data:unknown){
 const calls:any[]=[];const queries:any[]=[];const realtime:any[]=[];const signal=new AbortController().signal;
 let error:unknown=null;
 const request:any={abortSignal(s:unknown){assert.equal(s,signal);calls.push({signal:s});return request;},then(resolve:any){return Promise.resolve({data,error}).then(resolve);}};
 const module={exports:{} as any};const code=ts.transpileModule(readFileSync('src/hooks/use-category-details.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(`(function(require,module,exports){${code}})`,{} )((name:string)=>{
  if(name==='@/lib/category-detail-breakdown')return {decodeCategoryDetailBreakdown,decodeSubcategoryFilterStates};
  if(name==='@/lib/supabase')return {supabase:{rpc:(name:string,args:unknown)=>{calls.push({name,args});return request;}}};
  if(name==='@/hooks/use-items')return {useRealtimeInvalidate:(...args:any[])=>realtime.push(args)};
  if(name==='@tanstack/react-query')return {useQuery:(options:any)=>{queries.push(options);return options;}};
  throw new Error(name);
 },module,module.exports);
 return {...module.exports,calls,queries,realtime,signal,setError:(next:unknown)=>{error=next;}};
}
function receipt(){return {from:'2026-01-01',to:'2026-12-31',workspace_id:ws,kind:'expense',parent_category:'saúde',total_cents:0,lines:[]};}
test('read hook passes exact scope and abort signal, disables collapsed query, and has no old placeholder',async()=>{
 const h=mount(receipt());h.useCategoryDetailBreakdown('2026-01-01','2026-12-31','saúde','expense',ws,false);
 const options=h.queries.at(-1);assert.equal(options.enabled,false);assert.equal(options.placeholderData,undefined);
 assert.equal(JSON.stringify(options.queryKey),JSON.stringify(['category-breakdown','2026-01-01','2026-12-31','saúde','expense',ws]));
 const result=await options.queryFn({signal:h.signal});assert.equal(result.workspace_id,ws);
 assert.equal(JSON.stringify(h.calls[0]),JSON.stringify({name:'category_detail_breakdown',args:{p_from:'2026-01-01',p_to:'2026-12-31',p_parent_category:'saúde',p_kind:'expense',p_workspace_id:ws}}));
 assert.equal(h.calls[1].signal,h.signal);assert.equal(h.realtime.length,2);
});
test('scope mismatch or transport error cannot be shown as another successful breakdown',async()=>{
 for(const patch of [{from:'2026-02-01'},{to:'2026-12-30'},{parent_category:'mercado'},{kind:'income'},{workspace_id:null}]){
  const h=mount({...receipt(),...patch});await assert.rejects(h.fetchCategoryDetailBreakdown('2026-01-01','2026-12-31','saúde','expense',ws,h.signal));
 }
 const h=mount(receipt());h.setError(new Error('offline'));await assert.rejects(h.fetchCategoryDetailBreakdown('2026-01-01','2026-12-31','saúde','expense',ws,h.signal),/offline/);
});
test('all-workspace catalog decoder is used behind an abortable membership-aware realtime query',async()=>{
 const h=mount([{workspace_id:ws,items:[]}]);h.useSubcategoryFilterOptions();const options=h.queries.at(-1);
 assert.equal(JSON.stringify(options.queryKey),JSON.stringify(['subcategories','filter-options']));
 const result=await options.queryFn({signal:h.signal});assert.equal(result[0].workspace_id,ws);assert.equal(h.calls[0].name,'subcategory_filter_states');
 assert.equal(h.calls[1].signal,h.signal);assert.equal(JSON.stringify(h.realtime.map((r:any)=>r[0])),JSON.stringify(['subcategories','transactions','workspace_members']));
 const bad=mount([{workspace_id:ws,items:[],extra:true}]);bad.useSubcategoryFilterOptions();await assert.rejects(bad.queries.at(-1).queryFn({signal:bad.signal}));
});
