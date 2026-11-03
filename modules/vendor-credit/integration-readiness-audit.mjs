// Module 11 B18: static, read-only production-integration readiness gate.
// No NetSuite API, BigQuery mutation, scheduler/task changes, or checkpoint updates.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,'../..');
const arg=process.argv.slice(2);
if(arg.length!==1||arg[0]!=='--dry-run')throw Error('Usage: node modules/vendor-credit/integration-readiness-audit.mjs --dry-run');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const sha=(s)=>crypto.createHash('sha256').update(s).digest('hex');
const status=[];
const audit=(name,pass,detail,severity='blocker')=>{status.push({name,status:pass?'PASS':severity==='blocker'?'BLOCKER':'REVIEW',detail});console.log('GATE',JSON.stringify(status.at(-1)));};
const required=['modules/vendor-credit/mapping.mjs','modules/vendor-credit/schema-contract.mjs','modules/vendor-credit/incremental-sync.mjs','modules/vendor-credit/verified-deletion.mjs','modules/vendor-credit/deletion-identity.confirmed.json','modules/vendor-credit/presence.mjs','modules/vendor-credit/check-financial.mjs','modules/vendor-credit/final-readonly.mjs','modules/vendor-credit/test-incremental-writer-offline.mjs','common/decimal-precision.mjs','common/verified-deletion-proof.mjs','common/recovery-controller.mjs','config/scheduler.json'];
console.log('MODULE 11 B18 INTEGRATION READINESS | STRICT STATIC READ ONLY');
const missing=required.filter(x=>!fs.existsSync(path.join(root,x)));
audit('required_files',missing.length===0,missing.length?{missing}:{count:required.length});
if(missing.length){console.log('B18 RESULT',JSON.stringify({status:'BLOCKED_NOT_READY',missing,writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0}));process.exitCode=2;}
else {
const files=Object.fromEntries(required.map(f=>[f,read(f)]));
const inc=files['modules/vendor-credit/incremental-sync.mjs'];
const del=files['modules/vendor-credit/verified-deletion.mjs'];
const map=files['modules/vendor-credit/mapping.mjs'];
const schema=files['modules/vendor-credit/schema-contract.mjs'];
const ident=JSON.parse(files['modules/vendor-credit/deletion-identity.confirmed.json']);
const sched=JSON.parse(files['config/scheduler.json'].replace(/^\uFEFF/,''));
const guarded=/missing from source|deletion requires independent proof/.test(inc)&&!/DELETE\s+FROM\s+\$\{T\(/i.test(inc);
audit('unverified_missing_source_blocked',guarded,'Incremental refuses source-missing records; no hard delete');
audit('deletion_tuple',ident.recordtypeid==='vendorcredit'&&ident.type==='VENDORCREDIT'&&ident.independentlyVerified===true,{recordtypeid:ident.recordtypeid,type:ident.type});
audit('deletion_protection',/MAX=3/.test(del)&&/exactProof\(/.test(del)&&/absentGlobally\(/.test(del)&&/UPDATE \$\{table\} SET is_deleted=TRUE/.test(del)&&!/DELETE FROM \$\{table\}/.test(del),'Bounded proof and header-only soft deletion');
audit('checkpoint_protection',/last_successful_modified_at=DATETIME\(@oldCp\)/.test(inc)&&/BEGIN TRANSACTION/.test(inc)&&/ROLLBACK TRANSACTION/.test(inc),'Atomic compare-and-swap checkpoint contract');
audit('scope_start',/2026-10-01/.test(map),'Scoped to Oct 1, 2026');
const finite=/t\.trandate\s*<|2027-01-01/.test(map);
audit('future_date_coverage',!finite,'Vendor Credit query has no fixed end date');
const blocksDeleted=!/async function deletedIds\(/.test(inc)||!/verified-deleted record reappeared in source/.test(inc)||!/deleted header resurrection blocked/.test(inc);
audit('post_soft_delete_incremental',!blocksDeleted,'Verified-deleted IDs excluded, protected from resurrection; active data remains reconcilable');
const testsLive='NOT_PROVEN';
audit('changed_source_live_commit',false,'Only B17 offline simulation and B12 unchanged-source dry-run verified', 'blocker');
audit('actual_soft_delete_live',false,'No eligible Oct 2026 candidate; real apply path not exercised', 'blocker');
audit('scheduler_isolation',sched.workflow==='common/recovery-controller.mjs',{workflow:sched.workflow,mode:sched.mode});
audit('module_schema_present',schema.includes('vendor_credit_headers')&&schema.includes('vendor_credit_accounting_lines'),'Vendor Credit table contract available');
const fingerprints=Object.fromEntries(['common/recovery-controller.mjs','config/scheduler.json'].map(f=>[f,sha(files[f])]));
console.log('PRODUCTION_FILE_FINGERPRINTS',JSON.stringify(fingerprints));
const blockers=status.filter(x=>x.status==='BLOCKER');
console.log('MODULE 11 B18 RESULT',JSON.stringify({status:blockers.length?'BLOCKED_NOT_READY':'READINESS_STATIC_PASS',blockers:blockers.map(x=>x.name),warnings:status.filter(x=>x.status==='REVIEW').map(x=>x.name),checks:status.length,mode:'STATIC_READ_ONLY',liveChangedSourceWriteProven:false,realDeletionApplyProven:false,writerIntegrated:false,writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0}));
// Expected blockers are a completed audit, not a script execution failure.
}
