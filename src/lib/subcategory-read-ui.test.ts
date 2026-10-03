import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
// Reuse the established native/query boundary harness, running the actual production JSX.
const source=ts.createSourceFile('harness',readFileSync('src/lib/simple-finance-ui.test.ts','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const declaration=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='screen')!;
const harness=declaration.getText(source).replace("if (name === 'react') return react;",`if(name==='@/hooks/use-category-details')return {
 useSubcategoryFilterOptions:()=>inRealm({data:options.catalog??[],isSuccess:!options.catalogPending&&!options.catalogError,isPending:!!options.catalogPending,isError:!!options.catalogError,refetch:async()=>refetches.push('catalog')}),
 useCategoryDetailBreakdown:(...args)=>{(options.reads??=[]).push(args);return inRealm({data:options.breakdown,isPending:!!options.breakdownPending,isError:!!options.breakdownError,refetch:async()=>refetches.push('breakdown')});}};
 if(name==='@/lib/subcategories')return load('src/lib/subcategories.ts');
 if(name==='@/lib/category-detail-breakdown')return load('src/lib/category-detail-breakdown.ts');
 if (name === 'react') return react;`).replace('concealed: Boolean(options.concealed), toggle:', 'concealed: Boolean(options.concealed), ready:true, toggle:').replace("'Qualifications',","'Qualifications', 'CategoryDetailRow',");
const js=ts.transpileModule(harness,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const screen:any=runInNewContext(`(()=>{${js};return screen;})()`,{assert,require,ts,readFileSync,createContext,runInContext,runInNewContext,performance,Date,fixtureDate:Date});
const ws='10000000-0000-4000-8000-000000000001';const child='20000000-0000-4000-8000-000000000001';
const catalog=[{workspace_id:ws,items:[{id:child,workspace_id:ws,parent_category:'saúde',name:'consulta',revision:2,uses:1}]}];
const file='src/app/finance/transactions.tsx';
function latest(ui:any){return ui.transactionQueries.at(-1);}
function filters(ui:any){return ui.nodes().find((n:any)=>n.type==='ListFilters').props;}
function apply(ui:any,selections:any){ui.interact(()=>filters(ui).onApply({selections}));}
test('UUID link scopes recorded and expected reads, suppresses global summary, and offers named filter',()=>{
 const ui=screen(file,{params:{subcategoryId:child},catalog});assert.equal(latest(ui).subcategoryId,child);
 assert.equal(ui.summaryQueries.at(-1).pronto,false);assert.equal(filters(ui).value.selections.subcategoryId,child);
 assert.ok(filters(ui).selects.find((s:any)=>s.key==='subcategoryId').options.some((o:any)=>o.id===child&&o.label.includes('consulta')&&o.label.includes('saúde')));
});
test('none is explicit null, reset removes it, and malformed links never broaden reads',()=>{
 const ui=screen(file,{params:{subcategoryId:'none'},catalog});assert.equal(latest(ui).subcategoryId,null);
 apply(ui,{});assert.equal(latest(ui).subcategoryId,undefined);
 const bad=screen(file,{params:{subcategoryId:'tampered'},catalog});assert.equal(latest(bad).pronto,false);
 assert.ok(bad.nodes().some((n:any)=>n.type==='EmptyState'&&String(n.props.title).includes('Detalhe inválido')));
});
test('missing, wrong-parent and unconfirmed catalog identities cannot expose an unfiltered list',()=>{
 for(const options of [{catalog:[]},{catalog,params:{subcategoryId:child,category:'mercado'}},{catalog,catalogError:true},{catalog,catalogPending:true}]){
  const ui=screen(file,{params:{subcategoryId:child},...options});assert.equal(latest(ui).pronto,false);
 }
});
test('changing parent drops inherited identity; aliases preserve it; explicit none remains meaningful',()=>{
 const ui=screen(file,{params:{subcategoryId:child,category:'saúde'},catalog});
 apply(ui,{category:'SAUDE',subcategoryId:child});assert.equal(latest(ui).subcategoryId,child);
 apply(ui,{category:'mercado',subcategoryId:child});assert.equal(latest(ui).subcategoryId,undefined);
 apply(ui,{category:'mercado',subcategoryId:'none'});assert.equal(latest(ui).subcategoryId,null);
});
test('transaction subtitles display child name and never the UUID',()=>{
 const ui=screen(file,{params:{},catalog,txs:[{id:'tx',kind:'expense',category:'saúde',subcategory_id:child,subcategories:{name:'consulta'},amount_cents:100,occurred_at:'2026-10-03',status:'cleared',source:'app'}]});
 const row=ui.nodes().find((n:any)=>n.type==='ItemLink'&&typeof n.props.children==='function').props.children({onLongPress:()=>{}});
 assert.ok(row.props.subtitle.includes('consulta'));assert.ok(row.props.accessibilityLabel.includes('consulta'));
 assert.ok(!ui.nodes().some((n:any)=>String(n.props.accessibilityLabel??'').includes(child)));
});
test('transaction detail displays the resolved child name and stays clean for legacy null',()=>{
 const detailFile='src/app/finance/[txId].tsx';
 for(const name of ['consulta',null]) {
  const tx={id:'detail-tx',kind:'expense',category:'saúde',subcategory_id:name?child:null,subcategories:name?{name}:null,amount_cents:100,occurred_at:'2026-10-03',status:'cleared',source:'app'};
  const ui=screen(detailFile,{params:{txId:'detail-tx'},txs:[tx]});
  const metadata=ui.nodes().filter((n:any)=>n.type==='ThemedText').map((n:any)=>JSON.stringify(n.props.children)).join(' ');
  assert.equal(metadata.includes('consulta'),Boolean(name));
  assert.ok(!metadata.includes(child));assert.ok(!metadata.includes('undefined'));
 }
});
const breakdown={from:'2026-01-01',to:'2026-12-31',parent_category:'saúde',kind:'expense',workspace_id:null,total_cents:500,lines:[{subcategory_id:child,name:'consulta',workspace_name:'Casa',total_cents:300,tx_count:1},{subcategory_id:null,name:null,workspace_name:null,total_cents:200,tx_count:2}]};
const component='src/components/finance/category-detail-breakdown.tsx';const props={from:breakdown.from,to:breakdown.to,parent:'saúde',kind:'expense'};
test('collapsed breakdown reads only on expansion and keeps Sem detalhe alongside exact total',()=>{
 const options:any={componente:'CategoryDetailBreakdown',props,breakdown,reads:[]};const ui=screen(component,options);
 assert.equal(options.reads.at(-1)[5],false);ui.interact(()=>ui.nodes().find((n:any)=>n.type==='Row'&&n.props.title==='Detalhes').props.onPress());
 assert.equal(options.reads.at(-1)[5],true);assert.ok(ui.nodes().some((n:any)=>n.type==='Row'&&n.props.title==='Sem detalhe'));
 assert.ok(ui.nodes().some((n:any)=>n.type==='Row'&&n.props.title==='Total da categoria'&&n.props.trailing.props.cents===500));
});
test('privacy hides child/workspace/count and different scope collapses without retained old lines',()=>{
 const options:any={componente:'CategoryDetailBreakdown',props:{...props},breakdown,reads:[],concealed:true};const ui=screen(component,options);
 ui.interact(()=>ui.nodes().find((n:any)=>n.type==='Row'&&n.props.title==='Detalhes').props.onPress());
 assert.ok(!ui.nodes().some((n:any)=>JSON.stringify(n.props.title??n.props.subtitle??'').match(/consulta|Casa|2 registros/)));
 options.props.parent='mercado';ui.interact(()=>{});assert.equal(options.reads.at(-1)[5],false);
 assert.ok(!ui.nodes().some((n:any)=>n.type==='Row'&&n.props.title==='Total da categoria'));
});
test('mounted links hydrate new identities and catalog removal blocks cached rows',()=>{
 const options:any={params:{subcategoryId:'none'},catalog};const ui=screen(file,options);
 options.params={subcategoryId:child};ui.interact(()=>{});assert.equal(latest(ui).subcategoryId,child);assert.equal(latest(ui).pronto,true);
 options.catalog=[];ui.interact(()=>{});assert.equal(latest(ui).pronto,false);
 assert.ok(ui.nodes().some((n:any)=>n.type==='EmptyState'&&n.props.title==='Não consegui conferir este detalhe'));
 options.catalog=catalog;options.params={subcategoryId:child,category:'mercado'};ui.interact(()=>{});assert.equal(latest(ui).pronto,false);
});
test('expected and in-transit rows obey the same child filter including Sem detalhe',()=>{
 const line=(id:string,detail:string|null)=>({ref_id:id,origin:'recurring',due_date:'2026-09-20',amount_cents:100,kind:'expense',description:id,category:'saúde',subcategory_id:detail,account_id:null,status:'pending',installment_no:null,installments_total:null,inferred_start:false});
 const a=line('selected',child),b=line('none',null),c=line('transit',child),d=line('transit-none',null);
 const options:any={params:{subcategoryId:child},catalog,txs:[],expectedLines:[a,b],expectedInTransit:[c,d]};const ui=screen(file,options);
 const names=()=>ui.nodes().filter((n:any)=>n.type==='LinhaPrevista').map((n:any)=>n.props.line.ref_id);
 assert.equal(JSON.stringify(names().sort()),JSON.stringify(['selected','transit']));apply(ui,{subcategoryId:'none'});assert.equal(JSON.stringify(names().sort()),JSON.stringify(['none','transit-none']));
});
test('a failed breakdown ignores cached successful data and offers the scoped retry',()=>{
 const options:any={componente:'CategoryDetailBreakdown',props,breakdown,breakdownError:true};const ui=screen(component,options);
 ui.interact(()=>ui.nodes().find((n:any)=>n.type==='Row'&&n.props.title==='Detalhes').props.onPress());
 assert.ok(!ui.nodes().some((n:any)=>n.type==='Row'&&n.props.title==='consulta'));ui.press('Tentar de novo');assert.ok(ui.refetches.includes('breakdown'));
});
