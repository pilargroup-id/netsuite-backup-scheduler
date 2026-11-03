import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { bq } from '../../common/bigquery-client.mjs';
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { normalize } from './mapping.mjs';

// Targeted SI recovery. Only missing or soft-deleted headers may be written.
// Deliberately NEVER updates sync_checkpoints.
const PROJECT = 'even-gearbox-255203';
const DATASET = 'netsuite_backup';
const LOCATION = 'asia-southeast1';
const HEADER = 'sales_invoice_headers';
const LINES = 'sales_invoice_lines';
const fq = name => `\`${PROJECT}.${DATASET}.${name}\``;
const dataset = bq.dataset(DATASET);

const args = process.argv.slice(2);
const idFlag = args.indexOf('--id');
const rawId = idFlag >= 0 ? args[idFlag + 1] : undefined;
const apply = args.includes('--apply');
const dryRun = args.includes('--dry-run');
const accepted = new Set(['--id', '--apply', '--dry-run']);
if (!rawId || !/^[1-9][0-9]{0,14}$/.test(rawId) || (apply && dryRun) ||
    args.some((arg, index) => !accepted.has(arg) && index !== idFlag + 1) ||
    idFlag === -1 || args.filter(a => a === '--id').length !== 1) {
  console.error('Usage: node modules/sales-invoice/recover.mjs --id 3152063 [--dry-run|--apply]');
  process.exit(2);
}
const id = Number(rawId);
if (!Number.isSafeInteger(id)) throw new Error('Unsafe internal ID');

