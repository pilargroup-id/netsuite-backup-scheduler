import {token,fetchAll} from '../../common/netsuite-client.mjs';
import {fetchHeaders,fetchLines,mapSource,FROM,TO,TYPE} from './mapping.mjs';
try {
 console.log(`ITEM RECEIPT PROBE | READ ONLY | ${FROM} to ${TO} | expected type ${TYPE}`);
 const access=await token();
 const headers=await fetchHeaders(access);
 console.log('Header count:',headers.length);
 console.log('Header samples:',JSON.stringify(headers.slice(0,3),null,2));
 if(!headers.length){console.log('NO RECEIPTS: confirm NetSuite permissions and transaction type.');process.exit(2);}
 const lines=await fetchLines(access,headers.slice(0,3).map(h=>h.internal_id));
 console.log('Raw line sample:',JSON.stringify(lines.slice(0,9),null,2));
 const mapped=mapSource(headers.slice(0,3),lines);
 console.log('Mapped header count:',mapped.headers.length,'mapped item line count:',mapped.lines.length);
 const candidates=await fetchAll(access,`SELECT transaction,transactionline,accountingbook,account,debit,credit,posting FROM TransactionAccountingLine WHERE transaction IN (${headers.slice(0,3).map(h=>Number(h.internal_id)).join(',')})`);
 console.log('GL samples:',JSON.stringify(candidates.slice(0,15),null,2));
 console.log('PROBE PASS; amount KPI NOT YET CERTIFIED');
} catch(e){console.error('ITEM RECEIPT PROBE ERROR:',e.message);process.exitCode=1;}
