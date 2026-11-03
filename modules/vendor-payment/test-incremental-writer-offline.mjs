// Module 12 offline writer safety contract, patterned on frozen Module 11 B17.
// No credentials, NetSuite API, BigQuery API, checkpoint or scheduler writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateNumeric} from '../../common/decimal-precision.mjs';
import {GROUPS} from './schema-contract.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const src=fs.readFileSync(path.join(dir,'incremental-sync.mjs'),'utf8');
let tests=0;
function test(name,fn){fn();tests++;console.log('PASS',name);}
function match(re){assert.match(src,re);}
const names=GROUPS.map(x=>x.table);
test('only five Module 12 tables',()=>assert.deepEqual(names,['vendor_payment_headers','vendor_payment_lines','vendor_payment_accounting_lines','vendor_payment_previous_links','vendor_payment_next_links']));
test('strict isolated sync opt-in',()=>{match(/NETSUITE_VENDOR_PAYMENT_INCREMENTAL_CONFIRM/);match(/MODULE12_ONLY/);match(/\['--dry-run','--sync'\]/);});
test('no production scheduler or other-module writes',()=>{assert.doesNotMatch(src,/\bTRUNCATE\s+TABLE\b/i);assert.doesNotMatch(src,/\bUPDATE\s+Transaction\b/i);assert.doesNotMatch(src,/modules\/(?:vendor-credit|customer-credit-memo|sales-payment)\//);});
test('dry-run returns before staging',()=>{match(/if\(mode==='--dry-run'\)\{console\.log\('MODULE 12 INCREMENTAL DRY RUN PASS: ZERO WRITES'\);return;/);assert.ok(src.indexOf("if(mode==='--dry-run')")<src.indexOf('const suffix=crypto.randomUUID()'));});
test('no-change returns before staging',()=>{match(/if\(!changed\)\{console\.log\('MODULE 12 INCREMENTAL PASS_NO_CHANGE: no writes; checkpoint unchanged'\);return;/);});
test('five identical checkpoints required',()=>{match(/rows\.length===5/);match(/new Set\(rows\.map\(r=>r\.watermark\)\)/);});
test('missing live header does not imply deletion',()=>{match(/target rows missing from source/);match(/unverified missing header blocked/);});
test('deleted header cannot be resurrected',()=>{match(/async function deletedIds/);match(/verified-deleted record reappeared in source/);match(/deleted header resurrection blocked/);});
test('nonposting GL requires matching header flag',()=>{match(/r\.posting===headers\.get\(r\.vendor_payment_id\)\?\.posting/);assert.doesNotMatch(src,/must\(r\.posting,'nonposting GL'/);});
test('GL grouped by payment and accounting book and balanced exactly',()=>{match(/r\.vendor_payment_id\+'\|'\+r\.accounting_book_id/);match(/v===0n/);match(/BigInt\(i\)\*scale/);});
test('application mirror uses common fields, preserving previous-side discount',()=>{match(/const a=mapped\.previousLinks\.map\(signature\)/);match(/const signature|function signature/);assert.doesNotMatch(src,/r\.discount.*r\.next_type/);});
test('source duplicate keys and decimal checked',()=>{match(/duplicate /);match(/validateNumeric\(v,\{module:'vendor-payment'/);});
test('stage count and duplicate guards in transactional script',()=>{match(/BEGIN TRANSACTION;/);match(/stage count/);match(/stage duplicate/);});
test('atomic checkpoint compare-and-swap',()=>{match(/last_successful_modified_at=DATETIME\(@oldCp\)/);match(/=5 AS 'checkpoint changed'/);});
test('atomic rollback on SQL exception',()=>match(/ROLLBACK TRANSACTION; RAISE;/));
test('idempotent MERGE keyed on null-safe composite equality',()=>{match(/IS NOT DISTINCT FROM/);match(/WHEN MATCHED THEN UPDATE SET/);match(/WHEN NOT MATCHED THEN INSERT/);});
test('stale detail deletion limited to active source headers',()=>{match(/const staleDetails=stages\.slice\(1\)/);match(/active\.is_deleted,FALSE/);match(/h\.vendor_payment_id=d\.vendor_payment_id/);assert.doesNotMatch(src,/DELETE FROM \$\{T\('vendor_payment_headers'\)\}/);});
test('source moving guard retries bounded and fails closed',()=>{match(/MAX_SOURCE_STABILITY_ATTEMPTS=3/);match(/SOURCE_MOVING_RETRY/);match(/must\(stable,'source continued changing/);});
test('snapshot value and watermark rechecked before commit',()=>{match(/again\.watermark===snapshot\.watermark/);match(/canonicalSnapshot\(again\.mapped\)===canonicalSnapshot\(snapshot\.mapped\)/);match(/beforeCommit\.watermark===watermark/);});
test('staging cleanup checks existence and throws on failures',()=>{match(/finally\s*\{/);match(/dataset\.table\(s\.name\)\.delete/);match(/dataset\.table\(s\.name\)\.exists/);match(/STAGING CLEANUP FAILED/);});
test('staging residue blocks before write',()=>match(/leftover module 12 staging exists/));
test('numeric scientific notation normalized without loss',()=>{assert.equal(validateNumeric('-1.30805267045E9',{module:'vendor-payment',field:'base_total'}),'-1308052670.45');assert.throws(()=>validateNumeric('0.1234567891',{module:'vendor-payment',field:'base_total'}));});
test('discount is a distinct previous-link schema dimension',()=>{const p=GROUPS.find(x=>x.table==='vendor_payment_previous_links');const n=GROUPS.find(x=>x.table==='vendor_payment_next_links');assert.ok(p.fields.some(([k])=>k==='discount'));assert.ok(!n.fields.some(([k])=>k==='discount'));});
// Deterministic state-machine exercises: contract simulation, never a live BigQuery test.
const primary=GROUPS[0];const pk=x=>primary.key.map(k=>String(x[k]??'<NULL>')).join('|');
function simulate(state,staged,{failAfterFirst=false}={}){
 const next=structuredClone(state);
 assert.equal(next.checkpoints.length,5);
 assert.ok(next.checkpoints.every(x=>x.watermark===state.expected));
 const keys=new Set(staged.map(pk));assert.equal(keys.size,staged.length,'duplicate staged keys');
 for(const [i,r] of staged.entries()){
  const idx=next.headers.findIndex(x=>pk(x)===pk(r));
  if(idx>=0){assert.equal(next.headers[idx].is_deleted,false,'deleted resurrection blocked');next.headers[idx]={...next.headers[idx],...r};}
  else next.headers.push({...r,is_deleted:false,deleted_at:null});
  if(failAfterFirst&&i===0)throw Error('INJECTED_PRE_COMMIT_FAILURE');
 }
 next.checkpoints=next.checkpoints.map(x=>({...x,watermark:'2026-10-29 11:29:40'}));return next;
}
const initial={headers:[{vendor_payment_id:'1',status_id:'A',posting:false,is_deleted:false,deleted_at:null}],checkpoints:names.map(record_type=>({record_type,watermark:'2026-10-29 11:20:40'})),expected:'2026-10-29 11:20:40'};
const changed=[{vendor_payment_id:'1',status_id:'F',posting:true},{vendor_payment_id:'2',status_id:'A',posting:false}];
test('SIMULATED status transition and create',()=>{const r=simulate(initial,changed);assert.equal(r.headers.length,2);assert.equal(r.headers[0].posting,true);});
test('SIMULATED rerun remains idempotent',()=>{const once=simulate(initial,changed);const twice=simulate({...once,expected:'2026-10-29 11:29:40'},changed);assert.deepEqual(twice.headers,once.headers);});
test('SIMULATED precommit failure leaves original state intact',()=>{const b=JSON.stringify(initial);assert.throws(()=>simulate(initial,changed,{failAfterFirst:true}),/INJECTED_PRE_COMMIT_FAILURE/);assert.equal(JSON.stringify(initial),b);});
test('SIMULATED duplicated staged key rejected',()=>assert.throws(()=>simulate(initial,[changed[0],changed[0]]),/duplicate staged keys/));
test('SIMULATED checkpoint conflict rejected',()=>{const conflict=structuredClone(initial);conflict.checkpoints[0].watermark='2026-10-29 11:21:00';assert.throws(()=>simulate(conflict,changed));});
test('SIMULATED deleted header resurrection rejected',()=>{const deleted=structuredClone(initial);deleted.headers[0].is_deleted=true;assert.throws(()=>simulate(deleted,changed),/deleted resurrection blocked/);});
console.log('MODULE 12 OFFLINE INCREMENTAL WRITER CONTRACT PASS',JSON.stringify({tests,mode:'OFFLINE_STATIC_AND_SIMULATION_NOT_LIVE_BIGQUERY',writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0,liveChangedSourceWriteProven:false}));
