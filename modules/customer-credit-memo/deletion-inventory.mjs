// Module 10 only. Mirrors purchase-return/deletion-inventory.mjs. Read-only.
import {token,fetchHeaders} from './mapping.mjs';
import {query,T} from '../../common/bigquery-client.mjs';
const valid=x=>{const s=String(x??'');if(!/^[1-9][0-9]{0,14}$/.test(s))throw Error('Invalid credit memo ID '+s);return s;};
async function main(){
 const a=await token();const src=await fetchHeaders(a);
 const bq=await query(`SELECT credit_memo_id FROM ${T('customer_credit_memo_headers')} WHERE COALESCE(is_deleted,FALSE)=FALSE`);
 const nsIds=src.map(x=>valid(x.internal_id)),bqIds=bq.map(x=>valid(x.credit_memo_id));
 const ns=new Set(nsIds),stored=new Set(bqIds);
 const result={netSuite:nsIds.length,bigQuery:bqIds.length,
  onlyNetSuite:[...ns].filter(x=>!stored.has(x)).sort(),onlyBigQuery:[...stored].filter(x=>!ns.has(x)).sort(),
  sourceDuplicate:ns.size!==nsIds.length,bigQueryDuplicate:stored.size!==bqIds.length};
 console.log('CCM VERIFIED DELETION INVENTORY | READ ONLY');console.log(JSON.stringify(result));
 if(result.sourceDuplicate||result.bigQueryDuplicate||result.onlyNetSuite.length||result.onlyBigQuery.length)process.exitCode=3;
}
main().catch(e=>{console.error('CCM INVENTORY BLOCKED:',e.stack??e);process.exitCode=1;});
