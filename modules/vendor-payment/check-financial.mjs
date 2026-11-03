// Module 12 Vendor Payment - independent READ ONLY exact source/BQ reconciliation.
// Never writes BigQuery, checkpoint, staging, scheduler or any existing module.
import {query,T,DATASET} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {GROUPS} from './schema-contract.mjs';
import {fetchAll} from '../../common/netsuite-client.mjs';
import {matchDeletedRecordProof} from '../../common/verified-deletion-proof.mjs';
import fs from 'node:fs';
const CERT_URL=new URL('./deletion-identity.confirmed.json',import.meta.url);
const ID=/^[1-9][0-9]{0,14}$/;
function certifiedIdentity(){
  const c=JSON.parse(fs.readFileSync(CERT_URL,'utf8'));
  must(c.module==='vendor-payment'&&c.transactionType==='VendPymt'&&c.recordtypeid==='vendorpayment'&&c.type==='VENDORPAYMENT'&&c.independentlyVerified===true&&c.scope==='2026-10-01..open-ended','Deletion identity not certified');
  must(Array.isArray(c.evidenceRecordIds)&&c.evidenceRecordIds.length===3&&new Set(c.evidenceRecordIds).size===3&&c.evidenceRecordIds.every(x=>ID.test(x)),'Invalid independent evidence');
  return c;
}
async function verifiedHistoricalIds(access,source){
  const c=certifiedIdentity();
  const sourceIds=new Set(source.headers.map(h=>String(h.vendor_payment_id)));
  const stored=await query(`SELECT vendor_payment_id,FORMAT_DATE('%Y-%m-%d',transaction_date) AS transaction_date,is_deleted,deleted_at FROM ${T('vendor_payment_headers')} WHERE is_deleted IS TRUE OR deleted_at IS NOT NULL`);
  const verified=new Set();
  must(stored.length<=1000,'Excess historical deleted headers: fail closed');
  for(const h of stored){
    const id=String(h.vendor_payment_id);
    must(ID.test(id)&&h.transaction_date>='2026-10-01'&&h.is_deleted===true&&h.deleted_at!=null,'Bad deleted header state '+id);
    must(!sourceIds.has(id),'Verified-deleted header reappeared '+id);
    const evidence=await fetchAll(access,`SELECT recordid,recordtypeid,type,deleteddate,deletedby,context FROM deletedrecord WHERE recordid=${id}`);
    must(matchDeletedRecordProof(evidence,id,c).length===1,'Missing/nonunique deletedrecord proof '+id);
    const live=await fetchAll(access,`SELECT id,type FROM Transaction WHERE id=${id}`);
    must(live.length===0,'Deleted header visible globally '+id);
    must(!verified.has(id),'Duplicate historical deleted header '+id);
    verified.add(id);
  }
  console.log('VERIFIED_HISTORICAL_DELETIONS',JSON.stringify({ids:[...verified].sort(),count:verified.size,independentExactProof:true,globalSourceAbsence:true,writeOperations:0}));
  return verified;
}

