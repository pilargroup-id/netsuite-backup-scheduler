import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchApplications,mapSource,FROM,TO} from './mapping.mjs';
const definitions=[
 {table:'sales_payment_headers',source:'headers',keys:['payment_id'],fields:['payment_id','document_number','transaction_date','last_modified','status_id','customer_id','customer_name','currency_id','currency_name','exchange_rate','foreign_total','base_total','amount_used','amount_unused','posting_period_id','subsidiary_id','is_void'],numbers:['exchange_rate','foreign_total','base_total','amount_used','amount_unused'],booleans:['is_void']},
 {table:'sales_payment_lines',source:'transactionLines',keys:['payment_id','line_unique_key'],fields:['payment_id','line_unique_key','line_id','line_number','is_mainline','is_tax_line','accounting_line_type','account_id','foreign_amount','net_amount'],numbers:['foreign_amount','net_amount'],booleans:['is_mainline','is_tax_line']},
 {table:'sales_payment_accounting_lines',source:'accountingLines',keys:['payment_id','accounting_book_id','line_id','account_id'],fields:['payment_id','accounting_book_id','line_id','account_id','posting','debit','credit'],numbers:['debit','credit'],booleans:['posting']},
 {table:'sales_payment_applications',source:'applications',keys:['payment_id','invoice_id','payment_line_id','invoice_line_id'],fields:['payment_id','invoice_id','payment_line_id','invoice_line_id','link_type','applied_amount'],numbers:['applied_amount'],booleans:[]}
];
function decimal(v){
 if(v===null||v===undefined)return null;
 const s=String(typeof v==='object'&&v.value!==undefined?v.value:v).trim();
 const m=s.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
 if(!m)throw Error('Invalid decimal '+s);
 const frac=m[3]??m[4]??'', exponent=Number(m[5]??0);
 if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>100)throw Error('Invalid exponent '+s);
 let digits=((m[2]??'')+frac).replace(/^0+/,'')||'0';if(digits==='0')return '0';
 const offset=exponent-frac.length;
 if(offset>=0)digits+='0'.repeat(offset);
 else{const pos=digits.length+offset;digits=pos>0?digits.slice(0,pos)+'.'+digits.slice(pos):'0.'+'0'.repeat(-pos)+digits;digits=digits.replace(/0+$/,'').replace(/\.$/,'');}
 return (m[1]==='-'?'-':'')+digits;
}
function norm(d,f,v){
 if(v===null||v===undefined)return null;
 if(d.numbers.includes(f))return decimal(v);
 if(d.booleans.includes(f))return v===true||String(v).toLowerCase()==='true'||String(v)==='1'?'true':'false';
 return String(v);
}
function key(r,fields){return fields.map(x=>String(r[x]??'NULL')).join('\u001f');}
async function main(){
 console.log('SALES PAYMENT FULL FIELD RECONCILIATION | READ ONLY');
 const access=await token(),headers=await fetchHeaders(access),ids=headers.map(h=>h.payment_id);
 if(!headers.length)throw Error('Empty NetSuite source');
 const [lines,gl,apps]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchApplications(access,ids)]);
 const mapped=mapSource(headers,lines,gl,apps);
 const report={},samples=[];let failed=false;
 for(const d of definitions){
  const alias=d.source==='headers'?'h':'l';
  const cols=d.fields.map(f=>f==='transaction_date'?`CAST(${alias}.transaction_date AS STRING) AS transaction_date`:f==='last_modified'?`FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',${alias}.last_modified) AS last_modified`:d.numbers.includes(f)?`CAST(${alias}.${f} AS STRING) AS ${f}`:`${alias}.${f} AS ${f}`).join(',');
  const sql=d.source==='headers'?`SELECT ${cols} FROM ${T(d.table)} h WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`:`SELECT ${cols} FROM ${T(d.table)} l JOIN ${T('sales_payment_headers')} h ON h.payment_id=l.payment_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`;
  const stored=await query(sql),source=mapped[d.source];let duplicates=0,mismatch=0,onlySource=0,onlyBigQuery=0;
  const a=new Map(),b=new Map();
  for(const r of source){const k=key(r,d.keys);if(a.has(k))duplicates++;a.set(k,r);}
  for(const r of stored){const k=key(r,d.keys);if(b.has(k))duplicates++;b.set(k,r);}
  for(const [k,r] of a){const target=b.get(k);if(!target){onlySource++;if(samples.length<12)samples.push({table:d.table,key:k,issue:'MISSING_IN_BIGQUERY'});continue;}
   const different=d.fields.filter(f=>norm(d,f,r[f])!==norm(d,f,target[f]));
   if(different.length){mismatch++;if(samples.length<12)samples.push({table:d.table,key:k,fields:different.slice(0,6),source:Object.fromEntries(different.slice(0,3).map(f=>[f,r[f]])),bigQuery:Object.fromEntries(different.slice(0,3).map(f=>[f,target[f]]))});}
  }
  for(const k of b.keys())if(!a.has(k))onlyBigQuery++;
  const ok=source.length===stored.length&&!duplicates&&!mismatch&&!onlySource&&!onlyBigQuery;
  report[d.table]={source:source.length,bigQuery:stored.length,duplicates,mismatch,onlySource,onlyBigQuery,status:ok?'PASS':'FAIL'};
  if(!ok)failed=true;
 }
 const integrity=(await query(`SELECT
 (SELECT COUNT(*) FROM (SELECT payment_id FROM ${T('sales_payment_headers')} GROUP BY 1 HAVING COUNT(*)>1)) AS duplicate_headers,
 (SELECT COUNT(*) FROM (SELECT payment_id,line_unique_key FROM ${T('sales_payment_lines')} GROUP BY 1,2 HAVING COUNT(*)>1)) AS duplicate_lines,
 (SELECT COUNT(*) FROM (SELECT payment_id,accounting_book_id,line_id,account_id FROM ${T('sales_payment_accounting_lines')} GROUP BY 1,2,3,4 HAVING COUNT(*)>1)) AS duplicate_gl,
 (SELECT COUNT(*) FROM (SELECT payment_id,invoice_id,payment_line_id,invoice_line_id FROM ${T('sales_payment_applications')} GROUP BY 1,2,3,4 HAVING COUNT(*)>1)) AS duplicate_applications,
 (SELECT COUNT(*) FROM ${T('sales_payment_lines')} l LEFT JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.payment_id IS NULL) AS orphan_lines,
 (SELECT COUNT(*) FROM ${T('sales_payment_accounting_lines')} l LEFT JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.payment_id IS NULL) AS orphan_gl,
 (SELECT COUNT(*) FROM ${T('sales_payment_applications')} l LEFT JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.payment_id IS NULL) AS orphan_applications`))[0];
 if(Object.values(integrity).some(x=>Number(x)!==0))failed=true;
 console.log(JSON.stringify({tables:report,integrity,samples},null,2));
 if(failed){console.error('SALES PAYMENT CHECK NEEDS_REVIEW (source may have changed since sync)');process.exitCode=3;return;}
 console.log('SALES PAYMENT CHECK PASS (four tables, exact decimal, unique keys and orphans)');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
