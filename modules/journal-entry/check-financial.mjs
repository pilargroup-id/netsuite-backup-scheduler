// Module 13: independent read-only exact Journal Entry source-to-BigQuery reconciliation.
// Never writes checkpoints, tables, or scheduler state.
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {GROUPS} from './schema-contract.mjs';
import {query,T} from '../../common/bigquery-client.mjs';
import {fetchAll} from '../../common/netsuite-client.mjs';
import {matchDeletedRecordProof} from '../../common/verified-deletion-proof.mjs';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const must=(ok,msg)=>{if(!ok)throw Error('MODULE 13 AUDIT BLOCKED: '+msg);};
const SCALE=1000000000n;
function units(value){
 if(value==null)return null;
 let s=String(value).trim();
 const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
 must(m,'invalid exact decimal '+s);
 const exp=Number(m[4]??0),digits=m[2]+(m[3]??''),places=(m[3]??'').length-exp;
 must(Number.isSafeInteger(exp)&&Math.abs(exp)<100,'unsupported decimal exponent '+s);
 let n=BigInt(digits),shift=9-places;
 if(shift>=0)n*=10n**BigInt(shift);
 else {const divisor=10n**BigInt(-shift);must(n%divisor===0n,'more than 9 nonzero fractional digits '+s);n/=divisor;}
 return m[1]==='-'?-n:n;
}
function scalar(type,x){
 if(x==null)return null;
 if(type==='NUMERIC')return units(x).toString();
 if(type==='BOOL')return x===true||String(x).toLowerCase()==='true'||String(x).toUpperCase()==='T'?'true':'false';
 const v=typeof x==='object'&&'value' in x?x.value:x;
 if(type==='DATE')return String(v).slice(0,10);
 if(type==='DATETIME')return String(v).replace('T',' ').slice(0,19);
 return String(v);
}
function key(g,row){return JSON.stringify(g.key.map(k=>scalar('STRING',row[k])));}
function mapRows(g,rows){const out=new Map();for(const row of rows){const k=key(g,row);must(!out.has(k),`duplicate ${g.table} ${k}`);out.set(k,row);}return out;}
async function auditTable(g,source,verifiedDeleted){
 const cols=g.fields.map(([name])=>`CAST(\`${name}\` AS STRING) AS \`${name}\``).join(',');
 const rows=await query(`SELECT ${cols} FROM ${T(g.table)}${g===GROUPS[0]?' WHERE is_deleted=FALSE':''}`);
 const archived=rows.filter(r=>verifiedDeleted.has(String(r.journal_entry_id)));
 must(g!==GROUPS[0]||archived.length===0,'verified-deleted header incorrectly active');
 const active=rows.filter(r=>!verifiedDeleted.has(String(r.journal_entry_id)));
 console.log('RETAINED_VERIFIED_DELETION_HISTORY',JSON.stringify({table:g.table,retainedRows:archived.length}));
 const src=mapRows(g,source),bq=mapRows(g,active);
 let missingBQ=0,missingSource=0,fieldMismatches=0;
 const samples={missingBQ:[],missingSource:[],fields:[]};
 for(const [k,s] of src){const b=bq.get(k);if(!b){missingBQ++;if(samples.missingBQ.length<3)samples.missingBQ.push(k);continue;}
  for(const [f,type] of g.fields){const a=scalar(type,s[f]),z=scalar(type,b[f]);if(a!==z){fieldMismatches++;if(samples.fields.length<3)samples.fields.push({key:k,field:f,source:a,bigquery:z});}}
 }
 for(const k of bq.keys())if(!src.has(k)){missingSource++;if(samples.missingSource.length<3)samples.missingSource.push(k);}
 const report={table:g.table,source:source.length,bigquery:active.length,bigqueryTotal:rows.length,missingBQ,missingSource,fieldMismatches,samples};
 console.log('EXACT_COMPARE',JSON.stringify(report));
 return {ok:missingBQ===0&&missingSource===0&&fieldMismatches===0,report,rows:active};
}
function glAudit(rows,label){const totals=new Map(),books=new Set();for(const r of rows){must(r.posting===true||String(r.posting).toLowerCase()==='true',label+' nonposting GL '+r.journal_entry_id);const k=r.journal_entry_id+'|'+r.accounting_book_id;books.add(String(r.accounting_book_id));totals.set(k,(totals.get(k)??0n)+(units(r.debit)??0n)-(units(r.credit)??0n));}const bad=[...totals].filter(([,n])=>n!==0n);console.log('GL_BALANCE',JSON.stringify({side:label,groups:totals.size,books:[...books].sort(),imbalanced:bad.length,samples:bad.slice(0,3).map(([k,n])=>({key:k,differenceScaled:n.toString()}))}));return bad.length===0;}
function mirror(rowsA,rowsB,label){const sig=r=>JSON.stringify(['previous_doc_id','previous_line_id','next_doc_id','next_line_id','previous_type','next_type','link_type','applied_amount','last_modified'].map(f=>f==='applied_amount'?(units(r[f])?.toString()??null):r[f]??null));const a=rowsA.map(sig).sort(),b=rowsB.map(sig).sort();const same=a.length===b.length&&a.every((x,i)=>x===b[i]);console.log('LINK_MIRROR',JSON.stringify({side:label,previous:a.length,next:b.length,matched:same}));return same;}
async function main(){
 must(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--audit-only','only --audit-only allowed');
 console.log('MODULE 13 JOURNAL ENTRY EXACT FINANCIAL / DATA RECONCILIATION | READ ONLY');
 const cpNames=GROUPS.map(g=>`'${g.table}'`).join(',');
 const cp=await query(`SELECT record_type,CAST(last_successful_modified_at AS STRING) watermark FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames}) ORDER BY record_type`);
 console.log('CHECKPOINT',JSON.stringify(cp));
 must(cp.length===5,'expected exactly five Journal Entry checkpoints');
 const marks=[...new Set(cp.map(x=>x.watermark))];must(marks.length===1&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(marks[0]),'checkpoint watermarks must agree');
 const stage=await query(`SELECT table_name FROM ${T('INFORMATION_SCHEMA.TABLES')} WHERE STARTS_WITH(table_name,'_stage_je_')`);
 console.log('LEFTOVER_STAGING',JSON.stringify(stage));must(stage.length===0,'staging residue');
 const deletion=await query(`SELECT journal_entry_id,is_deleted,CAST(deleted_at AS STRING) AS deleted_at,CAST(transaction_date AS STRING) AS transaction_date FROM ${T(GROUPS[0].table)} WHERE COALESCE(is_deleted,FALSE)=TRUE OR is_deleted IS NULL OR deleted_at IS NOT NULL`);
 console.log('DELETION_FLAGS',JSON.stringify({rows:deletion.length,ids:deletion.slice(0,3).map(x=>x.journal_entry_id)}));
 const a=await token();console.log('OAuth: SUCCESS');
 const verifiedDeleted=new Set();
 if(deletion.length){
   const certificate=JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'deletion-identity.confirmed.json'),'utf8'));
   must(certificate.module==='journal-entry'&&certificate.transactionType==='Journal'&&certificate.recordtypeid==='journalentry'&&certificate.type==='JOURNALENTRY'&&certificate.independentlyVerified===true&&certificate.scope==='2026-10-01..open-ended','invalid journal deletion identity certificate');
   must(Array.isArray(certificate.evidenceRecordIds)&&certificate.evidenceRecordIds.length===3&&new Set(certificate.evidenceRecordIds.map(String)).size===3,'missing independent historical certificate evidence');
   for(const hist of certificate.evidenceRecordIds){
     const id=String(hist);must(/^[1-9][0-9]{0,14}$/.test(id),'invalid historical proof id');
     const proofs=await fetchAll(a,`SELECT recordid,recordtypeid,type,deleteddate,deletedby,context FROM deletedrecord WHERE recordid=${id}`);
     must(matchDeletedRecordProof(proofs,id,certificate).length===1,'historical deletion identity proof changed '+id);
     must((await fetchAll(a,`SELECT id,type FROM Transaction WHERE id=${id}`)).length===0,'historical deleted Journal visible '+id);
   }
   for(const row of deletion){
     const id=String(row.journal_entry_id);
     must(/^[1-9][0-9]{0,14}$/.test(id)&&!verifiedDeleted.has(id),'duplicate/invalid deleted header '+id);
     must(row.is_deleted===true&&row.deleted_at!=null&&row.transaction_date>='2026-10-01','invalid scoped deletion flags '+id);
     const proofs=await fetchAll(a,`SELECT recordid,recordtypeid,type,deleteddate,deletedby,context FROM deletedrecord WHERE recordid=${id}`);
     must(matchDeletedRecordProof(proofs,id,certificate).length===1,'missing unique independent deletedrecord proof '+id);
     must((await fetchAll(a,`SELECT id,type FROM Transaction WHERE id=${id}`)).length===0,'deleted Journal still visible in global Transaction '+id);
     verifiedDeleted.add(id);
   }
 }
 console.log('VERIFIED_HISTORICAL_DELETIONS',JSON.stringify({ids:[...verifiedDeleted],count:verifiedDeleted.size,independentExactProof:true,globalSourceAbsence:true,writeOperations:0}));
 const hs=await fetchHeaders(a),ids=hs.map(x=>x.internal_id);
 must(hs.every(h=>!verifiedDeleted.has(String(h.internal_id))),'historically deleted Journal has reappeared');
 const [ls,gs,ps,ns]=await Promise.all([fetchLines(a,ids),fetchGL(a,ids),fetchPreviousLinks(a,ids),fetchNextLinks(a,ids)]);
 const mapped=mapSource(hs,ls,gs,ps,ns);
 let clean=true;const bq={};for(const g of GROUPS){const result=await auditTable(g,mapped[g.source],verifiedDeleted);clean=clean&&result.ok;bq[g.source]=result.rows;}
 clean=glAudit(mapped.accountingLines,'NetSuite')&&clean;
 clean=glAudit(bq.accountingLines,'BigQuery')&&clean;
 clean=mirror(mapped.previousLinks,mapped.nextLinks,'NetSuite')&&clean;
 clean=mirror(bq.previousLinks,bq.nextLinks,'BigQuery')&&clean;
 const watermark=hs.map(x=>x.last_modified).filter(Boolean).sort().at(-1)??null;
 const fresh=watermark===marks[0];
 console.log('SOURCE_WATERMARK_CHECK',JSON.stringify({checkpoint:marks[0],latestLiveSource:watermark,liveSourceAheadOfCheckpoint:watermark>marks[0],sourceCount:hs.length}));
 if(!clean||!fresh){console.error('MODULE 13 EXACT FINANCIAL AUDIT NEEDS_REVIEW: source may have changed since initial sync; no write performed');process.exitCode=3;return;}
 console.log('MODULE 13 EXACT FINANCIAL AUDIT PASS',JSON.stringify({counts:mapped.counts,watermark,checkpoints:5,fieldMismatches:0,writeOperations:0,schedulerChanges:0}));
}
main().catch(e=>{console.error('MODULE 13 EXACT FINANCIAL AUDIT BLOCKED',e?.stack??String(e));process.exitCode=1;});
