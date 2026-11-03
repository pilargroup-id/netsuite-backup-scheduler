// Exact all-field, all-grain source-to-BigQuery audit; values not rounded.
import {query,T} from '../../common/bigquery-client.mjs';
import {GROUPS,liveSource,sourceRows,storedRows,compareKeys,compareFields} from './reconcile-common.mjs';
async function main(){
 console.log('MODULE 10 CUSTOMER CREDIT MEMO B5 EXACT FINANCIAL / DATA RECONCILIATION | READ ONLY');
 const mapped=await liveSource();let failed=false;
 for(const group of GROUPS){const source=sourceRows(mapped,group),stored=await storedRows(group);const r=compareKeys(source,stored,group);const fields=compareFields(r.a,r.b,group);
  console.log('EXACT_COMPARE',JSON.stringify({table:group.table,source:r.source,bigquery:r.bigquery,onlyNetSuite:r.onlyNetSuite,onlyBigQuery:r.onlyBigQuery,fieldMismatches:fields.mismatches,missingSourceSample:r.onlyNetSuiteSample,missingBigQuerySample:r.onlyBigQuerySample,mismatchSample:fields.samples}));
  if(r.onlyNetSuite||r.onlyBigQuery||r.source!==r.bigquery||fields.mismatches)failed=true;
 }
 const header=await query(`SELECT COUNTIF(is_deleted IS TRUE) AS deleted_count,COUNTIF(is_deleted IS NULL) AS null_deleted_count,COUNTIF(is_deleted IS TRUE AND deleted_at IS NULL) AS missing_deleted_at FROM ${T('customer_credit_memo_headers')}`);
 const deleted=Number(header[0]?.deleted_count??0),nullable=Number(header[0]?.null_deleted_count??0),missingAt=Number(header[0]?.missing_deleted_at??0);
 // A verified soft-delete is valid history, not an active presence mismatch.
 // Incomplete/null deletion flags remain blockers.
 console.log('HEADER_DELETION_FLAGS',JSON.stringify({deleted,null_is_deleted:nullable,missing_deleted_at:missingAt}));if(nullable||missingAt)failed=true;
 const classifications=mapped.financialClassification.reduce((x,r)=>(x[r.classification]=(x[r.classification]??0)+1,x),{});
 console.log('SOURCE_CLASSIFICATIONS',JSON.stringify(classifications));
 console.log('B5 EXACT FINANCIAL RECONCILIATION:',failed?'BLOCKED':'PASS');if(failed)process.exitCode=1;
}
main().catch(e=>{console.error('B5 FINANCIAL BLOCKED:',e?.stack??String(e));process.exitCode=1;});
