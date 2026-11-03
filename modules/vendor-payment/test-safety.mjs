// Module 12 incremental negative-path static safety gate, modeled on Module 11 test-safety.mjs.
// Offline only. No credentials, BigQuery, scheduler, filesystem modifications, or API calls.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const directory=path.dirname(fileURLToPath(import.meta.url));
const inc=fs.readFileSync(path.join(directory,'incremental-sync.mjs'),'utf8');
let tests=0;
function check(name,fn){fn();tests++;console.log('PASS',name);}
check('Module 12 only and standalone imports',()=>{assert.match(inc,/vendor-payment/);assert.doesNotMatch(inc,/from ['"].*modules\/(?!vendor-payment)/);assert.match(inc,/\.\.\/\.\.\/common\/bigquery-client\.mjs/);});
check('explicit opt-in required for live delta',()=>{assert.match(inc,/\['--dry-run','--sync'\]/);assert.match(inc,/NETSUITE_VENDOR_PAYMENT_INCREMENTAL_CONFIRM/);assert.match(inc,/MODULE12_ONLY/);});
check('dry-run has zero-write return before staging',()=>{assert.match(inc,/if\(mode==='--dry-run'\)\{console\.log\('MODULE 12 INCREMENTAL DRY RUN PASS: ZERO WRITES'\);return;\}/);});
check('no-change returns before staging',()=>assert.match(inc,/if\(!changed\)\{console\.log\('MODULE 12 INCREMENTAL PASS_NO_CHANGE: no writes; checkpoint unchanged'\);return;\}/));
check('checkpoint must have five identical watermarks',()=>{assert.match(inc,/rows\.length===5/);assert.match(inc,/new Set\(rows\.map\(r=>r\.record_type\)\)\.size===5/);assert.match(inc,/s\.size===1/);});
check('missing source header requires bounded independent exact proof',()=>{assert.match(inc,/unverified missing header count; deletion requires independent proof/);assert.match(inc,/deletionCandidates\(mapped\)/);assert.match(inc,/matchDeletedRecordProof\(rows,id,identity\)/);assert.match(inc,/visible\.length===0/);assert.match(inc,/ids\.length<=DELETION_LIMIT/);});
check('deleted header cannot resurrect',()=>{assert.match(inc,/verified-deleted record reappeared in source/);assert.match(inc,/deleted header resurrection blocked/);assert.match(inc,/deletedIds\(snapshot\.mapped\)/);});
check('GL flags matched per header, balanced using BigInt',()=>{assert.match(inc,/r\.posting===headers\.get\(r\.vendor_payment_id\)\?\.posting/);assert.match(inc,/BigInt/);assert.match(inc,/unbalanced GL/);});
check('previous/next application exact mirror',()=>{assert.match(inc,/mapped\.previousLinks\.map\(signature\)/);assert.match(inc,/mapped\.nextLinks\.map\(signature\)/);assert.match(inc,/link mirror/);});
check('exact decimal and duplicate guards',()=>{assert.match(inc,/validateNumeric\(/);assert.match(inc,/duplicate /);assert.match(inc,/stage duplicate/);});
check('staging cannot start with residue',()=>{assert.match(inc,/_stage_vp_/);assert.match(inc,/leftover module 12 staging exists/);});
check('source stability bounded and exact snapshot',()=>{assert.match(inc,/MAX_SOURCE_STABILITY_ATTEMPTS=3/);assert.match(inc,/canonicalSnapshot\(again\.mapped\)===canonicalSnapshot\(snapshot\.mapped\)/);assert.match(inc,/canonicalSnapshot\(beforeCommit\.mapped\)===canonicalSnapshot\(mapped\)/);});
check('checkpoint CAS transactional guard',()=>{assert.match(inc,/last_successful_modified_at=DATETIME\(@oldCp\)/);assert.match(inc,/checkpoint changed/);assert.match(inc,/await checkpoint\(\)===cp/);});
check('rollback and transactional commit',()=>{assert.match(inc,/BEGIN TRANSACTION/);assert.match(inc,/COMMIT TRANSACTION/);assert.match(inc,/ROLLBACK TRANSACTION/);assert.match(inc,/RAISE;/);});
check('null-safe composite merge',()=>{assert.match(inc,/IS NOT DISTINCT FROM/);assert.match(inc,/MERGE \$\{T\(s\.g\.table\)\}/);});
check('no hard deletion of header or truncate',()=>{assert.doesNotMatch(inc,/\bTRUNCATE TABLE\b/i);assert.doesNotMatch(inc,/DELETE FROM \$\{T\('vendor_payment_headers'\)\}/);assert.match(inc,/const staleDetails=stages\.slice\(1\)/);});
check('detail deletion restricted to active source headers',()=>{assert.match(inc,/EXISTS \(SELECT 1 FROM \$\{hStage\} h WHERE h\.vendor_payment_id=d\.vendor_payment_id\)/);assert.match(inc,/COALESCE\(active\.is_deleted,FALSE\)=FALSE/);assert.match(inc,/active\.deleted_at IS NULL/);});
check('post-merge row count and key checks',()=>{assert.match(inc,/postcommit count/);assert.match(inc,/postcommit missing key/);});
check('staging cleanup enforced and checked',()=>{assert.match(inc,/\}finally\{/);assert.match(inc,/delete\(\{ignoreNotFound:true\}\)/);assert.match(inc,/\.exists\(\)/);assert.match(inc,/STAGING CLEANUP FAILED/);});
check('no scheduler integrations; only verified atomic header soft-delete',()=>{assert.doesNotMatch(inc,/schtasks|Register-ScheduledTask|Stop-ScheduledTask|Disable-ScheduledTask/i);assert.match(inc,/UPDATE \${T\('vendor_payment_headers'\)} SET is_deleted=TRUE,deleted_at=CURRENT_TIMESTAMP\(\)/);});
console.log('MODULE 12 INCREMENTAL OFFLINE SAFETY PASS',JSON.stringify({tests,mode:'STATIC_NEGATIVE_PATH_ONLY_NOT_LIVE_BIGQUERY',writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0,liveRollbackProven:false,liveConcurrencyProven:false}));
