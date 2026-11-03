// Module 11 Vendor Credit - exact field & GL reconciliation, read-only.
import {query,T} from '../../common/bigquery-client.mjs';
import {GROUPS,liveSource,sourceRows,storedRows,compareKeys,compareFields} from './reconcile-common.mjs';
const SCALE=1000000000n;
function units(v){if(v==null)return 0n;const s=String(v?.value??v);if(!/^-?\d+(?:\.\d{1,9})?$/.test(s))throw Error('Non-exact decimal '+s);const neg=s[0]==='-';const [i,f='']=s.replace('-','').split('.');const n=BigInt(i)*SCALE+BigInt(f.padEnd(9,'0'));return neg?-n:n;}
function glBalances(rows){const sums=new Map();for(const r of rows){const k=r.vendor_credit_id+'|'+r.accounting_book_id;sums.set(k,(sums.get(k)??0n)+units(r.debit)-units(r.credit));}return [...sums].filter(([,v])=>v!==0n).map(([key,delta])=>({key,deltaNano:delta.toString()}));}
async function main(){
 console.log('MODULE 11 VENDOR CREDIT EXACT FINANCIAL / FIELD RECONCILIATION | READ ONLY');
 const mapped=await liveSource();let failed=false;let storedGl=[];
 for(const g of GROUPS){const source=sourceRows(mapped,g),stored=await storedRows(g),r=compareKeys(source,stored,g),d=compareFields(r.a,r.b,g);
  console.log('EXACT_COMPARE',JSON.stringify({table:g.table,source:r.source,bigquery:r.bigquery,onlyNetSuite:r.onlyNetSuite,onlyBigQuery:r.onlyBigQuery,fieldMismatches:d.mismatches,missingSourceSample:r.onlyNetSuiteSample,missingBigQuerySample:r.onlyBigQuerySample,mismatchSample:d.samples}));
  if(r.onlyNetSuite||r.onlyBigQuery||r.source!==r.bigquery||d.mismatches)failed=true;
  if(g.source==='accountingLines')storedGl=stored;
 }
 const sourceImbalance=glBalances(mapped.accountingLines),targetImbalance=glBalances(storedGl);
 console.log('GL_BALANCE',JSON.stringify({sourceGroups: new Set(mapped.accountingLines.map(r=>r.vendor_credit_id+'|'+r.accounting_book_id)).size,sourceImbalanced:sourceImbalance.length,bigqueryImbalanced:targetImbalance.length,sourceSamples:sourceImbalance.slice(0,5),bigquerySamples:targetImbalance.slice(0,5)}));
 if(sourceImbalance.length||targetImbalance.length)failed=true;
 const rows=await query(`SELECT COUNTIF(is_deleted IS TRUE) AS deleted_count,COUNTIF(is_deleted IS NULL) AS null_deleted_count, COUNTIF(deleted_at IS NOT NULL) AS deleted_at_count FROM ${T('vendor_credit_headers')}`);
 const flags={deleted:Number(rows[0]?.deleted_count??0),null_is_deleted:Number(rows[0]?.null_deleted_count??0),deleted_at_not_null:Number(rows[0]?.deleted_at_count??0)};
 console.log('HEADER_DELETION_FLAGS',JSON.stringify(flags));if(Object.values(flags).some(v=>v!==0))failed=true;
 console.log('MODULE 11 EXACT FINANCIAL RECONCILIATION',failed?'BLOCKED':'PASS');if(failed)process.exitCode=1;
}
main().catch(e=>{console.error('MODULE 11 FINANCIAL RECONCILIATION BLOCKED',e?.stack??String(e));process.exitCode=1;});
