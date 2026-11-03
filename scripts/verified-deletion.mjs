// Verified deletion: one source-proven transaction at a time; historical detail untouched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BigQuery } from '@google-cloud/bigquery';
import { token, fetchAll } from '../common/netsuite-client.mjs';
import { matchDeletedRecordProof } from '../common/verified-deletion-proof.mjs';

const args = process.argv.slice(2);
const idPos = args.indexOf('--id');
const rawId = idPos === -1 ? null : args[idPos + 1];
const apply = args.includes('--apply');
const modPos = args.indexOf('--module');
const moduleName = modPos === -1 ? 'sales-invoice' : args[modPos + 1];
const recordTypes = { 'sales-invoice': { recordtypeid:'invoice', type:'INVOICE', table:'sales_invoice_headers' }, 'sales-order': { recordtypeid:'salesorder', type:'SALESORDER', table:'sales_order_headers' }, 'item-fulfillment': { recordtypeid:'itemfulfillment', type:'ITEMFULFILLMENT', table:'item_fulfillment_headers' }, 'item-receipt': { recordtypeid:'itemreceipt', type:'ITEMRECEIPT', table:'item_receipt_headers' }, 'purchase-order': { recordtypeid:'purchaseorder', type:'PURCHASEORDER', table:'purchase_order_headers' }, 'purchase-invoice': { recordtypeid:'vendorbill', type:'VENDORBILL', table:'purchase_invoice_headers' }, 'sales-return': { recordtypeid:'itemreceipt', type:'ITEMRECEIPT', table:'sales_return_headers' }, 'purchase-return': { recordtypeid:'vendorreturnauthorization', type:'VENDORRETURNAUTHORIZATION', table:'purchase_return_headers' }, 'sales-payment': { recordtypeid:'customerpayment', type:'CUSTOMERPAYMENT', table:'sales_payment_headers' } };
const record = recordTypes[moduleName];
const headerIdColumn = moduleName === 'sales-payment' ? 'payment_id' : 'internal_id';
const sandbox = args.includes('--sandbox');
const valid = new Set(['--id','--module','--apply','--dry-run','--sandbox']);
if (!/^[1-9][0-9]{0,14}$/.test(rawId ?? '') || args.some((x, i) => !valid.has(x) && i !== idPos + 1 && i !== modPos + 1) || !record || (apply && args.includes('--dry-run'))) {
  console.error('Usage: node scripts/verified-deletion.mjs --id 3150917 [--module sales-invoice|sales-order|item-fulfillment|purchase-invoice] [--sandbox] [--dry-run|--apply]');
  process.exit(2);
}
if (apply && process.env.NETSUITE_VERIFIED_DELETE_CONFIRM !== 'I_CONFIRM_VERIFIED_SOFT_DELETE') throw Error('BLOCKED: explicit NETSUITE_VERIFIED_DELETE_CONFIRM required');
const project = 'even-gearbox-255203';
const dataset = sandbox ? 'netsuite_backup_recovery_test' : 'netsuite_backup';
const credentials = process.env.NETSUITE_TEST_CREDENTIALS;
if (sandbox && (process.env.NETSUITE_SANDBOX_CONFIRM !== 'I_UNDERSTAND_SANDBOX_ONLY' || !credentials || !fs.existsSync(credentials))) throw Error('BLOCKED: sandbox test account and confirmation required');
const bq = new BigQuery({ projectId: project, ...(sandbox ? {keyFilename: credentials} : {}) });
const table = `\`${project}.${dataset}.${record.table}\``;
const run = async (q, params = {}) => (await bq.query({query:q,params,location:'asia-southeast1'}))[0];
const id = Number(rawId);
const bqId = rawId; // Supports STRING and INT64 internal_id columns without implicit comparison casts.
const access = await token();
const auditSql = `SELECT recordid, recordtypeid, type, name, deleteddate, deletedby, context FROM deletedrecord WHERE recordid = ${id}`;
const evidence = await fetchAll(access, auditSql);
const matching = matchDeletedRecordProof(evidence, rawId, record);
if (matching.length !== 1) throw Error(`NOT VERIFIED: audit rows=${evidence.length}, verified ${moduleName}=${matching.length}. No changes.`);
const stillVisible = await fetchAll(access, `SELECT id FROM Transaction WHERE id = ${id}`);
if (stillVisible.length) throw Error('BLOCKED: transaction remains visible; no deletion apply');
const before = await run(`SELECT CAST(${headerIdColumn} AS STRING) AS id, transaction_date, COALESCE(is_deleted,FALSE) AS is_deleted FROM ${table} WHERE CAST(${headerIdColumn} AS STRING) = @id`, {id: bqId});
if (before.length !== 1) throw Error('BLOCKED: expected exactly one header row');
if (before[0].is_deleted) { console.log('ALREADY SOFT-DELETED: NO-OP'); process.exit(0); }
const e = matching[0];
console.log(`VERIFIED DELETE | ${sandbox?'SANDBOX':'PRODUCTION'} | ID=${id} | recordtypeid=${e.recordtypeid} | name=${e.name} | deleteddate=${e.deleteddate} | deletedby=${e.deletedby}`);
if (!apply) {console.log('DRY RUN PASS: NetSuite proof verified, BigQuery unchanged');process.exit(0);}
// Re-read evidence before write to reduce the window between verification and mutation.
const proof2 = await fetchAll(await token(), auditSql);
if (matchDeletedRecordProof(proof2, rawId, record).length !== 1) throw Error('BLOCKED: deletion evidence changed');
if ((await fetchAll(await token(), `SELECT id FROM Transaction WHERE id = ${id}`)).length) throw Error('BLOCKED: source reappeared');
// One transaction, one header only. No line deletes; no checkpoint writes.
await run(`BEGIN TRANSACTION;
 ASSERT (SELECT COUNT(*) FROM ${table} WHERE CAST(${headerIdColumn} AS STRING)=@id AND COALESCE(is_deleted,FALSE)=FALSE)=1 AS 'Header state changed';
 UPDATE ${table} SET is_deleted=TRUE, deleted_at=CURRENT_TIMESTAMP() WHERE CAST(${headerIdColumn} AS STRING)=@id AND COALESCE(is_deleted,FALSE)=FALSE;
 ASSERT (SELECT COUNT(*) FROM ${table} WHERE CAST(${headerIdColumn} AS STRING)=@id AND is_deleted=TRUE)=1 AS 'Soft-delete assertion failed';
 COMMIT TRANSACTION;`, {id: bqId});
const after = await run(`SELECT COALESCE(is_deleted,FALSE) AS is_deleted FROM ${table} WHERE CAST(${headerIdColumn} AS STRING)=@id`,{id: bqId});
if (after.length!==1 || !after[0].is_deleted) throw Error('POST-COMMIT VERIFICATION FAILED');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const logDir=path.join(root,'logs','verified-deletions');fs.mkdirSync(logDir,{recursive:true});
fs.appendFileSync(path.join(logDir,'audit.jsonl'),JSON.stringify({at:new Date().toISOString(),dataset,module:moduleName,id,recordtypeid:e.recordtypeid,name:e.name,deleteddate:e.deleteddate,deletedby:e.deletedby,result:'SOFT_DELETED'})+'\n');
console.log('VERIFIED SOFT DELETE PASS; historical lines and checkpoints unchanged by this script');
