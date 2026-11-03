import {token, fetchAll} from '../../common/netsuite-client.mjs';
export {token};
export const TYPE='ItemRcpt';
export const FROM='2026-10-01';
export const TO='2026-11-01';
export const HEADER_SQL=`SELECT id AS internal_id, tranid AS receipt_number, TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date, TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, BUILTIN.DF(status) AS status FROM Transaction WHERE type = 'ItemRcpt' AND trandate >= TO_DATE('${FROM}','YYYY-MM-DD') AND trandate < TO_DATE('${TO}','YYYY-MM-DD')`;
export async function fetchHeaders(access, since=null){
 const modified=since ? ` AND lastmodifieddate >= TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')` : '';
 return fetchAll(access, HEADER_SQL+modified+' ORDER BY id');
}
export async function fetchLines(access,ids){
 const result=[];
 for(let i=0;i<ids.length;i+=25){
  const group=ids.slice(i,i+25);
  if(!group.length)continue;
  const sql=`SELECT transaction, id AS line_id, uniquekey AS line_unique_key, linesequencenumber AS line_number, item AS item_id, quantity, rate, foreignamount, netamount, location AS location_id, units AS units_id, mainline, taxline, iscogs, accountinglinetype FROM TransactionLine WHERE transaction IN (${group.map(x=>Number(x)).join(',')}) ORDER BY transaction, id`;
  result.push(...await fetchAll(access,sql));
 }
 return result;
}
function id(n){const x=Number(n);if(!Number.isSafeInteger(x)||x<=0)throw Error(`Invalid ID: ${n}`);return String(x);}
function dec(v){if(v==null||v==='')return null;const n=Number(v);if(!Number.isFinite(n))throw Error(`Invalid decimal: ${v}`);return n.toFixed(6);}
// Exact arithmetic at NUMERIC's six fractional digits used by this module.
function decimalMicros(v){
 if(v==null||v==='')return 0n;
 const match=String(v).match(/^(-?)(\d+)(?:\.(\d{1,6}))?$/);
 if(!match)throw Error('Invalid six-decimal amount: '+v);
 const n=BigInt(match[2])*1000000n+BigInt((match[3]??'').padEnd(6,'0'));
 return match[1] ? -n : n;
}
function microsToDecimal(v){
 const negative=v<0n;const n=negative?-v:v;
 return (negative?'-':'')+(n/1000000n).toString()+'.'+(n%1000000n).toString().padStart(6,'0');
}
export function mapSource(headers,rawLines){
 const h=[],l=[],seen=new Set(),headerIds=new Set();
 for(const r of headers){const k=id(r.internal_id);if(headerIds.has(k))throw Error('Duplicate header '+k);headerIds.add(k);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(r.transaction_date)))throw Error('Invalid transaction date '+k);
  h.push({internal_id:k,receipt_number:r.receipt_number??null,transaction_date:r.transaction_date,last_modified:r.last_modified??null,created_from_id:r.created_from_id==null?null:String(r.created_from_id),status:r.status??null,total_amount:null});
 }
 for(const r of rawLines){
  const parent=id(r.transaction);if(!headerIds.has(parent))throw Error('Orphan source line '+parent);
  if(String(r.mainline).toUpperCase()!=='F'||String(r.taxline).toUpperCase()==='T'||String(r.iscogs).toUpperCase()==='T')continue;
  const key=r.line_unique_key==null?null:String(r.line_unique_key);if(!key)throw Error('Missing line uniquekey '+parent);
  const composite=parent+':'+key;if(seen.has(composite))throw Error('Duplicate source line '+composite);seen.add(composite);
  l.push({receipt_internal_id:parent,line_unique_key:key,line_id:r.line_id==null?null:String(r.line_id),line_number:r.line_number==null?null:String(r.line_number),item_id:r.item_id==null?null:String(r.item_id),quantity:dec(r.quantity),rate:dec(r.rate),foreign_amount:dec(r.foreignamount),net_amount:dec(r.netamount),location_id:r.location_id==null?null:String(r.location_id),units_id:r.units_id==null?null:String(r.units_id),accounting_line_type:r.accountinglinetype??null});
 }
 if(h.length&&!l.length)throw Error('No non-mainline receipt details found. Investigate SuiteQL before loading');
 const lineSet=new Set(l.map(x=>x.receipt_internal_id));const empty=h.filter(x=>!lineSet.has(x.internal_id));if(empty.length)throw Error(`Receipts without detail lines: ${empty.slice(0,10).map(x=>x.internal_id).join(', ')}`);
 // total_amount is a DERIVED sum of mapped detail net_amount, NOT the native NetSuite header total.
 // NULL net_amount lines contribute zero to this specifically named derived KPI.
 const totals=new Map(h.map(x=>[x.internal_id,0n]));
 for(const row of l)totals.set(row.receipt_internal_id,totals.get(row.receipt_internal_id)+decimalMicros(row.net_amount));
 for(const row of h)row.total_amount=microsToDecimal(totals.get(row.internal_id));
 return {headers:h,lines:l,rawLineCount:rawLines.length};
}
