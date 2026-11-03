import { validateNumericRows } from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {bq, dataset, DATASET, LOCATION, T, query} from '../../common/bigquery-client.mjs';
import {token, fetchHeaders, fetchLines, mapSource} from './mapping.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const SYNC = process.argv.includes('--sync');
if (DRY_RUN === SYNC) throw Error('Specify exactly one: --dry-run OR --sync');
const H='purchase_order_headers', L='purchase_order_lines', C='sync_checkpoints';
const HC='purchase_order_headers', LC='purchase_order_lines';
const headerFields=[['internal_id','STRING'],['po_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],['status','STRING'],['vendor_id','STRING'],['vendor_name','STRING'],['currency_id','STRING'],['exchange_rate','NUMERIC'],['foreign_total','NUMERIC'],['base_total','NUMERIC'],['posting_period_id','STRING']];
const lineFields=[['po_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],['line_number','STRING'],['line_type','STRING'],['item_id','STRING'],['quantity','NUMERIC'],['rate','NUMERIC'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC'],['location_id','STRING'],['units_id','STRING'],['accounting_line_type','STRING'],['is_tax_line','BOOL']];
const columns = f => f.map(x=>x[0]);
function afterOverlap(value){const d=new Date(value.replace(' ','T')+'Z');if(Number.isNaN(+d))throw Error('Invalid checkpoint '+value);return new Date(+d-300000).toISOString().slice(0,19).replace('T',' ');}
async function ensureTables(){
 await query(`CREATE TABLE IF NOT EXISTS ${T(H)} (internal_id STRING NOT NULL,po_number STRING,transaction_date DATE,last_modified DATETIME,status STRING,vendor_id STRING,vendor_name STRING,currency_id STRING,exchange_rate NUMERIC,foreign_total NUMERIC,base_total NUMERIC,posting_period_id STRING,synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP) PARTITION BY transaction_date CLUSTER BY internal_id`);
 await query(`CREATE TABLE IF NOT EXISTS ${T(L)} (po_internal_id STRING NOT NULL,line_unique_key STRING NOT NULL,line_id STRING,line_number STRING,line_type STRING,item_id STRING,quantity NUMERIC,rate NUMERIC,foreign_amount NUMERIC,net_amount NUMERIC,location_id STRING,units_id STRING,accounting_line_type STRING,is_tax_line BOOL,synced_at TIMESTAMP) CLUSTER BY po_internal_id,line_unique_key`);
 const [ok]=await dataset.table(C).exists();if(!ok)throw Error('Shared sync_checkpoints missing; refusing to create/alter it');
}
async function checkpoints(){
 const [ok]=await dataset.table(C).exists();if(!ok) return [];
 return query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS modified FROM ${T(C)} WHERE record_type IN ('${HC}','${LC}')`);
}
async function stage(name,rows,fields){
 validateNumericRows(rows, fields, { module: 'purchase-order' });
 if(!rows.length){await query(`CREATE TABLE ${T(name)} AS SELECT ${fields.map(([k,t])=>`CAST(NULL AS ${t}) AS ${k}`).join(',')} WHERE FALSE`);return;}
 const filename=path.join(os.tmpdir(),`netsuite-po-${crypto.randomUUID()}.ndjson`);
 await fs.writeFile(filename,rows.map(x=>JSON.stringify(x)).join('\n')+'\n',{mode:0o600});
 try{await dataset.table(name).load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:fields.map(([name,type])=>({name,type}))},location:LOCATION});}
 finally{await fs.rm(filename,{force:true});}
 const got=await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);if(Number(got[0].n)!==rows.length)throw Error('Stage count mismatch '+name);
}
// Retry only BigQuery's explicit transaction-aborted concurrency failure.
// Do not retry a generic timeout/network failure: commit outcome may be unknown.
const RETRY_DELAYS_MS = [1500, 3500, 7000];
function isCheckpointConflict(error){
 const message=String(error?.message??error);
 return /transaction is aborted due to concurrent update against table/i.test(message)
   && /netsuite_backup[.:]sync_checkpoints/i.test(message);
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function atomicCommitWithGuard(sql, params, originalCheckpoint){
 for(let attempt=0;;attempt++){
  try { return await query(sql,params); }
  catch(error){
   if(!isCheckpointConflict(error) || attempt>=RETRY_DELAYS_MS.length) throw error;
   // The entire BigQuery transaction has been explicitly aborted. Before a new
   // attempt, ensure no other writer has advanced the PO checkpoint.
   const latest=await checkpoints();
   const h=latest.find(row=>row.record_type===HC)?.modified??null;
   const l=latest.find(row=>row.record_type===LC)?.modified??null;
   if(latest.length>2 || h!==l || h!==originalCheckpoint){
    throw new Error(`PO checkpoint changed after transaction abort (before=${originalCheckpoint??'INITIAL'}, headers=${h??'INITIAL'}, lines=${l??'INITIAL'}). Refusing replay; run a fresh --dry-run and --sync.`,{cause:error});
   }
   const wait=RETRY_DELAYS_MS[attempt];
   console.warn(`PO checkpoint write conflict; atomic transaction aborted. Retry ${attempt+1}/${RETRY_DELAYS_MS.length} after ${wait}ms (staging retained).`);
   await sleep(wait);
  }
 }
}
async function main(){
 console.log(`PURCHASE ORDER | ${DRY_RUN?'DRY RUN':'PRODUCTION SYNC'} | ${DATASET} | ${LOCATION}`);
 if(SYNC)await ensureTables();
 const cp=await checkpoints();if(cp.length>2||new Set(cp.map(x=>x.record_type)).size!==cp.length)throw Error('Duplicate checkpoint');
 const a=cp.find(x=>x.record_type===HC)?.modified,b=cp.find(x=>x.record_type===LC)?.modified;
 if(Boolean(a)!==Boolean(b)||a!==b)throw Error('Header/line checkpoint mismatch; review before sync');
 const since=a?afterOverlap(a):null;
 const access=await token();
 const headers=await fetchHeaders(access,since);
 const raw=headers.length?await fetchLines(access,headers.map(x=>x.internal_id)):[];
 const mapped=mapSource(headers,raw);
 console.log(`Source: headers=${mapped.headers.length} lines=${mapped.lines.length}; checkpoint=${a??'INITIAL'}; fetchFrom=${since??'FULL OCTOBER'}`);
 if(!a&&!headers.length)throw Error('Initial fetch empty; verify permission/type before creating checkpoint');
 if(DRY_RUN){console.log('DRY RUN PASS: no BigQuery write. SOURCE BALANCE VERIFIED; BQ NOT CERTIFIED.');return;}
 if(a&&!headers.length){console.log('NO CHANGES; no checkpoint movement');console.log('PURCHASE ORDER NO CHANGES: SUCCESS');return;}
 // Never infer a deletion from a missing SuiteQL row. Historical records remain intact.
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20),hs=`_stage_po_h_${suffix}`,ls=`_stage_po_l_${suffix}`;
 const all=[hs,ls];
 try{
  await stage(hs,mapped.headers,headerFields);await stage(ls,mapped.lines,lineFields);
  const wm=mapped.headers.map(x=>x.last_modified).filter(Boolean).sort().at(-1);
  if(!wm || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(wm))throw Error('Missing/invalid source watermark');
  const hcols=columns(headerFields),lcols=columns(lineFields);
  const sql=`BEGIN
    BEGIN TRANSACTION;
    ASSERT (SELECT COUNT(*) FROM ${T(hs)})=@hc AS 'Staging header mismatch';
    ASSERT (SELECT COUNT(*) FROM ${T(ls)})=@lc AS 'Staging line mismatch';
    ASSERT (SELECT COUNT(*) FROM (SELECT internal_id FROM ${T(hs)} GROUP BY 1 HAVING COUNT(*)>1))=0 AS 'Duplicate headers';
    ASSERT (SELECT COUNT(*) FROM (SELECT po_internal_id,line_unique_key FROM ${T(ls)} GROUP BY 1,2 HAVING COUNT(*)>1))=0 AS 'Duplicate lines';
    ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN ('${HC}','${LC}'))=${a?2:0} AS 'PO checkpoint row count changed';
    ${a?`ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN ('${HC}','${LC}') AND last_successful_modified_at=DATETIME('${a}'))=2 AS 'PO checkpoint advanced during sync';`:''}
    MERGE ${T(H)} d USING ${T(hs)} s ON d.internal_id=s.internal_id
    WHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE THEN UPDATE SET ${hcols.filter(x=>x!=='internal_id').map(x=>`${x}=s.${x}`).join(',')},synced_at=CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT(${hcols.join(',')},synced_at,is_deleted,deleted_at) VALUES(${hcols.map(x=>`s.${x}`).join(',')},CURRENT_TIMESTAMP(),FALSE,NULL);
    DELETE FROM ${T(L)} WHERE po_internal_id IN (SELECT internal_id FROM ${T(hs)});
    INSERT INTO ${T(L)}(${lcols.join(',')},synced_at) SELECT ${lcols.join(',')},CURRENT_TIMESTAMP() FROM ${T(ls)};
    MERGE ${T(C)} d USING (SELECT '${HC}' AS record_type UNION ALL SELECT '${LC}' AS record_type) s ON d.record_type=s.record_type
    WHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());
    ASSERT (SELECT COUNT(*) FROM ${T(L)} l LEFT JOIN ${T(H)} h ON h.internal_id=l.po_internal_id WHERE h.internal_id IS NULL)=0 AS 'Orphan lines';
    COMMIT TRANSACTION;
    EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
    END;`;
  await atomicCommitWithGuard(sql,{hc:mapped.headers.length,lc:mapped.lines.length,wm},a??null);
  console.log('ATOMIC MERGE + LINE REPLACE + CHECKPOINT: SUCCESS');
  console.log('PURCHASE ORDER SYNC SUCCESS; RUN check.mjs + presence.mjs; NOT FINAL_PASS');
 }finally{for(const name of all){try{await dataset.table(name).delete({ignoreNotFound:true});}catch(e){console.error('Stage cleanup warning:',name,e.message);}}}
}
main().catch(e=>{console.error('PURCHASE ORDER ERROR:',e.stack??e);process.exitCode=1;});
