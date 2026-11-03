import { validateNumericRows } from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {dataset, DATASET, LOCATION, T, query} from '../../common/bigquery-client.mjs';
import {token, fetchHeaders, fetchLines, fetchGL, fetchApplications, mapSource} from './mapping.mjs';

const DRY_RUN=process.argv.includes('--dry-run');
const SYNC=process.argv.includes('--sync');
if(DRY_RUN===SYNC)throw Error('Specify exactly one: --dry-run OR --sync');
const C='sync_checkpoints';
const groups=[
 {table:'sales_payment_headers',fields:[['payment_id','STRING'],['document_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],['status_id','STRING'],['customer_id','STRING'],['customer_name','STRING'],['currency_id','STRING'],['currency_name','STRING'],['exchange_rate','NUMERIC'],['foreign_total','NUMERIC'],['base_total','NUMERIC'],['amount_used','NUMERIC'],['amount_unused','NUMERIC'],['posting_period_id','STRING'],['subsidiary_id','STRING'],['is_void','BOOL']],source:'headers',key:['payment_id']},
 {table:'sales_payment_lines',fields:[['payment_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],['line_number','STRING'],['is_mainline','BOOL'],['is_tax_line','BOOL'],['accounting_line_type','STRING'],['account_id','STRING'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC']],source:'transactionLines',key:['payment_id','line_unique_key']},
 {table:'sales_payment_accounting_lines',fields:[['payment_id','STRING'],['accounting_book_id','STRING'],['line_id','STRING'],['account_id','STRING'],['posting','BOOL'],['debit','NUMERIC'],['credit','NUMERIC']],source:'accountingLines',key:['payment_id','accounting_book_id','line_id','account_id']},
 {table:'sales_payment_applications',fields:[['payment_id','STRING'],['invoice_id','STRING'],['payment_line_id','STRING'],['invoice_line_id','STRING'],['link_type','STRING'],['applied_amount','NUMERIC']],source:'applications',key:['payment_id','invoice_id','payment_line_id','invoice_line_id']}
];
const names=groups.map(x=>x.table);
const cols=g=>g.fields.map(([name])=>name);
const cpList=names.map(x=>`'${x}'`).join(',');
const yes=id=>/^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id));
function overlap(date){const d=new Date(date.replace(' ','T')+'Z');if(Number.isNaN(+d))throw Error('Invalid checkpoint date '+date);return new Date(+d-300000).toISOString().slice(0,19).replace('T',' ');}
async function checkpoints(){return query(`SELECT record_type, FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS modified FROM ${T(C)} WHERE record_type IN (${cpList})`);}
// Same bounded conflict strategy as purchase-order. Never retry unknown commit outcomes.
const RETRY_DELAYS_MS = [1500, 3500, 7000];
function isCheckpointConflict(error){
 const message=String(error?.message??error);
 return /transaction is aborted due to concurrent update against table/i.test(message)
   && /netsuite_backup[.:]sync_checkpoints/i.test(message);
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function atomicCommitWithGuard(sql,params,originalCheckpoint){
 for(let attempt=0;;attempt++){
  try{return await query(sql,params);}
  catch(error){
   if(!isCheckpointConflict(error) || attempt>=RETRY_DELAYS_MS.length)throw error;
   // BigQuery explicitly aborted the full transaction. Confirm all four PI checkpoints
   // are still at the original watermark before replaying the same staged data.
   const latest=await checkpoints();
   if(latest.length!==(originalCheckpoint?4:0)
     || new Set(latest.map(row=>row.record_type)).size!==latest.length
     || latest.some(row=>!names.includes(row.record_type) || row.modified!==originalCheckpoint)){
    throw new Error(`Sales Payment checkpoint changed after aborted transaction (before=${originalCheckpoint??'INITIAL'}). Refusing replay; run fresh --dry-run and --sync.`,{cause:error});
   }
   const wait=RETRY_DELAYS_MS[attempt];
   console.warn(`Sales Payment checkpoint write conflict; transaction aborted. Retry ${attempt+1}/${RETRY_DELAYS_MS.length} after ${wait}ms (staging retained).`);
   await sleep(wait);
  }
 }
}
async function ensureTables(){
 const [ok]=await dataset.table(C).exists();if(!ok)throw Error('Shared checkpoint table missing; refusing to create');
 for(const g of groups){
  const defs=g.fields.map(([k,t])=>`${k} ${t}${g.key.includes(k)?' NOT NULL':''}`).join(',');
  const extra=g===groups[0]?',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP':',synced_at TIMESTAMP';
  const partition=g===groups[0]?' PARTITION BY transaction_date':'';
  const cluster=g===groups[0]?' CLUSTER BY payment_id':` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
  await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
 }
}
async function stage(name,rows,fields){
 validateNumericRows(rows, fields, { module: 'sales-payment' });
 if(!rows.length){await query(`CREATE TABLE ${T(name)} AS SELECT ${fields.map(([k,t])=>`CAST(NULL AS ${t}) AS ${k}`).join(',')} FROM UNNEST([1]) AS dummy WHERE FALSE`);return;}
 const filename=path.join(os.tmpdir(),`netsuite-sp-${crypto.randomUUID()}.ndjson`);
 await fs.writeFile(filename,rows.map(x=>JSON.stringify(x)).join('\n')+'\n',{mode:0o600});
 try{await dataset.table(name).load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:fields.map(([name,type])=>({name,type}))},location:LOCATION});}
 finally{await fs.rm(filename,{force:true});}
 const [v]=await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);if(Number(v.n)!==rows.length)throw Error('Stage count mismatch '+name);
}
async function main(){
 console.log(`SALES PAYMENT | ${DRY_RUN?'DRY RUN':'PRODUCTION SYNC'} | ${DATASET} | ${LOCATION}`);
 const [hasCP]=await dataset.table(C).exists();if(!hasCP)throw Error('Shared sync_checkpoints missing');
 const cp=await checkpoints();
 if(cp.length!==0&&cp.length!==4)throw Error('Partial Sales Payment checkpoints; refuse to continue');
 if(new Set(cp.map(x=>x.record_type)).size!==cp.length)throw Error('Duplicate Sales Payment checkpoints');
 const baseline=cp.length?cp[0].modified:null;
 if(cp.some(x=>x.modified!==baseline))throw Error('Sales Payment checkpoints diverged');
 const since=baseline?overlap(baseline):null;
 const access=await token();
 // Fetch October-December headers using the source mapping with checkpoint overlap.
 // The source mapping's fetchHeaders() remains unchanged and validated.
 const headers=await fetchHeaders(access,since);
 if(!baseline&&!headers.length)throw Error('Initial CustPymt fetch empty');
 if(headers.some(h=>!yes(h.payment_id)))throw Error('Invalid header id');
 const ids=headers.map(h=>h.payment_id);
 const [lines,gl,links]=await Promise.all([
  ids.length?fetchLines(access,ids):[],ids.length?fetchGL(access,ids):[],ids.length?fetchApplications(access,ids):[]
 ]);
 const mapped=mapSource(headers,lines,gl,links);
 const totals=Object.fromEntries(groups.map(g=>[g.table,mapped[g.source].length]));
 console.log('Source mapped:',JSON.stringify(totals));
 console.log(`Checkpoint=${baseline??'INITIAL'}; overlap from=${since??'FULL OCTOBER'}`);
 if(DRY_RUN){console.log('DRY RUN PASS: source validated; BigQuery and checkpoints unchanged.');return;}
 if(baseline&&!headers.length){console.log('SALES PAYMENT NO CHANGES: SUCCESS; checkpoint not moved');return;}
 await ensureTables();
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);
 const stages=groups.map((g,i)=>({...g,stageName:`_stage_sp_${i}_${suffix}`}));
 try{
  for(const g of stages)await stage(g.stageName,mapped[g.source],g.fields);
  const watermark= [...headers.map(h=>h.last_modified)].sort().at(-1);
  if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(watermark??''))throw Error('Invalid source watermark');
  const checks=stages.map(g=>{
   const count=mapped[g.source].length;
   const unique=g.key.join(',');
   return `ASSERT (SELECT COUNT(*) FROM ${T(g.stageName)})=${count} AS 'Stage row count mismatch ${g.table}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${unique} FROM ${T(g.stageName)} GROUP BY ${unique} HAVING COUNT(*)>1))=0 AS 'Duplicate stage key ${g.table}';`;
  }).join('\n');
  const merges=stages.map((g,i)=>{
   const fields=cols(g);
   if(i===0){return `MERGE ${T(g.table)} d USING ${T(g.stageName)} s ON d.payment_id=s.payment_id
WHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE THEN UPDATE SET ${fields.filter(x=>x!=='payment_id').map(x=>`${x}=s.${x}`).join(',')},synced_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(${fields.join(',')},synced_at,is_deleted,deleted_at) VALUES(${fields.map(x=>`s.${x}`).join(',')},CURRENT_TIMESTAMP(),FALSE,NULL);`}
   return `DELETE FROM ${T(g.table)} WHERE payment_id IN (SELECT payment_id FROM ${T(stages[0].stageName)});
INSERT INTO ${T(g.table)} (${fields.join(',')},synced_at) SELECT ${fields.join(',')},CURRENT_TIMESTAMP() FROM ${T(g.stageName)};`;
  }).join('\n');
  const guard=baseline?`ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}) AND last_successful_modified_at=DATETIME('${baseline}'))=4 AS 'Sales Payment checkpoint advanced';`:'';
  const cpSql=`MERGE ${T(C)} d USING (SELECT record_type FROM UNNEST([${cpList}]) AS record_type) s ON d.record_type=s.record_type
WHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());`;
  const orphans=stages.slice(1).map(g=>`ASSERT (SELECT COUNT(*) FROM ${T(g.table)} l LEFT JOIN ${T(stages[0].table)} h ON h.payment_id=l.payment_id WHERE h.payment_id IS NULL)=0 AS 'Orphan ${g.table}';`).join('\n');
  const sql=`BEGIN
BEGIN TRANSACTION;
${checks}
ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}))=${baseline?4:0} AS 'Sales Payment checkpoint row count changed';
${guard}
${merges}
${cpSql}
${orphans}
COMMIT TRANSACTION;
EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
END;`;
  await atomicCommitWithGuard(sql,{wm:watermark},baseline);
  console.log('ATOMIC MERGE + DETAIL REPLACE + FOUR CHECKPOINTS: SUCCESS');
  console.log('SALES PAYMENT SYNC SUCCESS; RUN reconciliation checks; NOT FINAL_PASS');
 } finally {for(const g of stages){try{await dataset.table(g.stageName).delete({ignoreNotFound:true});}catch(err){console.error('Stage cleanup warning',g.stageName,err.message);}}}
}
main().catch(err=>{console.error('SALES PAYMENT ERROR:',err.stack??err);process.exitCode=1;});
