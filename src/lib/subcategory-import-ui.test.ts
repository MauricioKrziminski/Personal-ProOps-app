import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as preview from './import-preview.ts';
import * as subcategories from './subcategories.ts';
import * as escrita from './escrita.ts';
import * as categories from './categories-merge.ts';
const ws='10000000-0000-4000-8000-000000000001';
const child='20000000-0000-4000-8000-000000000001';
const another='20000000-0000-4000-8000-000000000002';
const rule={id:'rule',workspace_id:ws,pattern:'mercado',category:'alimentação',subcategory_id:child,account_id:'account',hits:1,source:'user',subcategories:{name:'mercado'}};
const item={id:'item',workspace_id:ws,kind:'expense',amount_cents:101,occurred_at:'2026-10-03',description:'Mercado',merchant:null,status:'pending',nature:'compra',installment_no:null,installments:null,match_layer:null,match_note:null,adopt_ids:null,transactions:null,suggested_category:'alimentação',suggested_subcategory_id:child,suggested_subcategory_set:true};
function mount(screen:'rules'|'import', options:{missingWorkspace?:boolean;legacyRule?:boolean;missingRuleWorkspace?:boolean}={}){
 const slots:any[]=[];let cursor=0;let tree:any;let effects:any[]=[];const writes:any[]=[];let actions:any[]=[];
 const source=options.missingWorkspace?{...item,workspace_id:undefined}:item;
 const ruleSource:any={...rule};if(options.legacyRule)delete ruleSource.subcategory_id;if(options.missingRuleWorkspace)delete ruleSource.workspace_id;
 const query=(data:any)=>({data,isPending:false,isLoading:false,isError:false,isSuccess:true,refetch:async()=>{}});
 const mutation=(kind:string)=>({isPending:false,mutate(value:any,callbacks:any){writes.push({kind,value,callbacks});}});
 const hooks:any={useAccounts:()=>query([{id:'account',name:'Conta'}]),useRules:()=>query([ruleSource]),useSaveRule:()=>mutation('rule'),useDeleteRule:()=>mutation('delete'),
  useImportItems:()=>query([source]),useImportBatch:()=>query({status:'review',accounts:{type:'checking'},account_id:'account'}),useImportUnmatched:()=>query([]),usePlanStatus:()=>query({plan:'pro'})};
 const code=ts.transpileModule(readFileSync(screen==='rules'?'src/app/finance/rules.tsx':'src/app/import.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as any};
 runInNewContext(code,{module,exports:module.exports,require:(name:string)=>{
  if(name==='react')return {useState(value:any){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],(next:any)=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(value:any){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},useCallback:(fn:any)=>fn,useLayoutEffect:(fn:any)=>{effects.push(fn);}};
  if(name==='react/jsx-runtime')return {jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:'Fragment'};
  if(name==='react-native')return {View:'View',StyleSheet:{create:(v:any)=>v}};
  if(name==='expo-router')return {Stack:{Screen:'Stack.Screen'},router:{setParams:()=>{}},useLocalSearchParams:()=>({batch:'batch'})};
  if (name === 'react-native-worklets') return { scheduleOnRN: (fn: (...a: any[]) => unknown, ...a: unknown[]) => fn(...a) };
  if(name==='react-native-reanimated')return {default:{View:'Animated.View'},FadeInDown:{duration:()=>({delay:()=>null})}};
  if(name==='expo-haptics')return {notificationAsync:()=>{},NotificationFeedbackType:{Success:'success'}};
  if(name==='@/hooks/use-finance')return new Proxy(hooks,{get:(h,key)=>h[String(key)]??(()=>mutation(String(key)))});
  if(name==='@/hooks/use-subcategories')return {useSubcategories:()=>query({workspace_id:ws,items:[]})};
  if(name==='@/hooks/use-adaptive-window')return {useAdaptiveWindow:()=>({windowClass:'compact'})};
  if(name==='@/hooks/use-lock')return {useLock:()=>({semTrancar:(fn:any)=>fn()})};
  if(name==='@/hooks/use-aos-poucos')return {useAosPoucos:(items:any[])=>({visiveis:items,restantes:0}),useJanelasPorGrupo:()=>({janelaDe:(_g:any,items:any[])=>({visiveis:items,restantes:0})})};
  if(name==='@/hooks/use-items')return {formatDateBR:(x:any)=>x};
  if(name==='@/lib/import-preview')return preview;
  if(name==='@/lib/subcategories')return subcategories;
  if(name==='@/lib/escrita')return escrita;
  if(name==='@/lib/categories-merge')return categories;
  if(name==='@/lib/item-actions')return {showItemActions:(_t:any,list:any[])=>{actions=list;},confirmDestructive:()=>{}};
  if(name==='@/components/ui/toast')return {useToast:()=>()=>{}};
  if(name==='@/components/ui/conceal')return {useBRL:()=> (value:any)=>String(value)};
  if(name==='@/design/tokens')return {Space:{lg:16,xxl:32},Type:{title:{}},Motion:{duration:{slow:200},stagger:{step:10,cap:100}},tabular:{}};
  return new Proxy({}, {get:(_,key)=>String(key)});
 }});
 function nodes(v:any):any[]{if(!v)return [];if(Array.isArray(v))return v.flatMap(nodes);return v.props?[v,...nodes(v.props.children),...nodes(v.props.action)]:[];}
 function render(){cursor=0;effects=[];tree=module.exports.default();for(const fn of effects)fn();}
 function get(type:string,predicate:(p:any)=>boolean=()=>true){const n=nodes(tree).find(n=>n.type===type&&predicate(n.props));assert.ok(n,`${type} missing`);return n.props;}
 function open(){if(screen==='rules')get('Row',p=>p.icon==='text.badge.checkmark').onPress();else {get('ImportRow').onLongPress('item');actions.find(a=>a.label==='Editar').onPress();}render();}
 render();return {render,get,open,writes,close(){get('Sheet',p=>p.visible).onClose();render();}};
}
test('rule parent alias keeps child and changing parent clears it while save preserves fields',()=>{
 const ui=mount('rules');ui.open();assert.equal(ui.get('SubcategoryField').value,child);
 ui.get('CategoryPicker').onChange('ALIMENTACAO');ui.render();assert.equal(ui.get('SubcategoryField').value,child);
 ui.get('CategoryPicker').onChange('saúde');ui.render();assert.equal(ui.get('SubcategoryField').value,null);
 ui.get('Button',p=>p.label==='Salvar').onPress();const saved=ui.writes[0].value;
 assert.equal(saved.subcategory_id,null);assert.equal(saved.pattern,'mercado');assert.equal(saved.accountId,'account');assert.equal(saved.workspaceId,ws);
});
test('rule stale child callback from closed editor cannot select into reopened rule',()=>{
 const ui=mount('rules');ui.open();const old=ui.get('SubcategoryField').onChange;ui.close();ui.open();old(another);ui.render();assert.equal(ui.get('SubcategoryField').value,child);
});
test('import keeps editor open and blocks stale detail during parent mutation',()=>{
 const ui=mount('import');ui.open();const old=ui.get('SubcategoryField').onChange;
 ui.get('CategoryPicker').onChange('saúde');old(another);ui.render();assert.equal(ui.get('Sheet').visible,true);assert.equal(ui.get('SubcategoryField').value,null);assert.equal(ui.get('SubcategoryField').enabled,false);
 ui.writes[0].callbacks.onSuccess();ui.render();ui.get('SubcategoryField').onChange(null);ui.render();
 assert.equal(ui.writes[1].value.subcategory_id,null);assert.equal(ui.writes[1].value.expectedCategory,'saúde');assert.equal(ui.writes[1].value.workspaceId,ws);
 assert.equal(Object.hasOwn(ui.writes[1].value,'amount_cents'),false);
});
test('late failed parent mutation cannot roll back a reopened import visit',()=>{
 const ui=mount('import');ui.open();ui.get('CategoryPicker').onChange('saúde');const old=ui.writes[0].callbacks;ui.close();ui.open();ui.get('CategoryPicker').onChange('transporte');old.onError();ui.render();assert.equal(ui.get('CategoryPicker').value,'transporte');
});
test('rule parent change blocks old child callback even before React renders',()=>{
 const ui=mount('rules');ui.open();const old=ui.get('SubcategoryField').onChange;ui.get('CategoryPicker').onChange('saúde');old(another);ui.render();assert.equal(ui.get('SubcategoryField').value,null);
});
test('late successful rule save never closes the returning visit',()=>{
 const ui=mount('rules');ui.open();ui.get('Button',p=>p.label==='Salvar').onPress();const old=ui.writes[0].callbacks;ui.close();ui.open();old.onSuccess();ui.render();assert.equal(ui.get('Sheet').visible,true);
});
test('import missing source workspace never enables or writes detail in default workspace',()=>{
 const ui=mount('import',{missingWorkspace:true});ui.open();assert.equal(ui.get('SubcategoryField').enabled,false);ui.get('SubcategoryField').onChange(another);assert.equal(ui.writes.length,0);
});
test('rule explicit Sem detalhe persists null and blocks an immediate double save',()=>{
 const ui=mount('rules');ui.open();ui.get('SubcategoryField').onChange(null);ui.render();const save=ui.get('Button',p=>p.label==='Salvar').onPress;save();save();
 assert.equal(ui.writes.length,1);assert.equal(ui.writes[0].value.subcategory_id,null);assert.equal(ui.writes[0].value.category,'alimentação');
});
test('import alias preserves child and failed parent change restores both fields',()=>{
 const ui=mount('import');ui.open();ui.get('CategoryPicker').onChange('ALIMENTACAO');ui.render();assert.equal(ui.get('SubcategoryField').value,child);
 ui.writes[0].callbacks.onSuccess();ui.render();ui.get('CategoryPicker').onChange('saúde');ui.render();assert.equal(ui.get('SubcategoryField').value,null);
 ui.writes[1].callbacks.onError();ui.render();assert.equal(ui.get('CategoryPicker').value,'ALIMENTACAO');assert.equal(ui.get('SubcategoryField').value,child);
});
test('import immediate repeated detail taps send one mutation and failure restores choice',()=>{
 const ui=mount('import');ui.open();const choose=ui.get('SubcategoryField').onChange;choose(null);choose(another);assert.equal(ui.writes.length,1);ui.render();assert.equal(ui.get('SubcategoryField').value,null);
 ui.writes[0].callbacks.onError();ui.render();assert.equal(ui.get('SubcategoryField').value,child);assert.equal(ui.get('SubcategoryField').enabled,true);
});
test('legacy rule omission stays omitted while source without workspace never falls back to default',()=>{
 const legacy=mount('rules',{legacyRule:true});legacy.open();legacy.get('Button',p=>p.label==='Salvar').onPress();assert.equal(Object.hasOwn(legacy.writes[0].value,'subcategory_id'),false);
 const missing=mount('rules',{missingRuleWorkspace:true});missing.open();assert.equal(missing.get('SubcategoryField').enabled,false);assert.equal(missing.get('SubcategoryField').workspaceId,undefined);
 missing.get('SubcategoryField').onChange(another);missing.get('Button',p=>p.label==='Salvar').onPress();assert.equal(missing.writes.length,0);
});
