// Module 11 Vendor Credit, Phase B3: standalone source financial audit. Read only.
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
const SCALE=1000000000n;
function units(v){if(v==null)return 0n;if(!/^-?\d+(?:\.\d{1,9})?$/.test(v))throw Error('Unexpected mapped decimal: '+v);const neg=v.startsWith('-');const [i,f='']=v.replace('-','').split('.');const n=BigInt(i)*SCALE+BigInt(f.padEnd(9,'0'));return neg?-n:n;}
function fmt(n){const sign=n<0n?'-':'';const a=n<0n?-n:n;const f=(a%SCALE).toString().padStart(9,'0').replace(/0+$/,'');return sign+(a/SCALE).toString()+(f?'.'+f:'');}
function must(ok,message){if(!ok)throw Error('B3 BLOCKED: '+message);}
function compareLinks(p,n){const signature=r=>[r.vendor_credit_id,r.previous_doc_id,r.previous_line_id,r.next_doc_id,r.next_line_id,r.previous_type,r.next_type,r.link_type,r.applied_amount,r.last_modified].map(x=>x??'<NULL>').join('|');const a=p.map(signature).sort(),b=n.map(signature).sort();must(a.length===b.length,'previous/next link cardinality differs');for(let i=0;i<a.length;i++)must(a[i]===b[i],'link mismatch at index '+i);return a.length;}
async function main(){
 console.log('MODULE 11 PHASE B3 EXACT SOURCE FINANCIAL AUDIT | READ ONLY');
 const a=await token();const h=await fetchHeaders(a);must(h.length>0,'source headers empty');const ids=h.map(x=>x.internal_id);
 const [l,g,p,n]=await Promise.all([fetchLines(a,ids),fetchGL(a,ids),fetchPreviousLinks(a,ids),fetchNextLinks(a,ids)]);
 const m=mapSource(h,l,g,p,n);console.log('SOURCE COUNTS',JSON.stringify(m.counts));
 const byId=new Map(m.headers.map(x=>[x.vendor_credit_id,x]));const totals=new Map();const main=new Map();const flags={books:{},types:{},links:{},currency:{}};
 for(const x of m.headers)flags.currency[x.currency_id]=(flags.currency[x.currency_id]??0)+1;
 for(const x of m.transactionLines)if(x.is_mainline){must(!main.has(x.vendor_credit_id),'duplicate mainline '+x.vendor_credit_id);main.set(x.vendor_credit_id,x);}
 for(const x of m.accountingLines){must(x.posting,'nonposting GL '+x.vendor_credit_id);const key=x.vendor_credit_id+'|'+x.accounting_book_id;const b=totals.get(key)??{debit:0n,credit:0n,rows:0};b.debit+=units(x.debit);b.credit+=units(x.credit);b.rows++;totals.set(key,b);flags.books[x.accounting_book_id]=(flags.books[x.accounting_book_id]??0)+1;}
 const failures=[];for(const [key,b] of totals)if(b.debit!==b.credit)failures.push({key,debit:fmt(b.debit),credit:fmt(b.credit),difference:fmt(b.debit-b.credit)});
 console.log('GL BALANCE',JSON.stringify({groups:totals.size,imbalanced:failures.length,samples:failures.slice(0,10)}));
 // Header total and GL are differently signed across transaction types; check absolute debit/credit magnitudes, not arbitrary sign flips.
 const headerMismatch=[];for(const x of m.headers){const gl=totals.get(x.vendor_credit_id+'|1');if(!gl)continue;const amount=units(x.base_total);if((amount<0n?-amount:amount)!==gl.debit)headerMismatch.push({id:x.vendor_credit_id,baseTotal:x.base_total,glDebit:fmt(gl.debit)});}
 console.log('HEADER VS PRIMARY BOOK DEBIT (diagnostic)',JSON.stringify({compared:m.headers.filter(x=>totals.has(x.vendor_credit_id+'|1')).length,mismatches:headerMismatch.length,samples:headerMismatch.slice(0,10)}));
 const links=compareLinks(m.previousLinks,m.nextLinks);for(const x of m.previousLinks)flags.links[x.link_type]=(flags.links[x.link_type]??0)+1;
 console.log('LINK MIRROR',JSON.stringify({status:'PASS',rows:links,byType:flags.links}));
 console.log('DISTRIBUTIONS',JSON.stringify({accountingBooks:flags.books,currencies:flags.currency}));
 must(failures.length===0,'GL debit/credit mismatch');
 // Header debit check is diagnostic only: multi-book / credit applications can change relationship. Do not impose unproven invariant.
 console.log('PHASE B3 RESULT',JSON.stringify({status:'PASS',headers:h.length,glGroups:totals.size,balancedGroups:totals.size,mirroredLinks:links,headerVsPrimaryDebitMismatches:headerMismatch.length,headerComparison:'DIAGNOSTIC_ONLY',writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0}));
}
main().catch(e=>{console.error('PHASE B3 BLOCKED',e.stack??e);process.exitCode=1;});
