// Module 15 ONLY: initial backfill. Default --dry-run; guarded --sync.
// Uses isolated stages, transaction-bound checkpoints, and zero changes to schedulers.
import {dataset,query,T,LOCATION} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,mapSource} from './mapping.mjs';
import {TABLES} from './schema-contract.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const must=(x,m)=>{if(!x)throw Error('MODULE 15 INITIAL BACKFILL BLOCKED: '+m);};
const groups=[
 {t:TABLES[0],data:'headers',key:['internal_id']},
 {t:TABLES[1],data:'lines',key:['adjustment_internal_id','line_unique_key']},
 {t:TABLES[2],data:'accountingLines',key:['adjustment_internal_id','line_id','accounting_book_id','account_id']},
];
const cpList=groups.map(g=>`'${g.t.name}'`).join(',');
const fields=g=>g.t.fields.filter(([n])=>!['synced_at','is_deleted','deleted_at'].includes(n));
const fieldNames=g=>fields(g).map(([n])=>n);
const sig=rows=>{const hash=crypto.createHash('sha256');for(const r of rows.map(x=>JSON.stringify(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)))).sort())hash.update(r+'\n');return hash.digest('hex');};
const n=x=>{const v=Number(x);must(Number.isSafeInteger(v),'unsafe row count');return v;};
async function gates(){
 const [cpTable]=await dataset.table('sync_checkpoints').exists();must(cpTable,'shared checkpoint table missing');
 const cps=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpList})`);
 must(cps.length===0,'Module15 checkpoints already exist');
 for(const g of groups){
  const [exists]=await dataset.table(g.t.name).exists();must(exists,'missing schema '+g.t.name);
  const [meta]=await dataset.table(g.t.name).getMetadata();const actual=meta.schema?.fields??[];
  must(actual.length===g.t.fields.length,'schema column count '+g.t.name);
  for(const [name,type] of g.t.fields){const a=actual.find(f=>f.name.toLowerCase()===name.toLowerCase());must(a&&String(a.type).toUpperCase().replace('BOOLEAN','BOOL')===type,'schema mismatch '+g.t.name+'.'+name);}
  const c=await query(`SELECT COUNT(*) n FROM ${T(g.t.name)}`);must(n(c[0].n)===0,'target not empty '+g.t.name);
 }
}
async function snapshot(){
 const access=await token();const heads=await fetchHeaders(access);must(heads.length>0,'NO_SOURCE');
 const ids=heads.map(h=>h.internal_id);const [lines,gl]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids)]);
 const {data,stats}=mapSource(heads,lines,gl);
 for(const g of groups){const expected=new Set(fieldNames(g));for(const r of data[g.data]){must(Object.keys(r).length===expected.size,'field count '+g.t.name);for(const [k,t] of fields(g)){must(Object.hasOwn(r,k),'missing field '+g.t.name+'.'+k);must(r[k]==null || (t==='BOOL'?typeof r[k]==='boolean':typeof r[k]==='string'),'field type '+g.t.name+'.'+k);}}}
 return {data,stats,digests:groups.map(g=>sig(data[g.data]))};
}
async function stage(g,stageName,rows){
 const file=path.join(os.tmpdir(),`module15-${crypto.randomUUID()}.ndjson`);
 must(rows.length>0,'unexpected empty stage '+g.t.name);
 await fs.writeFile(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});
 try{await dataset.table(stageName).load(file,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:fields(g).map(([name,type])=>({name,type}))},location:LOCATION});}
 finally{await fs.rm(file,{force:true});}
 const c=await query(`SELECT COUNT(*) n FROM ${T(stageName)}`);must(n(c[0].n)===rows.length,'stage count '+stageName);
 console.log('STAGED',JSON.stringify({table:g.t.name,rows:rows.length}));
}
function commitSQL(st,s){
 const assertions=st.map((x,i)=>`ASSERT (SELECT COUNT(*) FROM ${T(x.name)})=${s.data[x.g.data].length} AS 'stage rows ${i}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${x.g.key.map(k=>'`'+k+'`').join(',')} FROM ${T(x.name)} GROUP BY ${x.g.key.map(k=>'`'+k+'`').join(',')} HAVING COUNT(*)>1))=0 AS 'duplicate stage ${i}';`).join('\n');
 const inserts=st.map((x,i)=>{const names=fieldNames(x.g).map(k=>'`'+k+'`');const extra=i===0?['synced_at','is_deleted','deleted_at']:['synced_at'];const values=i===0?['CURRENT_TIMESTAMP()','FALSE','NULL']:['CURRENT_TIMESTAMP()'];return `INSERT INTO ${T(x.g.t.name)} (${[...names,...extra].join(',')}) SELECT ${[...names,...values].join(',')} FROM ${T(x.name)};`;}).join('\n');
 return `BEGIN\nBEGIN TRANSACTION;\nASSERT (SELECT COUNT(*) FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpList}))=0 AS 'Module15 checkpoint exists';\n${groups.map(g=>`ASSERT (SELECT COUNT(*) FROM ${T(g.t.name)})=0 AS 'Module15 target not empty ${g.t.name}';`).join('\n')}\n${assertions}\n${inserts}\nASSERT (SELECT COUNT(*) FROM ${T(groups[1].t.name)} l LEFT JOIN ${T(groups[0].t.name)} h ON l.adjustment_internal_id=h.internal_id WHERE h.internal_id IS NULL)=0 AS 'orphan transaction line';\nASSERT (SELECT COUNT(*) FROM ${T(groups[2].t.name)} l LEFT JOIN ${T(groups[0].t.name)} h ON l.adjustment_internal_id=h.internal_id WHERE h.internal_id IS NULL)=0 AS 'orphan GL';\nMERGE ${T('sync_checkpoints')} d USING (SELECT record_type FROM UNNEST([${cpList}]) AS record_type) s ON d.record_type=s.record_type WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());\nCOMMIT TRANSACTION;\nEXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;\nEND;`;
}
async function main(){
 const mode=process.argv[2]??'--dry-run';must(process.argv.length<=3&&['--dry-run','--sync'].includes(mode),'usage: --dry-run or --sync');
 if(mode==='--sync')must(process.env.NETSUITE_INVENTORY_ADJUSTMENT_INITIAL_CONFIRM==='MODULE15_INITIAL_ONLY','explicit initial backfill authorization missing');
 console.log('MODULE 15 INITIAL BACKFILL',mode,'| MODULE15_ONLY | NO SCHEDULER CHANGES');
 await gates();const first=await snapshot();console.log('SOURCE_PLAN',JSON.stringify({...first.stats,tableRows:groups.map(g=>({table:g.t.name,count:first.data[g.data].length})),checkpointRows:3,otherModuleWrites:0,schedulerChanges:0}));
 if(mode==='--dry-run'){console.log('MODULE 15 INITIAL BACKFILL DRY RUN PASS: ZERO WRITES; NO CHECKPOINT CHANGES; NO SCHEDULER CHANGES');return;}
 await gates();const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);const stages=groups.map((g,i)=>({g,name:`_stage_invadj_initial_${i}_${suffix}`,created:false}));
 try{
  for(const st of stages){st.created=true;await stage(st.g,st.name,first.data[st.g.data]);}
  const second=await snapshot();must(second.stats.sourceWatermark===first.stats.sourceWatermark,'source watermark moved during staging');must(JSON.stringify(second.stats)===JSON.stringify(first.stats),'source stats moved during staging');must(second.digests.every((v,i)=>v===first.digests[i]),'source field values moved during staging');
  console.log('SOURCE_STABILITY PASS');await gates();const sql=commitSQL(stages,first);
  for(let attempt=1;attempt<=5;attempt++){
   await gates();try{await query(sql,{wm:first.stats.sourceWatermark});break;}
   catch(e){const msg=String(e?.message??e);if(attempt===5||!/transaction is aborted due to concurrent update/i.test(msg)||!/sync_checkpoints/i.test(msg))throw e;await gates();console.log('CHECKPOINT_CONFLICT_RETRY',JSON.stringify({attempt}));await new Promise(r=>setTimeout(r,1000*2**attempt));}
  }
  console.log('MODULE 15 INITIAL BACKFILL COMMIT PASS',JSON.stringify({headers:first.stats.headers,lines:first.stats.lines,glLines:first.stats.accountingLines,checkpoint:first.stats.sourceWatermark,checkpointRows:3,otherModuleWrites:0,schedulerChanges:0,automaticDeletions:0}));
 }finally{for(const st of stages)if(st.created)try{await dataset.table(st.name).delete({ignoreNotFound:true});}catch(e){console.warn('STAGING CLEANUP WARNING',st.name,String(e.message??e));}}
}
main().catch(e=>{console.error('MODULE 15 INITIAL BACKFILL BLOCKED',e.stack??e.message);process.exitCode=1;});
