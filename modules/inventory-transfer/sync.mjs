// Module 14 Inventory Transfer initial backfill. Isolated staging + atomic BigQuery commit.
// Never changes scheduler or any pre-existing module record/checkpoint.
import {dataset,query,T,LOCATION} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,mapSource} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
import {validateNumeric} from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const assert=(ok,msg)=>{if(!ok)throw Error('MODULE 14 INITIAL BACKFILL BLOCKED: '+msg);};
const checkpointNames=GROUPS.map(g=>`'${g.table}'`).join(',');
const SCALE=1000000000n;
function units(x){assert(typeof x==='string'&&/^-?\d+(\.\d{1,9})?$/.test(x),'invalid quantity '+x);const neg=x[0]==='-';const [a,b='']=x.replace('-','').split('.');const n=BigInt(a)*SCALE+BigInt(b.padEnd(9,'0'));return neg?-n:n;}
function counts(rows){return rows.length;}
function checkMapped(mapped){
 const ids=new Set(mapped.headers.map(h=>h.internal_id));const keys=new Set(),main=new Map(),totals=new Map(),locs=new Map();
 let adj=0,positive=0,negative=0,zero=0;
 assert(ids.size===mapped.headers.length,'duplicate headers');
 for(const h of mapped.headers){assert(/^\d{4}-\d\d-\d\d$/.test(h.transaction_date),'bad date '+h.internal_id);assert(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(h.last_modified),'bad watermark '+h.internal_id);}
 for(const l of mapped.lines){
  assert(ids.has(l.transfer_internal_id),'orphan line '+l.transfer_internal_id);
  const pk=l.transfer_internal_id+'|'+l.line_unique_key;assert(!keys.has(pk),'duplicate line '+pk);keys.add(pk);
  if(l.is_mainline){main.set(l.transfer_internal_id,(main.get(l.transfer_internal_id)??0)+1);continue;}
  assert(l.item_id!==null&&l.location_id!==null,'missing item/location '+pk);
  if(l.quantity===null){
   assert(String(l.memo??'').trim().toLowerCase()==='cost of sales adjustment','unexpected NULL quantity '+pk);
   adj++;continue;
  }
  assert(validateNumeric(l.quantity,{module:'inventory-transfer',recordId:l.transfer_internal_id,field:'quantity'})===l.quantity,'noncanonical qty '+pk);
  const q=units(l.quantity);positive+=Number(q>0n);negative+=Number(q<0n);zero+=Number(q===0n);
  const group=l.transfer_internal_id+'|'+l.item_id;
  totals.set(group,(totals.get(group)??0n)+q);
  if(!locs.has(group))locs.set(group,new Set());locs.get(group).add(l.location_id);
 }
 assert(main.size===ids.size,'missing mainlines');for(const id of ids)assert(main.get(id)===1,'mainline count '+id);
 for(const [key,q] of totals){assert(q===0n,'unbalanced qty '+key);assert(locs.get(key).size>=2,'single-location item '+key);}
 for(const g of GROUPS){const rows=g===GROUPS[0]?mapped.headers:mapped.lines;const names=new Set(g.fields.map(([n])=>n));for(const r of rows){for(const [n,t] of g.fields){const v=r[n];if(g.key.includes(n))assert(v!=null&&v!=='','missing key '+g.table+'.'+n);if(v==null)continue;assert(t==='BOOL'?typeof v==='boolean':typeof v==='string','bad type '+g.table+'.'+n);}for(const n of Object.keys(r))assert(names.has(n),'unexpected payload field '+g.table+'.'+n);}}
 return {headers:counts(mapped.headers),lines:counts(mapped.lines),mainline:main.size,positive,negative,zero,nullQuantityAdjustment:adj,balancedItemGroups:totals.size};
}
async function emptyTargets(){
 const cp=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${checkpointNames})`);
 assert(cp.length===0,'module 14 checkpoint already exists');
 for(const g of GROUPS){
  const tb=dataset.table(g.table);const [exists]=await tb.exists();assert(exists,'missing target '+g.table);
  const [meta]=await tb.getMetadata();const expected=columnDefinitions(g),actual=meta.schema?.fields??[];
  assert(actual.length===expected.length,'schema column count '+g.table);
  for(const [name,type] of expected){const col=actual.find(c=>c.name.toLowerCase()===name.toLowerCase());assert(col&&String(col.type).toUpperCase().replace('BOOLEAN','BOOL')===type,'schema mismatch '+g.table+'.'+name);}
  const r=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);assert(Number(r[0].n)===0,'target not empty '+g.table);
 }
}
async function sourceSnapshot(){
 const access=await token();const headers=await fetchHeaders(access);assert(headers.length>0,'no source headers');
 const lines=await fetchLines(access,headers.map(h=>h.internal_id));const mapped=mapSource(headers,lines);
 const stats=checkMapped(mapped);
 const watermark=mapped.headers.map(h=>h.last_modified).sort().at(-1);
 return {mapped,stats,watermark};
}
function signature(rows){const hash=crypto.createHash('sha256');for(const s of rows.map(r=>JSON.stringify(Object.entries(r).sort(([a],[b])=>a.localeCompare(b)))).sort())hash.update(s+'\n');return hash.digest('hex');}
async function stage(g,rows,name){
 const filename=path.join(os.tmpdir(),`module14-${crypto.randomUUID()}.ndjson`);
 await fs.writeFile(filename,rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});
 try{await dataset.table(name).load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:g.fields.map(([n,t])=>({name:n,type:t}))},location:LOCATION});}
 finally{await fs.rm(filename,{force:true});}
 const [meta]=await dataset.table(name).getMetadata();assert((meta.schema?.fields?.length??0)===g.fields.length,'bad stage schema '+name);
 const r=await query(`SELECT COUNT(*) n FROM ${T(name)}`);assert(Number(r[0].n)===rows.length,'stage count mismatch '+name);
 console.log('STAGED',JSON.stringify({table:g.table,rows:rows.length}));
}
async function main(){
 assert(process.argv.length===3&&process.argv[2]==='--sync','requires exactly --sync');
 assert(process.env.NETSUITE_INVENTORY_TRANSFER_INITIAL_CONFIRM==='MODULE14_ONLY','requires NETSUITE_INVENTORY_TRANSFER_INITIAL_CONFIRM=MODULE14_ONLY');
 console.log('MODULE 14 INVENTORY TRANSFER INITIAL BACKFILL | ISOLATED STAGING + ATOMIC COMMIT');
 await emptyTargets();console.log('TARGET + CHECKPOINT GATE PASS');
 const first=await sourceSnapshot();console.log('SOURCE VALIDATION PASS',JSON.stringify({...first.stats,watermark:first.watermark}));
 await emptyTargets();
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);
 const stages=GROUPS.map((g,i)=>({g,name:`_stage_invtrnfr_${i}_${suffix}`,rows:i===0?first.mapped.headers:first.mapped.lines,created:false}));
 try{
  for(const stageItem of stages){stageItem.created=true;await stage(stageItem.g,stageItem.rows,stageItem.name);}
  const current=await sourceSnapshot();
  assert(current.watermark===first.watermark,'source watermark changed during staging');
  assert(JSON.stringify(current.stats)===JSON.stringify(first.stats),'source counts changed during staging');
  assert(signature(current.mapped.headers)===signature(first.mapped.headers),'source header changed during staging');
  assert(signature(current.mapped.lines)===signature(first.mapped.lines),'source line changed during staging');
  console.log('SOURCE STABILITY PASS',first.watermark);
  await emptyTargets();
  const sql=`BEGIN
