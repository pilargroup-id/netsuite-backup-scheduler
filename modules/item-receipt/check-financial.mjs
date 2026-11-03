// Item Receipt financial detail reconciliation (READ ONLY).
// Uses existing shared NetSuite/BigQuery clients; no checkpoints or tables modified.
import { query, T } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, fetchLines, mapSource, FROM, TO } from './mapping.mjs';

const numericFields = ['quantity', 'rate', 'net_amount', 'foreign_amount'];
const amountFields = ['net_amount', 'foreign_amount'];
function scaled(value, scale, field, key) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw Error(`Invalid ${field} for ${key}: ${value}`);
  const scaledValue = Math.round(n * scale);
  if (!Number.isSafeInteger(scaledValue)) throw Error(`Unsafe numeric ${field} for ${key}`);
  return scaledValue;
}
function keyOf(row) { return `${String(row.receipt_internal_id)}:${String(row.line_unique_key)}`; }
function fmt(x, scale=100) { return (x / scale).toFixed(scale===100 ? 2 : 6); }
async function main() {
  console.log(`ITEM RECEIPT FINANCIAL CHECK | READ ONLY | ${FROM} to ${TO}`);
  const access = await token();
  const nsHeaders = await fetchHeaders(access);
  const raw = nsHeaders.length ? await fetchLines(access, nsHeaders.map(x => x.internal_id)) : [];
  const source = mapSource(nsHeaders, raw);
  const bqHeaders = await query(`SELECT internal_id,receipt_number,total_amount FROM ${T('item_receipt_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
  const bqLines = await query(`SELECT l.receipt_internal_id,l.line_unique_key,l.item_id,l.quantity,l.rate,l.net_amount,l.foreign_amount FROM ${T('item_receipt_lines')} l JOIN ${T('item_receipt_headers')} h ON h.internal_id=l.receipt_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);
  const sourceIds = new Set(source.headers.map(x => x.internal_id));
  const bqIds = new Set(bqHeaders.map(x => String(x.internal_id)));
  const onlyNSHeaders = [...sourceIds].filter(x => !bqIds.has(x));
  const onlyBQHeaders = [...bqIds].filter(x => !sourceIds.has(x));
  const ns = new Map(source.lines.map(r => [keyOf(r), r]));
  const bq = new Map();
  const dupBQ=[];
  for (const r of bqLines) { const k=keyOf(r); if(bq.has(k))dupBQ.push(k); else bq.set(k,r); }
  const onlyNSLines = [...ns.keys()].filter(k=>!bq.has(k));
  const onlyBQLines = [...bq.keys()].filter(k=>!ns.has(k));
  const different=[];
  const perReceipt=new Map();
  function summary(id) { if (!perReceipt.has(id)) perReceipt.set(id,{nsNet:0,bqNet:0,nsForeign:0,bqForeign:0,nsQuantity:0,bqQuantity:0}); return perReceipt.get(id); }
  for(const r of source.lines){const s=summary(r.receipt_internal_id);s.nsNet+=scaled(r.net_amount,100,'net_amount',keyOf(r))??0;s.nsForeign+=scaled(r.foreign_amount,100,'foreign_amount',keyOf(r))??0;s.nsQuantity+=scaled(r.quantity,1e6,'quantity',keyOf(r))??0;}
  for(const r of bqLines){const s=summary(String(r.receipt_internal_id));s.bqNet+=scaled(r.net_amount,100,'net_amount',keyOf(r))??0;s.bqForeign+=scaled(r.foreign_amount,100,'foreign_amount',keyOf(r))??0;s.bqQuantity+=scaled(r.quantity,1e6,'quantity',keyOf(r))??0;}
  for(const [k,a] of ns){const b=bq.get(k);if(!b)continue;
    for(const f of numericFields){const scale=f==='quantity'||f==='rate'?1e6:100;const av=scaled(a[f],scale,f,k),bv=scaled(b[f],scale,f,k);if(av!==bv)different.push({key:k,field:f,netSuite:a[f],bigQuery:b[f]});}
    if((a.item_id??null)!==(b.item_id??null))different.push({key:k,field:'item_id',netSuite:a.item_id,bigQuery:b.item_id});
  }
  const receiptDifferences=[];
  for(const [id,s] of perReceipt){if(s.nsNet!==s.bqNet||s.nsForeign!==s.bqForeign||s.nsQuantity!==s.bqQuantity)receiptDifferences.push({id,netSuiteNet:fmt(s.nsNet),bigQueryNet:fmt(s.bqNet),netSuiteForeign:fmt(s.nsForeign),bigQueryForeign:fmt(s.bqForeign),netSuiteQuantity:fmt(s.nsQuantity,1e6),bigQueryQuantity:fmt(s.bqQuantity,1e6)});}
  const totals = {nsNet:0,bqNet:0,nsForeign:0,bqForeign:0,nsQuantity:0,bqQuantity:0};
  for(const s of perReceipt.values())for(const k of Object.keys(totals))totals[k]+=s[k];
  const nullHeaderAmounts=bqHeaders.filter(x=>x.total_amount==null).length;
  console.log(JSON.stringify({sourceHeaders:source.headers.length,bqHeaders:bqHeaders.length,sourceLines:source.lines.length,bqLines:bqLines.length,onlyNSHeaders,onlyBQHeaders,duplicateBQKeys:dupBQ.slice(0,20),onlyNSLines:onlyNSLines.slice(0,20),onlyBQLines:onlyBQLines.slice(0,20),fieldDifferences:different.slice(0,20),receiptDifferences:receiptDifferences.slice(0,20),summary:{netSuiteNet:fmt(totals.nsNet),bigQueryNet:fmt(totals.bqNet),netSuiteForeign:fmt(totals.nsForeign),bigQueryForeign:fmt(totals.bqForeign),netSuiteQuantity:fmt(totals.nsQuantity,1e6),bigQueryQuantity:fmt(totals.bqQuantity,1e6)},headerAmountsNull:nullHeaderAmounts},null,2));
  if(onlyNSHeaders.length||onlyBQHeaders.length||dupBQ.length||onlyNSLines.length||onlyBQLines.length||different.length||receiptDifferences.length)throw Error('ITEM RECEIPT FINANCIAL DETAIL CHECK: FAIL (review above; no changes applied)');
  console.log('ITEM RECEIPT FINANCIAL DETAIL CHECK: PASS');
  console.log('NOTICE: Header total_amount and GL accounting book reconciliation are NOT certified by this check.');
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1;});
