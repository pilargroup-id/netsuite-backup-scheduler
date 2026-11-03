// Vendor Credit Module 11: read-only historical backfill sizing and safety audit.
// Does not modify production modules, checkpoints, BigQuery tables, or scheduling.
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { query, T } from '../../common/bigquery-client.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--dry-run') {
  throw Error('Usage: node modules/vendor-credit/prebackfill-audit.mjs --dry-run');
}
const fail = (s) => { throw Error('PREBACKFILL AUDIT BLOCKED: ' + s); };
const count = (x) => { const s=String(x??''); if(!/^\d+$/.test(s))fail('invalid count '+s); return BigInt(s); };
const year = (x) => { const s=String(x??''); if(!/^20\d\d$/.test(s))fail('invalid year '+s); return s; };
const sqls = [
 ['YEARS', `SELECT TO_CHAR(t.trandate,'YYYY') AS yr, COUNT(*) AS n, MIN(TO_CHAR(t.trandate,'YYYY-MM-DD')) AS first_date, MAX(TO_CHAR(t.trandate,'YYYY-MM-DD')) AS last_date, MAX(TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS')) AS last_modified FROM Transaction t WHERE t.type='VendCred' GROUP BY TO_CHAR(t.trandate,'YYYY') ORDER BY yr`],
 ['STATUS_DISTRIBUTION', `SELECT TO_CHAR(t.trandate,'YYYY') AS yr,t.status AS status_id, COUNT(*) AS n FROM Transaction t WHERE t.type='VendCred' GROUP BY TO_CHAR(t.trandate,'YYYY'),t.status ORDER BY yr,status_id`],
 ['CURRENCY_DISTRIBUTION', `SELECT TO_CHAR(t.trandate,'YYYY') AS yr,t.currency AS currency_id, COUNT(*) AS n FROM Transaction t WHERE t.type='VendCred' GROUP BY TO_CHAR(t.trandate,'YYYY'),t.currency ORDER BY yr,currency_id`],
 ['POSTING_VOID_DISTRIBUTION', `SELECT TO_CHAR(t.trandate,'YYYY') AS yr,t.posting,t.void,t.voided, COUNT(*) AS n FROM Transaction t WHERE t.type='VendCred' GROUP BY TO_CHAR(t.trandate,'YYYY'),t.posting,t.void,t.voided ORDER BY yr`],
 ['RECENT_OUTSIDE_WINDOW', `SELECT t.id AS internal_id,TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS modified_at FROM Transaction t WHERE t.type='VendCred' AND t.trandate<TO_DATE('2026-10-01','YYYY-MM-DD') ORDER BY t.lastmodifieddate DESC,t.id FETCH FIRST 20 ROWS ONLY`]
];
async function main() {
 console.log('MODULE 11 VENDOR CREDIT PRE-BACKFILL INVENTORY | STRICT READ ONLY');
 const cp=await query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS wm FROM ${T('sync_checkpoints')} WHERE record_type IN UNNEST(@names)`,{names:['vendor_credit_headers','vendor_credit_lines','vendor_credit_accounting_lines','vendor_credit_previous_links','vendor_credit_next_links']});
 if(cp.length!==5||new Set(cp.map(r=>r.record_type)).size!==5||new Set(cp.map(r=>r.wm)).size!==1)fail('five equal checkpoint watermarks required');
 console.log('EXISTING_MODULE_CHECKPOINT',cp[0].wm);
 const a=await token(); console.log('OAuth: SUCCESS');
 const results={};
 for(const [name,sql] of sqls){const rows=await fetchAll(a,sql);results[name]=rows;console.log(name,JSON.stringify(rows));}
 let total=0n, windowYear=0n;
 for(const r of results.YEARS){let y=year(r.yr);total+=count(r.n);if(y==='2026')windowYear+=count(r.n);}
 for(const name of ['STATUS_DISTRIBUTION','CURRENCY_DISTRIBUTION','POSTING_VOID_DISTRIBUTION']){
   let sub=0n;for(const r of results[name]){year(r.yr);sub+=count(r.n);}if(sub!==total)fail(name+' counts do not equal all-history');
 }
 const bq=await query(`SELECT COUNT(*) AS n FROM ${T('vendor_credit_headers')}`);
 const persisted=count(bq[0]?.n?.value??bq[0]?.n);
 if(total<persisted)fail('BigQuery headers exceed historical source count');
 console.log('BACKFILL_INVENTORY_RESULT',JSON.stringify({status:'REVIEW_REQUIRED_NO_WRITES',sourceHistory:total.toString(),existingBigQueryHeaders:persisted.toString(),approximateMissing: (total-persisted).toString(),important:'approximateMissing is a count delta, not a set-difference proof; a complete key-set comparison is needed before write',eligibleForBackfillApply:false,eligibleForScheduler:false,eligibleForDeletionApply:false,writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0}));
}
main().catch(e=>{console.error('PREBACKFILL AUDIT FAILED',e?.stack??String(e));process.exitCode=1;});
