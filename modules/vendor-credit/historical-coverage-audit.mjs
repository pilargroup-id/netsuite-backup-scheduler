// Module 11 VendCred — standalone read-only historical and modified-date coverage audit.
// No BigQuery DML/DDL, scheduler, checkpoint, file writes, or deletion operations.
import {token,fetchAll} from '../../common/netsuite-client.mjs';
import {query,T} from '../../common/bigquery-client.mjs';
import {FROM,TO} from './mapping.mjs';
if(process.argv.length!==3||process.argv[2]!=='--dry-run')throw Error('Usage: node modules/vendor-credit/historical-coverage-audit.mjs --dry-run');
const must=(v,msg)=>{if(!v)throw Error('VENDOR CREDIT COVERAGE AUDIT BLOCKED: '+msg);};
const int=x=>{const v=String(x?.value??x??'');must(/^\d+$/.test(v),'Invalid integer '+v);return BigInt(v);};
async function main(){
 console.log('MODULE 11 VENDOR CREDIT HISTORICAL COVERAGE | READ ONLY');
 console.log('CURRENT MAPPING TRANSACTION WINDOW',FROM,'to',TO,'exclusive');
 const cps=await query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS wm FROM ${T('sync_checkpoints')} WHERE record_type IN UNNEST(@names)`,{names:['vendor_credit_headers','vendor_credit_lines','vendor_credit_accounting_lines','vendor_credit_previous_links','vendor_credit_next_links']});
 must(cps.length===5&&new Set(cps.map(x=>x.record_type)).size===5,'Require exactly five module checkpoints');
 must(new Set(cps.map(x=>x.wm)).size===1&&cps[0].wm,'Inconsistent checkpoint');
 const wm=cps[0].wm;must(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(wm),'Invalid checkpoint');
 console.log('CHECKPOINT',wm);
 const a=await token();console.log('OAuth: SUCCESS');
 const base="t.type='VendCred'";
 const inside=`t.trandate>=TO_DATE('${FROM}','YYYY-MM-DD') AND t.trandate<TO_DATE('${TO}','YYYY-MM-DD')`;
 const reports=[
  ['ALL_HISTORY',`SELECT COUNT(*) AS n,MIN(TO_CHAR(t.trandate,'YYYY-MM-DD')) AS earliest_date,MAX(TO_CHAR(t.trandate,'YYYY-MM-DD')) AS latest_date,MAX(TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS')) AS latest_modified FROM Transaction t WHERE ${base}`],
  ['IN_WINDOW',`SELECT COUNT(*) AS n FROM Transaction t WHERE ${base} AND ${inside}`],
  ['OUTSIDE_WINDOW',`SELECT COUNT(*) AS n FROM Transaction t WHERE ${base} AND NOT (${inside})`],
  ['MODIFIED_AFTER_CHECKPOINT_ALL',`SELECT COUNT(*) AS n FROM Transaction t WHERE ${base} AND t.lastmodifieddate>TO_DATE('${wm}','YYYY-MM-DD HH24:MI:SS')`],
  ['MODIFIED_AFTER_CHECKPOINT_OUTSIDE',`SELECT COUNT(*) AS n FROM Transaction t WHERE ${base} AND NOT (${inside}) AND t.lastmodifieddate>TO_DATE('${wm}','YYYY-MM-DD HH24:MI:SS')`],
  ['OLDEST_OUTSIDE_SAMPLES',`SELECT t.id AS internal_id,TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified FROM Transaction t WHERE ${base} AND NOT (${inside}) ORDER BY t.trandate,t.id FETCH FIRST 15 ROWS ONLY`],
  ['RECENTLY_MODIFIED_OUTSIDE_SAMPLES',`SELECT t.id AS internal_id,TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified FROM Transaction t WHERE ${base} AND NOT (${inside}) ORDER BY t.lastmodifieddate DESC,t.id FETCH FIRST 15 ROWS ONLY`]
 ];
 const result={};for(const [name,sql] of reports){const rows=await fetchAll(a,sql);result[name]=rows;console.log(name,JSON.stringify(rows));}
 const all=int(result.ALL_HISTORY[0]?.n),inWin=int(result.IN_WINDOW[0]?.n),outside=int(result.OUTSIDE_WINDOW[0]?.n);
 must(all===inWin+outside,'Window partition count mismatch');
 const modifiedAll=int(result.MODIFIED_AFTER_CHECKPOINT_ALL[0]?.n),modifiedOutside=int(result.MODIFIED_AFTER_CHECKPOINT_OUTSIDE[0]?.n);
 must(modifiedOutside<=modifiedAll,'Modified partition invalid');
 console.log('COVERAGE RESULT',JSON.stringify({status:'AUDIT_COMPLETE_REVIEW_REQUIRED',historyCount:all.toString(),inWindowCount:inWin.toString(),outsideWindowCount:outside.toString(),modifiedAfterCheckpointAll:modifiedAll.toString(),modifiedAfterCheckpointOutside:modifiedOutside.toString(),incrementalWriterAuthorized:false,writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0}));
}
main().catch(e=>{console.error('COVERAGE AUDIT FAILED',e?.stack??String(e));process.exitCode=1;});
