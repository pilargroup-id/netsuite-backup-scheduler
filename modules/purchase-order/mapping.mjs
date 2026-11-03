import {token,fetchAll} from '../../common/netsuite-client.mjs';
export {token};
export const TYPE='PurchOrd';
export const FROM='2026-10-01';
export const TO='2026-11-01';
const base=`FROM Transaction WHERE type='${TYPE}' AND trandate>=TO_DATE('${FROM}','YYYY-MM-DD') AND trandate<TO_DATE('${TO}','YYYY-MM-DD')`;
export async function fetchHeaders(access,since=null){
 const changed=since?` AND lastmodifieddate>=TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')`:'';
 const sql=`SELECT id AS internal_id,tranid AS po_number,TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,BUILTIN.DF(status) AS status,entity AS vendor_id,BUILTIN.DF(entity) AS vendor_name,currency AS currency_id,exchangerate,foreigntotal,total,postingperiod ${base}${changed} ORDER BY id`;
 return fetchAll(access,sql);
}
export async function fetchLines(access,ids){
 const results=[];
 for(let i=0;i<ids.length;i+=25){
  const group=ids.slice(i,i+25).map(validId);
  const sql=`SELECT transaction,id AS line_id,uniquekey AS line_unique_key,linesequencenumber AS line_number,item AS item_id,quantity,rate,foreignamount,netamount,location AS location_id,units AS units_id,mainline,taxline,iscogs,accountinglinetype FROM TransactionLine WHERE transaction IN (${group.join(',')}) ORDER BY transaction,id`;
  results.push(...await fetchAll(access,sql));
 }
 return results;
}
function validId(x){const n=Number(x);if(!Number.isSafeInteger(n)||n<=0)throw Error('Invalid source ID '+x);return String(n);}
function str(v){return v==null?null:String(v);}
function decimal(v){if(v==null||v==='')return null;const s=String(v);const n=Number(s);if(!Number.isFinite(n))throw Error('Invalid decimal '+s);return n.toFixed(6);}
function cents(v){
 if(v==null||v==='')return 0n;
 const s=String(v).trim();
 const m=s.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
 if(!m)throw Error('Invalid decimal: '+s);
 const digits=(m[2]??'')+(m[3]??m[4]??'');
 const fractional=(m[3]??m[4]??'').length;
 const exponent=Number(m[5]??'0');
 if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>1000)throw Error('Invalid exponent: '+s);
 const shift=exponent-fractional+6;
 let scaled=BigInt(digits);
 if(shift>=0){
  scaled*=10n**BigInt(shift);
 }else{
  const divisor=10n**BigInt(-shift);
  if(scaled%divisor!==0n)throw Error('More than 6 significant decimal places: '+s);
  scaled/=divisor;
 }
 return m[1]==='-'?-scaled:scaled;
}
function display(n){return `${n<0n?'-':''}${(n<0n?-n:n)/1000000n}.${((n<0n?-n:n)%1000000n).toString().padStart(6,'0')}`;}
const yes=v=>String(v??'F').toUpperCase()==='T';
export function mapSource(headers,rawLines){
 const outH=[],outL=[],ids=new Set(),keys=new Set(),balance=new Map(),mainCount=new Map(),detailCount=new Map();
 for(const r of headers){
  const id=validId(r.internal_id);if(ids.has(id))throw Error('Duplicate PO header '+id);ids.add(id);
  if(!/^\d{4}-\d\d-\d\d$/.test(r.transaction_date??''))throw Error('Invalid PO date '+id);
  if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r.last_modified??''))throw Error('Missing PO modified date '+id);
  if(r.foreigntotal==null||r.total==null)throw Error('Missing financial header '+id);
  outH.push({internal_id:id,po_number:str(r.po_number),transaction_date:r.transaction_date,last_modified:r.last_modified,status:str(r.status),vendor_id:str(r.vendor_id),vendor_name:str(r.vendor_name),currency_id:str(r.currency_id),exchange_rate:decimal(r.exchangerate),foreign_total:decimal(r.foreigntotal),base_total:decimal(r.total),posting_period_id:str(r.postingperiod)});
  balance.set(id,0n);mainCount.set(id,0);detailCount.set(id,0);
 }
 for(const r of rawLines){
  const parent=validId(r.transaction);if(!ids.has(parent))throw Error('Orphan source PO line '+parent);
  const main=yes(r.mainline),tax=yes(r.taxline),cogs=yes(r.iscogs);
  if(cogs)throw Error('Unexpected COGS line: '+parent+':'+r.line_id);
  balance.set(parent,balance.get(parent)+cents(r.foreignamount));
  if(main){mainCount.set(parent,mainCount.get(parent)+1);continue;}
  detailCount.set(parent,detailCount.get(parent)+1);
  const key=str(r.line_unique_key);if(!key)throw Error('Missing unique key '+parent);
  const composite=parent+':'+key;if(keys.has(composite))throw Error('Duplicate PO line '+composite);keys.add(composite);
  const lineType=tax?'TAX':r.accountinglinetype==='ASSET'?'ASSET':r.accountinglinetype==='EXPENSE'?'EXPENSE':'OTHER';
  outL.push({po_internal_id:parent,line_unique_key:key,line_id:str(r.line_id),line_number:str(r.line_number),line_type:lineType,item_id:str(r.item_id),quantity:decimal(r.quantity),rate:decimal(r.rate),foreign_amount:decimal(r.foreignamount),net_amount:decimal(r.netamount),location_id:str(r.location_id),units_id:str(r.units_id),accounting_line_type:str(r.accountinglinetype),is_tax_line:tax});
 }
 for(const h of outH){
  const id=h.internal_id;
  if(mainCount.get(id)!==1||!detailCount.get(id))throw Error('PO structural count mismatch '+id);
  if(balance.get(id)!==0n)throw Error('PO foreign line imbalance '+id+': '+display(balance.get(id)));
 }
 if(!outH.length&&rawLines.length)throw Error('Lines present without PO headers');
 return {headers:outH,lines:outL,rawLineCount:rawLines.length,counts:{headers:outH.length,detail:outL.length,mainline:[...mainCount.values()].reduce((a,b)=>a+b,0)}};
}
