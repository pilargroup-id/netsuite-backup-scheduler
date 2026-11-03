// Module 11 Vendor Credit source discovery.
// STRICT READ ONLY: no BigQuery, no DDL/DML, no checkpoint, no scheduler changes,
// no deletion apply. Candidate NetSuite Transaction.type = VendCred must be
// proven against the live account before schema/mapping/sync code is built.
import { token, fetchAll, suiteql } from '../../common/netsuite-client.mjs';
import { validateNumeric, validateBigNumeric } from '../../common/decimal-precision.mjs';

const MODULE = 'vendor-credit';
const TYPE = 'VendCred';
const RANGE_FROM = '2026-10-01';
const RANGE_TO = '2027-01-01';
const MONTHS = [
  ['2026-10', '2026-10-01', '2026-11-01'],
  ['2026-11', '2026-11-01', '2026-12-01'],
  ['2026-12', '2026-12-01', '2027-01-01']
];

const failures = { required: 0, optional: 0 };
const validId = value => /^[1-9]\d{0,14}$/.test(String(value ?? ''));
const inList = ids => [...new Set(ids.map(String).filter(validId))].join(',');

function dateFilter(alias, from, to) {
  return `${alias}.trandate >= TO_DATE('${from}','YYYY-MM-DD') ` +
    `AND ${alias}.trandate < TO_DATE('${to}','YYYY-MM-DD')`;
}

async function query(access, label, sql, { required = true, sample = 20 } = {}) {
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

async function page(access, label, sql, { required = false, limit = 20 } = {}) {
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

function canonicalShape(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!m) return { raw, validDecimalSyntax: false };
  const fraction = m[3] ?? m[4] ?? '';
  const exponent = Number(m[5] ?? 0);
  return {
    raw,
    validDecimalSyntax: Number.isSafeInteger(exponent),
    rawFractionDigits: fraction.length,
    exponent
  };
}

function inspectDecimal(value, recordId, field) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  let numeric = 'NUMERIC_OK';
  let numericValue = null;
  let bigNumeric = 'BIGNUMERIC_OK';
  let bigNumericValue = null;
  try {
    numericValue = validateNumeric(raw, { module: MODULE, recordId, field });
  } catch (error) {
    numeric = `NUMERIC_REJECT: ${error.message}`;
  }
  try {
    bigNumericValue = validateBigNumeric(raw, { module: MODULE, recordId, field });
  } catch (error) {
    bigNumeric = `BIGNUMERIC_REJECT: ${error.message}`;
  }
  return { ...canonicalShape(raw), numeric, numericValue, bigNumeric, bigNumericValue };
}

function decimalProfile(label, rows, fields, idField = 'internal_id') {
  console.log(`\n=== DECIMAL PROFILE: ${label} ===`);
  if (!rows?.length) {
    console.log('No rows available for decimal inspection.');
    return;
  }

  for (const field of fields) {
    const profile = {
      field,
      values: 0,
      invalidSyntax: 0,
      numericRejected: 0,
      bigNumericRejected: 0,
      maxRawFractionDigits: 0,
      nonZeroExponentValues: 0,
      examples: []
    };

    for (const row of rows) {
      if (!(field in row)) continue;
      const value = row[field];
      if (value === null || value === undefined || value === '') continue;
      const recordId = String(row[idField] ?? row.transaction ?? row.transaction_id ?? 'unknown');
      const info = inspectDecimal(value, recordId, field);
      profile.values++;
      if (!info.validDecimalSyntax) profile.invalidSyntax++;
      if (String(info.numeric).startsWith('NUMERIC_REJECT')) profile.numericRejected++;
      if (String(info.bigNumeric).startsWith('BIGNUMERIC_REJECT')) profile.bigNumericRejected++;
      profile.maxRawFractionDigits = Math.max(profile.maxRawFractionDigits, info.rawFractionDigits ?? 0);
      if (info.exponent) profile.nonZeroExponentValues++;
      if (profile.examples.length < 10 &&
          (!info.validDecimalSyntax ||
           String(info.numeric).startsWith('NUMERIC_REJECT') ||
           String(info.bigNumeric).startsWith('BIGNUMERIC_REJECT') ||
           (info.rawFractionDigits ?? 0) > 9 ||
           info.exponent)) {
        profile.examples.push({ recordId, raw: info.raw, numeric: info.numeric, bigNumeric: info.bigNumeric });
      }
    }

    let recommendation = 'NO_DATA';
    if (profile.values) {
      if (profile.invalidSyntax || profile.bigNumericRejected) recommendation = 'REVIEW_OR_STRING';
      else if (profile.numericRejected) recommendation = 'BIGNUMERIC_CANDIDATE_DO_NOT_ROUND';
      else recommendation = 'NUMERIC_CANDIDATE_EXACT_SCALE_9';
    }
    console.log(JSON.stringify({ ...profile, recommendation }, null, 2));
  }
}

