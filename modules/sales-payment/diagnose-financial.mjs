// Sales Payment Phase B1.1: isolate GL vs header differences and verify applications.
// READ ONLY: does not touch BigQuery, checkpoints, deletion registry, or scheduler.
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { validateNumeric } from '../../common/decimal-precision.mjs';

const from = '2026-10-01';
const to = '2027-01-01';
const window = `t.trandate >= TO_DATE('${from}','YYYY-MM-DD') AND t.trandate < TO_DATE('${to}','YYYY-MM-DD')`;
const SCALE = 1000000000n;
function unit(value, id, field) {
  const s = validateNumeric(value, { module: 'sales-payment', recordId: id, field });
  if (s == null) return 0n;
  const minus = s[0] === '-';
  const [whole, frac = ''] = (minus ? s.slice(1) : s).split('.');
  const n = BigInt(whole) * SCALE + BigInt(frac.padEnd(9, '0'));
  return minus ? -n : n;
}
function fmt(value) {
  const abs = value < 0n ? -value : value;
  const frac = (abs % SCALE).toString().padStart(9,'0').replace(/0+$/,'');
  return `${value < 0n ? '-' : ''}${abs / SCALE}${frac ? '.' + frac : ''}`;
}
function add(map, key, value) { map.set(key, (map.get(key) ?? 0n) + value); }
const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
async function main() {
  console.log('SALES PAYMENT PHASE B1.1 — READ ONLY FINANCIAL VARIANCE DIAGNOSTIC');
  const access = await token();
  console.log('OAuth: SUCCESS');
  const headers = await fetchAll(access, `SELECT t.id AS payment_id, t.tranid AS document_number, t.total, t.foreigntotal, t.foreignpaymentamountused AS amount_used, t.foreignpaymentamountunused AS amount_unused, t.exchangerate, t.currency, t.status FROM Transaction t WHERE t.type='CustPymt' AND ${window} ORDER BY t.id`);
  if (!headers.length) throw new Error('No visible sales payments: abort');
  const byId = new Map(headers.map(x => [String(x.payment_id), x]));
  const gl = await fetchAll(access, `SELECT tal.transaction AS payment_id, tal.transactionline AS line_id, tal.accountingbook AS book_id, tal.account AS account_id, tal.posting, tal.debit, tal.credit FROM TransactionAccountingLine tal JOIN Transaction t ON t.id=tal.transaction WHERE t.type='CustPymt' AND ${window} ORDER BY tal.transaction, tal.accountingbook, tal.transactionline, tal.account`);
  const lines = await fetchAll(access, `SELECT tl.transaction AS payment_id, tl.id AS line_id, tl.mainline, tl.accountinglinetype, tl.foreignamount, tl.netamount FROM TransactionLine tl JOIN Transaction t ON t.id=tl.transaction WHERE t.type='CustPymt' AND ${window} ORDER BY tl.transaction, tl.id`);
  const links = await fetchAll(access, `SELECT p.nextdoc AS payment_id, p.nextline AS payment_line, p.previousdoc AS invoice_id, p.previousline AS invoice_line, p.linktype, p.previoustype, p.foreignamount AS applied_amount FROM PreviousTransactionLineLink p JOIN Transaction t ON t.id=p.nextdoc WHERE t.type='CustPymt' AND ${window} ORDER BY p.nextdoc, p.previousdoc, p.previousline, p.nextline`);
  console.log(`Counts: headers=${headers.length} transactionLines=${lines.length} GL=${gl.length} applicationLinks=${links.length}`);
  const glTotals = new Map(), glCounts = new Map(), glByBook = new Map(), totalsByBook = new Map();
  for (const g of gl) {
    const id = String(g.payment_id), book=String(g.book_id), key=`${id}|${book}`;
    if (!byId.has(id)) throw new Error(`Orphan GL ${id}`);
    count(glCounts,key); count(glByBook, book);
    const entry = glTotals.get(key) ?? { debit: 0n, credit: 0n };
    entry.debit += unit(g.debit,id,'gl_debit'); entry.credit += unit(g.credit,id,'gl_credit');
    glTotals.set(key,entry);
    const bt=totalsByBook.get(book) ?? {debit:0n,credit:0n};
    bt.debit += unit(g.debit,id,'gl_debit'); bt.credit += unit(g.credit,id,'gl_credit'); totalsByBook.set(book,bt);
  }
  const appById=new Map(), appCount=new Map();
  for (const a of links) {
    const id=String(a.payment_id);
    if(!byId.has(id)) throw new Error(`Orphan link ${id}`);
    add(appById,id,unit(a.applied_amount,id,'applied_amount'));
    count(appCount,id);
  }
  const lineCountById=new Map();
  for (const l of lines) {
    if(!byId.has(String(l.payment_id))) throw new Error(`Orphan line ${l.payment_id}`);
    count(lineCountById,String(l.payment_id));
    unit(l.foreignamount,l.payment_id,'line_foreignamount');
    unit(l.netamount,l.payment_id,'line_netamount');
  }
  let headerTotal=0n, headerUsed=0n, headerUnused=0n, applicationsTotal=0n;
  const anomalies=[]; const sampleLimit=25;
  const primaryBook='1';
  for (const h of headers) {
    const id=String(h.payment_id), total=unit(h.total,id,'total'), used=unit(h.amount_used,id,'amount_used'), unused=unit(h.amount_unused,id,'amount_unused'), application=appById.get(id)??0n;
    headerTotal+=total; headerUsed+=used; headerUnused+=unused; applicationsTotal+=application;
    const g=glTotals.get(`${id}|${primaryBook}`)??{debit:0n,credit:0n};
    const reasons=[];
    if(g.debit!==total || g.credit!==total) reasons.push('GL_VS_HEADER');
    if(g.debit!==g.credit) reasons.push('GL_UNBALANCED');
    if(application!==used) reasons.push('APPLICATION_VS_USED');
    if(used+unused!==unit(h.foreigntotal,id,'foreigntotal')) reasons.push('USED_PLUS_UNUSED_VS_FOREIGNTOTAL');
    if((lineCountById.get(id)??0)!==2) reasons.push('NONSTANDARD_TRANSACTION_LINES');
    if((glCounts.get(`${id}|${primaryBook}`)??0)!==2) reasons.push('NONSTANDARD_GL_LINE_COUNT');
    if(reasons.length) anomalies.push({id,doc:h.document_number,reasons,header:fmt(total),used:fmt(used),unused:fmt(unused),applications:fmt(application),glDebit:fmt(g.debit),glCredit:fmt(g.credit),glLines:glCounts.get(`${id}|${primaryBook}`)??0,applicationLines:appCount.get(id)??0});
  }
  console.log('\n=== TOTAL COMPARISON ===');
  console.log(JSON.stringify({headerTotal:fmt(headerTotal),headerUsed:fmt(headerUsed),headerUnused:fmt(headerUnused),applicationTotal:fmt(applicationsTotal),appMinusUsed:fmt(applicationsTotal-headerUsed),books:[...totalsByBook].map(([book,v])=>({book,glLineCount:glByBook.get(book),debit:fmt(v.debit),credit:fmt(v.credit),debitMinusHeader:fmt(v.debit-headerTotal),creditMinusHeader:fmt(v.credit-headerTotal)}))},null,2));
  console.log('\n=== ANOMALY SUMMARY ===');
  const reasonTotals={}; for(const a of anomalies)for(const r of a.reasons)reasonTotals[r]=(reasonTotals[r]??0)+1;
  console.log(JSON.stringify({anomalyPayments:anomalies.length,reasons:reasonTotals,first:anomalies.slice(0,sampleLimit)},null,2));
  const anomalousIds=new Set(anomalies.map(a=>a.id));
  console.log('\n=== GL DETAIL FOR ANOMALOUS PAYMENTS (up to 25 payments) ===');
  const selected=new Set(anomalies.slice(0,sampleLimit).map(a=>a.id));
  console.log(JSON.stringify(gl.filter(g=>selected.has(String(g.payment_id))),null,2));
  console.log('\n=== CONCLUSION ===');
  console.log('Source-only investigation complete; GL sums are NOT expected to equal payment header amounts unless accounting structure proves that invariant. No BigQuery or deletion changes.');
  console.log('Output is diagnostic, not mapping certification.');
}
main().catch(error=>{console.error('DIAGNOSTIC FAILED:',error.stack??error);process.exitCode=1;});
