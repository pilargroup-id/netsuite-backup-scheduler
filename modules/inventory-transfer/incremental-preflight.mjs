// Module 14 Inventory Transfer - incremental preflight, STRICT READ ONLY.
// This script does not mutate BigQuery, checkpoints, or scheduling.
import { token, fetchHeaders, fetchLines, mapSource } from './mapping.mjs';
import { query, T } from '../../common/bigquery-client.mjs';
import { GROUPS } from './schema-contract.mjs';
const fail = m => { throw new Error('MODULE 14 INCREMENTAL PREFLIGHT BLOCKED: ' + m); };
const cpKeys = GROUPS.map(g => `'${g.table}'`).join(',');
function epoch(s) { const n = Date.parse(String(s).replace(' ', 'T') + 'Z'); if(!Number.isFinite(n)) fail('invalid DATETIME: '+s); return n; }
async function main(){
 if(process.argv.length!==2 && !(process.argv.length===3 && process.argv[2]==='--audit-only')) fail('read-only --audit-only only');
 console.log('MODULE 14 INVENTORY TRANSFER INCREMENTAL PREFLIGHT | STRICT READ ONLY');
 const cp=await query(`SELECT record_type, CAST(last_successful_modified_at AS STRING) AS watermark FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpKeys}) ORDER BY record_type`);
 if(cp.length!==2 || new Set(cp.map(r=>r.record_type)).size!==2) fail('expected exactly two Module 14 checkpoints');
 if(cp[0].watermark!==cp[1].watermark) fail('header/line checkpoints are not aligned');
 const wm=cp[0].watermark;
 console.log('CHECKPOINT',JSON.stringify(cp));
 const counts={};
 for(const g of GROUPS){const r=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);counts[g.table]=Number(r[0]?.n??0);}
 console.log('BIGQUERY_COUNTS',JSON.stringify(counts));
 const a=await token();console.log('OAuth: SUCCESS');
 const headers=await fetchHeaders(a); const ids=headers.map(h=>String(h.internal_id));
 const seen=new Set(ids);if(seen.size!==ids.length)fail('duplicate source header id');
 const newer=headers.filter(h=>epoch(h.last_modified)>epoch(wm));
 const atWatermark=headers.filter(h=>epoch(h.last_modified)===epoch(wm));
 const older=headers.filter(h=>epoch(h.last_modified)<epoch(wm));
 const latest=headers.reduce((max,h)=>epoch(h.last_modified)>epoch(max)?h.last_modified:max,wm);
 // Fetch all source lines to detect how much load a safe full-snapshot diff would require.
 // Do not claim that unchanged header timestamps imply unchanged lines/deletions.
 const lines=await fetchLines(a,ids);const mapped=mapSource(headers,lines);
 const lineKeys=new Set(mapped.lines.map(l=>l.transfer_internal_id+'|'+l.line_unique_key));
 if(lineKeys.size!==mapped.lines.length)fail('duplicate source line unique key');
 const targetHeaders=await query(`SELECT CAST(internal_id AS STRING) AS id, CAST(last_modified AS STRING) AS modified FROM ${T('inventory_transfer_headers')} WHERE is_deleted=FALSE`);
 const targetIds=new Set(targetHeaders.map(h=>String(h.id)));
 if(targetIds.size!==targetHeaders.length)fail('duplicate BigQuery active headers');
 const newIds=ids.filter(id=>!targetIds.has(id));
 const absentIds=[...targetIds].filter(id=>!seen.has(id));
 const changedExisting=newer.filter(h=>targetIds.has(String(h.internal_id)));
 const report={checkpoint:wm,sourceHeaders:headers.length,sourceLines:lines.length,bqHeaders:counts.inventory_transfer_headers,bqLines:counts.inventory_transfer_lines,olderHeaders:older.length,atWatermarkHeaders:atWatermark.length,newerHeaders:newer.length,newHeaders:newIds.length,changedExistingHeaders:changedExisting.length,activeBQHeadersAbsentFromSource:absentIds.length,latestSourceModified:latest,sourceIsAhead:epoch(latest)>epoch(wm),candidateNewSamples:newIds.slice(0,8),candidateChangedSamples:changedExisting.slice(0,8).map(h=>({id:h.internal_id,last_modified:h.last_modified})),absentSourceSamples:absentIds.slice(0,8),sourceLineUniqueKeys:lineKeys.size,checkpointChanges:0,bqWrites:0,schedulerChanges:0};
 console.log('INCREMENTAL_PREFLIGHT',JSON.stringify(report));
 if(absentIds.length)console.log('DELETION_CANDIDATES_UNVERIFIED',JSON.stringify({count:absentIds.length,note:'DO NOT DELETE. Independent deletedrecord proof and source invisibility are required.'}));
 console.log('MODULE 14 INCREMENTAL PREFLIGHT PASS: READ ONLY; NO SYNC PERFORMED');
}
main().catch(e=>{console.error('MODULE 14 INCREMENTAL PREFLIGHT BLOCKED',e.stack??e.message);process.exitCode=1;});
