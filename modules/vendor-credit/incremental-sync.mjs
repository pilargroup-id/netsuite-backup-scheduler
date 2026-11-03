// Module 11: standalone scoped incremental; no production scheduler integration.
// Atomic MERGE + active-document detail key replacement; never delete headers or soft-deleted history.
import {dataset,query,T,LOCATION} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource,FROM} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
import {sourceRows,storedRows,compareKeys,compareFields} from './reconcile-common.mjs';
import {validateNumeric} from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const mode=process.argv[2];
if(process.argv.length!==3||!['--dry-run','--sync'].includes(mode)) throw Error('Usage: node modules/vendor-credit/incremental-sync.mjs --dry-run | --sync');
const must=(condition,reason)=>{if(!condition)throw Error('MODULE 11 INCREMENTAL BLOCKED: '+reason);};
const val=x=>x&&typeof x==='object'&&'value' in x?x.value:x;
const ct=x=>Number(val(x));
const names=GROUPS.map(g=>g.table);
const cpQuoted=names.map(n=>`'${n}'`).join(',');
const scale=1000000000n;
function units(value){if(value==null)return 0n;const v=validateNumeric(value,{module:'vendor-credit',field:'gl'});must(/^-?\d+(?:\.\d{1,9})?$/.test(v),'noncanonical GL amount');const neg=v[0]==='-';const [i,f='']=v.replace('-','').split('.');const z=BigInt(i)*scale+BigInt(f.padEnd(9,'0'));return neg?-z:z;}
function signature(r){return JSON.stringify([r.vendor_credit_id,r.previous_doc_id,r.previous_line_id,r.next_doc_id,r.next_line_id,r.previous_type,r.next_type,r.link_type,r.relationship_class,r.applied_amount,r.last_modified]);}
async function checkpoint(){const rows=await query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark FROM ${T('sync_checkpoints')} WHERE record_type IN UNNEST(@names)`,{names});must(rows.length===5&&new Set(rows.map(r=>r.record_type)).size===5,'five checkpoints required');const s=new Set(rows.map(r=>r.watermark));must(s.size===1&&[...s][0],'divergent checkpoints');return [...s][0];}
async function checkSchema(){for(const g of GROUPS){const [exists]=await dataset.table(g.table).exists();must(exists,'missing target '+g.table);const [meta]=await dataset.table(g.table).getMetadata();const a=meta.schema?.fields??[],b=columnDefinitions(g);must(a.length===b.length,'schema field count '+g.table);for(const [name,type] of b){const f=a.find(x=>x.name.toLowerCase()===name.toLowerCase());must(f&&(f.type.toUpperCase()==='BOOLEAN'?'BOOL':f.type.toUpperCase())===type,'schema '+g.table+'.'+name);}}}
function assertRows(mapped){const headerIds=new Set(mapped.headers.map(r=>r.vendor_credit_id));must(headerIds.size===mapped.headers.length&&headerIds.size>0,'source headers empty/duplicate');const balances=new Map();for(const r of mapped.accountingLines){must(headerIds.has(r.vendor_credit_id),'orphan GL');must(r.posting,'nonposting GL');const k=r.vendor_credit_id+'|'+r.accounting_book_id;balances.set(k,(balances.get(k)??0n)+units(r.debit)-units(r.credit));}must(balances.size===headerIds.size,'missing GL groups');for(const [k,v] of balances)must(v===0n,'unbalanced GL '+k);const a=mapped.previousLinks.map(signature).sort(),b=mapped.nextLinks.map(signature).sort();must(a.length===b.length&&a.every((v,i)=>v===b[i]),'link mirror');for(const g of GROUPS){const rows=mapped[g.source];const keys=new Set();for(const r of rows){must(headerIds.has(r.vendor_credit_id),'orphan '+g.table);const k=JSON.stringify(g.key.map(f=>r[f]??null));must(!keys.has(k),'duplicate '+g.table+' '+k);keys.add(k);for(const [f,type] of g.fields){const v=r[f];if(v==null)continue;must(type==='BOOL'?typeof v==='boolean':typeof v==='string','field type '+g.table+'.'+f);if(type==='NUMERIC')must(validateNumeric(v,{module:'vendor-credit',recordId:r.vendor_credit_id,field:f})===v,'decimal '+f);}}}return {glGroups:balances.size,linkRows:a.length};}
async function sourceSnapshot(){const auth=await token();console.log('OAuth: SUCCESS');const h=await fetchHeaders(auth);const ids=h.map(x=>String(x.internal_id));must(ids.length===new Set(ids).size,'duplicate source ids');const [l,g,p,n]=await Promise.all([fetchLines(auth,ids),fetchGL(auth,ids),fetchPreviousLinks(auth,ids),fetchNextLinks(auth,ids)]);const mapped=mapSource(h,l,g,p,n);const stats=assertRows(mapped);const watermark=h.map(x=>x.last_modified).filter(Boolean).sort().at(-1);must(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(watermark??''),'invalid source watermark');return {mapped,stats,watermark};}
async function deletedIds(mapped){
 const rows=await query(`SELECT vendor_credit_id, is_deleted, deleted_at FROM ${T('vendor_credit_headers')} WHERE COALESCE(is_deleted,FALSE)=TRUE OR deleted_at IS NOT NULL`);
 const ids=new Set();
 for(const r of rows){
  must(r.is_deleted===true && r.deleted_at!=null,'inconsistent deletion marker '+r.vendor_credit_id);
  must(!ids.has(String(r.vendor_credit_id)),'duplicate deleted header '+r.vendor_credit_id);
  ids.add(String(r.vendor_credit_id));
 }
 for(const r of mapped.headers)must(!ids.has(r.vendor_credit_id),'verified-deleted record reappeared in source: '+r.vendor_credit_id+'; manual investigation required');
 return ids;
}
async function compare(mapped,deleted){
 let changed=false;
 for(const g of GROUPS){
  const a=sourceRows(mapped,g);
  const b=(await storedRows(g)).filter(r=>!deleted.has(String(r.vendor_credit_id)));
  const x=compareKeys(a,b,g);
  const f=compareFields(x.a,x.b,g);
  const report={table:g.table,source:a.length,targetActive:b.length,excludedVerifiedDeleted:deleted.size,missingInTarget:x.onlyNetSuite,missingInSource:x.onlyBigQuery,fieldMismatches:f.mismatches,samples:f.samples};
  console.log('COMPARE',JSON.stringify(report));
  // Missing headers are never inferred to be deleted: independent deletedrecord proof is mandatory.
  // Missing detail keys under an active source header can be normal line re-keying.
  // They are replaced atomically along with the fresh full document snapshot.
  if(g.table==='vendor_credit_headers')must(!x.onlyBigQuery,'target rows missing from source: '+g.table+'; deletion requires independent proof');
  if(x.onlyNetSuite||x.onlyBigQuery||f.mismatches)changed=true;
 }
 return changed;
}
async function stage(g,rows,suffix){const name=`_stage_vc_delta_${GROUPS.indexOf(g)}_${suffix}`;const file=path.join(os.tmpdir(),`vc-${crypto.randomUUID()}.ndjson`);if(rows.length){await fs.writeFile(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});try{await dataset.table(name).load(file,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:g.fields.map(([name,type])=>({name,type}))},location:LOCATION});}finally{await fs.rm(file,{force:true});}}else{await query(`CREATE TABLE ${T(name)} (${g.fields.map(([f,t])=>`\`${f}\` ${t}`).join(',')})`);}const [count]=await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);must(ct(count.n)===rows.length,'staging row mismatch '+g.table);return {g,name,rows};}
async function commit(stages,oldCp,newCp){
 const hStage=T(stages[0].name);
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
  const key=[`d.vendor_credit_id=s.vendor_credit_id`,...s.g.key.filter(f=>f!=='vendor_credit_id').map(f=>`d.\`${f}\` IS NOT DISTINCT FROM s.\`${f}\``)].join(' AND ');
  return `DELETE FROM ${T(s.g.table)} d WHERE EXISTS (SELECT 1 FROM ${hStage} h WHERE h.vendor_credit_id=d.vendor_credit_id) AND EXISTS (SELECT 1 FROM ${T('vendor_credit_headers')} active WHERE active.vendor_credit_id=d.vendor_credit_id AND COALESCE(active.is_deleted,FALSE)=FALSE AND active.deleted_at IS NULL) AND NOT EXISTS (SELECT 1 FROM ${T(s.name)} s WHERE ${key});`;
 }).join('\n');
 const postGuards=stages.map(s=>{
  const key=[`d.vendor_credit_id=s.vendor_credit_id`,...s.g.key.filter(f=>f!=='vendor_credit_id').map(f=>`d.\`${f}\` IS NOT DISTINCT FROM s.\`${f}\``)].join(' AND ');
  const activeScope=`EXISTS (SELECT 1 FROM ${hStage} h WHERE h.vendor_credit_id=d.vendor_credit_id)`;
  return `ASSERT (SELECT COUNT(*) FROM ${T(s.g.table)} d WHERE ${activeScope})=${s.rows.length} AS 'postcommit count ${s.g.table}';\nASSERT (SELECT COUNT(*) FROM ${T(s.name)} s WHERE NOT EXISTS (SELECT 1 FROM ${T(s.g.table)} d WHERE ${key}))=0 AS 'postcommit missing key ${s.g.table}';`;
 }).join('\n');
 const sql=`BEGIN\nBEGIN TRANSACTION;
${guards}
ASSERT (SELECT COUNT(*) FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpQuoted}) AND last_successful_modified_at=DATETIME(@oldCp))=5 AS 'checkpoint changed';
ASSERT (SELECT COUNT(*) FROM ${T('vendor_credit_headers')} d JOIN ${hStage} s ON d.vendor_credit_id=s.vendor_credit_id WHERE d.is_deleted OR d.deleted_at IS NOT NULL)=0 AS 'deleted header resurrection blocked';
ASSERT (SELECT COUNT(*) FROM ${T('vendor_credit_headers')} d WHERE COALESCE(d.is_deleted,FALSE)=FALSE AND d.deleted_at IS NULL AND d.transaction_date >= DATE(@from) AND NOT EXISTS (SELECT 1 FROM ${hStage} h WHERE h.vendor_credit_id=d.vendor_credit_id))=0 AS 'unverified missing header blocked';
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

async function main(){
 console.log('MODULE 11 SCOPED INCREMENTAL',mode,'SCOPE',FROM,'.. OPEN ENDED');
 const cp=await checkpoint();
 await checkSchema();
 let snapshot=await sourceSnapshot();
 let deleted=await deletedIds(snapshot.mapped);
 let stable=false;
 // A moving source is not a deletion. Retry only this new module, without writing.
 for(let attempt=1;attempt<=MAX_SOURCE_STABILITY_ATTEMPTS;attempt++){
  const changed=await compare(snapshot.mapped,deleted);
  const targetCheckpoint=snapshot.watermark>cp?snapshot.watermark:cp;
  console.log('PLAN',JSON.stringify({changed,checkpoint:cp,watermark:snapshot.watermark,targetCheckpoint,verifiedDeletedExcluded:deleted.size,counts:snapshot.mapped.counts,...snapshot.stats,scope:`${FROM}..open-ended`,schedulerChanges:0,deletionOperations:0,stabilityAttempt:attempt}));
  if(mode==='--dry-run'){console.log('PHASE B19 DRY RUN PASS: ZERO WRITES');return;}
  if(!changed){console.log('PHASE B19 PASS_NO_CHANGE: no writes; checkpoint unchanged');return;}
  must(await checkpoint()===cp,'checkpoint changed before staging');
  const again=await sourceSnapshot();
  const updatedDeleted=await deletedIds(again.mapped);
  must(updatedDeleted.size===deleted.size&&[...deleted].every(x=>updatedDeleted.has(x)),'verified deletion set changed before commit');
  if(again.watermark===snapshot.watermark && canonicalSnapshot(again.mapped)===canonicalSnapshot(snapshot.mapped)){
   stable=true;
   break;
  }
  console.log('SOURCE_MOVING_RETRY',JSON.stringify({attempt,maxAttempts:MAX_SOURCE_STABILITY_ATTEMPTS,oldWatermark:snapshot.watermark,newWatermark:again.watermark,writeOperations:0}));
  snapshot=again;
  deleted=updatedDeleted;
 }
 must(stable,'source continued changing during bounded validation; no writes, retry on next scheduled run');
 const {mapped,watermark}=snapshot;
 const newCp=watermark>cp?watermark:cp;
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);const stages=[];
 try{
  for(const g of GROUPS){stages.push(await stage(g,mapped[g.source],suffix));console.log('STAGED',g.table,mapped[g.source].length);}
  await commit(stages,cp,newCp);
  console.log('PHASE B19 ATOMIC COMMIT PASS',JSON.stringify({counts:mapped.counts,checkpoint:newCp,verifiedDeletedExcluded:deleted.size,schedulerChanges:0,deletionOperations:0}));
 }finally{
  for(const s of stages){try{await dataset.table(s.name).delete({ignoreNotFound:true});}catch(e){console.warn('STAGE CLEANUP WARNING',s.name,String(e));}}
 }
}
main().catch(e=>{console.error('PHASE B19 BLOCKED',e.stack??String(e));process.exitCode=1;});
