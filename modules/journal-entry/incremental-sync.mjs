// Module 13: standalone scoped incremental; no production scheduler integration.
// Atomic MERGE + active-document detail key replacement; never delete headers or soft-deleted history.
import {dataset,query,T,LOCATION,DATASET} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
import {sourceRows,storedRows,compareKeys,compareFields} from './reconcile-common.mjs';
import {validateNumeric} from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import {fileURLToPath} from 'node:url';
import {fetchAll} from '../../common/netsuite-client.mjs';
import {matchDeletedRecordProof} from '../../common/verified-deletion-proof.mjs';

const FROM='2026-10-01';
const mode=process.argv[2];
if(process.argv.length!==3||!['--dry-run','--sync'].includes(mode)) throw Error('Usage: node modules/journal-entry/incremental-sync.mjs --dry-run | --sync');
if(mode==='--sync' && process.env.NETSUITE_JOURNAL_ENTRY_INCREMENTAL_CONFIRM!=='MODULE13_ONLY') throw Error('Set NETSUITE_JOURNAL_ENTRY_INCREMENTAL_CONFIRM=MODULE13_ONLY for isolated incremental sync');
const must=(condition,reason)=>{if(!condition)throw Error('MODULE 13 INCREMENTAL BLOCKED: '+reason);};
const val=x=>x&&typeof x==='object'&&'value' in x?x.value:x;
const ct=x=>Number(val(x));
const names=GROUPS.map(g=>g.table);
const cpQuoted=names.map(n=>`'${n}'`).join(',');
const scale=1000000000n;
function units(value){if(value==null)return 0n;const v=validateNumeric(value,{module:'journal-entry',field:'gl'});must(/^-?\d+(?:\.\d{1,9})?$/.test(v),'noncanonical GL amount');const neg=v[0]==='-';const [i,f='']=v.replace('-','').split('.');const z=BigInt(i)*scale+BigInt(f.padEnd(9,'0'));return neg?-z:z;}
function signature(r){return JSON.stringify([r.journal_entry_id,r.previous_doc_id,r.previous_line_id,r.next_doc_id,r.next_line_id,r.previous_type,r.next_type,r.link_type,r.applied_amount,r.last_modified]);}
async function checkpoint(){const rows=await query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark FROM ${T('sync_checkpoints')} WHERE record_type IN UNNEST(@names)`,{names});must(rows.length===5&&new Set(rows.map(r=>r.record_type)).size===5,'five checkpoints required');const s=new Set(rows.map(r=>r.watermark));must(s.size===1&&[...s][0],'divergent checkpoints');return [...s][0];}
async function checkSchema(){for(const g of GROUPS){const [exists]=await dataset.table(g.table).exists();must(exists,'missing target '+g.table);const [meta]=await dataset.table(g.table).getMetadata();const a=meta.schema?.fields??[],b=columnDefinitions(g);must(a.length===b.length,'schema field count '+g.table);for(const [name,type] of b){const f=a.find(x=>x.name.toLowerCase()===name.toLowerCase());must(f&&(f.type.toUpperCase()==='BOOLEAN'?'BOOL':f.type.toUpperCase())===type,'schema '+g.table+'.'+name);}}}
function assertRows(mapped){const headers=new Map(mapped.headers.map(r=>[r.journal_entry_id,r]));const headerIds=new Set(headers.keys());must(headerIds.size===mapped.headers.length&&headerIds.size>0,'source headers empty/duplicate');const balances=new Map();for(const r of mapped.accountingLines){must(headerIds.has(r.journal_entry_id),'orphan GL');must(r.posting===headers.get(r.journal_entry_id)?.posting,'GL posting mismatch '+r.journal_entry_id);const k=r.journal_entry_id+'|'+r.accounting_book_id;balances.set(k,(balances.get(k)??0n)+units(r.debit)-units(r.credit));}must(balances.size===headerIds.size,'missing GL groups');for(const [k,v] of balances)must(v===0n,'unbalanced GL '+k);const a=mapped.previousLinks.map(signature).sort(),b=mapped.nextLinks.map(signature).sort();must(a.length===b.length&&a.every((v,i)=>v===b[i]),'link mirror');for(const g of GROUPS){const rows=mapped[g.source];const keys=new Set();for(const r of rows){must(headerIds.has(r.journal_entry_id),'orphan '+g.table);const k=JSON.stringify(g.key.map(f=>r[f]??null));must(!keys.has(k),'duplicate '+g.table+' '+k);keys.add(k);for(const [f,type] of g.fields){const v=r[f];if(v==null)continue;must(type==='BOOL'?typeof v==='boolean':typeof v==='string','field type '+g.table+'.'+f);if(type==='NUMERIC')must(validateNumeric(v,{module:'journal-entry',recordId:r.journal_entry_id,field:f})===v,'decimal '+f);}}}return {glGroups:balances.size,linkRows:a.length};}
async function sourceSnapshot(){const auth=await token();console.log('OAuth: SUCCESS');const h=await fetchHeaders(auth);const ids=h.map(x=>String(x.internal_id));must(ids.length===new Set(ids).size,'duplicate source ids');const [l,g,p,n]=await Promise.all([fetchLines(auth,ids),fetchGL(auth,ids),fetchPreviousLinks(auth,ids),fetchNextLinks(auth,ids)]);const mapped=mapSource(h,l,g,p,n);const stats=assertRows(mapped);const watermark=h.map(x=>x.last_modified).filter(Boolean).sort().at(-1);must(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(watermark??''),'invalid source watermark');return {mapped,stats,watermark};}
async function deletedIds(mapped){
 const rows=await query(`SELECT journal_entry_id, is_deleted, deleted_at FROM ${T('journal_entry_headers')} WHERE COALESCE(is_deleted,FALSE)=TRUE OR deleted_at IS NOT NULL`);
 const ids=new Set();
 for(const r of rows){
  must(r.is_deleted===true && r.deleted_at!=null,'inconsistent deletion marker '+r.journal_entry_id);
  must(!ids.has(String(r.journal_entry_id)),'duplicate deleted header '+r.journal_entry_id);
  ids.add(String(r.journal_entry_id));
 }
 for(const r of mapped.headers)must(!ids.has(r.journal_entry_id),'verified-deleted record reappeared in source: '+r.journal_entry_id+'; manual investigation required');
 return ids;
}
// Module 13 only: coordinate independently verified soft delete with the delta
// in ONE atomic BigQuery transaction, solving the new-versus-deleted deadlock.
const DELETION_LIMIT=3;
const certifiedPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'deletion-identity.confirmed.json');
function deletionIdentity(){
 must(fsSync.existsSync(certifiedPath),'missing certified journalentry deletion identity');
 const c=JSON.parse(fsSync.readFileSync(certifiedPath,'utf8'));
 must(c.module==='journal-entry'&&c.transactionType==='Journal'&&c.recordtypeid==='journalentry'&&c.type==='JOURNALENTRY'&&c.scope===`${FROM}..open-ended`&&c.independentlyVerified===true,'uncertified tuple');
 must(Array.isArray(c.evidenceRecordIds)&&c.evidenceRecordIds.length===3&&new Set(c.evidenceRecordIds).size===3&&c.evidenceRecordIds.every(x=>/^[1-9][0-9]{0,14}$/.test(String(x))),'invalid historical evidence');
 return c;
}
async function deletionCandidates(mapped){
 const source=new Set(mapped.headers.map(h=>h.journal_entry_id));
 const stored=await query(`SELECT journal_entry_id,CAST(transaction_date AS STRING) AS transaction_date,is_deleted,deleted_at FROM ${T('journal_entry_headers')} WHERE transaction_date>=DATE(@from) AND COALESCE(is_deleted,FALSE)=FALSE AND deleted_at IS NULL`,{from:FROM});
 const ids=stored.filter(r=>!source.has(String(r.journal_entry_id))).map(r=>String(r.journal_entry_id)).sort();
 must(ids.length<=DELETION_LIMIT,'deletion candidates exceed MAX=3; refuse partial operation');
 must(new Set(ids).size===ids.length,'duplicate deletion candidates');
 const identity=deletionIdentity();
 if(ids.length===0)return {ids,proofs:[]};
 const access=await token();
 for(const hist of identity.evidenceRecordIds){
  const id=String(hist);const proofs=await fetchAll(access,`SELECT recordid,recordtypeid,type,deleteddate,deletedby,context FROM deletedrecord WHERE recordid=${id}`);
  must(matchDeletedRecordProof(proofs,id,identity).length===1,'historical identity proof changed '+id);
  const live=await fetchAll(access,`SELECT id,type FROM Transaction WHERE id=${id}`);
  must(live.length===0,'historical identity now visible '+id);
 }
 const proofs=[];
 for(const id of ids){
  must(/^[1-9][0-9]{0,14}$/.test(id),'invalid candidate id');
  const rows=await fetchAll(access,`SELECT recordid,recordtypeid,type,deleteddate,deletedby,context FROM deletedrecord WHERE recordid=${id}`);
  const exact=matchDeletedRecordProof(rows,id,identity);
  must(exact.length===1,'missing/nonunique deletion proof '+id);
  const visible=await fetchAll(access,`SELECT id,type FROM Transaction WHERE id=${id}`);
  must(visible.length===0,'candidate visible globally '+id);
  const target=stored.filter(x=>String(x.journal_entry_id)===id);
  must(target.length===1&&target[0].transaction_date>=FROM&&target[0].is_deleted===false&&target[0].deleted_at==null,'candidate BQ header mismatch '+id);
  proofs.push(exact[0]);
 }
 console.log('VERIFIED_DELETION_CANDIDATES',JSON.stringify({ids,proofCount:proofs.length,maximum:DELETION_LIMIT,writeOperations:0}));
 return {ids,proofs};
}
function equalCandidateIds(a,b){return JSON.stringify(a.ids)===JSON.stringify(b.ids);}
function deletionAudit(proofs){
 if(!proofs.length)return;
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const dir=path.join(root,'logs','verified-deletions');fsSync.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'audit.jsonl');
 for(const row of proofs){fsSync.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),module:'journal-entry',id:String(row.recordid),recordtypeid:row.recordtypeid,type:row.type,deleteddate:row.deleteddate,deletedby:row.deletedby,result:'SOFT_DELETED_ATOMIC_WITH_INCREMENTAL'})+'\n');}
}
async function compare(mapped,deleted,candidates){
 let changed=false;
 for(const g of GROUPS){
  const a=sourceRows(mapped,g);
  const b=(await storedRows(g)).filter(r=>!deleted.has(String(r.journal_entry_id)));
  const x=compareKeys(a,b,g);
  const f=compareFields(x.a,x.b,g);
  const report={table:g.table,source:a.length,targetActive:b.length,excludedVerifiedDeleted:deleted.size,missingInTarget:x.onlyNetSuite,missingInSource:x.onlyBigQuery,fieldMismatches:f.mismatches,samples:f.samples};
  console.log('COMPARE',JSON.stringify(report));
  // Missing headers are never inferred to be deleted: independent deletedrecord proof is mandatory.
  // Missing detail keys under an active source header can be normal line re-keying.
  // They are replaced atomically along with the fresh full document snapshot.
  if(g.table==='journal_entry_headers')must(x.onlyBigQuery===candidates.ids.length,'unverified missing header count; deletion requires independent proof');
  if(x.onlyNetSuite||x.onlyBigQuery||f.mismatches)changed=true;
 }
 return changed;
}
async function stage(g,rows,suffix){const name=`_stage_je_delta_${GROUPS.indexOf(g)}_${suffix}`;const file=path.join(os.tmpdir(),`je-${crypto.randomUUID()}.ndjson`);if(rows.length){await fs.writeFile(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});try{await dataset.table(name).load(file,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:g.fields.map(([name,type])=>({name,type}))},location:LOCATION});}finally{await fs.rm(file,{force:true});}}else{await query(`CREATE TABLE ${T(name)} (${g.fields.map(([f,t])=>`\`${f}\` ${t}`).join(',')})`);}const [count]=await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);must(ct(count.n)===rows.length,'staging row mismatch '+g.table);return {g,name,rows};}
async function commit(stages,oldCp,newCp,candidates){
 const hStage=T(stages[0].name);
 const deletionList=candidates.ids.map(x=>`'${x}'`).join(',');
 const delGuard=candidates.ids.length?`ASSERT (SELECT COUNT(*) FROM ${T('journal_entry_headers')} WHERE journal_entry_id IN (${deletionList}) AND transaction_date>=DATE(@from) AND COALESCE(is_deleted,FALSE)=FALSE AND deleted_at IS NULL)=${candidates.ids.length} AS 'verified deletion targets changed';\nUPDATE ${T('journal_entry_headers')} SET is_deleted=TRUE,deleted_at=CURRENT_TIMESTAMP() WHERE journal_entry_id IN (${deletionList}) AND transaction_date>=DATE(@from) AND COALESCE(is_deleted,FALSE)=FALSE AND deleted_at IS NULL;\nASSERT (SELECT COUNT(*) FROM ${T('journal_entry_headers')} WHERE journal_entry_id IN (${deletionList}) AND is_deleted=TRUE AND deleted_at IS NOT NULL)=${candidates.ids.length} AS 'atomic verified soft delete failed';`:'';
 const guards=stages.map(s=>`ASSERT (SELECT COUNT(*) FROM ${T(s.name)})=${s.rows.length} AS 'stage count ${s.g.table}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${s.g.key.map(k=>`\`${k}\``).join(',')} FROM ${T(s.name)} GROUP BY ${s.g.key.map(k=>`\`${k}\``).join(',')} HAVING COUNT(*)>1))=0 AS 'stage duplicate ${s.g.table}';`).join('\n');
 const updates=stages.map((s,i)=>{
  const fields=s.g.fields.map(([f])=>f);
  const key=s.g.key.map(f=>`d.\`${f}\` IS NOT DISTINCT FROM s.\`${f}\``).join(' AND ');
  const nonkeys=fields.filter(f=>!s.g.key.includes(f));
  const assignments=nonkeys.map(f=>`d.\`${f}\`=s.\`${f}\``).concat(['d.synced_at=CURRENT_TIMESTAMP()']).join(',');
  const dest=fields.map(f=>`\`${f}\``).concat(i===0?['synced_at','is_deleted','deleted_at']:['synced_at']);
  const vals=fields.map(f=>`s.\`${f}\``).concat(i===0?['CURRENT_TIMESTAMP()','FALSE','NULL']:['CURRENT_TIMESTAMP()']);
  return `MERGE ${T(s.g.table)} d USING ${T(s.name)} s ON ${key} WHEN MATCHED THEN UPDATE SET ${assignments} WHEN NOT MATCHED THEN INSERT (${dest.join(',')}) VALUES (${vals.join(',')});`;
 }).join('\n');
 // Only obsolete DETAIL keys of headers still present and active in the source snapshot.
 // Never touch historical children of soft-deleted headers; never delete a header.
 const staleDetails=stages.slice(1).map(s=>{
  const key=[`d.journal_entry_id=s.journal_entry_id`,...s.g.key.filter(f=>f!=='journal_entry_id').map(f=>`d.\`${f}\` IS NOT DISTINCT FROM s.\`${f}\``)].join(' AND ');
  return `DELETE FROM ${T(s.g.table)} d WHERE EXISTS (SELECT 1 FROM ${hStage} h WHERE h.journal_entry_id=d.journal_entry_id) AND EXISTS (SELECT 1 FROM ${T('journal_entry_headers')} active WHERE active.journal_entry_id=d.journal_entry_id AND COALESCE(active.is_deleted,FALSE)=FALSE AND active.deleted_at IS NULL) AND NOT EXISTS (SELECT 1 FROM ${T(s.name)} s WHERE ${key});`;
 }).join('\n');
 const postGuards=stages.map(s=>{
  const key=[`d.journal_entry_id=s.journal_entry_id`,...s.g.key.filter(f=>f!=='journal_entry_id').map(f=>`d.\`${f}\` IS NOT DISTINCT FROM s.\`${f}\``)].join(' AND ');
  const activeScope=`EXISTS (SELECT 1 FROM ${hStage} h WHERE h.journal_entry_id=d.journal_entry_id)`;
  return `ASSERT (SELECT COUNT(*) FROM ${T(s.g.table)} d WHERE ${activeScope})=${s.rows.length} AS 'postcommit count ${s.g.table}';\nASSERT (SELECT COUNT(*) FROM ${T(s.name)} s WHERE NOT EXISTS (SELECT 1 FROM ${T(s.g.table)} d WHERE ${key}))=0 AS 'postcommit missing key ${s.g.table}';`;
 }).join('\n');
 const sql=`BEGIN\nBEGIN TRANSACTION;
${guards}
${delGuard}
ASSERT (SELECT COUNT(*) FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpQuoted}) AND last_successful_modified_at=DATETIME(@oldCp))=5 AS 'checkpoint changed';
ASSERT (SELECT COUNT(*) FROM ${T('journal_entry_headers')} d JOIN ${hStage} s ON d.journal_entry_id=s.journal_entry_id WHERE d.is_deleted OR d.deleted_at IS NOT NULL)=0 AS 'deleted header resurrection blocked';
ASSERT (SELECT COUNT(*) FROM ${T('journal_entry_headers')} d WHERE COALESCE(d.is_deleted,FALSE)=FALSE AND d.deleted_at IS NULL AND d.transaction_date >= DATE(@from) AND NOT EXISTS (SELECT 1 FROM ${hStage} h WHERE h.journal_entry_id=d.journal_entry_id))=0 AS 'unverified missing header blocked';
${staleDetails}
${updates}
${postGuards}
UPDATE ${T('sync_checkpoints')} SET last_successful_modified_at=DATETIME(@newCp),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP() WHERE record_type IN (${cpQuoted});
COMMIT TRANSACTION;
EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
END;`;
 await query(sql,{oldCp,newCp,from:FROM});
}

