import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { validateNumeric } from '../../common/decimal-precision.mjs';

export { token };
export const TYPE = 'VendAuth';
export const FROM = '2026-10-01';
export const TO = '2027-01-01';
const date = s => `TO_DATE('${s}','YYYY-MM-DD')`;
const id = v => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw Error(`Invalid NetSuite id ${v}`); return String(n); };
const str = v => v == null ? null : String(v);
const bool = v => String(v ?? 'F').toUpperCase() === 'T';
const dec = (v, recordId, field) => v == null || v === '' ? null : validateNumeric(String(v), {module:'purchase-return', recordId, field});
// Rates on historical VendAuth can exceed NUMERIC scale 9. Keep exact raw text in a STRING field; no rounding.
const rawRate = (v, recordId) => {
  if (v == null || v === '') return null;
  const raw=String(v).trim();
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(raw)) throw Error(`Invalid raw rate ${recordId}: ${raw}`);
  return raw;
};
async function batched(access, ids, sql) {
  const results=[];
  for(let i=0;i<ids.length;i+=25) {
    const group=ids.slice(i,i+25).map(id);
    results.push(...await fetchAll(access, sql(group.join(','))));
  }
  return results;
}
export async function fetchHeaders(access, since=null, {from=FROM,to=TO}={}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw Error('Invalid date window');
  if(since!==null && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since)) throw Error('Invalid modified watermark');
  const mod=since ? ` AND r.lastmodifieddate >= TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')` : '';
  return fetchAll(access, `SELECT r.id AS internal_id, r.tranid AS authorization_number, TO_CHAR(r.trandate,'YYYY-MM-DD') AS transaction_date, TO_CHAR(r.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, BUILTIN.DF(r.status) AS status, r.entity AS vendor_id, BUILTIN.DF(r.entity) AS vendor_name, r.currency AS currency_id, r.exchangerate, r.foreigntotal, r.total, r.memo, r.subsidiary AS subsidiary_id FROM Transaction r WHERE r.type='VendAuth' AND r.trandate >= ${date(from)} AND r.trandate < ${date(to)}${mod} ORDER BY r.id`);
}
export async function fetchLines(access, ids) { return batched(access,ids, q=> `SELECT transaction AS transaction_id,id AS line_id,uniquekey AS line_unique_key,linesequencenumber AS line_number,item AS item_id,quantity,rate,foreignamount,netamount,location AS location_id,units AS units_id,mainline,taxline,iscogs,accountinglinetype FROM TransactionLine WHERE transaction IN (${q}) ORDER BY transaction,id`); }
export async function fetchGL(access, ids) { return batched(access,ids, q=> `SELECT transaction AS transaction_id,transactionline AS line_id,accountingbook AS accounting_book_id,account AS account_id,debit,credit,posting FROM TransactionAccountingLine WHERE transaction IN (${q}) ORDER BY transaction,accountingbook,transactionline,account`); }
export async function fetchPreviousLinks(access, ids) { return batched(access,ids, q=> `SELECT l.nextdoc AS authorization_id,l.previousdoc AS related_id,l.linktype AS link_type,t.type AS related_type,t.tranid AS related_number,TO_CHAR(t.trandate,'YYYY-MM-DD') AS related_date FROM PreviousTransactionLineLink l JOIN Transaction t ON t.id=l.previousdoc WHERE l.nextdoc IN (${q}) AND l.linktype='PurchRet' AND t.type='PurchOrd' ORDER BY l.nextdoc,l.previousdoc`); }
export async function fetchNextLinks(access, ids) { return batched(access,ids, q=> `SELECT l.previousdoc AS authorization_id,l.nextdoc AS related_id,l.linktype AS link_type,t.type AS related_type,t.tranid AS related_number,TO_CHAR(t.trandate,'YYYY-MM-DD') AS related_date FROM NextTransactionLineLink l JOIN Transaction t ON t.id=l.nextdoc WHERE l.previousdoc IN (${q}) AND ((l.linktype='ShipRcpt' AND t.type='ItemShip') OR (l.linktype='OrdBill' AND t.type='VendCred')) ORDER BY l.previousdoc,l.nextdoc`); }
export function mapSource(headers,lines,gl,previous,next) {
  const result={ headers:[],transactionLines:[],accountingLines:[],sourceLinks:[],downstreamLinks:[] };
  const ids=new Set(); const seenLines=new Set(); const seenGL=new Set(); const seenPrev=new Set(); const seenNext=new Set();
  const physicalCounts=new Map(); const prevCounts=new Map();
  for(const x of headers){
    const key=id(x.internal_id); if(ids.has(key)) throw Error(`Duplicate VendAuth ${key}`); ids.add(key);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(x.transaction_date??''))) throw Error(`Invalid date ${key}`);
    if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(x.last_modified??''))) throw Error(`Invalid watermark ${key}`);
    physicalCounts.set(key,0); prevCounts.set(key,0);
    result.headers.push({ internal_id:key,authorization_number:str(x.authorization_number), transaction_date:x.transaction_date,last_modified:x.last_modified,status:str(x.status),vendor_id:str(x.vendor_id),vendor_name:str(x.vendor_name),currency_id:str(x.currency_id), exchange_rate:dec(x.exchangerate,key,'exchange_rate'), foreign_total:dec(x.foreigntotal,key,'foreign_total'),total_amount:dec(x.total,key,'total_amount'),memo:str(x.memo),subsidiary_id:str(x.subsidiary_id) });
  }
  for(const x of lines){const key=id(x.transaction_id);if(!ids.has(key))throw Error(`Orphan return line ${key}`);if(bool(x.mainline)||bool(x.taxline))continue;
    const unique=str(x.line_unique_key);if(!unique)throw Error(`Missing uniquekey ${key}`);const compound=`${key}:${unique}`;if(seenLines.has(compound))throw Error(`Duplicate line ${compound}`);seenLines.add(compound);
    const quantity=dec(x.quantity,key,'quantity');const rate=rawRate(x.rate,key);
    if(x.item_id!=null && quantity!=null && quantity!=='0')physicalCounts.set(key,physicalCounts.get(key)+1);
    result.transactionLines.push({authorization_internal_id:key,line_unique_key:unique,line_id:str(x.line_id),line_number:str(x.line_number),item_id:str(x.item_id),quantity,rate_raw:rate,foreign_amount:dec(x.foreignamount,key,'foreign_amount'),net_amount:dec(x.netamount,key,'net_amount'),location_id:str(x.location_id),units_id:str(x.units_id),is_cogs:bool(x.iscogs),accounting_line_type:str(x.accountinglinetype)});
  }
  for(const x of gl){const key=id(x.transaction_id);if(!ids.has(key))throw Error(`Orphan GL ${key}`);const compound=[key,x.accounting_book_id,x.line_id,x.account_id].join(':');if(seenGL.has(compound))throw Error(`Duplicate GL ${compound}`);seenGL.add(compound);
    if(bool(x.posting))throw Error(`Unexpected posting GL for VendAuth ${key}`);
    result.accountingLines.push({authorization_internal_id:key,accounting_book_id:str(x.accounting_book_id),line_id:str(x.line_id),account_id:str(x.account_id),debit:dec(x.debit,key,'debit'),credit:dec(x.credit,key,'credit'),posting:false});
  }
  for(const x of previous){const key=id(x.authorization_id);if(!ids.has(key))throw Error(`Orphan source link ${key}`);if(x.link_type!=='PurchRet'||x.related_type!=='PurchOrd')throw Error(`Unexpected previous link ${key}`);
    const uniq=`${key}:${id(x.related_id)}:PurchRet`;if(seenPrev.has(uniq))continue;seenPrev.add(uniq);prevCounts.set(key,prevCounts.get(key)+1);
    result.sourceLinks.push({authorization_internal_id:key,source_internal_id:id(x.related_id),source_type:'PurchOrd',source_number:str(x.related_number),source_date:str(x.related_date),link_type:'PurchRet'});
  }
  for(const x of next){const key=id(x.authorization_id);if(!ids.has(key))throw Error(`Orphan downstream link ${key}`);if(!((x.link_type==='ShipRcpt'&&x.related_type==='ItemShip')||(x.link_type==='OrdBill'&&x.related_type==='VendCred')))throw Error(`Unexpected downstream link ${key}`);
    const uniq=`${key}:${id(x.related_id)}:${x.link_type}`;if(seenNext.has(uniq))continue;seenNext.add(uniq);
    result.downstreamLinks.push({authorization_internal_id:key,related_internal_id:id(x.related_id),related_type:x.related_type,related_number:str(x.related_number),related_date:str(x.related_date),link_type:x.link_type});
  }
  // Not all authorizations are completed: cancelled and closed records must remain eligible.
  for(const key of ids){if(physicalCounts.get(key)===0)throw Error(`VendAuth ${key} missing item lines`);}
  result.counts=Object.fromEntries(Object.entries(result).filter(([k])=>k!=='counts').map(([k,v])=>[k,v.length]));
  return result;
}
