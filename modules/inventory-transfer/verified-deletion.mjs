// Module 14 ONLY. Verified Inventory Transfer header soft-deletion, NEVER automatic.
// Exact independent proof + global absence + fresh inventory + max 3 + checkpoint guard.
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { token, fetchHeaders } from './mapping.mjs';
import { fetchAll } from '../../common/netsuite-client.mjs';
import { query, T } from '../../common/bigquery-client.mjs';
import { matchDeletedRecordProof } from '../../common/verified-deletion-proof.mjs';

const mode = process.argv[2];
const APPLY = mode === '--apply';
const FROM = '2026-10-01', MAX = 3, ID = /^[1-9][0-9]{0,14}$/;
const table = T('inventory_transfer_headers');
const cp = T('sync_checkpoints');
const directory = dirname(fileURLToPath(import.meta.url));
const fail = message => { throw Error('MODULE 14 VERIFIED DELETION BLOCKED: ' + message); };
const must = (ok, why) => { if (!ok) fail(why); };
const clean = value => String(value && typeof value === 'object' && 'value' in value ? value.value : value ?? '').trim();
const id = value => { const text = clean(value); must(ID.test(text), 'invalid ID ' + text); return text; };
function certificate() {
 const c = JSON.parse(readFileSync(join(directory, 'deletion-identity.confirmed.json'), 'utf8'));
 for (const [key, expected] of Object.entries({module:'inventory-transfer', transactionType:'InvTrnfr',recordtypeid:'inventorytransfer',type:'INVENTORYTRANSFER',scope:'2026-10-01..open-ended',independentlyVerified:true,perCandidateDeletionAuthorized:false,automaticDeletionAuthorized:false,maxApplyBatch:3})) must(c[key] === expected,'identity certificate mismatch '+key);
 must(Array.isArray(c.evidenceRecordIds) && c.evidenceRecordIds.length >= 3 && c.evidenceRecordIds.every(x => ID.test(x)) && new Set(c.evidenceRecordIds).size === c.evidenceRecordIds.length,'invalid historical evidence IDs');
 return c;
}
async function proof(access, raw, c) {
 const x = id(raw);
 const all = await fetchAll(access, `SELECT recordid,recordtypeid,type,deleteddate,deletedby,context FROM deletedrecord WHERE recordid=${x}`);
 const found = matchDeletedRecordProof(all, x, c);
 must(found.length === 1,'missing/nonunique independent deletedrecord proof '+x);
 return found[0];
}
async function absent(access, raw) {
 const x = id(raw);
 must((await fetchAll(access, `SELECT id,type FROM Transaction WHERE id=${x}`)).length === 0,'Transaction still globally visible '+x);
}
async function inventory(access) {
 const [source,stored] = await Promise.all([
  fetchHeaders(access),
  query(`SELECT CAST(internal_id AS STRING) internal_id, CAST(transaction_date AS STRING) transaction_date, is_deleted, deleted_at FROM ${table}`)
 ]);
 const sourceIds = source.map(r=>id(r.internal_id));
 const active = stored.filter(r=>r.is_deleted===false || clean(r.is_deleted).toLowerCase()==='false');
 const targetIds = active.map(r=>id(r.internal_id));
 must(sourceIds.length===new Set(sourceIds).size && stored.length===new Set(stored.map(r=>id(r.internal_id))).size,'duplicate source/target header');
 must(stored.every(r=>(r.is_deleted===true||clean(r.is_deleted).toLowerCase()==='true')===(r.deleted_at!=null)),'deletion flag mismatch');
 must(active.every(r=>r.transaction_date>=FROM),'out-of-scope active header');
 const ss = new Set(sourceIds), ts=new Set(targetIds);
 const missing = [...ss].filter(x=>!ts.has(x)).sort();
 const absentIds=[...ts].filter(x=>!ss.has(x)).sort();
 console.log('INVENTORY',JSON.stringify({source:sourceIds.length,bqActive:targetIds.length,sourceNotActiveInBQ:missing.length,absentFromSource:absentIds.length,candidates:absentIds}));
 must(!missing.length,'source headers missing from active BigQuery (sync first)');
 must(absentIds.length<=MAX,'candidates exceed max batch 3; no partial deletion');
 return absentIds;
}
async function checkpoint() {
 const rows=await query(`SELECT record_type,CAST(last_successful_modified_at AS STRING) wm FROM ${cp} WHERE record_type IN ('inventory_transfer_headers','inventory_transfer_lines') ORDER BY record_type`);
 must(rows.length===2 && rows[0].wm===rows[1].wm,'checkpoint missing or divergent');
 return rows[0].wm;
}
async function scopedActive(raw) {
 const x=id(raw);
 const rows=await query(`SELECT CAST(internal_id AS STRING) internal_id,CAST(transaction_date AS STRING) transaction_date,is_deleted,deleted_at FROM ${table} WHERE internal_id=@id`,{id:x});
 must(rows.length===1 && (rows[0].is_deleted===false||clean(rows[0].is_deleted).toLowerCase()==='false') && rows[0].deleted_at==null && rows[0].transaction_date>=FROM,'header not uniquely active or in scope '+x);
}
async function main() {
 must(process.argv.length===3 && (mode==='--dry-run'||APPLY),'usage: node modules/inventory-transfer/verified-deletion.mjs --dry-run|--apply');
 console.log('MODULE 14 VERIFIED DELETION '+mode+' | STRICT MODULE14 SCOPE | MAX_BATCH=3');
 const c=certificate(); const access=await token(); console.log('OAuth: SUCCESS');
 const before=await checkpoint(); const candidates=await inventory(access);
 if(candidates.length===0){console.log('MODULE 14 VERIFIED DELETION CLEAN PASS: NO CANDIDATES; ZERO WRITES');return;}
 for(const historical of c.evidenceRecordIds){await proof(access,historical,c);await absent(access,historical);}
 for(const x of candidates){await proof(access,x,c);await absent(access,x);await scopedActive(x);console.log('CANDIDATE VERIFIED',x);}
 must(await checkpoint()===before,'checkpoint changed during proof');
 if(!APPLY){console.log('MODULE 14 VERIFIED DELETION DRY RUN PASS: ZERO WRITES',JSON.stringify({candidates,maxBatch:MAX}));return;}
 must(process.env.NETSUITE_INVENTORY_TRANSFER_DELETE_CONFIRM==='MODULE14_VERIFIED_HEADER_ONLY' && process.env.NETSUITE_VERIFIED_DELETE_CONFIRM==='I_CONFIRM_VERIFIED_SOFT_DELETE','explicit dual authorization absent');
 const freshAccess=await token(), fresh=await inventory(freshAccess);
 must(JSON.stringify(fresh)===JSON.stringify(candidates),'candidate inventory changed before apply');
 must(await checkpoint()===before,'checkpoint changed before apply');
 // A single transaction protects all candidate header mutations and checkpoint equality.
 // We preserve every line and never write to shared checkpoint tables.
 for(const x of candidates){await proof(freshAccess,x,c);await absent(freshAccess,x);await scopedActive(x);}
 const params={ids:candidates,wm:before};
 const sql=`BEGIN\nBEGIN TRANSACTION;\nASSERT (SELECT COUNT(*) FROM ${cp} WHERE record_type IN ('inventory_transfer_headers','inventory_transfer_lines') AND CAST(last_successful_modified_at AS STRING)=@wm)=2 AS 'Module14 checkpoint changed';\nASSERT (SELECT COUNT(*) FROM ${table} WHERE internal_id IN UNNEST(@ids) AND transaction_date>=DATE '${FROM}' AND is_deleted=FALSE AND deleted_at IS NULL)=${candidates.length} AS 'candidate header state changed';\nUPDATE ${table} SET is_deleted=TRUE,deleted_at=CURRENT_TIMESTAMP() WHERE internal_id IN UNNEST(@ids) AND transaction_date>=DATE '${FROM}' AND is_deleted=FALSE AND deleted_at IS NULL;\nASSERT (SELECT COUNT(*) FROM ${table} WHERE internal_id IN UNNEST(@ids) AND is_deleted=TRUE AND deleted_at IS NOT NULL)=${candidates.length} AS 'soft delete verification failed';\nCOMMIT TRANSACTION;\nEXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;\nEND;`;
 await query(sql,params);
 const verified=await query(`SELECT CAST(internal_id AS STRING) internal_id,is_deleted,deleted_at FROM ${table} WHERE internal_id IN UNNEST(@ids)`,{ids:candidates});
 must(verified.length===candidates.length && verified.every(r=>r.is_deleted===true && r.deleted_at!=null),'post-commit verification failed; investigate, do not retry');
 const auditPath=join(directory,'..','..','logs','verified-deletions','inventory-transfer.jsonl');
 mkdirSync(dirname(auditPath),{recursive:true});
 for(const x of candidates)appendFileSync(auditPath,JSON.stringify({at:new Date().toISOString(),module:'inventory-transfer',id:x,identity:'inventorytransfer|INVENTORYTRANSFER',status:'SOFT_DELETED_HEADER_ONLY',checkpoint:before})+'\n');
 console.log('MODULE 14 VERIFIED DELETION APPLY PASS',JSON.stringify({deleted:candidates.length,linesChanged:0,checkpointChanges:0,otherModuleWrites:0}));
}
main().catch(e=>{console.error(e?.stack??String(e));process.exitCode=1;});
