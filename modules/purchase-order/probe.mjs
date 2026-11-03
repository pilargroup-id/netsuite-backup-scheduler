// Purchase Order discovery probe - READ ONLY. October 2026 baseline.
// Uses existing shared OAuth/SuiteQL client. No BigQuery writes or checkpoints.
import { token, fetchAll } from '../../common/netsuite-client.mjs';

const FROM = '2026-10-01';
const TO = '2026-11-01';
const TYPE = 'PurchOrd';
const dateFilter = `trandate >= TO_DATE('${FROM}','YYYY-MM-DD') AND trandate < TO_DATE('${TO}','YYYY-MM-DD')`;
const isPositiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const quoteIds = values => values.map(Number).join(',');

async function section(access, name, sql, sampleSize = 5) {
  console.log(`\n=== ${name} ===`);
  try {
    const rows = await fetchAll(access, sql);
    console.log('Rows:', rows.length);
    console.log('Sample:', JSON.stringify(rows.slice(0, sampleSize), null, 2));
    return { ok: true, rows };
  } catch (error) {
    // An optional unsupported SuiteQL column should not hide other useful discoveries.
    console.error('QUERY FAILED:', error.message);
    return { ok: false, rows: [] };
  }
}

try {
  console.log(`PURCHASE ORDER PROBE | READ ONLY | ${FROM} to ${TO} | expected type ${TYPE}`);
  const access = await token();

  const types = await section(access, 'TRANSACTION TYPES (OCT 2026)',
    `SELECT type, COUNT(*) AS transaction_count FROM Transaction WHERE ${dateFilter} GROUP BY type ORDER BY type`, 100);

  const headers = await section(access, 'PURCHASE ORDER HEADERS',
    `SELECT id AS internal_id, tranid AS po_number, TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date, ` +
    `TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, ` +
    `BUILTIN.DF(status) AS status FROM Transaction ` +
    `WHERE type = '${TYPE}' AND ${dateFilter} ORDER BY id`, 5);

  if (!headers.ok) {
    console.error('HEADER QUERY FAILED: Check Purchase Order = View and field availability. No conclusions about absence/deletion.');
    process.exitCode = 1;
  } else if (!headers.rows.length) {
    console.warn('NO PO HEADERS RETURNED. Verify permissions, PO activity for October, and transaction type.');
    process.exitCode = 2;
  } else {
    const ids = headers.rows.slice(0, 5).map(r => r.internal_id);
    if (!ids.every(isPositiveId)) throw new Error('Unsafe internal IDs from source');
    const inIds = quoteIds(ids);

    await section(access, 'HEADER FINANCIAL / ENTITY FIELDS',
      `SELECT id, entity AS vendor_id, currency AS currency_id, foreigntotal AS foreign_total, ` +
      `exchangerate, subsidiary, postingperiod, createdfrom ` +
      `FROM Transaction WHERE id IN (${inIds}) ORDER BY id`);

    await section(access, 'HEADER EXTENDED FIELDS',
      `SELECT id, subsidiary, postingperiod, createdfrom, exchangerate, ` +
      `BUILTIN.DF(status) AS status, BUILTIN.DF(entity) AS vendor_name ` +
      `FROM Transaction WHERE id IN (${inIds}) ORDER BY id`);

    await section(access, 'RAW LINES (INCLUDES MAINLINE/TAX/COGS)',
      `SELECT transaction, id AS line_id, uniquekey AS line_unique_key, ` +
      `linesequencenumber AS line_number, item, quantity, rate, foreignamount, ` +
      `netamount, location, units, mainline, taxline, iscogs, ` +
      `accountinglinetype FROM TransactionLine WHERE transaction IN (${inIds}) ` +
      `ORDER BY transaction, id`, 30);

    await section(access, 'LINE CLASSIFICATION SUMMARY (SAMPLED POS)',
      `SELECT mainline, taxline, iscogs, accountinglinetype, ` +
      `COUNT(*) AS line_count, SUM(foreignamount) AS sum_foreignamount, ` +
      `SUM(netamount) AS sum_netamount FROM TransactionLine ` +
      `WHERE transaction IN (${inIds}) ` +
      `GROUP BY mainline, taxline, iscogs, accountinglinetype ` +
      `ORDER BY mainline, taxline, iscogs, accountinglinetype`, 30);

    await section(access, 'ACCOUNTING LINES (MAY BE EMPTY FOR NONPOSTING PO)',
      `SELECT transaction, transactionline, accountingbook, account, debit, credit, posting ` +
      `FROM TransactionAccountingLine WHERE transaction IN (${inIds})`, 20);

    await section(access, 'RELATED TRANSACTIONS (PO -> RECEIPT/BILL)',
      `SELECT previousdoc, nextdoc, linktype FROM NextTransactionLineLink ` +
      `WHERE previousdoc IN (${inIds})`, 20);
  }
  console.log('\nPROBE COMPLETE: READ ONLY. No amounts, line classes, or links certified yet.');
  if (!types.ok) console.warn('Transaction type discovery failed; check role scope.');
} catch (error) {
  console.error('PURCHASE ORDER PROBE ERROR:', error.message);
  process.exitCode = 1;
}
