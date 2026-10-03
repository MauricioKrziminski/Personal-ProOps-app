import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as domain from './subcategories.ts';
import * as commands from './subcategory-save.ts';
import * as categories from './categories-merge.ts';
const ws = '10000000-0000-4000-8000-000000000001';
const a = '20000000-0000-4000-8000-000000000001';
const b = '20000000-0000-4000-8000-000000000002';
const child = { id: a, workspace_id: ws, parent_category: 'alimentação', name: 'mercado', edit_revision: 2, uses: 3 };
function mount() {
  let props = { visible: true, parent: 'alimentação', workspaceId: ws, onClose: () => { closes++; } }; let closes = 0;
  const slots: any[] = []; const effects: any[] = []; let cursor = 0; let dirty = false; let queue: any[] = []; let tree: any;
  let state = { workspace_id: ws, items: [child] }; let error = false; let loading = false;
  const sent: any[] = []; const confirmations: (() => void)[] = []; let attempt: any = null; let pending = false;
  let finish!: (value: unknown) => void; let fail!: (error: unknown) => void;
  const transport = () => new Promise((yes, no) => { finish = yes; fail = no; });
  let request = 0;
  const controller = commands.createSubcategorySaveController(async input => { sent.push(input); return transport(); },
    () => `30000000-0000-4000-8000-${String(++request).padStart(12,'0')}`, value => { attempt = value; dirty = true; }, async () => transport());
  const write = { get isPending() { return pending; }, get unconfirmedInput() { return attempt; },
    mutateAsync(input: any) { pending = true; return controller.submit(input).finally(() => { pending = false; }); },
    resolveAsync() { pending = true; return controller.resolve().finally(() => { pending = false; }); } };
  const react = {
    useState(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value;
      return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; dirty = true; }]; },
    useRef(value: any) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
    useLayoutEffect(fn: any, deps: any[]) { const i = cursor++; if (!effects[i] || deps.some((v,index) => !Object.is(v,effects[i].deps[index]))) queue.push({i,fn,deps}); },
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync('src/components/finance/subcategory-manager.tsx','utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, require(name: string) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:'Fragment' };
    if (name === 'react-native') return { View:'View',StyleSheet:{create:(value:any)=>value} };
    if (name === '@/hooks/use-subcategories') return { useSubcategories:()=>({data:state,isError:error,isPending:loading,isLoading:loading,refetch:async()=>{}}),useWriteSubcategory:()=>write };
    if (name === '@/hooks/use-finance') return { useCategoriesUsed:()=>({data:[{category:'alimentação'},{category:'saúde'}]}) };
    if (name === '@/lib/subcategories') return domain;
    if (name === '@/lib/subcategory-save') return commands;
    if (name === '@/lib/categories-merge') return categories;
    if (name === '@/lib/item-actions') return { confirmDestructive:(_title:any,_label:any,fn:any)=>confirmations.push(fn) };
    if (name === '@/hooks/use-aos-poucos') return { useAosPoucos:(items:any[])=>({visiveis:items,restantes:0,verMais:()=>{}}) };
    if (name === '@/design/tokens') return { Space:{lg:16,md:12,xl:24,sm:8} };
    return new Proxy({}, {get:(_,key)=>String(key)});
  } });
  function render(next: any = {}) { props = {...props,...next}; let rounds=0;
    do { cursor=0;dirty=false;queue=[];tree=module.exports.SubcategoryManager(props);assert.ok(++rounds<12); } while(dirty);
    for (const effect of queue) {effects[effect.i]?.cleanup?.();effects[effect.i]={deps:effect.deps,cleanup:effect.fn()};} return tree; }
  function nodes(value:any):any[] { if(!value)return [];if(Array.isArray(value))return value.flatMap(nodes);
    return value.props ? [value,...nodes(value.props.children),...nodes(value.props.action)] : []; }
  function get(type:string, predicate:(props:any)=>boolean=()=>true) { const node=nodes(tree).find(n=>n.type===type&&predicate(n.props));assert.ok(node,`${type} missing`);return node.props; }
  render();return {render,get,sent,confirmations,get closes(){return closes;},
    select(){get('Row',p=>p.title==='mercado').onPress();render();},
    change(label:string,value:string){const field=get('Field',p=>p.label===label);const input=nodes(field.children).find(n=>n.type==='TextField');assert.ok(input);input.props.onChangeText(value);render();},
    read(items:any[],failure=false){state={workspace_id:ws,items};error=failure;render();},
    async settle(){await new Promise<void>(resolve=>setImmediate(resolve));render();},
    resolve(value:unknown){finish(value);},reject(value:unknown){fail(value);},
    unmount(){effects.forEach(e=>e?.cleanup?.());},
  };
}
const receipt={workspace_id:ws,subcategory_id:a,edit_revision:3,merged:false,deleted:false,affected_records:3};
test('manager sends captured revision, preserves editor on resize, and refuses externally changed snapshot',()=>{
  const ui=mount();ui.select();ui.change('Nome','feira');ui.render({width:900});
  assert.equal(ui.get('TextField',p=>p.accessibilityLabel==='Nome do detalhe').value,'feira');
  ui.read([{...child,edit_revision:3,name:'outro'}]);assert.equal(ui.get('Button',p=>p.label==='Salvar detalhe').disabled,true);
  ui.get('Button',p=>p.label==='Reabrir detalhe').onPress();ui.render();
  assert.equal(ui.get('TextField',p=>p.accessibilityLabel==='Nome do detalhe').value,'outro');
});
test('save ambiguity freezes fields and close, retries same intent, then accepts matching late receipt',async()=>{
  const ui=mount();ui.select();ui.change('Nome','feira');ui.get('Button',p=>p.label==='Salvar detalhe').onPress();ui.render();
  assert.equal(ui.sent[0].expected_revision,2);assert.equal(ui.sent[0].subcategory_id,a);
  ui.reject(new Error('lost'));await ui.settle();ui.get('Sheet').onClose();assert.equal(ui.closes,0);
  assert.equal(ui.get('TextField',p=>p.accessibilityLabel==='Nome do detalhe').editable,false);
  ui.get('Button',p=>p.label==='Tentar novamente').onPress();ui.resolve(receipt);await ui.settle();
  assert.deepEqual(ui.sent[0],ui.sent[1]);assert.equal(ui.closes,0);
});
test('collision merge requires explicit confirmation and freezes both revisions; stale confirmation cannot write',()=>{
  const target={...child,id:b,parent_category:'saúde',edit_revision:4};const ui=mount();ui.read([child,target]);ui.select();
  ui.get('SelectField').onChange('saúde');ui.render();ui.get('Button',p=>p.label==='Juntar detalhes').onPress();
  assert.equal(ui.sent.length,0);assert.equal(ui.confirmations.length,1);
  ui.confirmations[0]();assert.equal(ui.sent[0].merge_into_id,b);assert.equal(ui.sent[0].expected_merge_revision,4);
  const stale=mount();stale.read([child,target]);stale.select();stale.get('SelectField').onChange('saúde');stale.render();
  stale.get('Button',p=>p.label==='Juntar detalhes').onPress();stale.render({parent:'saúde'});stale.confirmations[0]();assert.equal(stale.sent.length,0);
});
test('delete confirmation sends closed delete payload and stale row handlers cannot edit a new visit',()=>{
  const ui=mount();ui.select();ui.get('Button',p=>p.label==='Remover detalhe').onPress();
  assert.equal(ui.sent.length,0);ui.confirmations[0]();assert.deepEqual({...ui.sent[0]},{action:'delete',workspace_id:ws,subcategory_id:a,expected_revision:2});
  const stale=mount();const row=stale.get('Row',p=>p.title==='mercado').onPress;stale.render({parent:'saúde'});row();stale.render();
  assert.throws(()=>stale.get('TextField',p=>p.accessibilityLabel==='Nome do detalhe'));
});
test('old completion or resolution cannot close a later visit; read failure hides stale catalog',async()=>{
  const ui=mount();ui.select();ui.get('Button',p=>p.label==='Salvar detalhe').onPress();ui.render({visible:false});ui.render({visible:true,parent:'saúde'});
  ui.resolve(receipt);await ui.settle();assert.equal(ui.closes,0);
  ui.read([child],true);assert.throws(()=>ui.get('Row',p=>p.title==='mercado'));assert.ok(ui.get('Button',p=>p.label==='Tentar carregar'));
});
test('confirmed CAS refusal releases close without adopting a newer revision; terminal resolution releases frozen fields',async()=>{
  const ui=mount();ui.select();ui.get('Button',p=>p.label==='Salvar detalhe').onPress();
  ui.reject({code:'PT409',message:'Detalhe alterado. Abra novamente'});await ui.settle();
  ui.read([{...child,edit_revision:3}]);assert.equal(ui.get('Button',p=>p.label==='Salvar detalhe').disabled,true);
  ui.get('Sheet').onClose();assert.equal(ui.closes,1);
  const cancelled=mount();cancelled.select();cancelled.get('Button',p=>p.label==='Salvar detalhe').onPress();
  cancelled.reject(new Error('lost'));await cancelled.settle();cancelled.get('Button',p=>p.label==='Conferir tentativa').onPress();
  cancelled.resolve({workspace_id:ws,cancelled:true});await cancelled.settle();
  cancelled.get('Sheet').onClose();assert.equal(cancelled.closes,1);
});
test('late resolution and unmount callbacks never close a newer editor; changed merge receiver invalidates confirmation',async()=>{
  const ui=mount();ui.select();ui.get('Button',p=>p.label==='Salvar detalhe').onPress();ui.reject(new Error('lost'));await ui.settle();
  ui.render({parent:'saúde'});ui.get('Button',p=>p.label==='Conferir tentativa').onPress();ui.resolve(receipt);await ui.settle();assert.equal(ui.closes,0);
  const target={...child,id:b,parent_category:'saúde',edit_revision:4};const stale=mount();stale.read([child,target]);stale.select();
  stale.get('SelectField').onChange('saúde');stale.render();stale.get('Button',p=>p.label==='Juntar detalhes').onPress();
  stale.read([child,{...target,edit_revision:5}]);stale.confirmations[0]();assert.equal(stale.sent.length,0);
  const gone=mount();gone.select();gone.get('Button',p=>p.label==='Salvar detalhe').onPress();gone.unmount();gone.resolve(receipt);await gone.settle();assert.equal(gone.closes,0);
});
test('confirmation captured for a prior editor in the same visit cannot delete after choosing another child',()=>{
  const ui=mount();ui.read([child,{...child,id:b,name:'feira'}]);ui.select();
  ui.get('Button',p=>p.label==='Remover detalhe').onPress();ui.get('Button',p=>p.label==='Voltar aos detalhes').onPress();ui.render();
  ui.get('Row',p=>p.title==='feira').onPress();ui.render();ui.confirmations[0]();assert.equal(ui.sent.length,0);
});
test('inline create uses concrete catalog workspace and null source revision without inventing a parent entity',async()=>{
  const ui=mount();ui.read([]);ui.get('Button',p=>p.label==='Novo detalhe').onPress();ui.render();ui.change('Nome',' FEIRA ');
  ui.get('Button',p=>p.label==='Salvar detalhe').onPress();assert.deepEqual({...ui.sent[0]}, {
    action:'save',workspace_id:ws,subcategory_id:null,expected_revision:null,parent_category:'alimentação',name:'feira',merge_into_id:null,expected_merge_revision:null,
  });
  ui.resolve({...receipt,edit_revision:1,affected_records:0});await ui.settle();assert.ok(ui.get('Button',p=>p.label==='Novo detalhe'));
});
