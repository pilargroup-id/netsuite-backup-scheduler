// Module 15 Phase G: incremental source/target discovery. STRICT READ ONLY.
// No mutation of any BigQuery tables/checkpoints or Windows tasks.
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,mapSource} from './mapping.mjs';
const must=(v,m)=>{if(!v)throw Error('MODULE 15 INCREMENTAL PREFLIGHT BLOCKED: '+m);};
const tables=['inventory_adjustment_headers','inventory_adjustment_lines','inventory_adjustment_accounting_lines'];
const fmt=x=>String(x??'').replace('T',' ').replace(/(?:\.\d+)?(?:Z|\+00(?::?00)?)$/,'').slice(0,19);
const toEpoch=(s,label)=>{must(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s),'invalid DATETIME '+label+': '+s);const v=Date.parse(s.replace(' ','T')+'Z');must(Number.isFinite(v),'invalid timestamp '+label+': '+s);return v;};
const num=(v,label)=>{const n=Number(v);must(Number.isSafeInteger(n)&&n>=0,'invalid count '+label);return n;};
async function main(){
 must(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--audit-only'),'usage: --audit-only (read only)');
 console.log('MODULE 15 INVENTORY ADJUSTMENT INCREMENTAL PREFLIGHT | STRICT READ ONLY');
 const cps=await query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark FROM ${T('sync_checkpoints')} WHERE record_type IN UNNEST(@tables) ORDER BY record_type`,{tables});
 must(cps.length===3&&new Set(cps.map(x=>x.record_type)).size===3&&tables.every(t=>cps.some(x=>x.record_type===t)),'expected 3 distinct Module15 checkpoints');
 must(new Set(cps.map(x=>x.watermark)).size===1,'Module15 checkpoints not aligned');
 const watermark=fmt(cps[0].watermark);const watermarkEpoch=toEpoch(watermark,'checkpoint');
 console.log('CHECKPOINT',JSON.stringify(cps));
 const counts={};for(const table of tables){const r=await query(`SELECT COUNT(*) AS n FROM ${T(table)}`);counts[table]=num(r[0]?.n,table);}
 console.log('BIGQUERY_COUNTS',JSON.stringify(counts));
 const active=await query(`SELECT CAST(internal_id AS STRING) AS internal_id, FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_modified) AS last_modified FROM ${T(tables[0])} WHERE is_deleted=FALSE`);
 const activeSet=new Set(active.map(x=>String(x.internal_id)));
 must(activeSet.size===active.length,'duplicate active BigQuery header IDs');
 const access=await token();console.log('OAuth: SUCCESS');
 const headers=await fetchHeaders(access);const ids=headers.map(x=>String(x.internal_id));const sourceSet=new Set(ids);
 must(sourceSet.size===ids.length,'duplicate source header IDs');
 const [lines,gl]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids)]);
 const {data,stats}=mapSource(headers,lines,gl);
 const newer=headers.filter(x=>toEpoch(fmt(x.last_modified),'source')>watermarkEpoch);
 const same=headers.filter(x=>toEpoch(fmt(x.last_modified),'source')===watermarkEpoch);
 const older=headers.filter(x=>toEpoch(fmt(x.last_modified),'source')<watermarkEpoch);
 const newIds=ids.filter(x=>!activeSet.has(x));
 const changedIds=newer.map(x=>String(x.internal_id)).filter(x=>activeSet.has(x));
 const missingIds=[...activeSet].filter(x=>!sourceSet.has(x));
 const report={checkpoint:watermark,sourceWatermark:stats.sourceWatermark,sourceHeaders:stats.headers,sourceLines:stats.lines,sourceAccountingLines:stats.accountingLines,sourceGlGroups:stats.glBooks,bigQueryCounts:counts,olderHeaders:older.length,atWatermarkHeaders:same.length,newerHeaders:newer.length,newHeaders:newIds.length,changedExistingHeaders:changedIds.length,activeBQHeadersAbsentFromSource:missingIds.length,newHeaderSamples:newIds.slice(0,8),changedHeaderSamples:changedIds.slice(0,8),unverifiedAbsenceSamples:missingIds.slice(0,8),sourceIsAhead:toEpoch(fmt(stats.sourceWatermark),'source watermark')>watermarkEpoch,bigQueryWrites:0,checkpointChanges:0,schedulerChanges:0,otherModuleWrites:0};
 console.log('INCREMENTAL_PREFLIGHT',JSON.stringify(report));
 if(missingIds.length)console.log('DELETION_CANDIDATES_UNVERIFIED',JSON.stringify({count:missingIds.length,note:'NO DELETE: requires independent NetSuite deletedrecord proof, source invisibility, and certified identity.'}));
 if(newer.length===0&&newIds.length===0&&missingIds.length===0)console.log('NO_INCREMENTAL_CANDIDATES_AT_THIS_SNAPSHOT');
 console.log('MODULE 15 PHASE G INCREMENTAL PREFLIGHT PASS: READ ONLY; NO SYNC PERFORMED');
}
main().catch(e=>{console.error('MODULE 15 PHASE G INCREMENTAL PREFLIGHT BLOCKED:',e?.stack??e);process.exitCode=1;});
