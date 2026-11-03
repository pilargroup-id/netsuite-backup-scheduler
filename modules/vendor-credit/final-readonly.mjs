// Module 11 B16: final live read-only gates; does not execute --sync/--apply.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {query,T} from '../../common/bigquery-client.mjs';
import {GROUPS} from './schema-contract.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
if(process.argv.length!==3||process.argv[2]!=='--dry-run')throw Error('Usage: node modules/vendor-credit/final-readonly.mjs --dry-run');
const checkpointNames=GROUPS.map(x=>x.table);
async function snapshot(){
 const checkpoints=await query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark,CAST(last_successful_sync_at AS STRING) AS sync_at FROM ${T('sync_checkpoints')} WHERE record_type IN UNNEST(@names) ORDER BY record_type`,{names:checkpointNames});
 if(checkpoints.length!==5||new Set(checkpoints.map(x=>x.record_type)).size!==5)throw Error('Missing Vendor Credit checkpoints');
 const result={checkpoints,tableCounts:{}};
 for(const group of GROUPS){const [r]=await query(`SELECT COUNT(*) AS n FROM ${T(group.table)}`);result.tableCounts[group.table]=String(r.n?.value??r.n);}
 const [h]=await query(`SELECT COUNTIF(is_deleted=TRUE) AS deleted, COUNTIF(deleted_at IS NOT NULL) AS deletedAt FROM ${T('vendor_credit_headers')}`);
 result.deletionFlags={deleted:String(h.deleted?.value??h.deleted??0),deletedAt:String(h.deletedAt?.value??h.deletedAt??0)};
 return result;
}
async function main(){
 console.log('MODULE 11 B16 FINAL STANDALONE READ-ONLY | 2026-10-01..OPEN ENDED');
 const before=await snapshot();console.log('BEFORE',JSON.stringify(before));
 const tests=[['test-safety.mjs',[]],['incremental-sync.mjs',['--dry-run']],['verified-deletion.mjs',['--dry-run']],['presence.mjs',[]],['check-financial.mjs',[]]];
 for(const [file,args] of tests){console.log('RUN',file,args.join(' '));const run=spawnSync(process.execPath,[path.join(dir,file),...args],{stdio:'inherit',cwd:path.resolve(dir,'../..'),env:process.env});if(run.error)throw run.error;if(run.status!==0)throw Error(`${file} failed exit=${run.status} signal=${run.signal}`);console.log('GATE_PASS',file);}
 const after=await snapshot();console.log('AFTER',JSON.stringify(after));
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('READ-ONLY INVARIANT FAILED: module checkpoints/counts/deletion flags changed while tests ran; investigate concurrency, no automatic repair');
 console.log('MODULE 11 B16 FINAL READ-ONLY PASS',JSON.stringify({gates:tests.length,checkpointChanges:0,tableCountChanges:0,deletionFlagChanges:0,writerIdempotency:'NOT_YET_PROVEN_ON_CHANGED_SOURCE',deletionApply:'NOT_EXERCISED_NO_CANDIDATE',schedulerChanges:0}));
}
main().catch(e=>{console.error('MODULE 11 B16 BLOCKED',e.stack??String(e));process.exitCode=1;});
