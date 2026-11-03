// Module 9 Sales Payment / Customer Payment source discovery.
// READ ONLY: no BigQuery, no DDL/DML, no checkpoints, no deletion apply.
// Candidate NetSuite Transaction.type = CustPymt; this probe must prove it in the live account.
import { token, fetchAll, suiteql } from '../../common/netsuite-client.mjs';
import { validateNumeric } from '../../common/decimal-precision.mjs';

const TYPE = 'CustPymt';
const RANGE_FROM = '2026-10-01';
const RANGE_TO = '2027-01-01';
const MONTHS = [
  ['2026-10', '2026-10-01', '2026-11-01'],
  ['2026-11', '2026-11-01', '2026-12-01'],
  ['2026-12', '2026-12-01', '2027-01-01']
];

const failures = { required: 0, optional: 0 };
const validId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const inList = ids => ids.filter(validId).map(Number).join(',');

function dateFilter(alias, from, to) {
  return `${alias}.trandate >= TO_DATE('${from}','YYYY-MM-DD') ` +
    `AND ${alias}.trandate < TO_DATE('${to}','YYYY-MM-DD')`;
}

async function query(access, label, sql, { required = true, sample = 12 } = {}) {
  console.log(`\n=== ${label} ===`);
  try {
    const rows = await fetchAll(access, sql);
    console.log('Rows:', rows.length);
    console.log('Sample:', JSON.stringify(rows.slice(0, sample), null, 2));
    return rows;
  } catch (error) {
    failures[required ? 'required' : 'optional']++;
    console.error(`${required ? 'QUERY FAILED' : 'OPTIONAL QUERY FAILED'}:`, error.message);
    return null;
  }
}

async function page(access, label, sql, { required = false, limit = 10 } = {}) {
  console.log(`\n=== ${label} ===`);
  try {
    const result = await suiteql(access, sql, limit, 0);
    const rows = result.items ?? [];
    console.log('Rows returned:', rows.length, '| hasMore:', Boolean(result.hasMore));
    console.log('Sample:', JSON.stringify(rows, null, 2));
    return rows;
  } catch (error) {
    failures[required ? 'required' : 'optional']++;
    console.error(`${required ? 'QUERY FAILED' : 'OPTIONAL QUERY FAILED'}:`, error.message);
    return null;
  }
}

function precision(value, context) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  let numericStatus = 'NUMERIC_OK';
  let numericValue = null;
  try {
    numericValue = validateNumeric(raw, context);
  } catch (error) {
    numericStatus = `NUMERIC_REJECT: ${error.message}`;
  }
  return { raw, numericStatus, numericValue };
}

