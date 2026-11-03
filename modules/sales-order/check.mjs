import {FROM,TO,T,N,token,fetchHeaders,fetchLines,mapSource,query} from './mapping.mjs';
const cents = x => Math.round((N(x)+Number.EPSILON)*100);
const qty = x => x==null?null:Number(x).toFixed(6);
const k=l=>`${l.sales_order_internal_id}:${l.line_unique_key}`;
const fail=[];
function check(label,ok,note='') {console.log(`${label.padEnd(32)}: ${ok?'PASS':'FAIL'}${note?' | '+note:''}`);if(!ok)fail.push(label);}
async function main(){
 console.log('==========================================');console.log('SALES ORDER FINAL RECONCILIATION');console.log('==========================================');
 console.log(`Period ${FROM} .. ${TO} (READ ONLY)`);
 const access=await token();console.log('NetSuite OAuth: SUCCESS');
 const sourceHeaders=await fetchHeaders(access);const rawLines=await fetchLines(access,sourceHeaders.map(h=>h.id));const source=mapSource(sourceHeaders,rawLines);
 console.log(`NetSuite: headers=${source.headers.length}, lines=${source.lines.length}`);
 const bqHeaders=await query(`SELECT internal_id,tranid,CAST(transaction_date AS STRING) AS transaction_date,status,customer_id,subsidiary_id,currency_id,CAST(total_amount AS STRING) AS total_amount,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_modified) AS last_modified FROM ${T('sales_order_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const bqLines=await query(`SELECT l.sales_order_internal_id,l.line_unique_key,l.line_id,l.line_type,l.item_id,l.item_type,l.accounting_line_type,CAST(l.quantity AS STRING) AS quantity,CAST(l.rate AS STRING) AS rate,CAST(l.foreign_amount AS STRING) AS foreign_amount,CAST(l.net_amount AS STRING) AS net_amount,CAST(l.tax_amount AS STRING) AS tax_amount,l.location_id,l.units_id,l.memo,l.is_closed,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',l.last_modified) AS last_modified FROM ${T('sales_order_lines')} l INNER JOIN ${T('sales_order_headers')} h ON h.internal_id=l.sales_order_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);
 console.log(`BigQuery: headers=${bqHeaders.length}, lines=${bqLines.length}`);
 check('HEADER COUNT',source.headers.length===bqHeaders.length);
 check('DETAIL LINE COUNT',source.lines.length===bqLines.length);
 const sourceTotal=source.headers.reduce((s,h)=>s+cents(h.total_amount),0);
 const bigqueryTotal=bqHeaders.reduce((s,h)=>s+cents(h.total_amount),0);
 check('HEADER TOTAL EXACT CENTS',sourceTotal===bigqueryTotal,`NetSuite=${(sourceTotal/100).toFixed(2)} BigQuery=${(bigqueryTotal/100).toFixed(2)}`);
 const sourceHeadMap=new Map(source.headers.map(h=>[h.internal_id,h]));const targetHeadMap=new Map(bqHeaders.map(h=>[h.internal_id,h]));
 check('UNIQUE HEADER IDs',sourceHeadMap.size===source.headers.length&&targetHeadMap.size===bqHeaders.length);
 let headerMismatch=0;const examples=[];
 for(const [id,a] of sourceHeadMap){const b=targetHeadMap.get(id); if(!b||a.tranid!==b.tranid||a.transaction_date!==b.transaction_date||a.status!==b.status||a.customer_id!==b.customer_id||a.subsidiary_id!==b.subsidiary_id||a.currency_id!==b.currency_id||cents(a.total_amount)!==cents(b.total_amount)||a.last_modified!==b.last_modified){headerMismatch++;if(examples.length<8)examples.push(`HEADER ${id}`);}}
 for(const id of targetHeadMap.keys())if(!sourceHeadMap.has(id)){headerMismatch++;if(examples.length<8)examples.push(`EXTRA HEADER ${id}`);}
 check('HEADER FIELD-BY-FIELD MATCH',headerMismatch===0,`mismatch=${headerMismatch}`);
 const sourceLineMap=new Map(source.lines.map(l=>[k(l),l]));const targetLineMap=new Map(bqLines.map(l=>[k(l),l]));
 check('UNIQUE LINE KEYS',sourceLineMap.size===source.lines.length&&targetLineMap.size===bqLines.length);
 const stringCols=['line_id','line_type','item_id','item_type','accounting_line_type','location_id','units_id','memo','last_modified'];
 const decimalCols=['quantity','rate','foreign_amount','net_amount','tax_amount'];
 let lineMismatch=0;
 for(const [key,a] of sourceLineMap){const b=targetLineMap.get(key);let equal=Boolean(b);if(b){for(const c of stringCols){if((a[c]??null)!==(b[c]??null)){equal=false;break;}}if(equal)for(const c of decimalCols){if((a[c]==null)!==(b[c]==null)||a[c]!=null&& (c==='quantity'?qty(a[c])!==qty(b[c]):cents(a[c])!==cents(b[c]))){equal=false;break;}}if(Boolean(a.is_closed)!==Boolean(b.is_closed))equal=false;}
 if(!equal){lineMismatch++;if(examples.length<8)examples.push(`LINE ${key}`);}}
 for(const key of targetLineMap.keys())if(!sourceLineMap.has(key)){lineMismatch++;if(examples.length<8)examples.push(`EXTRA LINE ${key}`);}
 check('LINE FIELD-BY-FIELD MATCH',lineMismatch===0,`mismatch=${lineMismatch}`);
 const lineAmountSource=source.lines.reduce((s,l)=>s+cents(l.foreign_amount),0);
 const lineAmountTarget=bqLines.reduce((s,l)=>s+cents(l.foreign_amount),0);
 check('RAW LINE AMOUNT MATCH',lineAmountSource===lineAmountTarget,`NS signed=${(lineAmountSource/100).toFixed(2)} BQ signed=${(lineAmountTarget/100).toFixed(2)}`);
 const categories=[...new Set([...source.lines.map(l=>l.line_type),...bqLines.map(l=>l.line_type)])].sort();
 for(const c of categories)check(`CLASS ${c}`,source.lines.filter(l=>l.line_type===c).length===bqLines.filter(l=>l.line_type===c).length);
 const [integrity]=await query(`SELECT (SELECT COUNT(*) FROM (SELECT internal_id,COUNT(*) n FROM ${T('sales_order_headers')} GROUP BY 1 HAVING n>1)) AS dh,(SELECT COUNT(*) FROM (SELECT sales_order_internal_id,line_unique_key,COUNT(*) n FROM ${T('sales_order_lines')} GROUP BY 1,2 HAVING n>1)) AS dl,(SELECT COUNT(*) FROM ${T('sales_order_lines')} l LEFT JOIN ${T('sales_order_headers')} h ON l.sales_order_internal_id=h.internal_id WHERE h.internal_id IS NULL) AS orphans,(SELECT COUNT(*) FROM ${T('sales_order_headers')} h WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE AND NOT EXISTS(SELECT 1 FROM ${T('sales_order_lines')} l WHERE l.sales_order_internal_id=h.internal_id)) AS no_lines`);
 check('DUPLICATE HEADERS',N(integrity.dh)===0);
 check('DUPLICATE LINES',N(integrity.dl)===0);
 check('ORPHAN LINES',N(integrity.orphans)===0);
 check('HEADERS WITHOUT LINES',N(integrity.no_lines)===0);
 // Source mismatch between header and sum of lines is INFORMATIONAL, not a backup discrepancy.
 console.log('NOTE: SO rounding discounts can make sum(detail foreignamount) differ from foreigntotal by < 0.50 per order. This is preserved, not corrected.');
 if(examples.length)console.log('Mismatch examples:',examples.join(', '));
 console.log('\n==========================================');
 console.log(fail.length?'SALES ORDER CHECK: FAIL':'SALES ORDER CHECK: PASS');
 if(fail.length){console.log('Failed:',fail.join(', '));process.exitCode=1;}
 else console.log('NetSuite and BigQuery October SO snapshots match.');
}
main().catch(e=>{console.error('SALES ORDER FINAL CHECK ERROR:',e.stack??e);process.exitCode=1;});