BEGIN TRANSACTION;
ASSERT (SELECT COUNT(*) FROM ${T('sync_checkpoints')} WHERE record_type IN (${checkpointNames}))=0 AS 'Module 14 checkpoint already exists';
ASSERT (SELECT COUNT(*) FROM ${T('inventory_transfer_headers')})=0 AS 'Module 14 header target not empty';
ASSERT (SELECT COUNT(*) FROM ${T('inventory_transfer_lines')})=0 AS 'Module 14 line target not empty';
ASSERT (SELECT COUNT(*) FROM ${T(stages[0].name)})=${first.stats.headers} AS 'Header stage changed';
ASSERT (SELECT COUNT(*) FROM ${T(stages[1].name)})=${first.stats.lines} AS 'Line stage changed';
ASSERT (SELECT COUNT(*) FROM (SELECT internal_id FROM ${T(stages[0].name)} GROUP BY internal_id HAVING COUNT(*)>1))=0 AS 'Duplicate header stage';
ASSERT (SELECT COUNT(*) FROM (SELECT transfer_internal_id,line_unique_key FROM ${T(stages[1].name)} GROUP BY transfer_internal_id,line_unique_key HAVING COUNT(*)>1))=0 AS 'Duplicate line stage';
INSERT INTO ${T('inventory_transfer_headers')} (${GROUPS[0].fields.map(([c])=>'`'+c+'`').join(',')},synced_at,is_deleted,deleted_at)
SELECT ${GROUPS[0].fields.map(([c])=>'`'+c+'`').join(',')},CURRENT_TIMESTAMP(),FALSE,NULL FROM ${T(stages[0].name)};
INSERT INTO ${T('inventory_transfer_lines')} (${GROUPS[1].fields.map(([c])=>'`'+c+'`').join(',')},synced_at)
SELECT ${GROUPS[1].fields.map(([c])=>'`'+c+'`').join(',')},CURRENT_TIMESTAMP() FROM ${T(stages[1].name)};
ASSERT (SELECT COUNT(*) FROM ${T('inventory_transfer_lines')} l LEFT JOIN ${T('inventory_transfer_headers')} h ON l.transfer_internal_id=h.internal_id WHERE h.internal_id IS NULL)=0 AS 'Orphan line after insert';
MERGE ${T('sync_checkpoints')} d USING (SELECT record_type FROM UNNEST([${checkpointNames}]) record_type) s ON d.record_type=s.record_type
WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());
COMMIT TRANSACTION;
EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
END;`;
  // Retry ONLY BigQuery transaction conflicts on shared sync_checkpoints.
  // A failed transaction is rolled back; never replay after an ambiguous outcome
  // or if Module 14 target/checkpoint state has changed.
  const maxAttempts=6;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
   await emptyTargets();
   try{
    await query(sql,{wm:first.watermark});
    break;
   }catch(err){
    const message=String(err?.message??err);
    const isCheckpointConflict=/transaction is aborted due to concurrent update against table/i.test(message)
      && /netsuite_backup[.:]sync_checkpoints/i.test(message);
    if(!isCheckpointConflict || attempt===maxAttempts)throw err;
    // The only retriable failure is a server-confirmed transaction abort.
    // Validate no partial Module 14 commit before retrying.
    await emptyTargets();
    const delayMs=Math.min(30000,2000*2**(attempt-1));
    console.warn('MODULE 14 CHECKPOINT CONFLICT - RETRY',JSON.stringify({attempt,maxAttempts,delayMs,otherModulesChanged:false}));
    await new Promise(resolve=>setTimeout(resolve,delayMs));
   }
  }
  console.log('MODULE 14 INITIAL BACKFILL COMMIT PASS' ,JSON.stringify({status:'COMMITTED',...first.stats,watermark:first.watermark,checkpointRows:2,schedulerChanges:0,otherModuleWrites:0}));
 }finally{
  for(const st of stages){if(st.created){try{await dataset.table(st.name).delete({ignoreNotFound:true});}catch(e){console.warn('STAGING CLEANUP WARNING',st.name,e.message);}}}
 }
}
main().catch(e=>{console.error('MODULE 14 INITIAL BACKFILL BLOCKED',e.stack??e.message);process.exitCode=1;});
