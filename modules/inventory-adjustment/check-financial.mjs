// Module 15 Phase F: strict read-only source versus BigQuery exact reconciliation.
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,mapSource,decimalExact,scaledDecimal} from './mapping.mjs';
const must=(v,m)=>{if(!v)throw Error(m);};
const groups=[
 {table:'inventory_adjustment_headers',source:'headers',key:['internal_id'],extra:['is_deleted','deleted_at']},
 {table:'inventory_adjustment_lines',source:'lines',key:['adjustment_internal_id','line_unique_key'],extra:[]},
 {table:'inventory_adjustment_accounting_lines',source:'accountingLines',key:['adjustment_internal_id','line_id','accounting_book_id','account_id'],extra:[]}
];
const decimalFields=new Set(['quantity','rate','foreign_amount','net_amount','debit','credit']);
const boolFields=new Set(['is_mainline','is_cogs','is_posting']);
const fields={
 headers:['internal_id','tranid','transaction_date','last_modified','memo','subsidiary_id','location_id','adjustment_account_id','posting_period_id','status_id'],
 lines:['adjustment_internal_id','line_id','line_unique_key','line_sequence_number','is_mainline','item_id','location_id','quantity','units_id','rate','foreign_amount','net_amount','memo','is_cogs','accounting_line_type'],
 accountingLines:['adjustment_internal_id','line_id','accounting_book_id','account_id','is_posting','debit','credit']
};
const norm=(v,f)=>v==null?null:decimalFields.has(f)?decimalExact(v,f):boolFields.has(f)?(v===true||String(v).toLowerCase()==='true'||String(v).toUpperCase()==='T'):String(v);
const key=(r,parts)=>JSON.stringify(parts.map(f=>norm(r[f],f)));
async function readTarget(g){const cols=fields[g.source].map(f=>decimalFields.has(f)?`CAST(\`${f}\` AS STRING) AS \`${f}\``:f==='last_modified'?`FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_modified) AS last_modified`:f==='transaction_date'?`CAST(transaction_date AS STRING) AS transaction_date`:`\`${f}\``).concat(g.extra.map(f=>f==='deleted_at'?`CAST(deleted_at AS STRING) AS deleted_at`:`\`${f}\``));return query(`SELECT ${cols.join(',')} FROM ${T(g.table)}`);}
function compare(g,src,tgt){const a=new Map(),b=new Map(),samples=[];for(const [rows,map,side] of [[src,a,'source'],[tgt,b,'bigquery']])for(const r of rows){const k=key(r,g.key);must(!map.has(k),`duplicate ${side} ${g.table} ${k}`);map.set(k,r);}
 let missingBQ=0,extraBQ=0,mismatchedFields=0;for(const [k,x] of a){const y=b.get(k);if(!y){missingBQ++;if(samples.length<6)samples.push({type:'missingBQ',key:k});continue;}for(const f of fields[g.source]){const v=norm(x[f],f),w=norm(y[f],f);if(v!==w){mismatchedFields++;if(samples.length<6)samples.push({type:'field',key:k,field:f,source:v,bigquery:w});}}}for(const [k] of b)if(!a.has(k)){extraBQ++;if(samples.length<6)samples.push({type:'extraBQ',key:k});}
 const result={table:g.table,source:src.length,bigquery:tgt.length,missingBQ,extraBQ,mismatchedFields,samples};console.log('EXACT_COMPARE',JSON.stringify(result));must(!missingBQ&&!extraBQ&&!mismatchedFields,'exact comparison failed: '+g.table);return result;}
function glBalance(rows,side){const sums=new Map();for(const r of rows){if(!r.is_posting)continue;const k=JSON.stringify([r.adjustment_internal_id,r.accounting_book_id]);sums.set(k,(sums.get(k)??0n)+(scaledDecimal(r.debit)??0n)-(scaledDecimal(r.credit)??0n));}const bad=[...sums].filter(([,v])=>v!==0n);console.log('GL_BALANCE',JSON.stringify({side,groups:sums.size,unbalanced:bad.length,samples:bad.slice(0,5).map(([key,value])=>({key,unscaled:value.toString()}))}));must(!bad.length,'unbalanced GL on '+side);}
try{
 console.log('MODULE 15 INVENTORY ADJUSTMENT EXACT RECONCILIATION | STRICT READ ONLY');
 const cpNames=groups.map(g=>g.table);
 const cp=await query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark FROM ${T('sync_checkpoints')} WHERE record_type IN UNNEST(@names) ORDER BY record_type`,{names:cpNames});
 console.log('CHECKPOINT',JSON.stringify(cp));must(cp.length===3&&new Set(cp.map(r=>r.watermark)).size===1,'three aligned Module15 checkpoints required');
 const auth=await token();const headers=await fetchHeaders(auth);const ids=headers.map(h=>h.internal_id);const [lines,gl]=await Promise.all([fetchLines(auth,ids),fetchGL(auth,ids)]);const {data,stats}=mapSource(headers,lines,gl);
 const target={};for(const g of groups)target[g.source]=await readTarget(g);
 const flags=target.headers.filter(r=>r.is_deleted!==false||r.deleted_at!=null);console.log('DELETION_FLAGS',JSON.stringify({anomalies:flags.length,samples:flags.slice(0,5).map(r=>r.internal_id)}));must(flags.length===0,'unexpected deletion flags');
 for(const g of groups)compare(g,data[g.source],target[g.source]);
 glBalance(data.accountingLines,'NetSuite');glBalance(target.accountingLines,'BigQuery');
 console.log('WATERMARK',JSON.stringify({checkpoint:cp[0].watermark,latestLiveSource:stats.sourceWatermark,sourceAhead:stats.sourceWatermark>cp[0].watermark}));must(stats.sourceWatermark===cp[0].watermark,'source watermark differs from checkpoint; scheduled source may have advanced');
 console.log('MODULE 15 EXACT RECONCILIATION PASS',JSON.stringify({headers:stats.headers,lines:stats.lines,accountingLines:stats.accountingLines,watermark:cp[0].watermark,bqWrites:0,checkpointChanges:0,schedulerChanges:0,otherModuleWrites:0}));
}catch(e){console.error('MODULE 15 EXACT RECONCILIATION NEEDS_REVIEW:',e?.stack??e);process.exitCode=1;}
