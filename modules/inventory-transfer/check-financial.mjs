// Module 14 Inventory Transfer: independent, read-only source/BQ reconciliation.
// Does not write, create, delete, or change checkpoints or scheduler state.
import {token,fetchHeaders,fetchLines,mapSource} from './mapping.mjs';
import {GROUPS} from './schema-contract.mjs';
import {query,T} from '../../common/bigquery-client.mjs';

const must=(test,msg)=>{if(!test)throw Error('MODULE 14 EXACT AUDIT BLOCKED: '+msg);};
const SCALE=1000000000n;
function decimal(value){
 if(value===null||value===undefined)return null;
 const s=String(value).trim();
 const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
 must(!!m,'invalid quantity '+s);
 const exp=Number(m[4]??0);
 must(Number.isSafeInteger(exp)&&Math.abs(exp)<100,'invalid decimal exponent '+s);
 const digits=BigInt(m[2]+(m[3]??''));
 const shift=9-(m[3]?.length??0)+exp;
 let scaled;
 if(shift>=0)scaled=digits*10n**BigInt(shift);
 else {const divisor=10n**BigInt(-shift);must(digits%divisor===0n,'quantity exceeds 9 decimal places '+s);scaled=digits/divisor;}
 return (m[1]==='-'?-scaled:scaled).toString();
}
function scalar(type,v){
 if(v==null)return null;
 if(type==='NUMERIC')return decimal(v);
 if(type==='BOOL')return v===true||String(v).toLowerCase()==='true'||String(v).toUpperCase()==='T'?'true':'false';
 if(typeof v==='object'&&v!==null&&'value' in v)v=v.value;
 if(type==='DATE')return String(v).slice(0,10);
 if(type==='DATETIME')return String(v).replace('T',' ').slice(0,19);
 return String(v);
}
function index(g,rows){
 const out=new Map();
 for(const r of rows){const k=JSON.stringify(g.key.map(f=>String(r[f]??'')));must(!out.has(k),'duplicate key '+g.table+' '+k);out.set(k,r);}
 return out;
}
async function compare(g,source){
 // CAST keeps DATE/DATETIME and exact NUMERIC values stable across the Node BigQuery driver.
 const cols=g.fields.map(([n])=>`CAST(\`${n}\` AS STRING) AS \`${n}\``).join(',');
 const rows=await query(`SELECT ${cols} FROM ${T(g.table)}`);
 const left=index(g,source),right=index(g,rows);
 let missingBQ=0,extraBQ=0,mismatchedFields=0;
 const samples={missingBQ:[],extraBQ:[],fields:[]};
 for(const [k,s] of left){
  const b=right.get(k);
  if(!b){missingBQ++;if(samples.missingBQ.length<4)samples.missingBQ.push(k);continue;}
  for(const [field,type] of g.fields){
   const a=scalar(type,s[field]),v=scalar(type,b[field]);
   if(a!==v){mismatchedFields++;if(samples.fields.length<5)samples.fields.push({key:k,field,source:a,bigquery:v});}
  }
 }
 for(const k of right.keys())if(!left.has(k)){extraBQ++;if(samples.extraBQ.length<4)samples.extraBQ.push(k);}
 const report={table:g.table,source:source.length,bigquery:rows.length,missingBQ,extraBQ,mismatchedFields,samples};
 console.log('EXACT_COMPARE',JSON.stringify(report));
 return {ok:missingBQ===0&&extraBQ===0&&mismatchedFields===0,rows};
}
function quantityAudit(lines,label){
 const totals=new Map(),locations=new Map();let positive=0,negative=0,nullAdjustment=0,mainline=0,zero=0;
 for(const r of lines){
  if(scalar('BOOL',r.is_mainline)==='true'){mainline++;continue;}
  if(r.quantity==null){
   must(String(r.memo??'').trim().toLowerCase()==='cost of sales adjustment',label+' unexpected NULL quantity '+r.line_unique_key);
   nullAdjustment++;continue;
  }
  const v=BigInt(decimal(r.quantity));
  if(v>0n)positive++;else if(v<0n)negative++;else zero++;
  const k=String(r.transfer_internal_id)+'|'+String(r.item_id);
  totals.set(k,(totals.get(k)??0n)+v);
  if(!locations.has(k))locations.set(k,new Set());locations.get(k).add(String(r.location_id));
 }
 const unbalanced=[...totals].filter(([,sum])=>sum!==0n);
 const singleLocation=[...locations].filter(([,ls])=>ls.size<2);
 const report={side:label,mainline,positive,negative,zero,nullAdjustment,itemGroups:totals.size,unbalanced:unbalanced.length,singleLocation:singleLocation.length,
  unbalancedSamples:unbalanced.slice(0,3).map(([key,value])=>({key,scaledValue:String(value)})),singleLocationSamples:singleLocation.slice(0,3).map(([key])=>key)};
 console.log('QUANTITY_BALANCE',JSON.stringify(report));
 return {ok:unbalanced.length===0&&singleLocation.length===0,report};
}
async function main(){
 must(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--audit-only'),'only --audit-only is permitted');
 console.log('MODULE 14 INVENTORY TRANSFER EXACT RECONCILIATION | STRICT READ ONLY');
 const cpNames=GROUPS.map(g=>`'${g.table}'`).join(',');
 const checkpoints=await query(`SELECT record_type, CAST(last_successful_modified_at AS STRING) AS watermark FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames}) ORDER BY record_type`);
 console.log('CHECKPOINT',JSON.stringify(checkpoints));
 must(checkpoints.length===2,'expected two Module 14 checkpoints');
 const names=new Set(checkpoints.map(c=>c.record_type));
 must(GROUPS.every(g=>names.has(g.table)),'checkpoint name mismatch');
 const watermarks=[...new Set(checkpoints.map(c=>String(c.watermark)))];
 must(watermarks.length===1&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(watermarks[0]),'checkpoint watermarks differ');
 const stages=await query(`SELECT table_name FROM ${T('INFORMATION_SCHEMA.TABLES')} WHERE STARTS_WITH(table_name,'_stage_invtrnfr_')`);
 console.log('STAGING_RESIDUE',JSON.stringify({count:stages.length,samples:stages.slice(0,5)}));
 must(stages.length===0,'staging tables remain; inspect before further writes');
 const deleted=await query(`SELECT internal_id FROM ${T(GROUPS[0].table)} WHERE is_deleted IS DISTINCT FROM FALSE OR deleted_at IS NOT NULL LIMIT 5`);
 console.log('DELETION_FLAGS',JSON.stringify({anomalies:deleted.length,samples:deleted}));
 must(deleted.length===0,'unexpected deletion state after initial backfill');
 const access=await token();console.log('OAuth: SUCCESS');
 const rawHeaders=await fetchHeaders(access);
 const rawLines=await fetchLines(access,rawHeaders.map(h=>h.internal_id));
 const mapped=mapSource(rawHeaders,rawLines);
 const headerAudit=await compare(GROUPS[0],mapped.headers);
 const lineAudit=await compare(GROUPS[1],mapped.lines);
 const a=quantityAudit(mapped.lines,'NetSuite');
 const b=quantityAudit(lineAudit.rows,'BigQuery');
 const latest=mapped.headers.map(h=>h.last_modified).sort().at(-1)??null;
 const checkpoint=watermarks[0];
 console.log('WATERMARK',JSON.stringify({checkpoint,latestLiveSource:latest,sourceAhead:latest>checkpoint}));
 const ok=headerAudit.ok&&lineAudit.ok&&a.ok&&b.ok&&a.report.mainline===mapped.headers.length&&b.report.mainline===headerAudit.rows.length&&JSON.stringify(a.report&&Object.fromEntries(Object.entries(a.report).filter(([k])=>!['side','unbalancedSamples','singleLocationSamples'].includes(k))))===JSON.stringify(Object.fromEntries(Object.entries(b.report).filter(([k])=>!['side','unbalancedSamples','singleLocationSamples'].includes(k))));
 if(!ok||latest!==checkpoint){
  console.error('MODULE 14 EXACT RECONCILIATION NEEDS_REVIEW: source may have changed since initial backfill; no write performed');
  process.exitCode=3;return;
 }
 console.log('MODULE 14 EXACT RECONCILIATION PASS',JSON.stringify({headers:mapped.headers.length,lines:mapped.lines.length,watermark:latest,checkpoints:2,quantityBalanced:true,fieldMismatches:0,bqWrites:0,schedulerChanges:0,otherModuleWrites:0}));
}
main().catch(err=>{console.error('MODULE 14 EXACT RECONCILIATION BLOCKED',err?.stack??String(err));process.exitCode=1;});
