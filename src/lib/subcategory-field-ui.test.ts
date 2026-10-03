import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as categories from './categories-merge.ts';
import * as domain from './subcategories.ts';
import * as save from './subcategory-save.ts';

const ws='10000000-0000-4000-8000-000000000001';
const child='20000000-0000-4000-8000-000000000001';
function deferred() { let resolve!: (value: any) => void; let reject!: (error: unknown) => void;
  const promise=new Promise<any>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
function mount(initial: Record<string, any> = {}) {
  let props={ parent:'alimentação',value:null,workspaceId:ws,sessionKey:'first',...initial };
  const slots:any[]=[];const effects:any[]=[];let cursor=0;let dirty=false;let pendingEffects:any[]=[];
  let active=true;let state:any={ workspace_id:ws,items:[] };let failure=false;let tree:any;
  const chosen:any[]=[];const sent:any[]=[];let attempt:any=null;let pending=false;
  let send=deferred();let resolution=deferred();
  const write={get isPending(){return pending;},get unconfirmedInput(){return attempt;},
    mutateAsync(input:any){sent.push(input);attempt=input;pending=true;return send.promise.finally(()=>{pending=false;});},
    resolveAsync(){pending=true;return resolution.promise.finally(()=>{pending=false;attempt=null;});}};
  const react={
    useState(value:any){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;
      return [slots[i],(next:any)=>{slots[i]=typeof next==='function'?next(slots[i]):next;dirty=true;}];},
    useRef(value:any){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},
    useLayoutEffect(fn:any,deps:any[]){const i=cursor++;const old=effects[i];
      if(!old||deps.some((value,index)=>!Object.is(value,old.deps[index])))pendingEffects.push({i,fn,deps});},
  };
  const module={exports:{} as any};
  const code=ts.transpileModule(readFileSync(process.env.PROOPS_F09_SUBCATEGORY_FIELD_FIXTURE ?? 'src/components/finance/subcategory-field.tsx','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},
  }).outputText;
  runInNewContext(code,{module,exports:module.exports,require:(name:string)=>{
    if(name==='react')return react;
    if(name==='react/jsx-runtime')return {jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:'Fragment'};
    if(name==='react-native')return {View:'View',StyleSheet:{create:(v:any)=>v}};
    if(name==='@/components/motion/presenca')return {Presenca:'Presenca',usePresencaAtiva:()=>active};
    if(name==='@/hooks/use-subcategories')return {useSubcategories:()=>({data:state,isLoading:false,isError:failure,refetch:async()=>{}}),useWriteSubcategory:()=>write};
    if(name==='@/hooks/use-aos-poucos')return {useAosPoucos:(items:any[])=>({visiveis:items,restantes:0,verMais:()=>{}})};
    if(name==='@/lib/categories-merge')return categories;
    if(name==='@/lib/subcategories')return domain;
    if(name==='@/lib/subcategory-save')return save;
    if(name==='@/design/tokens')return {Space:{lg:16,md:12,sm:8}};
    return new Proxy({}, {get:(_,key)=>String(key)});
  }});
  function render(next:any={}) {
    props={...props,...next};let rounds=0;
    do {cursor=0;dirty=false;pendingEffects=[];tree=module.exports.SubcategoryField({...props,onChange:(id:any)=>chosen.push(id)});
      assert.ok(++rounds<10,'unstable render');}while(dirty);
    for(const item of pendingEffects){effects[item.i]?.cleanup?.();effects[item.i]={deps:item.deps,cleanup:item.fn()};}
    return tree;
  }
  function nodes(node:any):any[]{if(!node)return [];if(Array.isArray(node))return node.flatMap(nodes);
    return node.props?[node,...nodes(node.props.children)]:[];}
  function get(type:string,predicate:(p:any)=>boolean=()=>true){const found=nodes(tree).find(n=>n.type===type&&predicate(n.props));assert.ok(found,`${type} missing`);return found.props;}
  function start(){get('Row',p=>p.title==='Detalhe').onPress();render();get('SelectField').actions[0].onPress();render();get('TextField').onChangeText('mercado');render();get('Button',p=>p.label==='Criar detalhe').onPress();}
  render();return {render,get,start,chosen,sent,send,resolution,
    setActive(value:boolean){active=value;render();},setRead(value:any,error=false){state=value;failure=error;render();},
    async settle(){await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();render();},
    unmount(){effects.forEach(e=>e?.cleanup?.());},
  };
}
const result={workspace_id:ws,subcategory_id:child,edit_revision:1,merged:false,deleted:false,affected_records:0};
test('Sem detalhe comes first; parent namespace filters actual selector and read errors hide old choices',()=>{
  const ui=mount();ui.setRead({workspace_id:ws,items:[
    {id:child,workspace_id:ws,parent_category:'alimentação',name:'mercado',edit_revision:1,uses:0},
    {id:'20000000-0000-4000-8000-000000000002',workspace_id:ws,parent_category:'saúde',name:'consulta',edit_revision:1,uses:0},
  ]});
  assert.equal(ui.get('SelectField').options[0].id,null);
  assert.deepEqual(Array.from(ui.get('SelectField').options,(p:any)=>p.label),['Sem detalhe','mercado']);
  ui.setRead({workspace_id:ws,items:[]},true);assert.equal(ui.get('SelectField').disabled,true);
  assert.deepEqual(Array.from(ui.get('SelectField').options,(p:any)=>p.label),['Sem detalhe']);
});
test('committed inline creation selects only its current record/parent visit',async()=>{
  const ui=mount();ui.start();ui.send.resolve(result);await ui.settle();assert.deepEqual(ui.chosen,[child]);
  const other=mount();other.start();other.render({parent:'saúde'});other.send.resolve(result);await other.settle();assert.deepEqual(other.chosen,[]);
});
test('stale selector handler cannot choose an old parent child into a new parent',()=>{
  const ui=mount();const old=ui.get('SelectField').onChange;ui.render({parent:'saúde'});old(child);assert.deepEqual(ui.chosen,[]);
});
test('late creation after leaving presence cannot select on the returning visit',async()=>{
  const ui=mount();ui.start();ui.setActive(false);ui.setActive(true);ui.send.resolve(result);await ui.settle();assert.deepEqual(ui.chosen,[]);
});
test('resolving an earlier record creation confirms catalog without selecting into a later record',async()=>{
  const ui=mount();ui.start();ui.send.reject(new Error('response lost'));await ui.settle();
  ui.render({sessionKey:'second'});ui.get('Button',p=>p.label==='Conferir criação').onPress();
  ui.resolution.resolve(result);await ui.settle();assert.deepEqual(ui.chosen,[]);
});
test('unmounted inline creation never selects on confirmation',async()=>{
  const ui=mount();ui.start();ui.unmount();ui.send.resolve(result);await ui.settle();assert.deepEqual(ui.chosen,[]);
});
