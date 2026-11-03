import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,FROM,TO} from './mapping.mjs';
async function main(){
 console.log('PURCHASE INVOICE PRESENCE | READ ONLY');
 const source=await fetchHeaders(await token());
 const ns=new Set(source.map(x=>String(x.internal_id)));
 const rows=await query(`SELECT internal_id FROM ${T('purchase_invoice_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const bq=new Set(rows.map(x=>String(x.internal_id)));
 const onlyNetSuite=[...ns].filter(x=>!bq.has(x));
 const onlyBigQuery=[...bq].filter(x=>!ns.has(x));
 console.log(JSON.stringify({netSuite:ns.size,bigQuery:bq.size,onlyNetSuite,onlyBigQuery,sourceDuplicate:ns.size!==source.length,bigQueryDuplicate:bq.size!==rows.length},null,2));
 if(!source.length||ns.size!==source.length||bq.size!==rows.length)
  throw Error('PURCHASE INVOICE PRESENCE INTEGRITY FAILED');
if(onlyNetSuite.length||onlyBigQuery.length){
  console.log('PURCHASE INVOICE PRESENCE NEEDS_REVIEW');
  process.exitCode=3;
  return;
}
 console.log('PURCHASE INVOICE PRESENCE PASS');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
