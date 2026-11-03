// Module 9 Sales Payment - Phase B1 source-wide financial & application discovery.
// READ ONLY. No BigQuery, deletion apply, checkpoints, scheduler, DDL or DML.
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { validateNumeric } from '../../common/decimal-precision.mjs';

const START = '2026-10-01';
const END = '2027-01-01';
const WINDOW = `t.trandate >= TO_DATE('${START}', 'YYYY-MM-DD') AND t.trandate < TO_DATE('${END}', 'YYYY-MM-DD')`;
const slices = [
  ['Oct', '2026-10-01', '2026-11-01'],
  ['Nov', '2026-11-01', '2026-12-01'],
  ['Dec', '2026-12-01', '2027-01-01']
];
const decimalFields = ['total', 'foreigntotal', 'exchangerate', 'foreignpaymentamountused', 'foreignpaymentamountunused'];
function assertNumeric(value, recordId, field) {
  if (value === null || value === undefined || value === '') return;
  validateNumeric(value, { module: 'sales-payment', recordId, field });
}
async function read(access, name, sql) {
  console.log(`\n=== ${name} ===`);
  const rows = await fetchAll(access, sql);
  console.log(`Rows=${rows.length}`);
  return rows;
}
function sumDecimal(values) {
  // Exact decimal sum using fixed-scale BigInt; no JS Number financial arithmetic.
  let sum = 0n;
  for (const val of values) {
    if (val === null || val === undefined || val === '') continue;
    const canonical = validateNumeric(val, { module: 'sales-payment', field: 'aggregate-source' });
    const neg = canonical.startsWith('-');
    const s = neg ? canonical.slice(1) : canonical;
    const [whole, fraction = ''] = s.split('.');
    const unit = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
    sum += neg ? -unit : unit;
  }
  const neg = sum < 0n;
  const a = neg ? -sum : sum;
  return `${neg ? '-' : ''}${a / 1000000000n}.${(a % 1000000000n).toString().padStart(9, '0')}`.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
async function main() {
  console.log('NETSUITE BACKUP - SALES PAYMENT PHASE B1 FULL-SOURCE AUDIT');
  console.log('READ ONLY - NO BQ WRITES - NO DELETION REGISTRY OR APPLY');
  const access = await token();
  console.log('OAuth: SUCCESS');
  const headers = await read(access, 'ALL OCT-DEC PAYMENT HEADERS', `
    SELECT t.id AS internal_id, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date, t.tranid AS document_number,
      t.lastmodifieddate AS last_modified, t.entity AS customer_id,
      t.currency AS currency_id, t.status AS status_id, t.exchangerate,
      t.total, t.foreigntotal, t.foreignpaymentamountused,
      t.foreignpaymentamountunused, t.posting, t.voided
    FROM Transaction t WHERE t.type = 'CustPymt' AND ${WINDOW} ORDER BY t.id`);
  if (!headers.length) throw new Error('No source rows visible; abort rather than certify empty payments');
  const ids = new Set(headers.map(r => String(r.internal_id)));
  let failedDecimal = 0;
  for (const r of headers) for (const field of decimalFields) {
    try { assertNumeric(r[field], r.internal_id, field); }
    catch (error) { failedDecimal++; console.error('DECIMAL_FAIL:', error.message); }
  }
  for (const [label, from, to] of slices) {
    const set = headers.filter(r => String(r.transaction_date).slice(0, 10) >= from && String(r.transaction_date).slice(0, 10) < to);
    console.log(`${label} headers=${set.length} total=${sumDecimal(set.map(r => r.total))} foreign_total=${sumDecimal(set.map(r => r.foreigntotal))}`);
  }
  const status = {};
  const currencies = {};
  for (const r of headers) {
    status[String(r.status_id)] = (status[String(r.status_id)] ?? 0) + 1;
    currencies[String(r.currency_id)] = (currencies[String(r.currency_id)] ?? 0) + 1;
  }
  console.log('Status distribution:', JSON.stringify(status));
  console.log('Currency distribution:', JSON.stringify(currencies));
  console.log('Void count:', headers.filter(r => r.voided === 'T').length);
  console.log('Decimal failures:', failedDecimal);
  // Payment application links are NOT line items; read all links for the payment ID set.
  const links = await read(access, 'ALL PAYMENT APPLICATION LINKS', `
    SELECT p.previousdoc AS invoice_id, p.previousline AS invoice_line,
      p.nextdoc AS payment_id, p.nextline AS payment_line,
      p.previoustype AS invoice_type, p.nexttype AS payment_type,
      p.linktype, p.foreignamount AS applied_foreign_amount,
      p.lastmodifieddate AS last_modified
    FROM PreviousTransactionLineLink p
    JOIN Transaction t ON t.id = p.nextdoc
    WHERE t.type = 'CustPymt' AND ${WINDOW}
    ORDER BY p.nextdoc, p.previousdoc, p.previousline, p.nextline`);
  const perPayment = new Map();
  const linkTypes = {};
  const priorTypes = {};
  let orphan = 0;
  for (const r of links) {
    if (!ids.has(String(r.payment_id))) orphan++;
    assertNumeric(r.applied_foreign_amount, r.payment_id, 'applied_foreign_amount');
    perPayment.set(String(r.payment_id), (perPayment.get(String(r.payment_id)) ?? 0) + 1);
    linkTypes[String(r.linktype)] = (linkTypes[String(r.linktype)] ?? 0) + 1;
    priorTypes[String(r.invoice_type)] = (priorTypes[String(r.invoice_type)] ?? 0) + 1;
  }
  console.log('Application links:', links.length, '| Payments with applications:', perPayment.size,
    '| Payments without applications:', headers.length - perPayment.size, '| Orphan links:', orphan);
  console.log('Link types:', JSON.stringify(linkTypes), '| Previous document types:', JSON.stringify(priorTypes));
  console.log('Maximum applications per payment:', Math.max(0, ...perPayment.values()));
  const lineStats = await read(access, 'PAYMENT TRANSACTIONLINE GROUPING', `
    SELECT tl.mainline, tl.accountinglinetype, COUNT(*) AS line_count,
      SUM(tl.foreignamount) AS foreign_amount_sum, SUM(tl.netamount) AS net_amount_sum
    FROM TransactionLine tl JOIN Transaction t ON t.id = tl.transaction
    WHERE t.type = 'CustPymt' AND ${WINDOW}
    GROUP BY tl.mainline, tl.accountinglinetype ORDER BY tl.mainline, tl.accountinglinetype`);
  for (const r of lineStats) {
    assertNumeric(r.foreign_amount_sum, 'group', 'foreign_amount_sum');
    assertNumeric(r.net_amount_sum, 'group', 'net_amount_sum');
    console.log(JSON.stringify(r));
  }
  const accounting = await read(access, 'PAYMENT ACCOUNTING BOOK DISTRIBUTION', `
    SELECT tal.accountingbook, tal.posting, COUNT(*) AS gl_line_count,
      SUM(tal.debit) AS debit_sum, SUM(tal.credit) AS credit_sum
    FROM TransactionAccountingLine tal JOIN Transaction t ON t.id = tal.transaction
    WHERE t.type = 'CustPymt' AND ${WINDOW}
    GROUP BY tal.accountingbook, tal.posting ORDER BY tal.accountingbook, tal.posting`);
  for (const r of accounting) {
    assertNumeric(r.debit_sum, 'accounting-group', 'debit_sum');
    assertNumeric(r.credit_sum, 'accounting-group', 'credit_sum');
    console.log(JSON.stringify(r));
  }
  console.log('\nPHASE B1 RESULT', JSON.stringify({ headers: headers.length, applicationLinks: links.length,
    transactionLineGroups: lineStats.length, accountingGroups: accounting.length, decimalFailures: failedDecimal,
    orphanLinks: orphan }));
  if (failedDecimal || orphan) process.exitCode = 2;
}
main().catch(error => { console.error('PHASE B1 BLOCKED:', error.message); process.exitCode = 2; });
