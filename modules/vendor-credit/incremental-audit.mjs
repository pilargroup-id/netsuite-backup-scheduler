// Module 11 Vendor Credit - standalone READ-ONLY incremental readiness audit.
// No source sync, BigQuery writes, checkpoint updates, deletion, or scheduler edits.
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource,FROM,TO} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
import {sourceRows,storedRows,compareKeys,compareFields} from './reconcile-common.mjs';
import {validateNumeric} from '../../common/decimal-precision.mjs';

if(process.argv.length!==3||process.argv[2]!=='--dry-run')throw Error('Usage: node modules/vendor-credit/incremental-audit.mjs --dry-run');
const fail=(m)=>{throw Error('MODULE 11 INCREMENTAL AUDIT BLOCKED: '+m);};
const val=x=>x&&typeof x==='object'&&'value' in x?x.value:x;
const scale=1000000000n;
function units(x){if(x==null)return 0n;const n=validateNumeric(x,{module:'vendor-credit',field:'gl'});if(!/^-?\d+(\.\d{1,9})?$/.test(n))fail('Unexpected decimal '+n);const neg=n.startsWith('-');const [i,f='']=n.replace('-','').split('.');const out=BigInt(i)*scale+BigInt(f.padEnd(9,'0'));return neg?-out:out;}
async function main(){
 console.log('MODULE 11 VENDOR CREDIT INCREMENTAL READINESS | DRY RUN | NO WRITES');
 console.log('SOURCE TRANSACTION-DATE COVERAGE:',FROM,'through',TO,'(exclusive)');
 const cpRows=await query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) watermark FROM ${T('sync_checkpoints')} WHERE record_type IN UNNEST(@names)`,{names:GROUPS.map(g=>g.table)});
 if(cpRows.length!==GROUPS.length||new Set(cpRows.map(r=>r.record_type)).size!==GROUPS.length)fail('Five unique module checkpoints required');
 const cps=new Set(cpRows.map(r=>r.watermark));if(cps.size!==1||![...cps][0])fail('Divergent/empty module checkpoint');const cp=[...cps][0];
 console.log('MODULE CHECKPOINT',cp);
 const access=await token();console.log('OAuth: SUCCESS');
 const headers=await fetchHeaders(access),ids=headers.map(r=>String(r.internal_id));
 if(ids.length!==new Set(ids).size)fail('Duplicate source header ids');
 const [lines,gl,previous,next]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchPreviousLinks(access,ids),fetchNextLinks(access,ids)]);
 const mapped=mapSource(headers,lines,gl,previous,next);
 const balances=new Map();for(const r of mapped.accountingLines){if(!r.posting)fail('Non-posting GL '+r.vendor_credit_id);const k=r.vendor_credit_id+'|'+r.accounting_book_id;balances.set(k,(balances.get(k)||0n)+units(r.debit)-units(r.credit));}for(const [k,v] of balances)if(v!==0n)fail('Unbalanced GL '+k);
 const signature=r=>JSON.stringify([r.vendor_credit_id,r.previous_doc_id,r.previous_line_id,r.next_doc_id,r.next_line_id,r.previous_type,r.next_type,r.link_type,r.relationship_class,r.applied_amount,r.last_modified]);
 const a=mapped.previousLinks.map(signature).sort(),b=mapped.nextLinks.map(signature).sort();if(a.length!==b.length||a.some((v,i)=>v!==b[i]))fail('Previous/next link mirror mismatch');
 const changes=[];
 for(const g of GROUPS){
  const source=sourceRows(mapped,g),stored=await storedRows(g);const keyCheck=compareKeys(source,stored,g);const fields=compareFields(keyCheck.a,keyCheck.b,g);
  const report={table:g.table,source:keyCheck.source,bigquery:keyCheck.bigquery,onlyNetSuite:keyCheck.onlyNetSuite,onlyBigQuery:keyCheck.onlyBigQuery,fieldMismatches:fields.mismatches,examples:fields.samples};
  console.log('EXACT_AUDIT',JSON.stringify(report));if(report.onlyNetSuite||report.onlyBigQuery||report.fieldMismatches)changes.push(report);
  const [schema]=await (await import('../../common/bigquery-client.mjs')).dataset.table(g.table).getMetadata();
  const expected=columnDefinitions(g),actual=schema.schema?.fields??[];if(actual.length!==expected.length)fail('Schema size '+g.table);
  for(const [name,type] of expected){const f=actual.find(x=>x.name.toLowerCase()===name.toLowerCase());if(!f||(f.type.toUpperCase()==='BOOLEAN'?'BOOL':f.type.toUpperCase())!==type)fail('Schema field '+g.table+'.'+name);}
 }
 const wm=headers.map(h=>h.last_modified).filter(Boolean).sort().at(-1);if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(wm??''))fail('Invalid source watermark');
 const late=headers.filter(h=>h.last_modified>cp).length;
 console.log('SOURCE WATERMARK',wm,'HEADERS AFTER CHECKPOINT',late);
 const status=changes.length?'SOURCE_TARGET_DRIFT_REVIEW_REQUIRED':'PASS_NO_CHANGE';
 console.log('MODULE 11 INCREMENTAL READINESS RESULT',JSON.stringify({status,counts:mapped.counts,checkpoint:cp,sourceWatermark:wm,glGroups:balances.size,mirroredLinks:a.length,driftTables:changes.map(r=>r.table),writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0,coverageCaveat:'Transaction date currently restricted to '+FROM+' .. '+TO}));
 if(changes.length)process.exitCode=2;
}
main().catch(e=>{console.error('MODULE 11 INCREMENTAL AUDIT ERROR',e?.stack??String(e));process.exitCode=1;});