// Ignore harmless NetSuite API row ordering, but never ignore changed values or keys.
function canonicalSnapshot(mapped){
 return JSON.stringify(GROUPS.map(g=>{
  const rows=mapped[g.source].map(r=>JSON.stringify(g.fields.map(([f])=>r[f]??null)));
  rows.sort();
  return [g.table,rows];
 }));
}
const MAX_SOURCE_STABILITY_ATTEMPTS=3;
// BigQuery DML concurrency is table-level: production may update other checkpoint rows.
// Retry ONLY a confirmed aborted transaction, with unchanged Module 13 checkpoint and source.
const MAX_CHECKPOINT_CONFLICT_ATTEMPTS=3;
// Module 13 only: bounded delay gives the production checkpoint writer time to finish.
const CHECKPOINT_CONFLICT_RETRY_DELAYS_MS=[5000,10000];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function isCheckpointConcurrencyAbort(e){
 const msg=String(e?.message??e);
 return /transaction is aborted due to concurrent update against table/i.test(msg)
  && /(?:^|[.:`\s])sync_checkpoints(?:[.`\s]|$)/i.test(msg);
}
async function commitWithCheckpointConflictGuard(stages,cp,newCp,mapped,watermark,verifiedDeleted,candidates){
 for(let attempt=1;attempt<=MAX_CHECKPOINT_CONFLICT_ATTEMPTS;attempt++){
  must(await checkpoint()===cp,'checkpoint moved before commit attempt '+attempt);
  if(attempt>1){
   // Staging is immutable and belongs only to this run. Never retry stale source.
   const now=await sourceSnapshot();
   must(now.watermark===watermark && canonicalSnapshot(now.mapped)===canonicalSnapshot(mapped),
     'source changed after aborted transaction; retry refused');
   const deleted=await deletedIds(now.mapped);
   const freshCandidates=await deletionCandidates(now.mapped);
   must(equalCandidateIds(freshCandidates,candidates),'deletion candidate identity changed during checkpoint retry');
   must(deleted.size===verifiedDeleted.size && [...verifiedDeleted].every(id=>deleted.has(id)),
     'verified deletion state changed after aborted transaction; retry refused');
  }
  try{
   await commit(stages,cp,newCp,candidates);
   console.log('MODULE 13 COMMIT ATTEMPT PASS',JSON.stringify({attempt,maxAttempts:MAX_CHECKPOINT_CONFLICT_ATTEMPTS}));
   return;
  }catch(e){
   if(!isCheckpointConcurrencyAbort(e))throw e;
   console.error('MODULE 13 CHECKPOINT TRANSACTION CONFLICT',JSON.stringify({attempt,maxAttempts:MAX_CHECKPOINT_CONFLICT_ATTEMPTS,checkpoint:cp,action:attempt===MAX_CHECKPOINT_CONFLICT_ATTEMPTS?'BLOCK':'REVALIDATE_AND_RETRY'}));
   if(attempt===MAX_CHECKPOINT_CONFLICT_ATTEMPTS)throw Error('MODULE 13 INCREMENTAL BLOCKED: checkpoint concurrency retry exhausted; original: '+String(e?.message??e));
   const delayMs=CHECKPOINT_CONFLICT_RETRY_DELAYS_MS[attempt-1];
   console.log('MODULE 13 CHECKPOINT RETRY BACKOFF',JSON.stringify({attempt,nextAttempt:attempt+1,delayMs}));
   await pause(delayMs);
  }
 }
}

