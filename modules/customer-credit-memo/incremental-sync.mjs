// Module 10 ONLY: standalone CustCred delta; no legacy module/scheduler modifications.
// --dry-run is read-only. --sync commits module rows + module checkpoint via one BQ transaction.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dataset,query,T,LOCATION,DATASET} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
import {sourceRows,storedRows,compareKeys,compareFields} from './reconcile-common.mjs';
import {validateNumeric,validateBigNumeric} from '../../common/decimal-precision.mjs';

const mode=process.argv[2];
if(process.argv.length!==3||!['--dry-run','--sync','--repair-audit'].includes(mode))throw Error('Usage: node modules/customer-credit-memo/incremental-sync.mjs --dry-run|--sync|--repair-audit');
const MODULE='customer-credit-memo';
const TABLES=GROUPS.map(g=>g.table);
const CP_TBL=T('sync_checkpoints');
const RETRIES=5;
const MAX_REPAIR_DOCUMENTS=10;
const DELAYS=[1500,3000,6000,12000];
const fail=message=>{throw Error('MODULE 10 INCREMENTAL BLOCKED: '+message);};
const val=x=>typeof x==='object'&&x!==null&&'value' in x?x.value:x;
const num=x=>Number(val(x));
const isConflict=e=>/transaction is aborted due to concurrent update against table/i.test(String(e?.message??e))&&/sync_checkpoints/i.test(String(e?.message??e));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function minusFiveMinutes(s){
 if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s))fail('Invalid checkpoint '+s);
 const ms=Date.parse(s.replace(' ','T')+'Z');if(!Number.isFinite(ms))fail('Invalid checkpoint date');
 return new Date(ms-300000).toISOString().slice(0,19).replace('T',' ');
}
async function checkpoint(){
 const rows=await query(`SELECT record_type, FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark FROM ${CP_TBL} WHERE record_type IN UNNEST(@tables)`,{tables:TABLES});
 if(rows.length!==TABLES.length||new Set(rows.map(r=>r.record_type)).size!==TABLES.length)fail('Missing or duplicate module checkpoints');
 const versions=[...new Set(rows.map(r=>r.watermark))];
 if(versions.length!==1||!versions[0])fail('Divergent/empty module checkpoint');
 return versions[0];
}
async function targetShape(){
 for(const g of GROUPS){
  const [exists]=await dataset.table(g.table).exists();if(!exists)fail('Missing target '+g.table);
  const [md]=await dataset.table(g.table).getMetadata();const fields=md.schema?.fields??[];const expected=columnDefinitions(g);
  if(fields.length!==expected.length)fail('Schema column count '+g.table);
  for(const [name,type] of expected){const f=fields.find(x=>x.name.toLowerCase()===name.toLowerCase());if(!f||(f.type.toUpperCase()==='BOOLEAN'?'BOOL':f.type.toUpperCase())!==type)fail('Schema mismatch '+g.table+'.'+name);}
 }
}
function checkVal(value,type,where){
 if(value==null)return;
 if(type==='STRING'&&typeof value==='string')return;
 if(type==='BOOL'&&typeof value==='boolean')return;
 if(type==='DATE'&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return;
 if(type==='DATETIME'&&typeof value==='string'&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value))return;
 if(type==='NUMERIC'&&typeof value==='string'&&validateNumeric(value,{module:MODULE,field:where})===value)return;
 if(type==='BIGNUMERIC'&&typeof value==='string'&&validateBigNumeric(value,{module:MODULE,field:where})===value)return;
 fail('Invalid '+type+' at '+where);
}
function validateGroup(group,rows,ids){
 const seen=new Set();
 rows.forEach((r,i)=>{
  if(!ids.has(String(r.credit_memo_id)))fail('Foreign credit memo in '+group.table);
  for(const [field,type] of group.fields)checkVal(r[field],type,group.table+'['+i+'].'+field);
  for(const field of group.key){if(!(group.nullableKey??[]).includes(field)&&(r[field]==null||r[field]===''))fail('Missing key '+group.table+'.'+field);}
  for(const field of Object.keys(r))if(!group.fields.some(([k])=>k===field))fail('Unexpected field '+group.table+'.'+field);
  const key=JSON.stringify(group.key.map(k=>r[k]??null));if(seen.has(key))fail('Duplicate key '+group.table+' '+key);seen.add(key);
 });
}
async function stage(name,rows,group){
 const table=dataset.table(name);
 if(!rows.length){await query(`CREATE TABLE ${T(name)} (${group.fields.map(([n,t])=>`${n} ${t}`).join(', ')})`);}
 else{
  const filename=path.join(os.tmpdir(),`ccm-delta-${crypto.randomUUID()}.ndjson`);
  await fs.writeFile(filename,rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});
  try{await table.load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:group.fields.map(([name,type])=>({name,type}))},location:LOCATION});}
  finally{await fs.rm(filename,{force:true});}
 }
 const count=await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);
 if(num(count[0].n)!==rows.length)fail('Staging count mismatch '+group.table);
}
async function main(){
 console.log('MODULE 10 CUSTOMER CREDIT MEMO B6 STANDALONE INCREMENTAL |',mode,'|',DATASET,'|',LOCATION);
 console.log('RULE: DO NOT TOUCH EXISTING MODULES, SCHEDULERS, OR THEIR CHECKPOINTS');
 await targetShape();const cp=await checkpoint(),since=minusFiveMinutes(cp);
 console.log('CHECKPOINT:',cp,'OVERLAP_SINCE:',since);
 const access=await token();console.log('OAuth: SUCCESS');
 let headers,ids,idSet,lines,gl,previous,next,mapped;
 if(mode==='--repair-audit'){
  // The audit is authoritative: do not widen the incremental checkpoint window.
  // Fail closed on inventory/key differences, duplicates, and excessive repair scope.
  const fullHeaders=await fetchHeaders(access);
  const fullIds=fullHeaders.map(h=>String(h.internal_id));
  if(fullIds.length!==new Set(fullIds).size)fail('Duplicate full source headers');
  const [allLines,allGL,allPrevious,allNext]=await Promise.all([
   fetchLines(access,fullIds),fetchGL(access,fullIds),fetchPreviousLinks(access,fullIds),fetchNextLinks(access,fullIds)
  ]);
  const fullMapped=mapSource(fullHeaders,allLines,allGL,allPrevious,allNext);
  const candidates=new Set();
  for(const g of GROUPS){
   const source=sourceRows(fullMapped,g),stored=await storedRows(g);
   const keys=compareKeys(source,stored,g);
   if(keys.onlyNetSuite||keys.onlyBigQuery||keys.source!==keys.bigquery)
    fail('REPAIR BLOCKED: inventory/key mismatch '+g.table+' sourceOnly='+keys.onlyNetSuite+' bqOnly='+keys.onlyBigQuery);
   const differences=compareFields(keys.a,keys.b,g,{maxExamples:50});
   for(const [key,sourceRow] of keys.a){
    const targetRow=keys.b.get(key);
    if(!targetRow)continue;
    if(compareFields(new Map([[key,sourceRow]]),new Map([[key,targetRow]]),g).mismatches)
     candidates.add(String(sourceRow.credit_memo_id));
   }
   console.log('REPAIR AUDIT',JSON.stringify({table:g.table,fieldMismatches:differences.mismatches}));
  }
  ids=[...candidates].sort((a,b)=>Number(a)-Number(b));
  console.log('REPAIR CANDIDATE IDS:',ids.join(',')||'NONE');
  if(!ids.length){console.log('CCM AUTO REPAIR NO_CHANGE: ZERO writes');return;}
  if(ids.length>MAX_REPAIR_DOCUMENTS)fail('REPAIR BLOCKED: affected documents '+ids.length+' exceed '+MAX_REPAIR_DOCUMENTS);
  idSet=new Set(ids);
  headers=fullHeaders.filter(r=>idSet.has(String(r.internal_id)));
  // Reuse precisely the source snapshot audited above. Nothing outside the candidate IDs.
  mapped=Object.fromEntries(Object.entries(fullMapped).map(([k,v])=>[
   k,Array.isArray(v)?v.filter(r=>idSet.has(String(r.credit_memo_id))):v
  ]));
  console.log('REPAIR MODE: exact source snapshot, bounded candidates, checkpoint unchanged');
 }else{
  headers=await fetchHeaders(access,since);ids=headers.map(h=>String(h.internal_id));idSet=new Set(ids);
  if(ids.length!==idSet.size)fail('Duplicate source header');
  console.log('CHANGED_HEADERS:',ids.length);
  if(!ids.length){console.log('B6 INCREMENTAL NO_CHANGE: no source headers, no writes');return;}
  [lines,gl,previous,next]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchPreviousLinks(access,ids),fetchNextLinks(access,ids)]);
  mapped=mapSource(headers,lines,gl,previous,next);
 }
 const prepared=[];let changed=false;
 for(const g of GROUPS){
  const source=sourceRows(mapped,g);validateGroup(g,source,idSet);
  const stored=(await storedRows(g)).filter(r=>idSet.has(String(r.credit_memo_id)));
  const keys=compareKeys(source,stored,g);const fields=compareFields(keys.a,keys.b,g);
  const change=keys.onlyNetSuite+keys.onlyBigQuery+fields.mismatches;
  changed ||= change>0;
  console.log('DELTA',JSON.stringify({table:g.table,source:source.length,stored:stored.length,newKeys:keys.onlyNetSuite,staleKeys:keys.onlyBigQuery,fieldMismatches:fields.mismatches}));
  prepared.push({g,rows:source});
 }
 if(!changed){console.log(mode==='--repair-audit'?'CCM AUTO REPAIR NO_CHANGE: ZERO writes':'B6 INCREMENTAL NO_CHANGE: overlap-only, ZERO writes, checkpoint unchanged');return;}
 const classifications=mapped.financialClassification.map(x=>x.classification);
 if(classifications.some(x=>!['GL_EXACT_BALANCED','SOURCE_ADJUSTMENT_VERIFIED'].includes(x)))fail('Unverified financial classification');
 const wm=headers.map(h=>h.last_modified).filter(Boolean).sort().at(-1);
 if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(wm??''))fail('Invalid max source timestamp');
 const nextWatermark = wm > cp ? wm : cp;
 if(mode==='--dry-run'){console.log('B6 INCREMENTAL DRY RUN PASS: changes detected; ZERO writes');return;}
 if(await checkpoint()!==cp)fail('Module checkpoint changed during source fetch');
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,18);
 const stages=prepared.map(({g,rows},i)=>({g,rows,name:`_stage_ccm_delta_${i}_${suffix}`}));
 try{
    let stageIndex=0;
  await Promise.all(Array.from({length:2},async()=>{
    while(stageIndex<stages.length){
      const st=stages[stageIndex++];
      console.log('STAGING START',st.g.table,new Date().toISOString());
      const started=Date.now();
      await stage(st.name,st.rows,st.g);
      console.log('STAGED',st.g.table,st.rows.length,'duration_ms='+String(Date.now()-started));
    }
  }));
  const stageAssertions=stages.map(st=>`ASSERT (SELECT COUNT(*) FROM ${T(st.name)})=${st.rows.length} AS 'Stage count ${st.g.table}';`).join('\n');
  const stageKeys=stages.map(st=>`ASSERT (SELECT COUNT(*) FROM (SELECT ${st.g.key.join(',')} FROM ${T(st.name)} GROUP BY ${st.g.key.join(',')} HAVING COUNT(*)>1))=0 AS 'Duplicate stage key ${st.g.table}';`).join('\n');
  const cpGuard=`ASSERT (SELECT COUNT(*) FROM ${CP_TBL} WHERE record_type IN UNNEST(@tables) AND FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at)=@cp)=${TABLES.length} AS 'Module checkpoint changed';`;
  const headGuard=`ASSERT (SELECT COUNT(*) FROM ${T(GROUPS[0].table)} WHERE credit_memo_id IN UNNEST(@ids) AND is_deleted IS TRUE)=0 AS 'Deleted header in changed set';`;
  // Match purchase-return production baseline: header MERGE, detail replace only.
  const statements=stages.map((st,i)=>{
   const names=st.g.fields.map(([name])=>name);
   if(i===0){
    const key='credit_memo_id';
    const updates=names.filter(n=>n!==key).map(n=>`d.${n}=s.${n}`).join(',');
    return `MERGE ${T(st.g.table)} d USING ${T(st.name)} s ON d.${key}=s.${key}\nWHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE THEN UPDATE SET ${updates},d.synced_at=CURRENT_TIMESTAMP()\nWHEN NOT MATCHED THEN INSERT (${[...names,'synced_at','is_deleted','deleted_at'].join(',')}) VALUES (${[...names.map(n=>`s.${n}`),'CURRENT_TIMESTAMP()','FALSE','NULL'].join(',')});`;
   }
   return `DELETE FROM ${T(st.g.table)} WHERE credit_memo_id IN UNNEST(@ids);\nINSERT INTO ${T(st.g.table)} (${[...names,'synced_at'].join(',')}) SELECT ${[...names,'CURRENT_TIMESTAMP()'].join(',')} FROM ${T(st.name)};`;
  }).join('\n');
  const orphan=stages.slice(1).map(st=>`ASSERT (SELECT COUNT(*) FROM ${T(st.g.table)} AS d LEFT JOIN ${T(GROUPS[0].table)} AS h ON h.credit_memo_id=d.credit_memo_id WHERE h.credit_memo_id IS NULL)=0 AS 'Orphans ${st.g.table}';`).join('\n');
  const cpWrite=mode==='--repair-audit'?'':`UPDATE ${CP_TBL} SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP() WHERE record_type IN UNNEST(@tables);\nASSERT @@row_count=${TABLES.length} AS 'Checkpoint update count';`;
  const sql=`BEGIN\nBEGIN TRANSACTION;\n${cpGuard}\n${headGuard}\n${stageAssertions}\n${stageKeys}\n${statements}\n${orphan}\n${cpWrite}\nCOMMIT TRANSACTION;\nEXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;\nEND;`;
  const params={ids,tables:TABLES,cp,wm:nextWatermark};
  for(let attempt=1;attempt<=RETRIES;attempt++){
   if(await checkpoint()!==cp)fail('Module checkpoint changed; retry prohibited');
   try{await query(sql,params);console.log(mode==='--repair-audit'?'CCM AUTO REPAIR ATOMIC COMMIT PASS: candidate IDs only, checkpoint unchanged; attempts='+attempt:'B6 INCREMENTAL ATOMIC COMMIT PASS: 6 module tables + 6 module checkpoints; attempts='+attempt);return;}
   catch(e){
    if(!isConflict(e))throw e;
    if(await checkpoint()!==cp)fail('Checkpoint advanced during uncertain commit; stop, reconcile first');
    if(attempt===RETRIES)fail('Checkpoint concurrency retries exhausted');
    console.log('MODULE 10 ONLY CHECKPOINT CONFLICT: RETRY',attempt);
    await sleep(DELAYS[attempt-1]);
   }
  }
 }finally{for(const st of stages){try{await dataset.table(st.name).delete({ignoreNotFound:true});}catch(e){console.warn('STAGING CLEANUP WARNING',st.name,e.message);}}}
}
// Production --sync also closes historical field drift not reflected in
// last_modified. This calls the existing bounded six-table --repair-audit mode;
// it never widens the checkpoint or repairs soft-deleted historical rows.
// A failed repair is a real module failure; never silently claim SYNC_OK.
main().then(()=>{
 if(mode!=='--sync')return;
 console.log('CCM B10 AUTOMATIC ACTIVE REPAIR START');
 const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--repair-audit'],{
  cwd:process.cwd(),encoding:'utf8',windowsHide:true,timeout:300000,
  maxBuffer:8*1024*1024,env:process.env
 });
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.stderr)process.stderr.write(result.stderr);
 if(result.error||result.status!==0){
  console.error('CCM B10 AUTOMATIC ACTIVE REPAIR BLOCKED:',result.error?.message??('exit='+result.status));
  process.exitCode=1;return;
 }
 if(!/CCM AUTO REPAIR (?:ATOMIC COMMIT PASS:|NO_CHANGE:)/.test(result.stdout??'')){
  console.error('CCM B10 AUTOMATIC ACTIVE REPAIR BLOCKED: success marker absent');
  process.exitCode=1;return;
 }
 console.log('CCM B10 AUTOMATIC ACTIVE REPAIR PASS');
}).catch(e=>{console.error('B6 INCREMENTAL BLOCKED:',e?.stack??String(e));process.exitCode=1;});
