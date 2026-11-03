import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,FROM,TO} from './mapping.mjs';
async function main(){
 const ns=new Set((await fetchHeaders(await token())).map(x=>String(x.internal_id)));
 const rows=await query(`SELECT internal_id FROM ${T('purchase_order_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const bq=new Set(rows.map(x=>String(x.internal_id)));
 const onlyNS=[...ns].filter(x=>!bq.has(x)),onlyBQ=[...bq].filter(x=>!ns.has(x));
 console.log(JSON.stringify({netSuite:ns.size,bigQuery:bq.size,onlyNetSuite:onlyNS,onlyBigQuery:onlyBQ},null,2));
 if(onlyNS.length||onlyBQ.length||rows.length!==bq.size)process.exitCode=3;else console.log('PURCHASE ORDER PRESENCE PASS');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
