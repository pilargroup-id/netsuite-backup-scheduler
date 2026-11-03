import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,mapSource,FROM,TO} from './mapping.mjs';

const fieldsH=['po_number','transaction_date','last_modified','status','vendor_id','vendor_name','currency_id','exchange_rate','foreign_total','base_total','posting_period_id'];
const fieldsL=['line_id','line_number','line_type','item_id','quantity','rate','foreign_amount','net_amount','location_id','units_id','accounting_line_type','is_tax_line'];
const numericFields=new Set(['exchange_rate','foreign_total','base_total','quantity','rate','foreign_amount','net_amount']);

// Compare decimal values by mathematical value (no floating-point conversion).
// SuiteQL may return scientific notation, and BigQuery may omit trailing zeroes.
function decimalKey(value){
 if(value==null)return null;
 const s=String(value).trim();
 const m=s.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
 if(!m)throw Error('Invalid decimal in reconciliation: '+s);
 const intPart=m[2]??'';
 const fracPart=m[3]??m[4]??'';
 const exp=Number(m[5]??'0');
 if(!Number.isSafeInteger(exp)||Math.abs(exp)>1000)throw Error('Invalid exponent: '+s);
 let digits=(intPart+fracPart).replace(/^0+/,'')||'0';
 if(digits==='0')return '0';
 const shift=exp-fracPart.length;
 if(shift>=0)digits+='0'.repeat(shift);
 else{
  const point=digits.length+shift;
  digits=point>0 ? digits.slice(0,point)+'.'+digits.slice(point) : '0.'+'0'.repeat(-point)+digits;
  digits=digits.replace(/0+$/,'').replace(/\.$/,'');
 }
 return (m[1]==='-'?'-':'')+digits;
}
function canonical(field,value){
 if(value==null)return null;
 if(numericFields.has(field))return decimalKey(value);
 if(field==='is_tax_line'){
  if(value===true||String(value).toLowerCase()==='true'||String(value)==='1')return 'true';
  if(value===false||String(value).toLowerCase()==='false'||String(value)==='0')return 'false';
 }
 return String(value);
}
function differences(source,stored,columns){
 if(!stored)return [{field:'__missing_row',source:'present',bigquery:'missing'}];
 return columns.filter(k=>canonical(k,source[k])!==canonical(k,stored[k]))
  .map(k=>({field:k,source:source[k]??null,bigquery:stored[k]??null}));
}
async function main(){
 console.log('PURCHASE ORDER FULL OCT 2026 CHECK | READ ONLY');
 const access=await token();
 const headers=await fetchHeaders(access);
 const source=mapSource(headers,headers.length?await fetchLines(access,headers.map(x=>x.internal_id)):[]);
 const bqH=await query(`SELECT internal_id,po_number,CAST(transaction_date AS STRING) AS transaction_date,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_modified) AS last_modified,status,vendor_id,vendor_name,currency_id,CAST(exchange_rate AS STRING) AS exchange_rate,CAST(foreign_total AS STRING) AS foreign_total,CAST(base_total AS STRING) AS base_total,posting_period_id FROM ${T('purchase_order_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 const bqL=await query(`SELECT l.po_internal_id,l.line_unique_key,l.line_id,l.line_number,l.line_type,l.item_id,CAST(l.quantity AS STRING) AS quantity,CAST(l.rate AS STRING) AS rate,CAST(l.foreign_amount AS STRING) AS foreign_amount,CAST(l.net_amount AS STRING) AS net_amount,l.location_id,l.units_id,l.accounting_line_type,l.is_tax_line FROM ${T('purchase_order_lines')} l JOIN ${T('purchase_order_headers')} h ON h.internal_id=l.po_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);
 const head=new Map(bqH.map(x=>[String(x.internal_id),x]));
 const lines=new Map(bqL.map(x=>[`${x.po_internal_id}:${x.line_unique_key}`,x]));
 let hfail=0,lfail=0;
 const samples=[];
 for(const h of source.headers){
  const diff=differences(h,head.get(h.internal_id),fieldsH);
  if(diff.length){hfail++;if(samples.length<8)samples.push({kind:'HEADER',id:h.internal_id,differences:diff.slice(0,5)});}
 }
 for(const l of source.lines){
  const key=`${l.po_internal_id}:${l.line_unique_key}`;
  const diff=differences(l,lines.get(key),fieldsL);
  if(diff.length){lfail++;if(samples.length<8)samples.push({kind:'LINE',id:key,differences:diff.slice(0,5)});}
 }
 const integrity=await query(`SELECT (SELECT COUNT(*) FROM (SELECT internal_id FROM ${T('purchase_order_headers')} GROUP BY 1 HAVING COUNT(*)>1)) AS dh,(SELECT COUNT(*) FROM (SELECT po_internal_id,line_unique_key FROM ${T('purchase_order_lines')} GROUP BY 1,2 HAVING COUNT(*)>1)) AS dl,(SELECT COUNT(*) FROM ${T('purchase_order_lines')} l LEFT JOIN ${T('purchase_order_headers')} h ON h.internal_id=l.po_internal_id WHERE h.internal_id IS NULL) AS orphan`);
 const ok=source.headers.length===bqH.length&&source.lines.length===bqL.length&&head.size===bqH.length&&lines.size===bqL.length&&hfail===0&&lfail===0&&Object.values(integrity[0]).every(v=>Number(v)===0);
 console.log(JSON.stringify({source_headers:source.headers.length,bq_headers:bqH.length,source_lines:source.lines.length,bq_lines:bqL.length,header_mismatch:hfail,line_mismatch:lfail,integrity:integrity[0],sample_errors:samples},null,2));
 if(!ok)throw Error('PURCHASE ORDER CHECK FAILED');
 console.log('PURCHASE ORDER CHECK PASS (snapshot field-by-field and integrity); scheduler/recovery NOT enabled');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
