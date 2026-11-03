// Module 10 Customer Credit Memo: guarded INITIAL load only.
// Mirrors purchase-return stage -> BigQuery transaction -> checkpoints baseline.
// Subsequent incremental sync requires a separate reviewed implementation.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {dataset,query,T,LOCATION,DATASET} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
import {validateNumeric} from '../../common/decimal-precision.mjs';
import {validateBigNumeric} from '../../common/decimal-precision.mjs';

if(process.argv.length!==3||process.argv[2]!=='--sync')throw Error('INITIAL SYNC requires exactly --sync. Run dry-run-sync.mjs --dry-run beforehand.');
const cpNames=GROUPS.map(g=>g.table);
const quoted=cpNames.map(x=>`'${x}'`).join(',');
const fail=m=>{throw Error('CUSTOMER CREDIT MEMO INITIAL SYNC BLOCKED: '+m);};
const countValue=x=>Number(typeof x==='object'&&x!==null&&'value' in x?x.value:x);

// Module-local concurrency recovery. Never pause or alter pre-existing production tasks.
// Retry ONLY when BigQuery explicitly reports a transaction update conflict.
const MAX_COMMIT_ATTEMPTS=5;
const RETRY_DELAYS_MS=[1500,3000,6000,12000];
export const isCheckpointConflict=error=>{
 const message=String(error?.message??error??'');
 return /transaction is aborted due to concurrent update against table/i.test(message)
   && /sync_checkpoints/i.test(message);
};
export async function commitWithIsolation({execute,ensureClean,sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms)),log=console.log,maxAttempts=MAX_COMMIT_ATTEMPTS,delays=RETRY_DELAYS_MS}){
 if(!Number.isInteger(maxAttempts)||maxAttempts<1)throw Error('Invalid retry attempts');
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  // Mandatory before every commit, including the first one. Checks both targets and module checkpoints.
  await ensureClean();
  try{
   await execute();
   return {attempts:attempt};
  }catch(error){
   // Fail closed for all errors other than the *specific* checkpoint concurrency conflict.
   if(!isCheckpointConflict(error))throw error;
   // An uncertain/partial commit must never be retried. Any data or module CP => BLOCKED.
   await ensureClean();
   if(attempt===maxAttempts)throw Error(`Customer Credit Memo standalone checkpoint conflict retry exhausted (${attempt} attempts)`,{cause:error});
   const delay=delays[Math.min(attempt-1,delays.length-1)];
   log(`STANDALONE CHECKPOINT CONFLICT: retry ${attempt}/${maxAttempts-1}; module targets and checkpoints confirmed empty; existing schedulers unchanged`);
   await sleep(delay);
  }
 }
}

