// Module 14 Inventory Transfer: source extraction and deterministic mapping. STRICT READ ONLY.
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { validateNumeric } from '../../common/decimal-precision.mjs';
import { GROUPS } from './schema-contract.mjs';
export { token };
const scope = "t.type='InvTrnfr' AND t.trandate>=TO_DATE('2026-10-01','YYYY-MM-DD')";
const str = v => v == null ? null : String(v);
const flag = v => String(v??'F').toUpperCase()==='T';
function id(v){const s=str(v);if(!/^[1-9]\d*$/.test(s??''))throw Error('Invalid source id: '+s);return s;}
function date(v,withTime=false){const s=str(v);if(!(withTime?/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/:/^\d{4}-\d\d-\d\d$/).test(s??''))throw Error('Invalid source date: '+s);return s;}
export async function fetchHeaders(a){return fetchAll(a,`SELECT t.id AS internal_id,t.tranid,TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,t.memo,t.subsidiary,t.location,t.transferlocation FROM Transaction t WHERE ${scope} ORDER BY t.id`);}
export async function fetchLines(a,ids){const out=[];for(let i=0;i<ids.length;i+=25){const p=ids.slice(i,i+25).map(id).join(',');out.push(...await fetchAll(a,`SELECT l.transaction AS transaction_id,l.id AS line_id,l.uniquekey AS line_unique_key,l.item,l.location,l.quantity,l.units,l.memo,l.mainline FROM TransactionLine l WHERE l.transaction IN (${p}) ORDER BY l.transaction,l.id`));}return out;}
export function mapSource(headers,lines){
 const mapped={headers:[],lines:[]};const hs=new Set(),ls=new Set();
 for(const h of headers){const k=id(h.internal_id);if(hs.has(k))throw Error('Duplicate header '+k);hs.add(k);mapped.headers.push({internal_id:k,tranid:str(h.tranid),transaction_date:date(h.transaction_date),last_modified:date(h.last_modified,true),memo:str(h.memo),subsidiary_id:str(h.subsidiary),source_location_id:str(h.location),destination_location_id:str(h.transferlocation)});}
 for(const l of lines){const tx=id(l.transaction_id),key=id(l.line_unique_key);if(!hs.has(tx))throw Error('Orphan line '+tx);const pk=tx+'|'+key;if(ls.has(pk))throw Error('Duplicate line '+pk);ls.add(pk);mapped.lines.push({transfer_internal_id:tx,line_id:str(l.line_id),line_unique_key:key,item_id:str(l.item),location_id:str(l.location),quantity:validateNumeric(l.quantity,{module:'inventory-transfer',recordId:tx,field:'quantity'}),units_id:str(l.units),memo:str(l.memo),is_mainline:flag(l.mainline)});}
 for(const g of GROUPS){const rows=g.table==='inventory_transfer_headers'?mapped.headers:mapped.lines;for(const r of rows){for(const [k,t] of g.fields){const v=r[k];if(g.key.includes(k)&&v==null)throw Error('Missing primary key '+k);if(v==null)continue;if(t==='BOOL'?typeof v!=='boolean':typeof v!=='string')throw Error('Invalid mapped field '+k);}}}
 return mapped;
}
