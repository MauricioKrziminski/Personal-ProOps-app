import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
const ws = '10000000-0000-4000-8000-000000000001';
const child = '20000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const manual = { expense_pattern:'variable',expense_pattern_source:'explicit',expense_necessity:'essential',expense_necessity_source:'explicit' };
const common = { kind:'expense',descricao:'Carro',valorCents:1000,contaId:'account',dataBR:'10/10/2026',categoria:'crédito',subcategory_id:child,expenseClassification:manual };
function debt() { return { id:'debt',workspace_id:ws,name:'Carro',kind:'financing',calculation_mode:'fixed_installments',
  principal_cents:3000,remaining_cents:2000,interest_rate_monthly:0,installments:3,installments_paid:1,installment_cents:1000,
  account_id:'account',payment_method:'pix',due_day:10,first_due_date:'2026-10-10',updated_at:'2026-10-03T12:00:00Z',edit_revision:4,
  payment_category:'crédito',subcategory_id:child,...manual }; }
function mount(options:{debt?:any;common?:any;guarded?:any;route?:any}={}) {
  const realm=createContext({Date});const into=(value:any)=>runInContext(`(${JSON.stringify(value)})`,realm);
  const slots:any[]=[];let cursor=0;let effects:any[]=[];let tree:any;let commonReader!:()=>any;let stateReader!:()=>any;
  const writes:any[]=[];const scopes:((scope:string)=>void)[]=[];let accountQuery:string|undefined;
  const modules=new Map<string,any>();
  const query=(data:any)=>({data:into(data),isPending:false,isLoading:false,isError:false,isSuccess:true,refetch:async()=>{}});
  const mutation=(operation:string)=>({isPending:false,mutate(value:any){writes.push({operation,value});},async mutateAsync(value:any){writes.push({operation,value});return 'debt';}});
  const hooks={DEBT_KINDS:[],useDebts:()=>query(options.debt?[options.debt]:[]),useAccounts:(id?:string)=>{accountQuery=id;return query([{id:'account',name:'Conta arquivada',type:'checking',archived:true}]);},
    useDebtSchedule:()=>query([]),useDebtPayments:()=>query(options.debt?[{id:'payment',debt_payment_no:1}]:[]),useDebtPaymentVersions:()=>query([{id:'payment',edit_revision:2}]),
    useSaveDebt:()=>mutation('create'),useSaveDebtContractScoped:()=>mutation('scope'),useRegistrarPagasContadas:()=>mutation('registrar'),useCycle:()=>({isPending:false,isError:false,data:{de:'2026-09-01',ate:'2026-09-30'}}),
    useCategoryClassificationDefaults:()=>query([{category:'crédito',default_expense_pattern:'fixed',default_expense_necessity:'essential'},
      {category:'saúde',default_expense_pattern:'variable',default_expense_necessity:'essential'}]),};
  function load(path:string):any {
    if(modules.has(path))return modules.get(path);
    const module={exports:{} as any};modules.set(path,module.exports);
    const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
    const req=(name:string):any=>{
      if(name==='react')return {useState(value:any){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;
        return [slots[i],(next:any)=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
        useRef(value:any){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},
        useEffect(fn:any){cursor++;effects.push(fn);},useLayoutEffect(fn:any){cursor++;effects.push(fn);}};
      if(name==='react/jsx-runtime')return {jsx:(type:any,props:any)=>typeof type==='function'?type(props):({type,props}),jsxs:(type:any,props:any)=>typeof type==='function'?type(props):({type,props}),Fragment:'Fragment'};
      if(name==='react-native')return {View:'View',StyleSheet:{create:(v:any)=>v}};
      if(name==='@/hooks/use-finance')return hooks;
      if(name==='@/hooks/use-items')return {localISODate:()=> '2026-10-03'};
      if(name==='@/hooks/use-pausas')return {useDebtPauses:()=>({data:[]})};
      if(name==='@/hooks/use-rascunho')return {useRascunho:()=>({tirar:()=>{}})};
      if(name==='@/lib/agent-chat')return {newClientMessageId:()=> '30000000-0000-4000-8000-000000000001'};
      if(name==='@/lib/edit-scope')return {askEditScope:(_kind:any,fn:any)=>scopes.push(fn)};
      if(name==='@/design/tokens')return {Space:{lg:16,sm:8,xl:24,xxxl:48},tabular:{}};
      if(name==='@/components/ui/conceal')return {useBRL:()=> (c:number)=>String(c)};
      if(name==='@/components/ui/toast')return {useToast:()=>()=>{}};
      if(name.startsWith('@/components/'))return new Proxy({}, {get:(_,key)=>String(key)});
      if(name.startsWith('@/'))return load(`src/${name.slice(2)}.ts`);
      if(name.startsWith('.')){const base=path.slice(0,path.lastIndexOf('/')+1);return load(base+name.slice(2).replace(/\.ts$/,'')+'.ts');}
      throw new Error(`unsupported dependency ${name}`);
    };
    const wrapped=runInContext(`(function(require,module,exports){${code}\n})`,realm);wrapped(req,module,module.exports);modules.set(path,module.exports);return module.exports;
  }
  const component=load('src/components/finance/formulario-da-divida.tsx');
  const props={comum:into(options.common??common),editandoId:options.debt?.id,estadoGuardado:options.guarded?into(options.guarded):undefined,
    dadosDoAplicar:options.route?into(options.route):undefined,onFechar:()=>{},onSalvo:()=>{},registrarComum:(fn:any)=>{commonReader=fn;},registrarEstado:(fn:any)=>{stateReader=fn;}};
  function render(){cursor=0;effects=[];tree=component.FormularioDaDivida(props);for(const fn of effects)fn();return tree;}
  function nodes(value:any):any[]{if(!value)return [];if(Array.isArray(value))return value.flatMap(nodes);return value.props?[value,...nodes(value.props.children),...nodes(value.props.action)]:[];}
  function get(type:string,predicate:(p:any)=>boolean=()=>true){const node=nodes(tree).find(n=>n.type===type&&predicate(n.props));assert.ok(node,`${type} missing`);return node.props;}
  render();return {render,get,writes,scopes,get common(){return commonReader();},get state(){return stateReader();},get accountQuery(){return accountQuery;},
    save(){get('Button',p=>p.label==='Salvar').onPress();},
    field(label:string){const field=get('Field',p=>p.label===label);return nodes(field.children)[0].props;},
    setInstallments(){get('TextField',p=>p.placeholder==='Ex.: 48').onChangeText('3');render();},
  };
}
test('category aliases preserve detail; changing parent clears it and child changes preserve manual classification',()=>{
  const ui=mount();assert.equal(ui.get('SubcategoryField').value,child);ui.get('CategoryPicker').onChange('CREDITO');ui.render();assert.equal(ui.get('SubcategoryField').value,child);
  ui.get('CategoryPicker').onChange('saúde');ui.render();assert.equal(ui.get('SubcategoryField').value,null);
  ui.get('SubcategoryField').onChange(other);ui.render();assert.deepEqual({...ui.get('ExpenseClassificationField').value},manual);
  assert.equal(ui.common.categoria,'saúde');assert.equal(ui.common.subcategory_id,other);
});
test('creation/preview carries optional UUID/null and omission remains a legacy omission',()=>{
  for(const value of [child,null,undefined]){
    const input:Record<string,any>={...common};if(value===undefined)delete input.subcategory_id;else input.subcategory_id=value;
    const ui=mount({common:input});ui.setInstallments();ui.save();const payload=ui.writes[0].value;
    assert.equal(payload.payment_category,'crédito');assert.equal(Object.hasOwn(payload,'subcategory_id'),value!==undefined);
    if(value!==undefined)assert.equal(payload.subcategory_id,value);
    const preview=ui.get('FinanceWritePreview').write.args.p_dados;assert.equal(preview.subcategory_id,payload.subcategory_id);
  }
});
test('paid contract asks scope for category/detail metadata and preserves versions and archived origin',()=>{
  const ui=mount({debt:debt()});assert.equal(ui.accountQuery,'account');ui.get('CategoryPicker').onChange('saúde');ui.render();ui.save();
  assert.equal(ui.writes.length,0);assert.equal(ui.scopes.length,1);ui.scopes[0]('all');
  const payload=ui.writes[0].value;assert.equal(payload.scope,'all');assert.equal(payload.debtRevision,4);assert.equal(payload.paymentVersions.payment,2);
  assert.equal(payload.patch.payment_category,'saúde');assert.equal(payload.patch.subcategory_id,null);assert.equal(Object.hasOwn(payload.patch,'account_id'),false);
});
test('saved draft and route preserve explicit null while omitted child is never coerced into own undefined',()=>{
  const ui=mount();ui.setInstallments();const saved={...ui.state,subcategory_id:null,payment_category:'saúde'};
  const {subcategory_id,...legacyCommon}=common;
  const reopened=mount({guarded:saved,common:legacyCommon});assert.equal(reopened.get('SubcategoryField').value,null);assert.equal(reopened.get('CategoryPicker').value,'saúde');
  const route=mount({route:{parcela:'1000',parcelas:'3',conta:'account',data:'10/10/2026',category:'crédito',subcategory_id:''}});
  assert.equal(route.get('SubcategoryField').value,null);assert.equal(route.get('CategoryPicker').value,'crédito');
});
test('returning from another format adopts the common parent and child together, including explicit null',()=>{
  const initial=mount();const guarded={...initial.state,payment_category:'crédito',subcategory_id:child};
  const returned=mount({guarded,common:{...common,categoria:'saúde',subcategory_id:other}});
  assert.equal(returned.get('CategoryPicker').value,'saúde');assert.equal(returned.get('SubcategoryField').value,other);
  const cleared=mount({guarded,common:{...common,categoria:null,subcategory_id:null}});
  assert.equal(cleared.get('CategoryPicker').value,null);assert.equal(cleared.get('SubcategoryField').value,null);
});
test('explicit null parent in a saved draft remains null when legacy common metadata is omitted',()=>{
  const initial=mount();const {subcategory_id,...legacyCommon}=common;
  const reopened=mount({guarded:{...initial.state,payment_category:null,subcategory_id:null},common:legacyCommon});
  assert.equal(reopened.get('CategoryPicker').value,null);
});
test('detail-only edit asks scope and does not change category, financial fields or classifications',()=>{
  const ui=mount({debt:debt()});ui.get('SubcategoryField').onChange(null);ui.render();ui.save();assert.equal(ui.scopes.length,1);ui.scopes[0]('future');
  assert.deepEqual({...ui.writes[0].value.patch},{subcategory_id:null});assert.equal(ui.writes[0].value.scope,'future');
});
test('editing never reads details in default workspace when the contract workspace is missing',()=>{
  const record=debt();delete record.workspace_id;const ui=mount({debt:record});
  assert.equal(ui.get('SubcategoryField').enabled,false);ui.get('SubcategoryField').onChange(other);ui.render();
  assert.equal(ui.get('SubcategoryField').value,child);
});
