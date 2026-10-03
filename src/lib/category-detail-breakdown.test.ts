import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCategoryDetailBreakdown, decodeSubcategoryFilterStates, parseSubcategoryFilter } from './category-detail-breakdown.ts';
const ws='10000000-0000-4000-8000-000000000001';const child='20000000-0000-4000-8000-00000000000a';
function dto(){return {from:'2026-10-01',to:'2026-10-31',workspace_id:null,kind:'expense',parent_category:'alimentação',total_cents:1001,
  lines:[{subcategory_id:child,name:'mercado',workspace_name:'Pessoal',total_cents:601,tx_count:2},
    {subcategory_id:null,name:null,workspace_name:null,total_cents:400,tx_count:1}]};}
test('exact breakdown preserves Sem detalhe and clones the closed read without deriving cents',()=>{
  const raw=dto();const decoded=decodeCategoryDetailBreakdown(raw);assert.deepEqual(decoded,raw);assert.notEqual(decoded.lines,raw.lines);
  decoded.lines[0].name='feira';assert.equal(raw.lines[0].name,'mercado');
});
for(const [label,patch] of [
  ['extra',{extra:1}],['bad from',{from:'2026-02-29'}],['reverse',{to:'2026-09-30'}],['workspace',{workspace_id:'x'}],
  ['kind',{kind:'transfer'}],['parent',{parent_category:' '}],['decimal',{total_cents:1001.5}],['coercion',{total_cents:'1001'}],
  ['wrong sum',{total_cents:1000}],['unsafe',{total_cents:Number.MAX_SAFE_INTEGER+1}],
] as const)test(`decoder rejects ${label}`,()=>assert.throws(()=>decodeCategoryDetailBreakdown({...dto(),...patch})));
for(const [label,patch] of [
  ['extra',{extra:1}],['id',{subcategory_id:'x'}],['missing name',{name:null}],['missing workspace',{workspace_name:null}],
  ['blank workspace',{workspace_name:''}],['negative',{total_cents:-1}],['count',{tx_count:1.2}],['coerced count',{tx_count:'2'}],
] as const)test(`line decoder rejects ${label}`,()=>{const raw=dto();Object.assign(raw.lines[0],patch);assert.throws(()=>decodeCategoryDetailBreakdown(raw));});
test('duplicate child or null and false Sem detalhe labels are rejected; empty zero and income are valid',()=>{
  const raw=dto();assert.throws(()=>decodeCategoryDetailBreakdown({...raw,total_cents:1202,lines:[raw.lines[0],raw.lines[0]]}));
  assert.throws(()=>decodeCategoryDetailBreakdown({...raw,total_cents:800,lines:[raw.lines[1],raw.lines[1]]}));
  assert.throws(()=>decodeCategoryDetailBreakdown({...raw,lines:[raw.lines[0],{...raw.lines[1],name:'Sem detalhe'}]}));
  assert.equal(decodeCategoryDetailBreakdown({...raw,kind:'income',total_cents:0,lines:[]}).total_cents,0);
});
test('filter catalog decodes every concrete workspace independently and never accepts mixed or repeated scopes',()=>{
  const state={workspace_id:ws,items:[{id:child,workspace_id:ws,parent_category:'alimentação',name:'mercado',edit_revision:1,uses:0}]};
  const decoded=decodeSubcategoryFilterStates([state]);assert.notEqual(decoded[0].items[0],state.items[0]);
  assert.throws(()=>decodeSubcategoryFilterStates([state,state]));assert.throws(()=>decodeSubcategoryFilterStates({items:[state]}));
  assert.throws(()=>decodeSubcategoryFilterStates([{...state,items:[{...state.items[0],workspace_id:'10000000-0000-4000-8000-000000000002'}]}]));
});
test('route filter distinguishes absence, Sem detalhe and UUID; malformed input remains an explicit error',()=>{
  assert.deepEqual(parseSubcategoryFilter(undefined),{valid:true,id:undefined});assert.deepEqual(parseSubcategoryFilter('none'),{valid:true,id:null});
  assert.deepEqual(parseSubcategoryFilter(child.toUpperCase()),{valid:true,id:child});
  for(const value of ['',null,'bad',[child],42])assert.equal(parseSubcategoryFilter(value).valid,false);
});
test('overflow cannot masquerade as a safe parent total; safe maximum and leap dates remain exact',()=>{
 const raw=dto();const max=Number.MAX_SAFE_INTEGER;
 assert.throws(()=>decodeCategoryDetailBreakdown({...raw,total_cents:max,lines:[{...raw.lines[0],total_cents:max},{...raw.lines[1],total_cents:1}]}));
 const valid=decodeCategoryDetailBreakdown({...raw,from:'2024-02-29',total_cents:max,lines:[{...raw.lines[0],total_cents:max}]});
 assert.equal(valid.total_cents,max);
});
test('catalog rejects a child UUID reused across independent workspaces',()=>{
 const state={workspace_id:ws,items:[{id:child,workspace_id:ws,parent_category:'alimentação',name:'mercado',edit_revision:1,uses:0}]};
 const other='10000000-0000-4000-8000-000000000002';
 assert.throws(()=>decodeSubcategoryFilterStates([state,{workspace_id:other,items:[{...state.items[0],workspace_id:other}]}]));
});