const accountingRow=r=>({credit_memo_id:r.credit_memo_id,accounting_book_id:r.bookId,classification:r.classification,gl_delta:r.gl_delta,adjustment_line_id:r.adjustment_line_id??null,adjustment_unique_key:r.adjustment_unique_key??null,adjustment_foreign_amount:r.adjustment_foreign_amount??null,non_adjustment_gl_delta:r.non_adjustment_gl_delta??null});
function assertType(value,type,where){
 if(value==null)return;
 if(type==='STRING'&&typeof value==='string')return;
 if(type==='BOOL'&&typeof value==='boolean')return;
 if(type==='DATE'&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return;
 if(type==='DATETIME'&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))return;
 if(type==='NUMERIC'){if(typeof value!=='string'||validateNumeric(value,{module:'customer-credit-memo',field:where})!==value)fail(where+' NUMERIC invalid');return;}
 if(type==='BIGNUMERIC'){if(typeof value!=='string'||validateBigNumeric(value,{module:'customer-credit-memo',field:where})!==value)fail(where+' BIGNUMERIC invalid');return;}
 fail(where+' type '+type+' invalid');
}
async function preconditions(){
 const [hasCP]=await dataset.table('sync_checkpoints').exists();if(!hasCP)fail('sync_checkpoints absent');
 const checkpoint=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${quoted}) OR record_type IN ('customer-credit-memo','customer_credit_memo')`);
 if(checkpoint.length)fail('module checkpoint exists; initial-only sync must not rerun');
 for(const g of GROUPS){const tbl=dataset.table(g.table);const [exists]=await tbl.exists();if(!exists)fail('Missing '+g.table);
  const [metadata]=await tbl.getMetadata();const actual=metadata.schema?.fields??[];const expected=columnDefinitions(g);
  if(actual.length!==expected.length)fail('Schema field count '+g.table);
  for(const [name,type] of expected){const field=actual.find(f=>f.name.toLowerCase()===name.toLowerCase());if(!field||(field.type.toUpperCase()==='BOOLEAN'?'BOOL':field.type.toUpperCase())!==type)fail('Schema mismatch '+g.table+'.'+name);}
  const rows=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);if(countValue(rows[0].n)!==0)fail('Target not empty '+g.table);
 }
}
async function stage(stagingName,rows,fields){
 const table=dataset.table(stagingName);
 if(!rows.length){
  // BigQuery rejects SELECT expressions + WHERE without FROM.
  // Create a typed, genuinely empty staging table; do not synthesize a row.
  await query(`CREATE TABLE ${T(stagingName)} (${fields.map(([name,type])=>`${name} ${type}`).join(', ')})`);
  const [res]=await query(`SELECT COUNT(*) AS n FROM ${T(stagingName)}`);
  if(countValue(res.n)!==0)fail('Empty staging count mismatch '+stagingName);
  return;
 }
 const filename=path.join(os.tmpdir(),`netsuite-ccm-${crypto.randomUUID()}.ndjson`);
 await fs.writeFile(filename,rows.map(row=>JSON.stringify(row)).join('\n')+'\n',{mode:0o600});
 try{await table.load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:fields.map(([name,type])=>({name,type}))},location:LOCATION});}
 finally{await fs.rm(filename,{force:true});}
 const [res]=await query(`SELECT COUNT(*) AS n FROM ${T(stagingName)}`);if(countValue(res.n)!==rows.length)fail('Staging count mismatch '+stagingName);
}
async function main(){
 console.log(`CUSTOMER CREDIT MEMO B4 INITIAL PRODUCTION SYNC | ${DATASET} | ${LOCATION}`);
 console.log('GUARD: INITIAL LOAD ONLY | ATOMIC MERGE + 6 CHECKPOINTS | NO DELETION / SCHEDULER');
 await preconditions();
 const access=await token();console.log('OAuth: SUCCESS');
 const h=await fetchHeaders(access),ids=h.map(x=>String(x.internal_id));if(!ids.length)fail('Empty source initial load');
 if(ids.length!==new Set(ids).size)fail('Duplicate source header');
 const [l,a,p,n]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchPreviousLinks(access,ids),fetchNextLinks(access,ids)]);
 const mapped=mapSource(h,l,a,p,n);
 const prepared=GROUPS.map(g=>({g,rows:g.source==='financialClassification'?mapped.financialClassification.map(accountingRow):mapped[g.source]}));
 for(const {g,rows} of prepared){const seen=new Set();for(let i=0;i<rows.length;i++){const r=rows[i];for(const [field,type] of g.fields)assertType(r[field],type,`${g.table}[${i}].${field}`);
   for(const k of g.key){if((g.nullableKey??[]).includes(k))continue;if(r[k]==null||r[k]==='')fail('Missing key '+g.table+'.'+k);}
   const key=JSON.stringify(g.key.map(k=>r[k]));if(seen.has(key))fail('Duplicate '+g.table+' '+key);seen.add(key);
   for(const k of Object.keys(r))if(!g.fields.some(f=>f[0]===k))fail('Unexpected column '+g.table+'.'+k);
  }console.log('PAYLOAD',g.table,rows.length);}
 const classifications=mapped.financialClassification.reduce((r,x)=>(r[x.classification]=(r[x.classification]??0)+1,r),{});
 if(Object.keys(classifications).some(k=>!['GL_EXACT_BALANCED','SOURCE_ADJUSTMENT_VERIFIED'].includes(k)))fail('Financial classification BLOCKED');
 console.log('FINANCIAL_CLASSIFICATION:',JSON.stringify(classifications));
 const wm=h.map(x=>x.last_modified).filter(Boolean).sort().at(-1);
 if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(wm??''))fail('Source watermark invalid');
 // Recheck target/checkpoint before staging. Transaction repeats these guards to catch races.
 await preconditions();
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);
 const stages=prepared.map(({g,rows},index)=>({g,rows,name:`_stage_ccm_${index}_${suffix}`}));
 try{
  for(const s of stages){await stage(s.name,s.rows,s.g.fields);console.log('STAGED:',s.g.table,s.rows.length);}
  const asserts=stages.map(s=>`ASSERT (SELECT COUNT(*) FROM ${T(s.name)})=${s.rows.length} AS 'Stage row count ${s.g.table}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${s.g.key.join(',')} FROM ${T(s.name)} GROUP BY ${s.g.key.join(',')} HAVING COUNT(*)>1))=0 AS 'Stage duplicate ${s.g.table}';`).join('\n');
  const inserts=stages.map((s,i)=>{const cols=s.g.fields.map(([name])=>name);const extra=i===0?'synced_at,is_deleted,deleted_at':'synced_at';const vals=i===0?'CURRENT_TIMESTAMP(),FALSE,NULL':'CURRENT_TIMESTAMP()';return `INSERT INTO ${T(s.g.table)} (${cols.join(',')},${extra}) SELECT ${cols.join(',')},${vals} FROM ${T(s.name)};`;}).join('\n');
  const orphan=stages.slice(1).map(s=>`ASSERT (SELECT COUNT(*) FROM ${T(s.g.table)} d LEFT JOIN ${T(GROUPS[0].table)} h ON h.credit_memo_id=d.credit_memo_id WHERE h.credit_memo_id IS NULL)=0 AS 'Orphan ${s.g.table}';`).join('\n');
  const checkpointSql=`MERGE ${T('sync_checkpoints')} d USING (SELECT record_type FROM UNNEST([${quoted}]) AS record_type) s ON d.record_type=s.record_type\nWHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP()\nWHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());`;
  const nonempty=GROUPS.map(g=>`ASSERT (SELECT COUNT(*) FROM ${T(g.table)})=0 AS 'Target changed ${g.table}';`).join('\n');
  const sql=`BEGIN\nBEGIN TRANSACTION;\n${asserts}\nASSERT (SELECT COUNT(*) FROM ${T('sync_checkpoints')} WHERE record_type IN (${quoted}) OR record_type IN ('customer-credit-memo','customer_credit_memo'))=0 AS 'Checkpoint appeared';\n${nonempty}\n${inserts}\n${orphan}\n${checkpointSql}\nCOMMIT TRANSACTION;\nEXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;\nEND;`;
  const outcome=await commitWithIsolation({execute:()=>query(sql,{wm}),ensureClean:preconditions});
  console.log('B4 INITIAL ATOMIC SYNC COMMITTED: 6 tables + 6 checkpoints; attempts='+outcome.attempts);
  console.log('NEXT: run presence/check/financial reconciliation; NOT FINAL_PASS; automatic verified deletion not enabled.');
 }finally{for(const s of stages){try{await dataset.table(s.name).delete({ignoreNotFound:true});}catch(e){console.warn('Staging cleanup:',s.name,e.message);}}}
}
main().catch(e=>{console.error('CUSTOMER CREDIT MEMO B4 SYNC BLOCKED:',e?.stack??String(e));process.exitCode=1;});
