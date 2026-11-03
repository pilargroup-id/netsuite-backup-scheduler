import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPriorLinks,mapSource,FROM,TO} from './mapping.mjs';
const defs=[
 {table:'purchase_invoice_headers',source:'headers',keys:['internal_id'],fields:['internal_id','document_number','transaction_date','last_modified','status','vendor_id','vendor_name','currency_id','currency_name','exchange_rate','signed_foreign_total','signed_base_total','posting_period_id','subsidiary_id'],numbers:['exchange_rate','signed_foreign_total','signed_base_total']},
 {table:'purchase_invoice_lines',source:'transactionLines',keys:['bill_internal_id','line_unique_key'],fields:['bill_internal_id','line_unique_key','line_id','line_number','line_type','item_id','quantity','rate','foreign_amount','net_amount','accounting_line_type','is_mainline','is_tax_line'],numbers:['quantity','rate','foreign_amount','net_amount']},
 {table:'purchase_invoice_accounting_lines',source:'accountingLines',keys:['bill_internal_id','accounting_book_id','line_id','account_id'],fields:['bill_internal_id','accounting_book_id','line_id','account_id','debit','credit','posting'],numbers:['debit','credit']},
 {table:'purchase_invoice_prior_links',source:'priorLinks',keys:['bill_internal_id','previous_document_id','link_type'],fields:['bill_internal_id','previous_document_id','link_type'],numbers:[]}
];
function dec(v){
 const s=String(v).trim(),m=s.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
 if(!m)throw Error('Invalid decimal: '+s);
 const whole=m[2]??'',fraction=m[3]??m[4]??'',exp=Number(m[5]??0);
 if(!Number.isSafeInteger(exp)||Math.abs(exp)>100)throw Error('Invalid decimal exponent '+s);
 let digits=(whole+fraction).replace(/^0+/,'')||'0';if(digits==='0')return '0';
 const shift=exp-fraction.length;
 if(shift>=0)digits+='0'.repeat(shift);
 else{const point=digits.length+shift;digits=point>0?digits.slice(0,point)+'.'+digits.slice(point):'0.'+'0'.repeat(-point)+digits;digits=digits.replace(/0+$/,'').replace(/\.$/,'');}
 return (m[1]==='-'?'-':'')+digits;
}
function norm(field,value,d){
 if(value===null||value===undefined)return null;
 if(d.numbers.includes(field))return dec(value);
 if(['is_mainline','is_tax_line','posting'].includes(field))return value===true||String(value).toLowerCase()==='true'||String(value)==='1'?'true':'false';
 return String(value);
}
function key(row,fields){return fields.map(x=>String(row[x]??'NULL')).join('\u001f');}
async function main(){
 console.log('PURCHASE INVOICE FULL OCT 2026 CHECK | READ ONLY');
 const access=await token(),headers=await fetchHeaders(access),ids=headers.map(h=>h.internal_id);
 if(!headers.length)throw Error('Empty NetSuite source');
 const [lines,gl,links]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchPriorLinks(access,ids)]);
 const mapped=mapSource(headers,lines,gl,links);
 const report={};let failed=false;const failures=[];
 for(const d of defs){
  const fieldsSql=d.fields.map(f=>f==='transaction_date'?`CAST(transaction_date AS STRING) AS transaction_date`:f==='last_modified'?`FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_modified) AS last_modified`:d.numbers.includes(f)?`CAST(${f} AS STRING) AS ${f}`:f).join(',');
  const sql=d.source==='headers'?`SELECT ${fieldsSql} FROM ${T(d.table)} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`:`SELECT ${d.fields.map(f=>f==='last_modified'?`FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',l.last_modified) AS last_modified`:d.numbers.includes(f)?`CAST(l.${f} AS STRING) AS ${f}`:`l.${f}`).join(',')} FROM ${T(d.table)} l JOIN ${T('purchase_invoice_headers')} h ON h.internal_id=l.bill_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`;
  const stored=await query(sql),source=mapped[d.source];
  const srcMap=new Map(),dstMap=new Map();let duplicates=0,mismatch=0,onlySource=0,onlyBq=0;
  for(const r of source){const k=key(r,d.keys);if(srcMap.has(k))duplicates++;srcMap.set(k,r);}
  for(const r of stored){const k=key(r,d.keys);if(dstMap.has(k))duplicates++;dstMap.set(k,r);}
  for(const [k,r] of srcMap){const b=dstMap.get(k);if(!b){onlySource++;if(failures.length<12)failures.push({table:d.table,key:k,issue:'MISSING_IN_BQ'});continue;}
   const differences=d.fields.filter(f=>norm(f,r[f],d)!==norm(f,b[f],d));
   if(differences.length){mismatch++;if(failures.length<12)failures.push({table:d.table,key:k,fields:differences.slice(0,8),source:Object.fromEntries(differences.slice(0,4).map(f=>[f,r[f]])),bq:Object.fromEntries(differences.slice(0,4).map(f=>[f,b[f]]))});}
  }
  for(const k of dstMap.keys())if(!srcMap.has(k))onlyBq++;
  const ok=source.length===stored.length&&!duplicates&&!mismatch&&!onlySource&&!onlyBq;
  report[d.table]={source:source.length,bigQuery:stored.length,duplicates,mismatch,onlySource,onlyBq,status:ok?'PASS':'FAIL'};
  if(!ok)failed=true;
 }
 // Check integrity across all persisted rows, not just October.
 const checks=await query(`SELECT
 (SELECT COUNT(*) FROM (SELECT internal_id FROM ${T('purchase_invoice_headers')} GROUP BY 1 HAVING COUNT(*)>1)) AS duplicate_headers,
 (SELECT COUNT(*) FROM (SELECT bill_internal_id,line_unique_key FROM ${T('purchase_invoice_lines')} GROUP BY 1,2 HAVING COUNT(*)>1)) AS duplicate_lines,
 (SELECT COUNT(*) FROM (SELECT bill_internal_id,accounting_book_id,line_id,account_id FROM ${T('purchase_invoice_accounting_lines')} GROUP BY 1,2,3,4 HAVING COUNT(*)>1)) AS duplicate_gl,
 (SELECT COUNT(*) FROM (SELECT bill_internal_id,previous_document_id,link_type FROM ${T('purchase_invoice_prior_links')} GROUP BY 1,2,3 HAVING COUNT(*)>1)) AS duplicate_links,
 (SELECT COUNT(*) FROM ${T('purchase_invoice_lines')} l LEFT JOIN ${T('purchase_invoice_headers')} h ON h.internal_id=l.bill_internal_id WHERE h.internal_id IS NULL) AS orphan_lines,
 (SELECT COUNT(*) FROM ${T('purchase_invoice_accounting_lines')} l LEFT JOIN ${T('purchase_invoice_headers')} h ON h.internal_id=l.bill_internal_id WHERE h.internal_id IS NULL) AS orphan_gl,
 (SELECT COUNT(*) FROM ${T('purchase_invoice_prior_links')} l LEFT JOIN ${T('purchase_invoice_headers')} h ON h.internal_id=l.bill_internal_id WHERE h.internal_id IS NULL) AS orphan_links`);
 if(Object.values(checks[0]).some(x=>Number(x)!==0))failed=true;
 console.log(JSON.stringify({tables:report,integrity:checks[0],samples:failures},null,2));
 if(failed)throw Error('PURCHASE INVOICE CHECK FAILED');
 console.log('PURCHASE INVOICE CHECK PASS (four-table field-by-field, source financial invariants, and integrity)');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
