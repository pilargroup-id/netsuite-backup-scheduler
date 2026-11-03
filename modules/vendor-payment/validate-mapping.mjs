// READ ONLY: bounded October source sample; no BigQuery, checkpoint, deletion or scheduler writes.
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {GROUPS} from './schema-contract.mjs';
import {validateNumeric} from '../../common/decimal-precision.mjs';
const assert=(x,m)=>{if(!x)throw Error('BLOCKED: '+m);};
async function main(){
 console.log('MODULE 12 PHASE B - LIVE MAPPING VALIDATION | READ ONLY');
 const access=await token();const all=await fetchHeaders(access);
 const headers=all.filter(r=>r.transaction_date>='2026-10-01'&&r.transaction_date<'2026-11-01').slice(0,25);
 assert(headers.length>0,'No October VendPymt sample');const ids=headers.map(r=>r.internal_id);
 // Sequential rather than parallel to reduce NetSuite query load.
 const lines=await fetchLines(access,ids),gl=await fetchGL(access,ids),prev=await fetchPreviousLinks(access,ids),next=await fetchNextLinks(access,ids);
 const mapped=mapSource(headers,lines,gl,prev,next);
 for(const g of GROUPS)for(const r of mapped[g.source])for(const [f,t] of g.fields){const v=r[f];if(v==null)continue;assert(t==='BOOL'?typeof v==='boolean':typeof v==='string',g.table+'.'+f+' incorrect JS type');if(t==='NUMERIC')assert(validateNumeric(v,{module:'vendor-payment',recordId:r.vendor_payment_id,field:f})===v,'Nonexact numeric '+f);}
 const a=mapped.previousLinks.map(r=>[r.previous_doc_id,r.previous_line_id,r.next_doc_id,r.next_line_id,r.link_type,r.applied_amount].join('|')).sort();
 const b=mapped.nextLinks.map(r=>[r.previous_doc_id,r.previous_line_id,r.next_doc_id,r.next_line_id,r.link_type,r.applied_amount].join('|')).sort();
 assert(JSON.stringify(a)===JSON.stringify(b),'Previous/Next link mirror mismatch');
 const debit=new Map();for(const r of mapped.accountingLines){if(!r.posting)continue;const k=r.vendor_payment_id+'|'+r.accounting_book_id;debit.set(k,(debit.get(k)??0)+1);}
 console.log('SOURCE COUNTS',JSON.stringify({headers:headers.length,lines:lines.length,gl:gl.length,previousLinks:prev.length,nextLinks:next.length}));
 console.log('MAPPED COUNTS',JSON.stringify(mapped.counts));
 console.log('STATUS',JSON.stringify({posting:headers.filter(h=>h.posting==='T').length,nonposting:headers.filter(h=>h.posting!=='T').length,discountLinks:mapped.previousLinks.filter(r=>r.discount).length,glGroups:debit.size}));
 console.log('PHASE B MAPPING VALIDATION PASS | NO BIGQUERY/SCHEMA/CHECKPOINT/DELETION/SCHEDULER WRITES');
}
main().catch(e=>{console.error('PHASE B MAPPING BLOCKED',e.stack??String(e));process.exitCode=1;});
