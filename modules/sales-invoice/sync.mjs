import { validateNumericRows } from '../../common/decimal-precision.mjs';
import { bq as sharedBQ } from '../../common/bigquery-client.mjs';
import { token as sharedToken } from '../../common/netsuite-client.mjs';
import { asDecimal, negate, safeInt, strTime, normalize } from './mapping.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// Keep this file named sync-sales-invoice.mjs after migration.
// Replace these two placeholders with your EXISTING integration identifiers.
import { CLIENT_ID, CERTIFICATE_ID, PRIVATE_KEY_PATH } from '../../credentials/netsuite-secrets.mjs';
const BASE_URL = 'https://6930902.suitetalk.api.netsuite.com';
const PROJECT = 'even-gearbox-255203';
const DATASET = 'netsuite_backup';
const LOCATION = 'asia-southeast1';
const HEADERS = 'sales_invoice_headers';
const LINES = 'sales_invoice_lines';
const CHECKPOINT = 'sync_checkpoints';
const OVERLAP_MINUTES = 5;
const DRY_RUN = process.argv.includes('--dry-run');
const CHUNK_SIZE = 25;
const bq = sharedBQ;
const dataset = bq.dataset(DATASET);
const fq = name => `\`${PROJECT}.${DATASET}.${name}\``;

async function query(sql, params = {}) {
  const [rows] = await bq.query({ query: sql, params, location: LOCATION });
  return rows;
}

const token = sharedToken;

