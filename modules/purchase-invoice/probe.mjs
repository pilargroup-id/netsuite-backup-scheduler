// Vendor Bill / Purchase Invoice discovery. READ ONLY; no BigQuery writes/checkpoint.
// Reuse existing NetSuite OAuth2 M2M client and role.
import { token, fetchAll } from '../../common/netsuite-client.mjs';

const FROM = '2026-10-01';
const TO = '2026-11-01';
const TYPE = 'VendBill'; // Candidate; must verify before implementing mapping.
const dateFilter = `trandate >= TO_DATE('${FROM}','YYYY-MM-DD') AND trandate < TO_DATE('${TO}','YYYY-MM-DD')`;
const validId = x => /^\d+$/.test(String(x)) && Number.isSafeInteger(Number(x)) && Number(x) > 0;

async function inspect(access, title, sql, limit = 12) {
  console.log(`\n=== ${title} ===`);
  try {
    const rows = await fetchAll(access, sql);
    console.log('Rows:', rows.length);
    console.log('Sample:', JSON.stringify(rows.slice(0, limit), null, 2));
    return { ok: true, rows };
  } catch (error) {
    console.error('QUERY FAILED:', error.message);
    return { ok: false, rows: [] };
  }
}

try {
  console.log(`PURCHASE INVOICE / VENDOR BILL PROBE | READ ONLY | ${FROM} to ${TO}`);
  const access = await token();
  const types = await inspect(access, 'OCTOBER TRANSACTION TYPES',
    `SELECT type, COUNT(*) AS transaction_count FROM Transaction WHERE ${dateFilter} GROUP BY type ORDER BY type`, 100);
  const headers = await inspect(access, 'VENDOR BILL HEADERS',
    `SELECT id AS internal_id, tranid AS document_number, ` +
    `TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date, ` +
    `TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, ` +
    `BUILTIN.DF(status) AS status FROM Transaction ` +
    `WHERE type='${TYPE}' AND ${dateFilter} ORDER BY id`, 8);

  if (!headers.ok) {
    console.error('Vendor Bill header query unavailable. Check role Vendor Bill=View / supported fields.');
    process.exitCode = 1;
  } else if (headers.rows.length === 0) {
    console.warn('No accessible October Vendor Bills. This does not prove there are no bills.');
    process.exitCode = 2;
  } else {
    const ids = headers.rows.slice(0, 5).map(row => row.internal_id);
    if (!ids.every(validId)) throw new Error('Unexpected nonnumeric transaction ID');
    const selected = ids.map(Number).join(',');

    await inspect(access, 'HEADER FINANCIAL FIELDS',
      `SELECT id, entity AS vendor_id, currency AS currency_id, foreigntotal AS foreign_total, ` +
      `exchangerate, postingperiod FROM Transaction WHERE id IN (${selected}) ORDER BY id`);
    await inspect(access, 'HEADER VENDOR / STATUS DISPLAY',
      `SELECT id, BUILTIN.DF(entity) AS vendor_name, BUILTIN.DF(status) AS status, ` +
      `BUILTIN.DF(currency) AS currency_name FROM Transaction WHERE id IN (${selected}) ORDER BY id`);
    await inspect(access, 'RAW TRANSACTION LINES',
      `SELECT transaction, id AS line_id, uniquekey AS line_unique_key, ` +
      `linesequencenumber AS line_number, item, quantity, rate, foreignamount, netamount, ` +
      `mainline, taxline, iscogs, accountinglinetype, location ` +
      `FROM TransactionLine WHERE transaction IN (${selected}) ORDER BY transaction,id`, 35);
    await inspect(access, 'LINE CLASSIFICATION',
      `SELECT mainline,taxline,iscogs,accountinglinetype,COUNT(*) AS line_count, ` +
      `SUM(foreignamount) AS foreign_amount_sum,SUM(netamount) AS net_amount_sum ` +
      `FROM TransactionLine WHERE transaction IN (${selected}) ` +
      `GROUP BY mainline,taxline,iscogs,accountinglinetype`, 25);
    await inspect(access, 'GENERAL LEDGER ACCOUNTING LINES',
      `SELECT transaction,transactionline,accountingbook,account,debit,credit,posting ` +
      `FROM TransactionAccountingLine WHERE transaction IN (${selected})`, 30);
    await inspect(access, 'PREVIOUS TRANSACTION LINKS (PO / RECEIPT)',
      `SELECT previousdoc,nextdoc,linktype FROM NextTransactionLineLink ` +
      `WHERE nextdoc IN (${selected})`, 20);
  }
  if (!types.ok) console.warn('Type list unavailable: check permissions; do not infer record absence.');
  console.log('\nPROBE FINISHED: READ ONLY. Business definition, totals, GL signs, voids, and data mapping NOT YET CERTIFIED.');
} catch (error) {
  console.error('PURCHASE INVOICE PROBE ERROR:', error.message);
  process.exitCode = 1;
}
