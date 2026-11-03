import {query,T} from '../../common/bigquery-client.mjs';
import {FROM,TO} from './mapping.mjs';
// Financial verification uses decimal strings and 9-place scaled BigInt: never JS Number for money.
function units(v){if(v==null)return 0n;const s=String(typeof v==='object'&&v.value!==undefined?v.value:v).trim();const m=s.match(/^(-?)(\d+)(?:\.(\d{0,9}))?$/);if(!m)throw Error(`Invalid persisted NUMERIC ${s}`);return (m[1]? -1n:1n)*(BigInt(m[2])*1000000000n+BigInt((m[3]??'').padEnd(9,'0')));}
function formatted(n){const sign=n<0n?'-':'';const a=n<0n?-n:n;return sign+(a/1000000000n)+'.'+String(a%1000000000n).padStart(9,'0').replace(/0+$/,'').padEnd(2,'0');}
async function main(){
 console.log('SALES PAYMENT FINANCIAL CHECK | READ ONLY');
 const header=await query(`SELECT payment_id,CAST(foreign_total AS STRING) AS foreign_total,CAST(base_total AS STRING) AS base_total,CAST(amount_used AS STRING) AS amount_used,CAST(amount_unused AS STRING) AS amount_unused,is_void FROM ${T('sales_payment_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
 if(!header.length)throw Error('No active payment headers');
 const [apps,gl,lines]=await Promise.all([
  query(`SELECT a.payment_id,CAST(a.applied_amount AS STRING) AS amount FROM ${T('sales_payment_applications')} a JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`),
  query(`SELECT g.payment_id,g.accounting_book_id,CAST(g.debit AS STRING) AS debit,CAST(g.credit AS STRING) AS credit FROM ${T('sales_payment_accounting_lines')} g JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`),
  query(`SELECT l.payment_id,l.is_mainline,CAST(l.foreign_amount AS STRING) AS amount FROM ${T('sales_payment_lines')} l JOIN ${T('sales_payment_headers')} h USING(payment_id) WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`)
 ]);
 const state=new Map(header.map(h=>[h.payment_id,{header:h,apps:0n,appCount:0,books:new Map(),lineBalance:0n,mainline:0,lines:0}]));
 for(const a of apps){const s=state.get(a.payment_id);if(!s)throw Error('Orphan app '+a.payment_id);s.apps+=units(a.amount);s.appCount++;}
 for(const g of gl){const s=state.get(g.payment_id);if(!s)throw Error('Orphan GL '+g.payment_id);const b=s.books.get(g.accounting_book_id)||{debit:0n,credit:0n,count:0};b.debit+=units(g.debit);b.credit+=units(g.credit);b.count++;s.books.set(g.accounting_book_id,b);}
 for(const l of lines){const s=state.get(l.payment_id);if(!s)throw Error('Orphan line '+l.payment_id);s.lineBalance+=units(l.amount);s.lines++;if(l.is_mainline)s.mainline++;}
 const problems=[],totals={foreign:0n,used:0n,applied:0n,debit:0n,credit:0n};
 for(const [id,s] of state){const h=s.header,foreign=units(h.foreign_total),used=units(h.amount_used),unused=units(h.amount_unused),base=units(h.base_total),book=s.books.get('1');const reasons=[];
  if(used+unused!==foreign)reasons.push('used+unused != foreign total');
  if(s.apps!==used)reasons.push('applications != used');
  if(s.lines<2||s.mainline!==1||s.lineBalance!==0n)reasons.push('transaction line imbalance');
  if(!book)reasons.push('missing book 1');else if(book.debit!==book.credit||(!h.is_void&&(book.debit!==base||book.credit!==base)))reasons.push('book 1/header mismatch');
  for(const [name,b] of s.books)if(b.debit!==b.credit)reasons.push('unbalanced book '+name);
  totals.foreign+=foreign;totals.used+=used;totals.applied+=s.apps;if(book){totals.debit+=book.debit;totals.credit+=book.credit;}
  if(reasons.length&&problems.length<25)problems.push({payment_id:id,reasons});
 }
 const result={headers:header.length,applications:apps.length,glLines:gl.length,transactionLines:lines.length,foreignTotal:formatted(totals.foreign),amountUsed:formatted(totals.used),applicationsTotal:formatted(totals.applied),book1Debit:formatted(totals.debit),book1Credit:formatted(totals.credit),problems};
 console.log(JSON.stringify(result,null,2));
 if(problems.length){console.error('SALES PAYMENT FINANCIAL CHECK FAIL');process.exitCode=3;return;}
 console.log('SALES PAYMENT FINANCIAL CHECK PASS (BQ internal invariants; run check.mjs for live NetSuite parity)');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
