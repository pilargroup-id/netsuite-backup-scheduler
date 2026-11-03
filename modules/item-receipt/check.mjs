import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,mapSource,FROM,TO} from './mapping.mjs';
async function main(){
 const access=await token(),headers=await fetchHeaders(access);
 const raw=headers.length?await fetchLines(access,headers.map(x=>x.internal_id)):[];
 const source=mapSource(headers,raw);
 const rows=await query(`SELECT (SELECT COUNT(*) FROM ${T('item_receipt_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE) AS hc,(SELECT COUNT(*) FROM ${T('item_receipt_lines')} l JOIN ${T('item_receipt_headers')} h ON h.internal_id=l.receipt_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE) AS lc,(SELECT COUNT(*) FROM (SELECT receipt_internal_id,line_unique_key FROM ${T('item_receipt_lines')} GROUP BY 1,2 HAVING COUNT(*)>1)) AS dup,(SELECT COUNT(*) FROM ${T('item_receipt_lines')} l LEFT JOIN ${T('item_receipt_headers')} h ON h.internal_id=l.receipt_internal_id WHERE h.internal_id IS NULL) AS orphan`);
 const c=rows[0];
 const bqh=await query(`SELECT internal_id FROM ${T('item_receipt_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const ns=new Set(source.headers.map(x=>x.internal_id)),bq=new Set(bqh.map(x=>x.internal_id));
 const onlyNS=[...ns].filter(x=>!bq.has(x)),onlyBQ=[...bq].filter(x=>!ns.has(x));
 console.log({source_headers:source.headers.length,bq_headers:Number(c.hc),source_lines:source.lines.length,bq_lines:Number(c.lc),only_ns:onlyNS.slice(0,20),only_bq:onlyBQ.slice(0,20),duplicate_lines:Number(c.dup),orphans:Number(c.orphan)});
 if(source.headers.length!==Number(c.hc)||source.lines.length!==Number(c.lc)||onlyNS.length||onlyBQ.length||Number(c.dup)||Number(c.orphan))throw Error('ITEM RECEIPT CHECK FAILED');
 console.log('ITEM RECEIPT CHECK: PASS (counts/presence/integrity ONLY)');
 console.log('AMOUNT KPI NOT CERTIFIED; NOT FINAL_PASS');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