function reportPrecision(label, rows, fields, idField = 'internal_id') {
  console.log(`\n=== DECIMAL PRECISION: ${label} ===`);
  if (!rows?.length) {
    console.log('No rows available for precision inspection.');
    return;
  }

  const report = [];
  for (const row of rows) {
    const recordId = row[idField] ?? row.transaction ?? row.transaction_id ?? 'unknown';
    for (const field of fields) {
      if (!(field in row)) continue;
      const result = precision(row[field], { module: 'sales-payment', recordId, field });
      if (result) report.push({ recordId: String(recordId), field, ...result });
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

function collectRelatedIds(linkSets, paymentIds) {
  const payment = new Set(paymentIds.map(String));
  const related = new Set();
  for (const rows of linkSets) {
    for (const row of rows ?? []) {
      for (const key of ['previousdoc', 'nextdoc']) {
        const value = row[key];
        if (validId(value) && !payment.has(String(value))) related.add(String(value));
      }
    }
  }
  return [...related].slice(0, 50);
}

console.log('NETSUITE BACKUP - MODULE 9 SALES PAYMENT SOURCE DISCOVERY');
console.log(`Candidate type: ${TYPE}`);
console.log(`KPI window: ${RANGE_FROM} .. ${RANGE_TO} (exclusive end)`);
console.log('MODE: LIVE READ-ONLY | NO BIGQUERY | NO CHECKPOINT | NO DELETION APPLY');

try {
  const access = await token();
  console.log('\nOAuth: SUCCESS');

  const octoberTypes = await query(
    access,
    'OCTOBER TRANSACTION TYPE INVENTORY',
    `SELECT t.type, COUNT(*) AS transaction_count ` +
      `FROM Transaction t ` +
      `WHERE ${dateFilter('t', '2026-10-01', '2026-11-01')} ` +
      `GROUP BY t.type ORDER BY t.type`,
    { required: true, sample: 200 }
  );

  const monthly = [];
  for (const [month, from, to] of MONTHS) {
    const rows = await query(
      access,
      `MONTHLY KPI ${month} - RAW NETSUITE TOTALS`,
      `SELECT COUNT(*) AS transaction_count, ` +
        `SUM(t.foreigntotal) AS foreign_total_sum, ` +
        `SUM(t.total) AS total_sum ` +
        `FROM Transaction t ` +
        `WHERE t.type='${TYPE}' AND ${dateFilter('t', from, to)}`,
      { required: true, sample: 5 }
    );
    monthly.push({ month, rows });
  }

  const headers = await query(
    access,
    'OCT-DEC CUSTOMER PAYMENT HEADERS',
    `SELECT t.id AS internal_id, t.type, t.tranid AS document_number, ` +
      `TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date, ` +
      `TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, ` +
      `t.status AS status_id, t.entity AS customer_id, ` +
      `t.currency AS currency_id, ` +
      `t.exchangerate, t.foreigntotal, t.total ` +
      `FROM Transaction t ` +
      `WHERE t.type='${TYPE}' AND ${dateFilter('t', RANGE_FROM, RANGE_TO)} ` +
      `ORDER BY t.trandate, t.id`,
    { required: true, sample: 15 }
  );

  let workingHeaders = headers ?? [];
  if (!workingHeaders.length) {
    console.warn('\nNo Oct-Dec CustPymt rows accessible. Running historical fallback to prove type/shape only.');
    const historical = await query(
      access,
      'HISTORICAL CUSTPYMT FALLBACK - LATEST ACCESSIBLE ROWS',
      `SELECT t.id AS internal_id, t.type, t.tranid AS document_number, ` +
        `TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date, ` +
        `TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified, ` +
        `t.status AS status_id, t.entity AS customer_id, ` +
        `t.currency AS currency_id, ` +
        `t.exchangerate, t.foreigntotal, t.total ` +
        `FROM Transaction t WHERE t.type='${TYPE}' ` +
        `ORDER BY t.trandate DESC, t.id DESC`,
      { required: true, sample: 15 }
    );
    workingHeaders = historical ?? [];
  }

  const candidateVisible = (octoberTypes ?? []).some(row => String(row.type) === TYPE) || workingHeaders.length > 0;
  console.log(`\nTYPE EVIDENCE ${TYPE}:`, candidateVisible ? 'VISIBLE/CONFIRMED CANDIDATE' : 'NOT YET PROVEN');

  reportPrecision('HEADER FINANCIALS', workingHeaders.slice(0, 20), [
    'exchangerate', 'foreigntotal', 'total'
  ]);

  if (workingHeaders.length) {
    const displayIds = inList(workingHeaders.map(row => row.internal_id).slice(0, 12));
    if (displayIds) {
      await query(
        access,
        'PAYMENT DISPLAY FIELDS / CUSTOMER-CURRENCY PERMISSION CHECK',
        `SELECT t.id AS internal_id, BUILTIN.DF(t.status) AS status, ` +
          `BUILTIN.DF(t.entity) AS customer_name, BUILTIN.DF(t.currency) AS currency_name ` +
          `FROM Transaction t WHERE t.id IN (${displayIds}) ORDER BY t.id`,
        { required: false, sample: 20 }
      );
    }
  }

  const sampleIds = [...new Set(workingHeaders.map(row => String(row.internal_id)))]
    .filter(validId)
    .slice(0, 6);

  if (!sampleIds.length) {
    console.warn('\nNo accessible payment IDs for structural discovery. Do not create schema/mapping from assumptions.');
  } else {
    const selected = inList(sampleIds);
    const firstId = Number(sampleIds[0]);

    await page(
      access,
      `RAW TRANSACTION * FOR PAYMENT ${firstId}`,
      `SELECT * FROM Transaction WHERE id=${firstId}`,
      { required: false, limit: 3 }
    );

    const lines = await query(
      access,
      'PAYMENT TRANSACTION LINES - KNOWN BASELINE FIELDS',
      `SELECT transaction, id AS line_id, uniquekey AS line_unique_key, ` +
        `linesequencenumber AS line_number, item, quantity, rate, ` +
        `foreignamount, netamount, mainline, taxline, iscogs, ` +
        `accountinglinetype, location ` +
        `FROM TransactionLine WHERE transaction IN (${selected}) ` +
        `ORDER BY transaction,id`,
      { required: true, sample: 80 }
    );

    await page(
      access,
      `RAW TRANSACTIONLINE * FOR PAYMENT ${firstId}`,
      `SELECT * FROM TransactionLine WHERE transaction=${firstId}`,
      { required: false, limit: 20 }
    );

    const accounting = await query(
      access,
      'PAYMENT ACCOUNTING LINES',
      `SELECT transaction, transactionline, accountingbook, account, ` +
        `debit, credit, posting ` +
        `FROM TransactionAccountingLine WHERE transaction IN (${selected}) ` +
        `ORDER BY transaction, transactionline, account`,
      { required: true, sample: 100 }
    );

    reportPrecision('TRANSACTION LINES', lines, [
      'quantity', 'rate', 'foreignamount', 'netamount'
    ], 'transaction');
    reportPrecision('ACCOUNTING LINES', accounting, [
      'debit', 'credit'
    ], 'transaction');

    const previousAsNext = await query(
      access,
      'PREVIOUSTRANSACTIONLINELINK - PAYMENT AS NEXTDOC',
      `SELECT previousdoc,nextdoc,linktype FROM PreviousTransactionLineLink ` +
        `WHERE nextdoc IN (${selected})`,
      { required: true, sample: 100 }
    );

    const previousAsPrevious = await query(
      access,
      'PREVIOUSTRANSACTIONLINELINK - PAYMENT AS PREVIOUSDOC',
      `SELECT previousdoc,nextdoc,linktype FROM PreviousTransactionLineLink ` +
        `WHERE previousdoc IN (${selected})`,
      { required: false, sample: 100 }
    );

    const nextAsPrevious = await query(
      access,
      'NEXTTRANSACTIONLINELINK - PAYMENT AS PREVIOUSDOC',
      `SELECT previousdoc,nextdoc,linktype FROM NextTransactionLineLink ` +
        `WHERE previousdoc IN (${selected})`,
      { required: true, sample: 100 }
    );

    const nextAsNext = await query(
      access,
      'NEXTTRANSACTIONLINELINK - PAYMENT AS NEXTDOC',
      `SELECT previousdoc,nextdoc,linktype FROM NextTransactionLineLink ` +
        `WHERE nextdoc IN (${selected})`,
      { required: false, sample: 100 }
    );

    await page(
      access,
      `RAW PREVIOUS LINK * FOR PAYMENT ${firstId} AS NEXTDOC`,
      `SELECT * FROM PreviousTransactionLineLink WHERE nextdoc=${firstId}`,
      { required: false, limit: 20 }
    );

    await page(
      access,
      `RAW NEXT LINK * FOR PAYMENT ${firstId} AS PREVIOUSDOC`,
      `SELECT * FROM NextTransactionLineLink WHERE previousdoc=${firstId}`,
      { required: false, limit: 20 }
    );

    const relatedIds = collectRelatedIds(
      [previousAsNext, previousAsPrevious, nextAsPrevious, nextAsNext],
      sampleIds
    );

    if (relatedIds.length) {
      await query(
        access,
        'RELATED TRANSACTION HEADERS FROM PAYMENT LINKS',
        `SELECT t.id AS internal_id,t.type,t.tranid AS document_number,` +
          `TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,` +
          `t.status AS status_id,BUILTIN.DF(t.status) AS status,` +
          `t.entity AS entity_id,t.currency AS currency_id,` +
          `t.exchangerate,t.foreigntotal,t.total ` +
          `FROM Transaction t WHERE t.id IN (${inList(relatedIds)}) ` +
          `ORDER BY t.type,t.id`,
        { required: true, sample: 100 }
      );
    } else {
      console.warn('\nNo related transaction IDs discovered from tested link directions. Allocation model remains unresolved.');
    }
  }

  console.log('\n=== PHASE A RESULT ===');
  console.log('Required query failures:', failures.required);
  console.log('Optional discovery failures:', failures.optional);
  console.log('No BigQuery writes, DDL, checkpoints, deletion registry, or scheduler files were touched.');
  console.log('Do NOT build Sales Payment schema until this output proves source totals, line/accounting model, links, and decimal policy.');

  if (failures.required > 0) {
    console.error('PHASE A NEEDS REVIEW: one or more required source queries failed.');
    process.exitCode = 1;
  } else if (!workingHeaders.length) {
    console.warn('PHASE A SOURCE NOT PROVEN: no accessible CustPymt sample rows.');
    process.exitCode = 2;
  } else {
    console.log('PHASE A SOURCE DISCOVERY PASS: live CustPymt sample available for review; mapping is NOT certified yet.');
    process.exitCode = 0;
  }
} catch (error) {
  console.error('SALES PAYMENT PROBE FATAL:', error.stack ?? error);
  process.exitCode = 1;
}