async function main(){
 console.log('MODULE 13 SCOPED INCREMENTAL',mode,'SCOPE',FROM,'.. OPEN ENDED');
 const cp=await checkpoint();
 await checkSchema();
 const lingering=await query(`SELECT table_name FROM \`${DATASET}.INFORMATION_SCHEMA.TABLES\` WHERE STARTS_WITH(table_name, '_stage_je_')`);must(!lingering.length,'leftover module 13 staging exists; investigate before retry');
 let snapshot=await sourceSnapshot();
 let deleted=await deletedIds(snapshot.mapped);
 let candidates=await deletionCandidates(snapshot.mapped);
 let stable=false;
 // A moving source is not a deletion. Retry only this new module, without writing.
 for(let attempt=1;attempt<=MAX_SOURCE_STABILITY_ATTEMPTS;attempt++){
  const changed=await compare(snapshot.mapped,deleted,candidates);
  must(snapshot.watermark>=cp,'source watermark behind checkpoint; requires investigation');
  const targetCheckpoint=snapshot.watermark>cp?snapshot.watermark:cp;
  console.log('PLAN',JSON.stringify({changed,checkpoint:cp,watermark:snapshot.watermark,targetCheckpoint,verifiedDeletedExcluded:deleted.size,verifiedDeleteCandidates:candidates.ids,counts:snapshot.mapped.counts,...snapshot.stats,scope:`${FROM}..open-ended`,schedulerChanges:0,deletionOperations:0,stabilityAttempt:attempt}));
  if(mode==='--dry-run'){console.log('MODULE 13 INCREMENTAL DRY RUN PASS: ZERO WRITES');return;}
  if(!changed){console.log('MODULE 13 INCREMENTAL PASS_NO_CHANGE: no writes; checkpoint unchanged');return;}
  must(await checkpoint()===cp,'checkpoint changed before staging');
  const again=await sourceSnapshot();
  const updatedDeleted=await deletedIds(again.mapped);
  const updatedCandidates=await deletionCandidates(again.mapped);
  must(equalCandidateIds(updatedCandidates,candidates),'deletion candidate list moved before staging');
  must(updatedDeleted.size===deleted.size&&[...deleted].every(x=>updatedDeleted.has(x)),'verified deletion set changed before commit');
  if(again.watermark===snapshot.watermark && canonicalSnapshot(again.mapped)===canonicalSnapshot(snapshot.mapped)){
   stable=true;
   break;
  }
  console.log('SOURCE_MOVING_RETRY',JSON.stringify({attempt,maxAttempts:MAX_SOURCE_STABILITY_ATTEMPTS,oldWatermark:snapshot.watermark,newWatermark:again.watermark,writeOperations:0}));
  snapshot=again;
  deleted=updatedDeleted;
  candidates=updatedCandidates;
 }
 must(stable,'source continued changing during bounded validation; no writes, retry on next scheduled run');
 const {mapped,watermark}=snapshot;
 const newCp=watermark>cp?watermark:cp;
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);const stages=[];
 try{
  for(const g of GROUPS){const name=`_stage_je_delta_${GROUPS.indexOf(g)}_${suffix}`;stages.push({g,name,rows:mapped[g.source]});await stage(g,mapped[g.source],suffix);console.log('STAGED',g.table,mapped[g.source].length);}
  must(await checkpoint()===cp,'checkpoint moved during staging');
  const beforeCommit=await sourceSnapshot();must(beforeCommit.watermark===watermark && canonicalSnapshot(beforeCommit.mapped)===canonicalSnapshot(mapped),'source changed during staging; abort before commit');
  const preCommitCandidates=await deletionCandidates(beforeCommit.mapped);
  must(equalCandidateIds(preCommitCandidates,candidates),'candidate deletion proof changed before commit');
  if(candidates.ids.length)must(process.env.NETSUITE_JOURNAL_ENTRY_DELETE_CONFIRM==='MODULE13_VERIFIED_HEADER_ONLY'&&process.env.NETSUITE_VERIFIED_DELETE_CONFIRM==='I_CONFIRM_VERIFIED_SOFT_DELETE','explicit verified deletion confirmations required');
  await commitWithCheckpointConflictGuard(stages,cp,newCp,mapped,watermark,deleted,candidates);
  deletionAudit(candidates.proofs);
  console.log('MODULE 13 INCREMENTAL ATOMIC COMMIT PASS',JSON.stringify({counts:mapped.counts,checkpoint:newCp,verifiedDeletedExcluded:deleted.size,schedulerChanges:0,deletionOperations:candidates.ids.length}));
 }finally{
  const failures=[];for(const s of stages){try{await dataset.table(s.name).delete({ignoreNotFound:true});const [exists]=await dataset.table(s.name).exists();if(exists)failures.push(s.name+': still exists');}catch(e){failures.push(s.name+': '+String(e));}}if(failures.length)throw Error('MODULE 13 STAGING CLEANUP FAILED: '+failures.join('; '));
 }
}
main().catch(e=>{console.error('MODULE 13 INCREMENTAL BLOCKED',e.stack??String(e));process.exitCode=1;});