async function query(sql, params = {}) {
  const [rows] = await bq.query({ query: sql, params, location: LOCATION });
  return rows;
}
async function state() {
  const rows = await query(`SELECT internal_id, is_deleted,
    FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', netsuite_last_modified_at) AS modified
    FROM ${fq(HEADER)} WHERE internal_id = @id`, { id });
  if (rows.length > 1) throw new Error('Duplicate existing headers; refusing recovery');
  return rows[0] ?? null;
}
function assertSource(header, lines) {
  if (header.length !== 1 || Number(header[0].internal_id) !== id) {
    throw new Error('Source invoice missing or duplicated; recovery refused');
  }
  if (header[0].transaction_date < '2026-10-01' || header[0].transaction_date >= '2026-11-01') {
    throw new Error(`Invoice outside October 2026: ${header[0].transaction_date}`);
  }
  if (header[0].total_amount == null) throw new Error('Source invoice total is NULL');
  if (!lines.length) throw new Error('Source invoice has zero detail lines; review manually');
  const normalized = normalize(header, lines);
  if (normalized.lines.length !== lines.length) throw new Error('Source line mismatch');
  return normalized;
}
async function source(access) {
  const headers = await fetchAll(access, `
    SELECT t.id AS internal_id, t.tranid AS invoice_number,
      TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date,
      BUILTIN.DF(t.postingperiod) AS posting_period,
      BUILTIN.DF(t.status) AS status,
      t.foreigntotal AS total_amount,
      TO_CHAR(t.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS netsuite_last_modified_at
    FROM Transaction t WHERE t.type = 'CustInvc' AND t.id = ${id}`);
  if (headers.length !== 1) return { headers, lines: [] };
  const lines = await fetchAll(access, `
    SELECT t.id AS invoice_internal_id, t.tranid AS invoice_number,
      tl.linesequencenumber AS line_number, tl.item AS item_internal_id,
      BUILTIN.DF(tl.item) AS item_name, tl.memo AS description,
      tl.quantity AS raw_quantity, BUILTIN.DF(tl.units) AS unit,
      tl.rate AS rate, tl.foreignamount AS raw_amount,
      TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date,
      BUILTIN.DF(t.postingperiod) AS posting_period,
      TO_CHAR(t.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS netsuite_last_modified_at
    FROM TransactionLine tl JOIN Transaction t ON t.id = tl.transaction
    WHERE t.id = ${id} AND t.type = 'CustInvc'
      AND tl.mainline = 'F' AND tl.taxline = 'F'
      AND tl.item IS NOT NULL AND NVL(tl.iscogs, 'F') = 'F'
    ORDER BY t.id, tl.linesequencenumber, tl.uniquekey`);
  return { headers, lines };
}
function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}
async function stage(name, tableName, file, count) {
  await query(`CREATE TABLE ${fq(name)} AS SELECT * FROM ${fq(tableName)} WHERE FALSE`);
  await dataset.table(name).load(file, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON', writeDisposition: 'WRITE_TRUNCATE',
    ignoreUnknownValues: false, maxBadRecords: 0, location: LOCATION
  });
  const [r] = await query(`SELECT COUNT(*) n FROM ${fq(name)}`);
  if (Number(r.n) !== count) throw new Error(`Staging count mismatch: ${name}`);
}
async function writeRecovery(hStage, lStage, count, expectedState) {
  // Recheck state inside the transaction to avoid turning a concurrent successful
  // sync of an active invoice into an unintended recovery write.
  const predicate = expectedState === 'MISSING'
    ? `(SELECT COUNT(*) FROM ${fq(HEADER)} WHERE internal_id = @id) = 0`
    : `(SELECT COUNT(*) FROM ${fq(HEADER)} WHERE internal_id = @id AND is_deleted = TRUE) = 1`;
  const sql = `
    BEGIN TRANSACTION;
    ASSERT ${predicate} AS 'Header state changed after audit; recovery cancelled';
    MERGE ${fq(HEADER)} target USING ${fq(hStage)} source
    ON target.internal_id = source.internal_id
    WHEN MATCHED THEN UPDATE SET
      invoice_number = source.invoice_number,
      transaction_date = source.transaction_date,
      posting_period = source.posting_period,
      status = source.status,
      total_amount = source.total_amount,
      netsuite_last_modified_at = source.netsuite_last_modified_at,
      synced_at = CURRENT_TIMESTAMP(), is_deleted = FALSE, deleted_at = NULL
    WHEN NOT MATCHED THEN INSERT (
      internal_id, invoice_number, transaction_date, posting_period,
      status, total_amount, netsuite_last_modified_at, synced_at,
      first_synced_at, is_deleted, deleted_at
    ) VALUES (
      source.internal_id, source.invoice_number, source.transaction_date,
      source.posting_period, source.status, source.total_amount,
      source.netsuite_last_modified_at, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), FALSE, NULL
    );
    DELETE FROM ${fq(LINES)} WHERE invoice_internal_id = @id;
    INSERT INTO ${fq(LINES)} (
      invoice_internal_id, invoice_number, line_number, item_internal_id,
      item_name, description, quantity, unit, rate, amount,
      transaction_date, posting_period, netsuite_last_modified_at, synced_at
    ) SELECT invoice_internal_id, invoice_number, line_number, item_internal_id,
      item_name, description, quantity, unit, rate, amount,
      transaction_date, posting_period, netsuite_last_modified_at, CURRENT_TIMESTAMP()
    FROM ${fq(lStage)};
    ASSERT (SELECT COUNT(*) FROM ${fq(HEADER)} WHERE internal_id = @id AND is_deleted = FALSE) = 1
      AS 'Recovered header validation failed';
    ASSERT (SELECT COUNT(*) FROM ${fq(LINES)} WHERE invoice_internal_id = @id) = @count
      AS 'Recovered line count mismatch';
    ASSERT (SELECT COUNT(*) FROM (
      SELECT line_number FROM ${fq(LINES)} WHERE invoice_internal_id = @id
      GROUP BY line_number HAVING COUNT(*) > 1)) = 0 AS 'Duplicate recovered lines';
    COMMIT TRANSACTION;`;
  await query(sql, { id, count });
}
async function main() {
  console.log(`SI TARGETED RECOVERY | ID ${id} | ${apply ? 'APPLY' : 'READ ONLY'}`);
  console.log('Checkpoint: NEVER MODIFIED');
  const access = await token();
  console.log('NetSuite OAuth: SUCCESS');
  const previous = await state();
  console.log(`BigQuery header: ${previous ? (previous.is_deleted ? 'SOFT_DELETED' : 'ACTIVE') : 'MISSING'}`);
  if (previous && !previous.is_deleted) {
    console.log('ALREADY ACTIVE: NO-OP. Header/line equivalence not asserted; use check.mjs.');
    return;
  }
  const fetched = await source(access);
  if (fetched.headers.length !== 1) {
    throw new Error('NOT_VISIBLE_IN_NETSUITE: no recovery allowed');
  }
  const mapped = assertSource(fetched.headers, fetched.lines);
  const action = previous ? 'RESTORE' : 'RECOVER';
  console.log(`SOURCE VALIDATION: PASS | ${mapped.headers.length} header | ${mapped.lines.length} lines`);
  console.log(`ACTION: ${action}`);
  if (!apply) {
    console.log('DRY RUN PASS: BigQuery and checkpoint unchanged');
    return;
  }
  // Re-fetch immediately prior to write to catch source edits during preparation.
  const reloaded = await source(access);
  const fresh = assertSource(reloaded.headers, reloaded.lines);
  if (JSON.stringify(mapped.headers.map(({synced_at,first_synced_at,...v}) => v)) !==
      JSON.stringify(fresh.headers.map(({synced_at,first_synced_at,...v}) => v)) ||
      JSON.stringify(mapped.lines.map(({synced_at,...v}) => v)) !==
      JSON.stringify(fresh.lines.map(({synced_at,...v}) => v))) {
    throw new Error('NetSuite data changed during recovery; retry later');
  }
  const suffix = crypto.randomUUID().replace(/-/g, '');
  const hStage = `_si_rec_h_${suffix}`;
  const lStage = `_si_rec_l_${suffix}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'si-recovery-'));
  const created = [];
  try {
    const hp = path.join(temp, 'header.jsonl');
    const lp = path.join(temp, 'lines.jsonl');
    writeJsonl(hp, fresh.headers);
    writeJsonl(lp, fresh.lines);
    created.push(hStage);
    await stage(hStage, HEADER, hp, 1);
    created.push(lStage);
    await stage(lStage, LINES, lp, fresh.lines.length);
    console.log('STAGING VALIDATION: PASS');
    await writeRecovery(hStage, lStage, fresh.lines.length, previous ? 'SOFT_DELETED' : 'MISSING');
    console.log(`ATOMIC ${action}: SUCCESS (${fresh.lines.length} lines; checkpoint unchanged)`);
  } finally {
    for (const name of created) {
      try { await dataset.table(name).delete({ ignoreNotFound: true }); }
      catch (err) { console.error(`Cleanup warning ${name}: ${err.message}`); }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => {
  console.error('SI TARGETED RECOVERY ERROR:', error.stack ?? error.message);
  process.exitCode = 1;
});
