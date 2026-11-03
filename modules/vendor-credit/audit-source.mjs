// Module 11 VendCred Phase B1. Read-only full-population audit.
// Does not touch production modules, BigQuery, checkpoints, scheduler or deletion.
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { validateNumeric, validateBigNumeric } from '../../common/decimal-precision.mjs';
const FROM = '2026-10-01';
const TO = '2027-01-01';
const fromClause = `t.trandate >= TO_DATE('${FROM}','YYYY-MM-DD') AND t.trandate < TO_DATE('${TO}','YYYY-MM-DD')`;
const failures=[];
const ids = x => [...new Set(x.map(r=>String(r.id)).filter(v=>/^[1-9]\d{0,14}$/.test(v)))];
function quotedIds(x) { if(!x.length) throw Error('No IDs'); return x.join(','); }
async function get(a, label, sql) {
 console.log(`\n=== ${label} ===`);
 try { const r=await fetchAll(a,sql);console.log('Rows:',r.length);return r; }
 catch(e) { failures.push({label,error:e.message}); console.error('FAILED:',e.message);return null; }
}
function decimalAudit(name, rows, fields, idKey='transaction_id') {
 console.log(`\n=== DECIMAL AUDIT ${name} ===`);
 for(const field of fields) {
  const stats={field,nonNull:0,numericRejected:0,bigNumericRejected:0,exponents:0,maxFraction:0,invalidSamples:[]};
  for(const r of rows??[]) {
   const v=r[field]; if(v===null||v===undefined||v==='')continue;
   const raw=String(v);stats.nonNull++;
   if(/[eE]/.test(raw))stats.exponents++;
   const match=/^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw);
   if(match)stats.maxFraction=Math.max(stats.maxFraction,(match[1]??match[2]??'').length);
   for(const [kind,fn] of [['numeric',validateNumeric],['bigNumeric',validateBigNumeric]]) {
    try{fn(raw,{module:'vendor-credit',recordId:r[idKey],field});}
    catch(e){stats[kind+'Rejected']++;if(stats.invalidSamples.length<12)stats.invalidSamples.push({id:r[idKey],raw,kind,reason:e.message});}
   }
  }
  console.log(JSON.stringify(stats));
 }
}
function uniqueness(name,rows, keyFn) {
 const seen=new Set(),duplicates=[];
 for(const r of rows??[]) {const k=keyFn(r);if(seen.has(k)&&duplicates.length<15)duplicates.push(k);seen.add(k);}
 console.log(name,JSON.stringify({rows:rows?.length??null,uniqueKeys:seen.size,duplicateExamples:duplicates}));
 if(duplicates.length)failures.push({label:name,error:'Duplicate grain key'});
}
function distribution(rows,key){const d={};for(const r of rows??[]){const k=String(r[key]??'NULL');d[k]=(d[k]??0)+1;}return d;}
async function main() {
 console.log('MODULE 11 VENDOR CREDIT PHASE B1 | READ-ONLY FULL OCT-DEC SOURCE AUDIT');
 const a=await token();console.log('OAuth: SUCCESS');
 const headers=await get(a,'ALL HEADERS',`SELECT t.id AS id,t.trandate AS transaction_date,t.lastmodifieddate AS last_modified,t.entity AS vendor_id,t.currency AS currency_id,t.status AS status_id,t.posting AS posting,t.void AS void_flag,t.voided AS voided_flag,t.exchangerate AS exchangerate,t.foreigntotal AS foreigntotal,t.total AS total FROM Transaction t WHERE t.type='VendCred' AND ${fromClause} ORDER BY t.id`);
 if(!headers?.length)throw Error('No VendCred headers or query failed; fail closed');
 const idList=ids(headers);uniqueness('HEADERS',headers,r=>r.id);
 decimalAudit('HEADERS',headers,['exchangerate','foreigntotal','total'],'id');
 console.log('HEADER DISTRIBUTIONS',JSON.stringify({currency:distribution(headers,'currency_id'),status:distribution(headers,'status_id'),posting:distribution(headers,'posting'),void:distribution(headers,'void_flag'),voided:distribution(headers,'voided_flag')}));
 // Restrict each query to verified header IDs to avoid unrelated production data.
 const chunks=[];for(let i=0;i<idList.length;i+=150)chunks.push(idList.slice(i,i+150));
 const lines=[],gl=[],prev=[],next=[];
 for(const chunk of chunks){const where=`IN (${quotedIds(chunk)})`;
  const q=[
   ['LINES',`SELECT l.transaction AS transaction_id,l.id AS line_id,l.uniquekey AS line_unique_key,l.mainline AS mainline,l.taxline AS taxline,l.iscogs AS iscogs,l.accountinglinetype AS accounting_line_type,l.item AS item_id,l.quantity AS quantity,l.rate AS rate,l.foreignamount AS foreignamount,l.netamount AS netamount FROM TransactionLine l WHERE l.transaction ${where} ORDER BY l.transaction,l.id`,lines],
   ['GL',`SELECT g.transaction AS transaction_id,g.transactionline AS line_id,g.accountingbook AS accounting_book_id,g.account AS account_id,g.posting AS posting,g.debit AS debit,g.credit AS credit FROM TransactionAccountingLine g WHERE g.transaction ${where} ORDER BY g.transaction,g.transactionline,g.accountingbook,g.account`,gl],
   ['PREVIOUS LINKS',`SELECT p.previousdoc AS previous_doc_id,p.previousline AS previous_line_id,p.nextdoc AS next_doc_id,p.nextline AS next_line_id,p.previoustype AS previous_type,p.nexttype AS next_type,p.linktype AS link_type,p.foreignamount AS foreignamount,p.lastmodifieddate AS last_modified FROM PreviousTransactionLineLink p WHERE p.nextdoc ${where} OR p.previousdoc ${where}`,prev],
   ['NEXT LINKS',`SELECT n.previousdoc AS previous_doc_id,n.previousline AS previous_line_id,n.nextdoc AS next_doc_id,n.nextline AS next_line_id,n.previoustype AS previous_type,n.nexttype AS next_type,n.linktype AS link_type,n.foreignamount AS foreignamount,n.lastmodifieddate AS last_modified FROM NextTransactionLineLink n WHERE n.nextdoc ${where} OR n.previousdoc ${where}`,next]
  ];
  for(const [label,sql,out] of q){const r=await get(a,label,sql);if(r)out.push(...r);}
 }
 uniqueness('LINES',lines,r=>`${r.transaction_id}|${r.line_unique_key}`);
 uniqueness('GL',gl,r=>`${r.transaction_id}|${r.line_id}|${r.accounting_book_id}|${r.account_id??'NULL'}`);
 uniqueness('PREVIOUS LINKS',prev,r=>`${r.previous_doc_id}|${r.previous_line_id}|${r.next_doc_id}|${r.next_line_id}|${r.link_type}|${r.previous_type}|${r.next_type}`);
 uniqueness('NEXT LINKS',next,r=>`${r.previous_doc_id}|${r.previous_line_id}|${r.next_doc_id}|${r.next_line_id}|${r.link_type}|${r.previous_type}|${r.next_type}`);
 decimalAudit('LINES',lines,['quantity','rate','foreignamount','netamount']);
 decimalAudit('GL',gl,['debit','credit']);
 decimalAudit('PREVIOUS LINKS',prev,['foreignamount'],'next_doc_id');
 decimalAudit('NEXT LINKS',next,['foreignamount'],'next_doc_id');
 console.log('LINE DISTRIBUTIONS',JSON.stringify({mainline:distribution(lines,'mainline'),taxline:distribution(lines,'taxline'),cogs:distribution(lines,'iscogs'),accountingType:distribution(lines,'accounting_line_type')}));
 console.log('GL DISTRIBUTIONS',JSON.stringify({book:distribution(gl,'accounting_book_id'),posting:distribution(gl,'posting')}));
 console.log('LINK DISTRIBUTIONS',JSON.stringify({previousLinkType:distribution(prev,'link_type'),previousType:distribution(prev,'previous_type'),previousNextType:distribution(prev,'next_type'),nextLinkType:distribution(next,'link_type')}));
 const seenLines=new Set(lines.map(x=>String(x.transaction_id))),seenGl=new Set(gl.map(x=>String(x.transaction_id)));
 console.log('HEADER COVERAGE',JSON.stringify({headers:idList.length,withLines:idList.filter(x=>seenLines.has(x)).length,missingLines:idList.filter(x=>!seenLines.has(x)).slice(0,30),withGl:idList.filter(x=>seenGl.has(x)).length,missingGl:idList.filter(x=>!seenGl.has(x)).slice(0,30)}));
 console.log('PHASE B1 RESULT',JSON.stringify({queryOrGrainFailures:failures,headers:headers.length,lines:lines.length,gl:gl.length,previousLinks:prev.length,nextLinks:next.length}));
 if(failures.length)process.exitCode=2;
}
main().catch(e=>{console.error('PHASE B1 BLOCKED:',e.stack??e);process.exitCode=1;});