const SCALE=1000000000n;
const val=x=>x&&typeof x==='object'&&'value' in x?x.value:x;
const str=x=>x==null?null:String(val(x));
const must=(ok,msg)=>{if(!ok)throw Error(msg);};
function decimal(v){if(v==null)return null;let s=str(v).trim();must(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s),'Invalid decimal '+s);let neg=s[0]==='-';if(/^[+-]/.test(s))s=s.slice(1);let [i,f='']=s.split('.');i=(i||'0').replace(/^0+(?=\d)/,'');f=f.replace(/0+$/,'');return i==='0'&&!f?'0':(neg?'-':'')+i+(f?'.'+f:'');}
function units(v){if(v==null)return 0n;const s=decimal(v);must(/^-?\d+(?:\.\d{1,9})?$/.test(s),'Non-exact decimal '+s);const neg=s[0]==='-';const [i,f='']=(neg?s.slice(1):s).split('.');const n=BigInt(i)*SCALE+BigInt(f.padEnd(9,'0'));return neg?-n:n;}
const canon=(v,t)=>v==null?null:t==='NUMERIC'||t==='BIGNUMERIC'?decimal(v):t==='BOOL'?(v===true||v==='T'||v==='true'?'true':v===false||v==='F'||v==='false'?'false':String(v)):t==='DATE'?str(v).slice(0,10):t==='DATETIME'?str(v).replace('T',' ').replace(/(?:\.0+)?Z?$/,''):str(v);
const key=(r,g)=>JSON.stringify(g.key.map(k=>str(r[k])));
const count=x=>Number(str(x)??0);
async function stored(g){const expr=g.fields.map(([n,t])=>t==='NUMERIC'||t==='BIGNUMERIC'?`CAST(${n} AS STRING) AS ${n}`:t==='DATE'?`FORMAT_DATE('%Y-%m-%d', ${n}) AS ${n}`:t==='DATETIME'?`FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', ${n}) AS ${n}`:n).join(',');return query(`SELECT ${expr} FROM ${T(g.table)}`);}
function index(rows,g,side){const m=new Map();const dup=[];for(const r of rows){const k=key(r,g);if(m.has(k))dup.push(k);else m.set(k,r);}return {m,dup};}
function compare(src,dst,g){const s=index(src,g,'source'),d=index(dst,g,'bq');let fields=0;const examples=[];for(const [k,a] of s.m){const b=d.m.get(k);if(!b)continue;for(const [f,t] of g.fields){const x=canon(a[f],t),y=canon(b[f],t);if(x!==y){fields++;if(examples.length<5)examples.push({key:k,field:f,source:x,bigquery:y});}}}const miss=[...s.m.keys()].filter(k=>!d.m.has(k)),extra=[...d.m.keys()].filter(k=>!s.m.has(k));return {source:src.length,bigquery:dst.length,duplicateSource:s.dup.length,duplicateBQ:d.dup.length,missingBQ:miss.length,missingSource:extra.length,fieldMismatches:fields,samples:{duplicates:s.dup.slice(0,3).concat(d.dup.slice(0,3)),missingBQ:miss.slice(0,3),missingSource:extra.slice(0,3),fields:examples}};}
function glAudit(rows,headers){const hm=new Map(headers.map(h=>[h.vendor_payment_id,h]));const sums=new Map();const mismatch=[];for(const r of rows){const h=hm.get(r.vendor_payment_id);if(!h){if(mismatch.length<5)mismatch.push({id:r.vendor_payment_id,error:'missing header'});continue;}if(Boolean(r.posting)!==Boolean(h.posting)&&mismatch.length<5)mismatch.push({id:r.vendor_payment_id,headerPosting:h.posting,glPosting:r.posting});const k=r.vendor_payment_id+'|'+r.accounting_book_id;sums.set(k,(sums.get(k)??0n)+units(r.debit)-units(r.credit));}const bad=[...sums].filter(([,n])=>n!==0n);return {groups:sums.size,imbalanced:bad.length,postingMismatchSample:mismatch,imbalanceSample:bad.slice(0,5).map(([key,n])=>({key,deltaNano:n.toString()}))};}
function linkAudit(p,n){const sig=r=>[r.vendor_payment_id,r.previous_doc_id,r.previous_line_id,r.next_doc_id,r.next_line_id,r.previous_type,r.next_type,r.link_type,decimal(r.applied_amount),r.last_modified].map(x=>x??'<NULL>').join('|');const a=new Map(),b=new Map();for(const r of p)a.set(sig(r),(a.get(sig(r))??0)+1);for(const r of n)b.set(sig(r),(b.get(sig(r))??0)+1);const diffs=[...new Set([...a.keys(),...b.keys()])].filter(k=>(a.get(k)??0)!==(b.get(k)??0));return {previous:p.length,next:n.length,discount:p.filter(r=>r.discount).length,mirrorDifferences:diffs.length,examples:diffs.slice(0,5)};}
async function main(){console.log('MODULE 12 VENDOR PAYMENT EXACT FINANCIAL + INTEGRITY AUDIT | READ ONLY');const cpRows=await query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark FROM ${T('sync_checkpoints')} WHERE record_type IN (${GROUPS.map(g=>`'${g.table}'`).join(',')}) ORDER BY record_type`);console.log('CHECKPOINT',JSON.stringify(cpRows));must(cpRows.length===5,'Expected five Module 12 checkpoints');must(new Set(cpRows.map(r=>r.watermark)).size===1,'Checkpoint watermarks not aligned');const wm=cpRows[0].watermark;
const [stage]=await Promise.all([query(`SELECT table_name FROM \`${DATASET}.INFORMATION_SCHEMA.TABLES\` WHERE STARTS_WITH(table_name,'_stage_vp_')`)]);console.log('LEFTOVER_STAGING',JSON.stringify(stage));must(stage.length===0,'Staging leftover exists');
const a=await token();const h=await fetchHeaders(a);const ids=h.map(r=>String(r.internal_id));const [l,gl,p,n]=await Promise.all([fetchLines(a,ids),fetchGL(a,ids),fetchPreviousLinks(a,ids),fetchNextLinks(a,ids)]);const source=mapSource(h,l,gl,p,n);const historical=await verifiedHistoricalIds(a,source);const all={};let failed=false;
for(const g of GROUPS){
  all[g.source]=await stored(g);
  const active=all[g.source].filter(r=>!historical.has(String(r.vendor_payment_id)));
  const retained=all[g.source].filter(r=>historical.has(String(r.vendor_payment_id)));
  const result=compare(source[g.source],active,g);
  console.log('EXACT_COMPARE',JSON.stringify({table:g.table,...result,bigqueryTotal:all[g.source].length,retainedVerifiedDeletionHistory:retained.length}));
  if(result.duplicateSource||result.duplicateBQ||result.missingBQ||result.missingSource||result.fieldMismatches)failed=true;
  if(g.source==='headers'&&retained.length!==historical.size)failed=true;
  // Historic child rows remain in BQ and are never compared as active source rows.
}
const sb=glAudit(source.accountingLines,source.headers),bb=glAudit(all.accountingLines,all.headers);console.log('GL_BALANCE_AND_POSTING',JSON.stringify({source:sb,bigquery:bb}));if(sb.imbalanced||bb.imbalanced||sb.postingMismatchSample.length||bb.postingMismatchSample.length)failed=true;
const sl=linkAudit(source.previousLinks,source.nextLinks),bl=linkAudit(all.previousLinks,all.nextLinks);console.log('APPLICATION_MIRROR',JSON.stringify({source:sl,bigquery:bl}));if(sl.mirrorDifferences||bl.mirrorDifferences)failed=true;
const livePosting=source.headers.reduce((acc,r)=>(acc[r.posting?'posting':'nonposting']++,acc),{posting:0,nonposting:0});console.log('POSTING_COUNTS',JSON.stringify(livePosting));
const [flags]=await query(`SELECT COUNTIF(is_deleted IS TRUE) AS deleted,COUNTIF(is_deleted IS NULL) AS null_is_deleted,COUNTIF(deleted_at IS NOT NULL) AS deleted_at FROM ${T('vendor_payment_headers')}`);console.log('DELETION_FLAGS',JSON.stringify(Object.fromEntries(Object.entries(flags).map(([k,v])=>[k,count(v)]))));if(count(flags.deleted)!==historical.size||count(flags.null_is_deleted)!==0||count(flags.deleted_at)!==historical.size)failed=true;
const sourceWatermark=source.headers.map(r=>r.last_modified).filter(Boolean).sort().at(-1)??null;console.log('SOURCE_WATERMARK_CHECK',JSON.stringify({checkpoint:wm,latestLiveSource:sourceWatermark,liveSourceAheadOfCheckpoint:sourceWatermark>wm,sourceCount:source.headers.length}));
if(sourceWatermark>wm)failed=true;console.log('MODULE 12 EXACT FINANCIAL AUDIT',failed?'BLOCKED':'PASS');if(failed)process.exitCode=1;
}
main().catch(e=>{console.error('MODULE 12 FINANCIAL AUDIT BLOCKED',e?.stack??String(e));process.exitCode=1;});
