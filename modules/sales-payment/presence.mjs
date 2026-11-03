import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,FROM,TO} from './mapping.mjs';

async function main(){
 console.log('SALES PAYMENT PRESENCE | OCT-DEC 2026 | READ ONLY');
 const source=await fetchHeaders(await token());
 const ns=new Set(source.map(x=>String(x.payment_id)));
 const rows=await query(`SELECT payment_id FROM ${T('sales_payment_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const bq=new Set(rows.map(x=>String(x.payment_id)));
 const onlyNetSuite=[...ns].filter(x=>!bq.has(x));
 const onlyBigQuery=[...bq].filter(x=>!ns.has(x));
 const deletionInventory=process.argv.includes('--deletion-inventory');
 const report={source:source.length,bigQuery:rows.length,sourceDuplicates:source.length-ns.size,bigQueryDuplicates:rows.length-bq.size,onlyNetSuite:deletionInventory?onlyNetSuite:onlyNetSuite.slice(0,30),onlyBigQuery:deletionInventory?onlyBigQuery:onlyBigQuery.slice(0,30),onlyNetSuiteCount:onlyNetSuite.length,onlyBigQueryCount:onlyBigQuery.length};
 console.log(JSON.stringify(report,null,2));
 if(!source.length||report.sourceDuplicates||report.bigQueryDuplicates||onlyNetSuite.length||onlyBigQuery.length){console.error('SALES PAYMENT PRESENCE NEEDS_REVIEW - possible source movement; rerun dry-run/sync before certification');process.exitCode=3;return;}
 console.log('SALES PAYMENT PRESENCE PASS');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
