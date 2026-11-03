// Exact identity presence for all six Customer Credit Memo tables. No writes.
import {GROUPS,liveSource,sourceRows,storedRows,compareKeys} from './reconcile-common.mjs';
async function main(){
 console.log('MODULE 10 CUSTOMER CREDIT MEMO B5 EXACT PRESENCE | READ ONLY | NO SCHEDULER CHANGES');
 const mapped=await liveSource();let failed=false;
 for(const group of GROUPS){const source=sourceRows(mapped,group),stored=await storedRows(group);const r=compareKeys(source,stored,group);
  console.log('PRESENCE',JSON.stringify({table:group.table,source:r.source,bigquery:r.bigquery,onlyNetSuite:r.onlyNetSuite,onlyBigQuery:r.onlyBigQuery,onlyNetSuiteSample:r.onlyNetSuiteSample,onlyBigQuerySample:r.onlyBigQuerySample}));
  if(r.onlyNetSuite||r.onlyBigQuery||r.source!==r.bigquery)failed=true;
 }
 console.log('B5 EXACT PRESENCE:',failed?'BLOCKED':'PASS');if(failed)process.exitCode=1;
}
main().catch(e=>{console.error('B5 EXACT PRESENCE BLOCKED:',e?.stack??String(e));process.exitCode=1;});