function collectRelatedIds(linkSets, vendorCreditIds) {
  const own = new Set(vendorCreditIds.map(String));
  const related = new Set();
  for (const rows of linkSets) {
    for (const row of rows ?? []) {
      for (const key of ['previousdoc', 'nextdoc']) {
        const value = String(row[key] ?? '');
        if (validId(value) && !own.has(value)) related.add(value);
      }
    }
  }
  return [...related].slice(0, 100);
}

function distribution(rows, field) {
  const out = {};
  for (const row of rows ?? []) {
    const key = String(row[field] ?? 'NULL');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

console.log('NETSUITE BACKUP - MODULE 11 VENDOR CREDIT SOURCE DISCOVERY');
console.log(`Candidate type: ${TYPE}`);
console.log(`KPI window: ${RANGE_FROM} .. ${RANGE_TO} (exclusive end)`);
console.log('MODE: LIVE READ-ONLY | NO BIGQUERY | NO CHECKPOINT | NO DELETION APPLY | NO SCHEDULER CHANGE');
console.log('DECIMAL RULE: inspect exact source text first; never use JS floating-point or silent rounding.');
console.log('DELETION RULE: deletedrecord tuple is discovery-only here; no tuple becomes trusted without independent evidence.');

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
    { required: true, sample: 250 }
  );

  for (const [month, from, to] of MONTHS) {
    await query(
      access,
      `MONTHLY KPI ${month} - RAW VENDOR CREDIT TOTALS`,
      `SELECT COUNT(*) AS transaction_count, ` +
        `SUM(t.foreigntotal) AS foreign_total_sum, ` +
        `SUM(t.total) AS total_sum ` +
        `FROM Transaction t ` +
        `WHERE t.type='${TYPE}' AND ${dateFilter('t', from, to)}`,
      { required: true, sample: 5 }
    );
  }

  const headers = await query(
    access,
    'OCT-DEC VENDOR CREDIT HEADERS',
    `SELECT t.id AS internal_id,t.type,t.tranid AS document_number,` +
      `TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,` +
      `TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,` +
      `t.status AS status_id,t.entity AS vendor_id,` +
      `t.currency AS currency_id,t.exchangerate,t.foreigntotal,t.total,` +
      `t.postingperiod AS posting_period_id,t.subsidiary AS subsidiary_id,` +
      `t.posting,t.void,t.voided ` +
      `FROM Transaction t ` +
      `WHERE t.type='${TYPE}' AND ${dateFilter('t', RANGE_FROM, RANGE_TO)} ` +
      `ORDER BY t.trandate,t.id`,
    { required: true, sample: 20 }
  );

  let workingHeaders = headers ?? [];
  if (!workingHeaders.length) {
    console.warn('\nNo Oct-Dec VendCred rows accessible. Running historical fallback for type/shape proof only.');
    const historical = await query(
      access,
      'HISTORICAL VENDCRED FALLBACK - LATEST ACCESSIBLE ROWS',
      `SELECT t.id AS internal_id,t.type,t.tranid AS document_number,` +
        `TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,` +
        `TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,` +
        `t.status AS status_id,t.entity AS vendor_id,` +
        `t.currency AS currency_id,t.exchangerate,t.foreigntotal,t.total,` +
        `t.postingperiod AS posting_period_id,t.subsidiary AS subsidiary_id,` +
        `t.posting,t.void,t.voided ` +
        `FROM Transaction t WHERE t.type='${TYPE}' ` +
        `ORDER BY t.trandate DESC,t.id DESC`,
      { required: true, sample: 20 }
    );
    workingHeaders = historical ?? [];
  }

  const typeVisible = (octoberTypes ?? []).some(row => String(row.type) === TYPE) ||
    workingHeaders.some(row => String(row.type) === TYPE);
  console.log(`\nTYPE EVIDENCE ${TYPE}:`, typeVisible ? 'VISIBLE/CONFIRMED CANDIDATE' : 'NOT YET PROVEN');
  console.log('HEADER STATUS DISTRIBUTION:', JSON.stringify(distribution(workingHeaders, 'status_id')));
  console.log('HEADER CURRENCY DISTRIBUTION:', JSON.stringify(distribution(workingHeaders, 'currency_id')));
  decimalProfile('HEADER FINANCIALS', workingHeaders, ['exchangerate', 'foreigntotal', 'total']);

  const headerIds = [...new Set(workingHeaders.map(row => String(row.internal_id)))].filter(validId);
  if (headerIds.length) {
    const display = inList(headerIds.slice(0, 20));
    await query(
      access,
      'VENDOR CREDIT DISPLAY FIELDS / VENDOR-CURRENCY PERMISSION CHECK',
      `SELECT t.id AS internal_id,BUILTIN.DF(t.status) AS status,` +
        `BUILTIN.DF(t.entity) AS vendor_name,BUILTIN.DF(t.currency) AS currency_name,` +
        `BUILTIN.DF(t.subsidiary) AS subsidiary_name ` +
        `FROM Transaction t WHERE t.id IN (${display}) ORDER BY t.id`,
      { required: false, sample: 30 }
    );
  }

  const sampleIds = headerIds.slice(0, 8);
  if (!sampleIds.length) {
    console.warn('\nNo accessible VendCred IDs for structural discovery. Do NOT create BigQuery schema or mapping from assumptions.');
  } else {
    const selected = inList(sampleIds);
    const firstId = sampleIds[0];

    await page(
      access,
      `RAW TRANSACTION * FOR VENDOR CREDIT ${firstId}`,
      `SELECT * FROM Transaction WHERE id=${firstId}`,
      { required: false, limit: 3 }
    );

    const lines = await query(
      access,
      'VENDOR CREDIT TRANSACTION LINES - KNOWN BASELINE FIELDS',
      `SELECT tl.transaction,tl.id AS line_id,tl.uniquekey AS line_unique_key,` +
        `tl.linesequencenumber AS line_number,tl.mainline,tl.taxline,tl.iscogs,` +
        `tl.accountinglinetype,tl.expenseaccount AS account_id,tl.item AS item_id,` +
        `tl.quantity,tl.rate,tl.foreignamount,tl.netamount,tl.location AS location_id,` +
        `tl.units AS units_id ` +
        `FROM TransactionLine tl WHERE tl.transaction IN (${selected}) ` +
        `ORDER BY tl.transaction,tl.id`,
      { required: true, sample: 120 }
    );

    await page(
      access,
      `RAW TRANSACTIONLINE * FOR VENDOR CREDIT ${firstId}`,
      `SELECT * FROM TransactionLine WHERE transaction=${firstId}`,
      { required: false, limit: 30 }
    );

    const accounting = await query(
      access,
      'VENDOR CREDIT ACCOUNTING LINES',
      `SELECT tal.transaction,tal.transactionline AS line_id,` +
        `tal.accountingbook AS accounting_book_id,tal.account AS account_id,` +
        `tal.posting,tal.debit,tal.credit ` +
        `FROM TransactionAccountingLine tal WHERE tal.transaction IN (${selected}) ` +
        `ORDER BY tal.transaction,tal.accountingbook,tal.transactionline,tal.account`,
      { required: true, sample: 160 }
    );

    decimalProfile('TRANSACTION LINES', lines, ['quantity', 'rate', 'foreignamount', 'netamount'], 'transaction');
    decimalProfile('ACCOUNTING LINES', accounting, ['debit', 'credit'], 'transaction');
    console.log('LINE MAINLINE DISTRIBUTION:', JSON.stringify(distribution(lines, 'mainline')));
    console.log('LINE ACCOUNTING TYPE DISTRIBUTION:', JSON.stringify(distribution(lines, 'accountinglinetype')));
    console.log('GL BOOK DISTRIBUTION:', JSON.stringify(distribution(accounting, 'accounting_book_id')));
    console.log('GL POSTING DISTRIBUTION:', JSON.stringify(distribution(accounting, 'posting')));

    const previousAsNext = await query(
      access,
      'PREVIOUSTRANSACTIONLINELINK - VENDOR CREDIT AS NEXTDOC',
      `SELECT previousdoc,previousline,nextdoc,nextline,previoustype,nexttype,` +
        `linktype,foreignamount,discount,` +
        `TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS lastmodifieddate ` +
        `FROM PreviousTransactionLineLink WHERE nextdoc IN (${selected}) ` +
        `ORDER BY nextdoc,previousdoc,previousline,nextline`,
      { required: true, sample: 160 }
    );

    const previousAsPrevious = await query(
      access,
      'PREVIOUSTRANSACTIONLINELINK - VENDOR CREDIT AS PREVIOUSDOC',
      `SELECT previousdoc,previousline,nextdoc,nextline,previoustype,nexttype,` +
        `linktype,foreignamount,discount,` +
        `TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS lastmodifieddate ` +
        `FROM PreviousTransactionLineLink WHERE previousdoc IN (${selected}) ` +
        `ORDER BY previousdoc,nextdoc,previousline,nextline`,
      { required: false, sample: 160 }
    );

    const nextAsPrevious = await query(
      access,
      'NEXTTRANSACTIONLINELINK - VENDOR CREDIT AS PREVIOUSDOC',
      `SELECT previousdoc,previousline,nextdoc,nextline,previoustype,nexttype,` +
        `linktype,foreignamount,` +
        `TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS lastmodifieddate ` +
        `FROM NextTransactionLineLink WHERE previousdoc IN (${selected}) ` +
        `ORDER BY previousdoc,nextdoc,previousline,nextline`,
      { required: true, sample: 160 }
    );

    const nextAsNext = await query(
      access,
      'NEXTTRANSACTIONLINELINK - VENDOR CREDIT AS NEXTDOC',
      `SELECT previousdoc,previousline,nextdoc,nextline,previoustype,nexttype,` +
        `linktype,foreignamount,` +
        `TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS lastmodifieddate ` +
        `FROM NextTransactionLineLink WHERE nextdoc IN (${selected}) ` +
        `ORDER BY nextdoc,previousdoc,previousline,nextline`,
      { required: false, sample: 160 }
    );

    decimalProfile('PREVIOUS LINKS AS NEXTDOC', previousAsNext, ['foreignamount'], 'nextdoc');
    decimalProfile('PREVIOUS LINKS AS PREVIOUSDOC', previousAsPrevious, ['foreignamount'], 'previousdoc');
    decimalProfile('NEXT LINKS AS PREVIOUSDOC', nextAsPrevious, ['foreignamount'], 'previousdoc');
    decimalProfile('NEXT LINKS AS NEXTDOC', nextAsNext, ['foreignamount'], 'nextdoc');

    console.log('PREVIOUS-AS-NEXT LINK TYPE DISTRIBUTION:', JSON.stringify(distribution(previousAsNext, 'linktype')));
    console.log('PREVIOUS-AS-NEXT PREVIOUS TYPE DISTRIBUTION:', JSON.stringify(distribution(previousAsNext, 'previoustype')));
    console.log('NEXT-AS-PREVIOUS LINK TYPE DISTRIBUTION:', JSON.stringify(distribution(nextAsPrevious, 'linktype')));
    console.log('NEXT-AS-PREVIOUS NEXT TYPE DISTRIBUTION:', JSON.stringify(distribution(nextAsPrevious, 'nexttype')));

    await page(
      access,
      `RAW PREVIOUS LINK * FOR VENDOR CREDIT ${firstId} AS NEXTDOC`,
      `SELECT * FROM PreviousTransactionLineLink WHERE nextdoc=${firstId}`,
      { required: false, limit: 30 }
    );

    await page(
      access,
      `RAW NEXT LINK * FOR VENDOR CREDIT ${firstId} AS PREVIOUSDOC`,
      `SELECT * FROM NextTransactionLineLink WHERE previousdoc=${firstId}`,
      { required: false, limit: 30 }
    );

    const relatedIds = collectRelatedIds(
      [previousAsNext, previousAsPrevious, nextAsPrevious, nextAsNext],
      sampleIds
    );
    if (relatedIds.length) {
      await query(
        access,
        'RELATED TRANSACTION HEADERS FROM VENDOR CREDIT LINKS',
        `SELECT t.id AS internal_id,t.type,t.tranid AS document_number,` +
          `TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,` +
          `t.status AS status_id,BUILTIN.DF(t.status) AS status,` +
          `t.entity AS entity_id,t.currency AS currency_id,` +
          `t.exchangerate,t.foreigntotal,t.total ` +
          `FROM Transaction t WHERE t.id IN (${inList(relatedIds)}) ` +
          `ORDER BY t.type,t.id`,
        { required: true, sample: 160 }
      );
    } else {
      console.warn('\nNo related transaction IDs discovered in sampled link directions. Relationship model remains unresolved.');
    }
  }

  const deletedTypes = await query(
    access,
    'DELETEDRECORD TYPE INVENTORY - DISCOVERY ONLY',
    `SELECT recordtypeid,type,COUNT(*) AS deleted_count ` +
      `FROM deletedrecord GROUP BY recordtypeid,type ORDER BY recordtypeid,type`,
    { required: false, sample: 500 }
  );
  const deletionCandidates = (deletedTypes ?? []).filter(row => {
    const text = `${row.recordtypeid ?? ''} ${row.type ?? ''}`.toLowerCase();
    return text.includes('vend') || text.includes('credit');
  });
  console.log('\n=== DELETION IDENTITY DISCOVERY CANDIDATES - NOT CERTIFIED ===');
  console.log(JSON.stringify(deletionCandidates, null, 2));
  console.log('RULE: no recordtypeid/type tuple may be enabled for automatic deletion from this aggregate alone.');
  console.log('A later phase requires independent exact deletedrecord evidence plus source absence for a real VendCred ID.');

  console.log('\n=== PHASE A RESULT ===');
  console.log('Required query failures:', failures.required);
  console.log('Optional discovery failures:', failures.optional);
  console.log('No BigQuery writes, DDL, checkpoints, deletion apply, shared locks, production modules, or scheduler files were touched.');
  console.log('Do NOT build Vendor Credit schema/mapping/sync until this output is reviewed for source grain, links, GL, and decimal policy.');

  if (failures.required > 0) {
    console.error('PHASE A NEEDS REVIEW: one or more required source queries failed.');
    process.exitCode = 1;
  } else if (!workingHeaders.length || !typeVisible) {
    console.warn('PHASE A SOURCE NOT PROVEN: no accessible VendCred sample rows.');
    process.exitCode = 2;
  } else {
    console.log('PHASE A SOURCE DISCOVERY PASS: live VendCred sample available for review; mapping/schema/deletion are NOT certified yet.');
    process.exitCode = 0;
  }
} catch (error) {
  console.error('VENDOR CREDIT PROBE FATAL:', error.stack ?? error);
  process.exitCode = 1;
}
