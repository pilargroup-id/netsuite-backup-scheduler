// Phase 2B: targeted transaction recovery diagnosis, deliberately READ ONLY.
// Run from C:\netsuite-backup. Does not change NetSuite, BigQuery, checkpoints or lines.
import { token, BASE_URL } from './netsuite-client.mjs';
import { query, T } from './bigquery-client.mjs';

const modules = {
  'sales-invoice': { type:'CustInvc', header:'sales_invoice_headers', lines:'sales_invoice_lines', lineId:'invoice_internal_id', softDelete:true },
  'item-fulfillment': { type:'ItemShip', header:'item_fulfillment_headers', lines:'item_fulfillment_lines', lineId:'fulfillment_internal_id', softDelete:true },
  'sales-order': { type:'SalesOrd', header:'sales_order_headers', lines:'sales_order_lines', lineId:'sales_order_internal_id', softDelete:false }
};
const [moduleName, rawId, ...flags] = process.argv.slice(2);
if (!modules[moduleName] || !/^[1-9][0-9]{0,14}$/.test(rawId ?? '') || flags.some(x=>x !== '--dry-run')) {
  console.error('Usage: node common/targeted-recovery.mjs <sales-invoice|item-fulfillment|sales-order> <internal_id> [--dry-run]');
  process.exit(2);
}
const c = modules[moduleName];
const id = rawId;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function suiteql(access, q) {
  const url = `${BASE_URL}/services/rest/query/v1/suiteql?limit=100&offset=0`;
  for (let attempt=1;attempt<=4;attempt++) {
    const response = await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json',Prefer:'transient'},body:JSON.stringify({q})});
    const body = await response.text();
    if (response.ok) {
      const parsed=JSON.parse(body);
      if (parsed.hasMore) throw new Error('Unexpected >100 source rows for a single ID');
      return parsed.items??[];
    }
    if (![429,500,502,503,504].includes(response.status) || attempt===4) throw new Error(`SuiteQL HTTP ${response.status}: ${body.slice(0,500)}`);
    await sleep(attempt*1000);
  }
}
async function main() {
  console.log(`TARGETED RECOVERY AUDIT | ${moduleName.toUpperCase()} | ID ${id} | READ ONLY`);
  const access = await token();
  const ns = await suiteql(access, `SELECT id, tranid, type, TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date, TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified FROM Transaction WHERE id=${id}`);
  const modifiedCol = moduleName === 'sales-order' ? 'last_modified' : 'netsuite_last_modified_at';
  const idPredicate = moduleName === 'sales-order' ? `internal_id='${id}'` : `internal_id=${id}`;
  const rows = await query(`SELECT CAST(internal_id AS STRING) AS id, CAST(transaction_date AS STRING) AS transaction_date, ${c.softDelete?'COALESCE(is_deleted,FALSE)':'FALSE'} AS is_deleted, CAST(${modifiedCol} AS STRING) AS last_modified FROM ${T(c.header)} WHERE ${idPredicate}`);
  if (ns.length>1 || rows.length>1) throw new Error('Unexpected duplicate header for internal ID');
  const source=ns[0]??null, backup=rows[0]??null;
  console.log('NetSuite:', source ? JSON.stringify(source) : 'NOT_VISIBLE (not proof of deletion)');
  console.log('BigQuery:',backup ? JSON.stringify(backup) : 'MISSING');
  let classification;
  if (source && source.type !== c.type) classification='TYPE_CHANGED_OR_WRONG_MODULE';
  else if (!source && !backup) classification='NOT_FOUND_IN_EITHER_SOURCE';
  else if (!source) classification='BIGQUERY_ONLY_VERIFY_UI_PERMISSIONS_PERIOD';
  else if (!backup) classification='RECOVERY_CANDIDATE_MISSING_HEADER';
  else if (backup.is_deleted === true || String(backup.is_deleted).toLowerCase()==='true') classification='RESTORE_CANDIDATE_SOFT_DELETED';
  else if (String(source.transaction_date)!==String(backup.transaction_date)) classification='PERIOD_OR_DATE_RELOCATION_CANDIDATE';
  else if (String(source.last_modified)!==String(backup.last_modified)) classification='TIMESTAMP_DIFFERENCE_REVIEW_DELTA_SYNC';
  else classification='HEADER_PRESENCE_AND_TIMESTAMP_MATCH_NOT_A_FULL_KPI_CHECK';
  console.log('CLASSIFICATION:',classification);
  // This intentionally does not compare raw NetSuite transaction lines with mapped BigQuery lines:
  // the three modules use different line filters and accounting calculations.
  console.log('NO CHANGES: headers, lines, checkpoints and historical data preserved.');
  if (classification!=='HEADER_PRESENCE_AND_TIMESTAMP_MATCH_NOT_A_FULL_KPI_CHECK') process.exitCode=3;
}
main().catch(err=>{console.error('TARGETED AUDIT ERROR:',err.message);process.exitCode=1;});
