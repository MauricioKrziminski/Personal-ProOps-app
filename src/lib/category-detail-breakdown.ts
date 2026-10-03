import { isValidBRDate, isoToBR } from './dates.ts';
import { decodeSubcategoryState, sumSubcategoryBreakdown, type SubcategoryState } from './subcategories.ts';
export interface CategoryDetailLine {
  subcategory_id:string|null;name:string|null;workspace_name:string|null;total_cents:number;tx_count:number;
}
export interface CategoryDetailBreakdown {
  from:string;to:string;workspace_id:string|null;kind:'expense'|'income';parent_category:string;total_cents:number;lines:CategoryDetailLine[];
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid():never{throw new Error('Detalhes da categoria inválidos. Confira os dados e tente novamente.');}
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const raw=value as Record<string,unknown>;
  if(Object.keys(raw).length!==keys.length||keys.some(key=>!Object.hasOwn(raw,key)))return invalid();return raw;
}
function uuid(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))return invalid();return value.toLowerCase();}
function integer(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)return invalid();return value;}
function text(value:unknown,limit?:number):string{if(typeof value!=='string'||!value.trim()||value!==value.trim()||(limit!==undefined&&Array.from(value).length>limit))return invalid();return value;}
function date(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!isValidBRDate(isoToBR(value)))return invalid();return value;}
export function decodeCategoryDetailBreakdown(value:unknown):CategoryDetailBreakdown{
  const raw=record(value,['from','to','workspace_id','kind','parent_category','total_cents','lines']);
  const from=date(raw.from);const to=date(raw.to);if(from>to||!Array.isArray(raw.lines)||(raw.kind!=='expense'&&raw.kind!=='income'))return invalid();
  const lines=raw.lines.map(value=>{
    const line=record(value,['subcategory_id','name','workspace_name','total_cents','tx_count']);
    const subcategory_id=line.subcategory_id===null?null:uuid(line.subcategory_id);
    if(subcategory_id===null&&(line.name!==null||line.workspace_name!==null))return invalid();
    return {subcategory_id,name:subcategory_id===null?null:text(line.name,40),workspace_name:subcategory_id===null?null:text(line.workspace_name),
      total_cents:integer(line.total_cents),tx_count:integer(line.tx_count)};
  });
  const total_cents=integer(raw.total_cents);
  sumSubcategoryBreakdown(total_cents,lines.map(line=>({subcategory_id:line.subcategory_id,total_cents:line.total_cents})));
  return {from,to,workspace_id:raw.workspace_id===null?null:uuid(raw.workspace_id),kind:raw.kind,
    parent_category:text(raw.parent_category,40),total_cents,lines};
}
export function decodeSubcategoryFilterStates(value:unknown):SubcategoryState[]{
  if(!Array.isArray(value))return invalid();const workspaces=new Set<string>();const ids=new Set<string>();
  return value.map(value=>{const state=decodeSubcategoryState(value);if(workspaces.has(state.workspace_id))return invalid();workspaces.add(state.workspace_id);
    for(const item of state.items){if(ids.has(item.id))return invalid();ids.add(item.id);}return state;});
}
export function parseSubcategoryFilter(value:unknown):{valid:boolean;id:string|null|undefined}{
  if(value===undefined)return {valid:true,id:undefined};if(value==='none')return {valid:true,id:null};
  if(typeof value!=='string'||!UUID.test(value))return {valid:false,id:undefined};return {valid:true,id:value.toLowerCase()};
}
