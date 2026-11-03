// Periodic presence reconciliation for deleted/relocated NetSuite transactions.
// Read-only by default. --apply changes backup flags; no destructive SQL.
import { token, BASE_URL } from './netsuite-client.mjs';
import { query, T } from './bigquery-client.mjs';

const MODULES = {
  'sales-invoice': { type: 'CustInvc', header: 'sales_invoice_headers', line: 'sales_invoice_lines', id: 'internal_id', lineFK: 'invoice_internal_id' },
  'item-fulfillment': { type: 'ItemShip', header: 'item_fulfillment_headers', line: 'item_fulfillment_lines', id: 'internal_id', lineFK: 'fulfillment_internal_id' },
  'sales-order': { type: 'SalesOrd', header: 'sales_order_headers', line: 'sales_order_lines', id: 'internal_id', lineFK: 'sales_order_internal_id' }
};
const RANGE = /^\d{4}-\d{2}-\d{2}$/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function suiteql(access, sql, limit = 1000, offset = 0) {
  const url = `${BASE_URL}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;
  for (let n = 0; n < 4; n++) {
    const r = await fetch(url, {method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json',Prefer:'transient'},body:JSON.stringify({q:sql})});
    const txt = await r.text();
    if (r.ok) return JSON.parse(txt);
    if (![429,500,502,503,504].includes(r.status) || n === 3) throw new Error(`NetSuite SuiteQL ${r.status}: ${txt}`);
    await sleep(1000 * (n + 1));
  }
}
async function allRows(access, sql) {
  const out=[];
  for(let offset=0;;offset+=1000){
    const p=await suiteql(access,sql,1000,offset);
    const items=p.items??[];out.push(...items);
    if(!p.hasMore) return out;
    if(items.length===0 || offset>1000000) throw new Error('Invalid SuiteQL pagination');
  }
}
async function verifyById(access, id) {
  const x = Number(id);
  if(!Number.isSafeInteger(x) || x <= 0) throw new Error('Invalid NetSuite ID');
  return allRows(access,`SELECT id, type, TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date FROM Transaction WHERE id = ${x}`);
}
const quoted = ids => ids.map(id => String(Number(id))).join(',');

export async function reconcilePresence(moduleName,{from='2026-10-01',to='2026-11-01',apply=false}={}) {
  const c=MODULES[moduleName];
  if(!c) throw new Error(`Unsupported module: ${moduleName}`);
  if(!RANGE.test(from)||!RANGE.test(to)||from>=to) throw new Error('Invalid period');
  const access=await token();
  const sql=`SELECT id FROM Transaction WHERE type='${c.type}' AND trandate >= TO_DATE('${from}','YYYY-MM-DD') AND trandate < TO_DATE('${to}','YYYY-MM-DD') ORDER BY id`;
  const source=await allRows(access,sql);
  const sourceIds=new Set(source.map(r=>String(r.id)));
  if(sourceIds.size !== source.length || source.length === 0) throw new Error('Unreliable source inventory; aborting');
  const target=await query(`SELECT CAST(internal_id AS STRING) AS id FROM ${T(c.header)} WHERE transaction_date >= DATE '${from}' AND transaction_date < DATE '${to}' AND COALESCE(is_deleted,FALSE)=FALSE`);
  const targetIds=new Set(target.map(r=>String(r.id)));
  if(targetIds.size!==target.length)throw new Error('Duplicate BigQuery header IDs');
  const missing=[...targetIds].filter(id=>!sourceIds.has(id));
  const newIds=[...sourceIds].filter(id=>!targetIds.has(id));
  console.log(`MODULE: ${moduleName} | NetSuite=${sourceIds.size} BQ active=${targetIds.size}`);
  console.log(`ONLY BIGQUERY: ${missing.length} | ONLY NETSUITE: ${newIds.length}`);
  const unresolved=[];const verified=[];
  for(const id of missing){
    const records=await verifyById(access,id);
    if(records.length===0){verified.push({id,reason:'NOT_VISIBLE_IN_NETSUITE'});continue;}
    const r=records[0];
    if(r.type!==c.type || r.transaction_date < from || r.transaction_date >= to){
      verified.push({id,reason:'OUTSIDE_PERIOD_OR_CHANGED_TYPE'});continue;
    }
    unresolved.push(id);
  }
  for(const r of verified)console.log(`MISSING ${r.id}: ${r.reason}`);
  if(unresolved.length)throw new Error(`Source inventory inconsistent for: ${unresolved.join(',')}`);
  if(newIds.length)console.log(`NETSUITE ONLY IDs (requires delta sync / initial recovery): ${newIds.slice(0,50).join(', ')}`);
  if(!apply){console.log('READ ONLY: no BigQuery changes. Run --apply after reviewing results.');return;}
  // SO apply supported after Phase 2C schema and active-only checker migration.
  if(newIds.length) throw new Error('Apply blocked: source records missing in BigQuery; run sync/check first');
  if(missing.length>Math.max(10, Math.ceil(target.length*0.05)))throw new Error('Mass deletion guard triggered');
  if(!verified.length){console.log('No missing records.');return;}
  // Use script-level BigQuery transaction and explicit ID list. Preserve lines for audit.
  const idList = moduleName === 'sales-order'
    ? verified.map(r => `'${String(Number(r.id))}'`).join(',')
    : quoted(verified.map(r=>r.id));
  const statement=`BEGIN TRANSACTION;
    UPDATE ${T(c.header)} SET is_deleted=TRUE, deleted_at=CURRENT_TIMESTAMP()
    WHERE internal_id IN (${idList}) AND COALESCE(is_deleted,FALSE)=FALSE;
    ASSERT (SELECT COUNT(*) FROM ${T(c.header)} WHERE internal_id IN (${idList}) AND is_deleted=TRUE) = ${verified.length} AS 'Flag count mismatch';
    COMMIT TRANSACTION;`;
  await query(statement);
  console.log(`SOFT DELETE FLAGS APPLIED: ${verified.length}. Lines retained for history.`);
}