async function suiteql(accessToken, sql, limit = 1000, offset = 0) {
  const url = `${BASE_URL}/services/rest/query/v1/suiteql?limit=${limit}&offset=${offset}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: 'transient' },
      body: JSON.stringify({ q: sql })
    });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if (attempt === 3 || ![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`SuiteQL HTTP ${res.status}: ${text}\nSQL: ${sql}`);
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
  }
}
async function allRows(accessToken, sql) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await suiteql(accessToken, sql, 1000, offset);
    const items = page.items ?? [];
    rows.push(...items);
    if (!page.hasMore) return rows;
    if (!items.length || offset >= 999000) throw new Error('SuiteQL pagination problem');
  }
}
async function checkpoints() {
  const rows = await query(`
    SELECT record_type,
      FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', last_successful_modified_at) AS modified
    FROM ${fq(CHECKPOINT)}
    WHERE record_type IN ('sales_invoice', 'sales_invoice_lines')
  `);
  const map = new Map(rows.map(r => [r.record_type, r.modified]));
  if (!map.has('sales_invoice') || !map.has('sales_invoice_lines') ||
      !map.get('sales_invoice') || !map.get('sales_invoice_lines')) {
    throw new Error('Both Sales Invoice checkpoints must already exist; no automatic reset');
  }
  const earliest = [map.get('sales_invoice'), map.get('sales_invoice_lines')].sort()[0];
  const overlap = await query(`
    SELECT FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',
      DATETIME_SUB(CAST(@modified AS DATETIME), INTERVAL ${OVERLAP_MINUTES} MINUTE)) AS fetch_from
  `, { modified: earliest });
  return { header: map.get('sales_invoice'), lines: map.get('sales_invoice_lines'), fetchFrom: overlap[0].fetch_from };
}
async function changedInvoices(accessToken, fetchFrom) {
  strTime(fetchFrom);
  return allRows(accessToken, `
    SELECT t.id AS internal_id, t.tranid AS invoice_number,
      TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date,
      BUILTIN.DF(t.postingperiod) AS posting_period,
      BUILTIN.DF(t.status) AS status,
      t.foreigntotal AS total_amount,
      TO_CHAR(t.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS netsuite_last_modified_at
    FROM Transaction t
    WHERE t.type = 'CustInvc'
      AND t.lastmodifieddate >= TO_DATE('${fetchFrom}', 'YYYY-MM-DD HH24:MI:SS')
    ORDER BY t.lastmodifieddate, t.id
  `);
}
async function invoiceLines(accessToken, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const slice = ids.slice(i, i + CHUNK_SIZE);
    const sql = `
      SELECT t.id AS invoice_internal_id,
        t.tranid AS invoice_number,
        tl.linesequencenumber AS line_number,
        tl.item AS item_internal_id,
        BUILTIN.DF(tl.item) AS item_name,
        tl.memo AS description,
        tl.quantity AS raw_quantity,
        BUILTIN.DF(tl.units) AS unit,
        tl.rate AS rate,
        tl.foreignamount AS raw_amount,
        TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date,
        BUILTIN.DF(t.postingperiod) AS posting_period,
        TO_CHAR(t.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS netsuite_last_modified_at
      FROM TransactionLine tl
      INNER JOIN Transaction t ON t.id = tl.transaction
      WHERE tl.transaction IN (${slice.join(',')})
        AND t.type = 'CustInvc'
        AND tl.mainline = 'F' AND tl.taxline = 'F'
        AND tl.item IS NOT NULL AND NVL(tl.iscogs, 'F') = 'F'
      ORDER BY t.id, tl.linesequencenumber, tl.uniquekey
    `;
    const rows = await allRows(accessToken, sql);
    out.push(...rows);
    console.log(`Line batch ${Math.floor(i / CHUNK_SIZE) + 1}: ${rows.length} rows`);
  }
  return out;
}
function jsonl(file, rows) {
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}
async function stage(name, target, file, expected) {
  await query(`CREATE TABLE ${fq(name)} AS SELECT * FROM ${fq(target)} WHERE FALSE`);
  await dataset.table(name).load(file, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON',
    writeDisposition: 'WRITE_TRUNCATE',
    ignoreUnknownValues: false,
    maxBadRecords: 0,
    location: LOCATION
  });
  const check = await query(`SELECT COUNT(*) AS n FROM ${fq(name)}`);
  if (Number(check[0].n) !== expected) throw new Error(`Stage ${name} count mismatch`);
}
async function commit(headerStage, lineStage, maxModified, expectedHeaders, expectedLines) {
  const sql = `
    BEGIN TRANSACTION;

    MERGE ${fq(HEADERS)} target
    USING ${fq(headerStage)} source
    ON target.internal_id = source.internal_id
    WHEN MATCHED THEN UPDATE SET
      invoice_number = source.invoice_number,
      transaction_date = source.transaction_date,
      posting_period = source.posting_period,
      status = source.status,
      total_amount = source.total_amount,
      netsuite_last_modified_at = source.netsuite_last_modified_at,
      synced_at = CURRENT_TIMESTAMP(),
      is_deleted = FALSE,
      deleted_at = NULL
    WHEN NOT MATCHED THEN INSERT (
      internal_id, invoice_number, transaction_date, posting_period, status,
      total_amount, netsuite_last_modified_at, synced_at, first_synced_at,
      is_deleted, deleted_at
    ) VALUES (
      source.internal_id, source.invoice_number, source.transaction_date,
      source.posting_period, source.status, source.total_amount,
      source.netsuite_last_modified_at, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(),
      FALSE, NULL
    );

    DELETE FROM ${fq(LINES)}
    WHERE invoice_internal_id IN (SELECT internal_id FROM ${fq(headerStage)});

    INSERT INTO ${fq(LINES)} (
      invoice_internal_id, invoice_number, line_number, item_internal_id,
      item_name, description, quantity, unit, rate, amount,
      transaction_date, posting_period, netsuite_last_modified_at, synced_at
    )
    SELECT invoice_internal_id, invoice_number, line_number, item_internal_id,
      item_name, description, quantity, unit, rate, amount,
      transaction_date, posting_period, netsuite_last_modified_at, CURRENT_TIMESTAMP()
    FROM ${fq(lineStage)};

    ASSERT (
      (SELECT COUNT(*) FROM ${fq(HEADERS)}
       WHERE internal_id IN (SELECT internal_id FROM ${fq(headerStage)})) = @expectedHeaders
    ) AS 'Header count mismatch';
    ASSERT (
      (SELECT COUNT(*) FROM ${fq(LINES)}
       WHERE invoice_internal_id IN (SELECT internal_id FROM ${fq(headerStage)})) = @expectedLines
    ) AS 'Line count mismatch';
    ASSERT (
      (SELECT COUNT(*) FROM (
        SELECT invoice_internal_id, line_number FROM ${fq(LINES)}
        WHERE invoice_internal_id IN (SELECT internal_id FROM ${fq(headerStage)})
        GROUP BY invoice_internal_id, line_number HAVING COUNT(*) > 1
      )) = 0
    ) AS 'Duplicate lines';
    ASSERT (
      (SELECT COUNT(*) FROM ${fq(LINES)} l
       LEFT JOIN ${fq(HEADERS)} h ON h.internal_id = l.invoice_internal_id
       WHERE l.invoice_internal_id IN (SELECT internal_id FROM ${fq(headerStage)})
         AND h.internal_id IS NULL) = 0
    ) AS 'Orphan lines';

    UPDATE ${fq(CHECKPOINT)}
    SET last_successful_modified_at = GREATEST(
          COALESCE(last_successful_modified_at, CAST(@maxModified AS DATETIME)),
          CAST(@maxModified AS DATETIME)),
        last_successful_sync_at = CURRENT_TIMESTAMP(),
        updated_at = CURRENT_TIMESTAMP()
    WHERE record_type IN ('sales_invoice', 'sales_invoice_lines');

    ASSERT (
      (SELECT COUNT(*) FROM ${fq(CHECKPOINT)}
       WHERE record_type IN ('sales_invoice', 'sales_invoice_lines')) = 2
    ) AS 'Checkpoint rows missing';

    COMMIT TRANSACTION;
  `;
  await query(sql, { maxModified, expectedHeaders, expectedLines });
}
async function markNoChange() {
  await query(`
    UPDATE ${fq(CHECKPOINT)}
    SET last_successful_sync_at = CURRENT_TIMESTAMP(), updated_at = CURRENT_TIMESTAMP()
    WHERE record_type IN ('sales_invoice', 'sales_invoice_lines')
  `);
}
async function reconcile(stageName, expectedHeaders, expectedLines) {
  const [r] = await query(`
    SELECT
      (SELECT COUNT(*) FROM ${fq(HEADERS)}
       WHERE internal_id IN (SELECT internal_id FROM ${fq(stageName)})) AS headers,
      (SELECT COUNT(*) FROM ${fq(LINES)}
       WHERE invoice_internal_id IN (SELECT internal_id FROM ${fq(stageName)})) AS lines,
      (SELECT COALESCE(SUM(total_amount), 0) FROM ${fq(HEADERS)}
       WHERE internal_id IN (SELECT internal_id FROM ${fq(stageName)})) AS header_amount,
      (SELECT COUNT(*) FROM (
         SELECT invoice_internal_id, line_number FROM ${fq(LINES)}
         WHERE invoice_internal_id IN (SELECT internal_id FROM ${fq(stageName)})
         GROUP BY invoice_internal_id, line_number HAVING COUNT(*) > 1
       )) AS duplicates,
      (SELECT COUNT(*) FROM ${fq(LINES)} l
       LEFT JOIN ${fq(HEADERS)} h ON h.internal_id = l.invoice_internal_id
       WHERE l.invoice_internal_id IN (SELECT internal_id FROM ${fq(stageName)})
         AND h.internal_id IS NULL) AS orphans
  `);
  const good = Number(r.headers) === expectedHeaders && Number(r.lines) === expectedLines &&
    Number(r.duplicates) === 0 && Number(r.orphans) === 0;
  console.log(`Reconcile headers=${r.headers}, lines=${r.lines}, header amount=${r.header_amount}, duplicates=${r.duplicates}, orphans=${r.orphans}`);
  if (!good) throw new Error('Post-commit reconciliation FAILED');
  console.log('DELTA RECONCILIATION: PASS');
}
async function main() {
  console.log('NETSUITE SALES INVOICE COMBINED DELTA SYNC');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'SYNC'}`);
  const cp = await checkpoints();
  console.log(`Header checkpoint: ${cp.header}`);
  console.log(`Lines checkpoint : ${cp.lines}`);
  console.log(`Fetch from       : ${cp.fetchFrom} (5-minute overlap)`);
  const accessToken = await token();
  console.log('OAuth: SUCCESS');
  const changed = await changedInvoices(accessToken, cp.fetchFrom);
  console.log(`Changed invoices: ${changed.length}`);
  if (!changed.length) {
    if (!DRY_RUN) await markNoChange();
    console.log('NO CHANGES: SUCCESS');
    return;
  }
  const ids = [...new Set(changed.map(r => safeInt(r.internal_id)))];
  const rawLines = await invoiceLines(accessToken, ids);
  const source = normalize(changed, rawLines);
  const maxModified = source.headers.reduce((max, r) =>
    !max || r.netsuite_last_modified_at > max ? r.netsuite_last_modified_at : max, null);
  console.log(`Source validation: PASS (${source.headers.length} headers, ${source.lines.length} lines)`);
  if (DRY_RUN) {
    console.log('DRY RUN PASS: BigQuery unchanged');
    return;
  }
  const suffix = crypto.randomUUID().replace(/-/g, '');
  const headerStage = `_stage_si_h_${suffix}`;
  const lineStage = `_stage_si_l_${suffix}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'netsuite-si-'));
  const stages = [];
  try {
    const hf = path.join(temp, 'headers.jsonl');
    const lf = path.join(temp, 'lines.jsonl');
    validateNumericRows(source.headers, [
      ['exchange_rate', 'NUMERIC'],
      ['subtotal', 'NUMERIC'],
      ['discount_total', 'NUMERIC'],
      ['tax_total', 'NUMERIC'],
      ['total_amount', 'NUMERIC']
    ], { module: 'sales-invoice-headers' });

    validateNumericRows(source.lines, [
      ['quantity', 'NUMERIC'],
      ['rate', 'NUMERIC'],
      ['amount', 'NUMERIC']
    ], { module: 'sales-invoice-lines' });
    jsonl(hf, source.headers);
    jsonl(lf, source.lines);
    await stage(headerStage, HEADERS, hf, source.headers.length);
    stages.push(headerStage);
    if (source.lines.length) {
      await stage(lineStage, LINES, lf, source.lines.length);
    } else {
      await query(`CREATE TABLE ${fq(lineStage)} AS SELECT * FROM ${fq(LINES)} WHERE FALSE`);
    }
    stages.push(lineStage);
    console.log('STAGING VALIDATION: PASS');
    await commit(headerStage, lineStage, maxModified, source.headers.length, source.lines.length);
    console.log('ATOMIC MERGE + REPLACE + CHECKPOINT: SUCCESS');
    await reconcile(headerStage, source.headers.length, source.lines.length);
    console.log('SALES INVOICE DELTA SYNC SUCCESS');
  } finally {
    for (const name of stages) {
      try { await dataset.table(name).delete({ ignoreNotFound: true }); }
      catch (error) { console.error(`Stage cleanup warning ${name}: ${error.message}`); }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('SYNC ERROR:', error.stack ?? error.message); process.exitCode = 1; });
