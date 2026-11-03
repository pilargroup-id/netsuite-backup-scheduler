import { validateNumericRows } from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  bq,
  DATASET,
  LOCATION,
  FROM,
  TO,
  T,
  N,
  token,
  fetchHeaders,
  fetchLines,
  mapSource,
  query
} from './mapping.mjs';

// =====================================================
// CONFIGURATION
// =====================================================

const DRY_RUN = process.argv.includes('--dry-run');

const HEADER_TABLE = 'sales_order_headers';
const LINE_TABLE = 'sales_order_lines';
const CHECKPOINT_TABLE = 'sync_checkpoints';

const HEADER_CHECKPOINT = 'sales_order_headers';
const LINE_CHECKPOINT = 'sales_order_lines';

const OVERLAP_MINUTES = 5;

const HEADER_SCHEMA = [
  ['internal_id', 'STRING'],
  ['tranid', 'STRING'],
  ['transaction_date', 'DATE'],
  ['status', 'STRING'],
  ['customer_id', 'STRING'],
  ['subsidiary_id', 'STRING'],
  ['currency_id', 'STRING'],
  ['total_amount', 'NUMERIC'],
  ['last_modified', 'DATETIME']
];

const LINE_SCHEMA = [
  ['sales_order_internal_id', 'STRING'],
  ['line_unique_key', 'STRING'],
  ['line_id', 'STRING'],
  ['line_type', 'STRING'],
  ['item_id', 'STRING'],
  ['item_type', 'STRING'],
  ['accounting_line_type', 'STRING'],
  ['quantity', 'NUMERIC'],
  ['rate', 'NUMERIC'],
  ['foreign_amount', 'NUMERIC'],
  ['net_amount', 'NUMERIC'],
  ['tax_amount', 'NUMERIC'],
  ['location_id', 'STRING'],
  ['units_id', 'STRING'],
  ['memo', 'STRING'],
  ['is_closed', 'BOOLEAN'],
  ['last_modified', 'DATETIME']
];

// =====================================================
// HELPERS
// =====================================================

function log(message = '') {
  console.log(message);
}

function schemaFields(schema) {
  return schema.map(([name, type]) => ({
    name,
    type
  }));
}

function subtractMinutes(dateTime, minutes) {
  const date = new Date(
    dateTime.replace(' ', 'T') + 'Z'
  );

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid checkpoint: ${dateTime}`);
  }

  date.setUTCMinutes(date.getUTCMinutes() - minutes);

  return date
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

function getMaxModified(headers) {
  return headers
    .map(row => row.last_modified)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

// =====================================================
// INITIALIZE TABLES
// =====================================================

async function ensureTables() {
  log('Checking BigQuery tables...');

  await query(`
    CREATE TABLE IF NOT EXISTS ${T(HEADER_TABLE)} (
      internal_id STRING NOT NULL,
      tranid STRING,
      transaction_date DATE,
      status STRING,
      customer_id STRING,
      subsidiary_id STRING,
      currency_id STRING,
      total_amount NUMERIC,
      last_modified DATETIME,
      synced_at TIMESTAMP
    )
    PARTITION BY transaction_date
    CLUSTER BY internal_id
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS ${T(LINE_TABLE)} (
      sales_order_internal_id STRING NOT NULL,
      line_unique_key STRING NOT NULL,
      line_id STRING,
      line_type STRING,
      item_id STRING,
      item_type STRING,
      accounting_line_type STRING,
      quantity NUMERIC,
      rate NUMERIC,
      foreign_amount NUMERIC,
      net_amount NUMERIC,
      tax_amount NUMERIC,
      location_id STRING,
      units_id STRING,
      memo STRING,
      is_closed BOOL,
      last_modified DATETIME,
      synced_at TIMESTAMP
    )
    CLUSTER BY sales_order_internal_id, line_unique_key
  `);

  const [checkpointExists] = await bq
    .dataset(DATASET)
    .table(CHECKPOINT_TABLE)
    .exists();

  if (!checkpointExists) {
    throw new Error(
      `Checkpoint table ${CHECKPOINT_TABLE} does not exist`
    );
  }

  log('BigQuery tables: READY');
}

// =====================================================
// CHECKPOINT
// =====================================================

async function loadCheckpoints() {
  const [exists] = await bq
    .dataset(DATASET)
    .table(CHECKPOINT_TABLE)
    .exists();

  if (!exists) {
    return new Map();
  }

  const rows = await query(`
    SELECT
      record_type,
      FORMAT_DATETIME(
        '%Y-%m-%d %H:%M:%S',
        last_successful_modified_at
      ) AS modified
    FROM ${T(CHECKPOINT_TABLE)}
    WHERE record_type IN (
      '${HEADER_CHECKPOINT}',
      '${LINE_CHECKPOINT}'
    )
  `);

  const result = new Map();

  for (const row of rows) {
    if (result.has(row.record_type)) {
      throw new Error(
        `Duplicate checkpoint: ${row.record_type}`
      );
    }

    result.set(row.record_type, row.modified);
  }

  return result;
}

// =====================================================
// STAGING TABLE
// =====================================================

async function createStageTable(tableName, rows, schema) {
  // Create empty staging table when no rows exist
  if (rows.length === 0) {
    const columns = schema.map(([name, type]) => {
      return `CAST(NULL AS ${type}) AS ${name}`;
    });

    await query(`
      CREATE TABLE ${T(tableName)} AS
      SELECT
        ${columns.join(',\n        ')}
      WHERE FALSE
    `);

    console.log(`EMPTY STAGING CREATED: ${tableName}`);
    return;
  }

  // Generate temporary NDJSON file
  const fileName = path.join(
    os.tmpdir(),
    `netsuite-so-${crypto.randomUUID()}.ndjson`
  );

  validateNumericRows(rows, schemaFields(schema).map(f => [f.name, f.type]), { module: 'sales-order' });

  const content =
    rows.map(row => JSON.stringify(row)).join('\n') + '\n';

  await fs.writeFile(fileName, content, {
    mode: 0o600
  });

  try {
    // Upload NDJSON to BigQuery staging table
    await bq
      .dataset(DATASET)
      .table(tableName)
      .load(fileName, {
        sourceFormat: 'NEWLINE_DELIMITED_JSON',
        writeDisposition: 'WRITE_TRUNCATE',
        schema: {
          fields: schemaFields(schema)
        },
        location: LOCATION
      });

    console.log(
      `STAGING LOAD SUCCESS: ${tableName} (${rows.length} rows)`
    );

  } finally {
    // Delete temporary local file
    await fs.rm(fileName, {
      force: true
    });
  }
}
// =====================================================
// STAGING VALIDATION
// =====================================================

async function validateStaging(
  stageHeaders,
  stageLines,
  expectedHeaders,
  expectedLines
) {
  const [result] = await query(`
    SELECT
      (
        SELECT COUNT(*)
        FROM ${T(stageHeaders)}
      ) AS header_count,

      (
        SELECT COUNT(*)
        FROM ${T(stageLines)}
      ) AS line_count,

      (
        SELECT COUNT(*)
        FROM (
          SELECT internal_id
          FROM ${T(stageHeaders)}
          GROUP BY internal_id
          HAVING COUNT(*) > 1
        )
      ) AS duplicate_headers,

      (
        SELECT COUNT(*)
        FROM (
          SELECT
            sales_order_internal_id,
            line_unique_key
          FROM ${T(stageLines)}
          GROUP BY
            sales_order_internal_id,
            line_unique_key
          HAVING COUNT(*) > 1
        )
      ) AS duplicate_lines,

      (
        SELECT COUNT(*)
        FROM ${T(stageLines)} l
        LEFT JOIN ${T(stageHeaders)} h
          ON h.internal_id = l.sales_order_internal_id
        WHERE h.internal_id IS NULL
      ) AS orphan_lines
  `);

  const valid =
    N(result.header_count) === expectedHeaders &&
    N(result.line_count) === expectedLines &&
    N(result.duplicate_headers) === 0 &&
    N(result.duplicate_lines) === 0 &&
    N(result.orphan_lines) === 0;

  if (!valid) {
    log(JSON.stringify(result, null, 2));
    throw new Error('STAGING VALIDATION: FAIL');
  }

  log('STAGING VALIDATION: PASS');
}

// =====================================================
// ATOMIC HEADER + LINES + CHECKPOINT
// =====================================================

async function atomicCommit({
  stageHeaders,
  stageLines,
  watermark,
  initial
}) {
  const headerColumns = HEADER_SCHEMA.map(
    ([name]) => name
  );

  const lineColumns = LINE_SCHEMA.map(
    ([name]) => name
  );

  const headerUpdates = headerColumns
    .filter(name => name !== 'internal_id')
    .map(name => `d.${name} = s.${name}`);

  headerUpdates.push(
    'd.synced_at = CURRENT_TIMESTAMP()'
  );
  // Restore a previously soft-deleted SO when a changed source record reappears.
  headerUpdates.push('d.is_deleted = FALSE', 'd.deleted_at = NULL');

  // During initial load, reconcile existing October
  // records against the complete source snapshot.
  // During delta, only changed documents are replaced.

  const initialCleanup = initial
    ? `
      DELETE FROM ${T(LINE_TABLE)}
      WHERE sales_order_internal_id IN (
        SELECT internal_id
        FROM ${T(HEADER_TABLE)}
        WHERE transaction_date >= DATE '${FROM}'
          AND transaction_date < DATE '${TO}'
          AND internal_id NOT IN (
            SELECT internal_id
            FROM ${T(stageHeaders)}
          )
      );

      DELETE FROM ${T(HEADER_TABLE)}
      WHERE transaction_date >= DATE '${FROM}'
        AND transaction_date < DATE '${TO}'
        AND internal_id NOT IN (
          SELECT internal_id
          FROM ${T(stageHeaders)}
        );
    `
    : '';

  const sql = `
    BEGIN
      BEGIN TRANSACTION;

      MERGE ${T(HEADER_TABLE)} d
      USING ${T(stageHeaders)} s
      ON d.internal_id = s.internal_id

      WHEN MATCHED THEN
        UPDATE SET
          ${headerUpdates.join(',\n          ')}

      WHEN NOT MATCHED THEN
        INSERT (
          ${headerColumns.join(', ')},
          synced_at, is_deleted, deleted_at
        )
        VALUES (
          ${headerColumns.map(name => `s.${name}`).join(', ')},
          CURRENT_TIMESTAMP(), FALSE, NULL
        );

      ${initialCleanup}

      DELETE FROM ${T(LINE_TABLE)}
      WHERE sales_order_internal_id IN (
        SELECT internal_id
        FROM ${T(stageHeaders)}
      );

      INSERT INTO ${T(LINE_TABLE)} (
        ${lineColumns.join(', ')},
        synced_at
      )
      SELECT
        ${lineColumns.join(', ')},
        CURRENT_TIMESTAMP()
      FROM ${T(stageLines)};

      MERGE ${T(CHECKPOINT_TABLE)} d
      USING (
        SELECT '${HEADER_CHECKPOINT}' AS record_type
        UNION ALL
        SELECT '${LINE_CHECKPOINT}' AS record_type
      ) s
      ON d.record_type = s.record_type

      WHEN MATCHED THEN
        UPDATE SET
          last_successful_modified_at =
            DATETIME('${watermark}'),
          last_successful_sync_at =
            CURRENT_TIMESTAMP(),
          updated_at =
            CURRENT_TIMESTAMP()

      WHEN NOT MATCHED THEN
        INSERT (
          record_type,
          last_successful_modified_at,
          last_successful_sync_at,
          updated_at
        )
        VALUES (
          s.record_type,
          DATETIME('${watermark}'),
          CURRENT_TIMESTAMP(),
          CURRENT_TIMESTAMP()
        );

      COMMIT TRANSACTION;

    EXCEPTION WHEN ERROR THEN
      ROLLBACK TRANSACTION;
      RAISE;
    END;
  `;

  await query(sql);

  log(
    'ATOMIC MERGE + LINE REPLACE + CHECKPOINT: SUCCESS'
  );
}

// =====================================================
// POST SYNC VALIDATION
// =====================================================

async function validateBigQuery(
  stageHeaders,
  stageLines
) {
  const [result] = await query(`
    SELECT
      (
        SELECT COUNT(*)
        FROM ${T(HEADER_TABLE)} h
        JOIN ${T(stageHeaders)} s
          ON s.internal_id = h.internal_id
      ) AS headers,

      (
        SELECT COUNT(*)
        FROM ${T(LINE_TABLE)} l
        JOIN ${T(stageHeaders)} s
          ON s.internal_id = l.sales_order_internal_id
      ) AS lines,

      (
        SELECT COUNT(*)
        FROM ${T(stageLines)}
      ) AS expected_lines,

      (
        SELECT COUNT(*)
        FROM (
          SELECT internal_id
          FROM ${T(HEADER_TABLE)}
          GROUP BY internal_id
          HAVING COUNT(*) > 1
        )
      ) AS duplicate_headers,

      (
        SELECT COUNT(*)
        FROM (
          SELECT
            sales_order_internal_id,
            line_unique_key
          FROM ${T(LINE_TABLE)}
          GROUP BY 1, 2
          HAVING COUNT(*) > 1
        )
      ) AS duplicate_lines,

      (
        SELECT COUNT(*)
        FROM ${T(LINE_TABLE)} l
        LEFT JOIN ${T(HEADER_TABLE)} h
          ON h.internal_id = l.sales_order_internal_id
        WHERE h.internal_id IS NULL
      ) AS orphan_lines
  `);

  log('');
  log('BIGQUERY DELTA RECONCILIATION');
  log(`Headers          : ${result.headers}`);
  log(`Lines            : ${result.lines}`);
  log(`Expected lines   : ${result.expected_lines}`);
  log(`Duplicate header : ${result.duplicate_headers}`);
  log(`Duplicate lines  : ${result.duplicate_lines}`);
  log(`Orphan lines     : ${result.orphan_lines}`);

  const passed =
    N(result.lines) === N(result.expected_lines) &&
    N(result.duplicate_headers) === 0 &&
    N(result.duplicate_lines) === 0 &&
    N(result.orphan_lines) === 0;

  if (!passed) {
    throw new Error('BIGQUERY DELTA RECONCILIATION: FAIL');
  }

  log('BIGQUERY DELTA RECONCILIATION: PASS');
}

// =====================================================
// MAIN
// =====================================================

async function run() {
  log('==========================================');
  log('NETSUITE SALES ORDER COMBINED SYNC');
  log('==========================================');

  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'SYNC'}`);

  let checkpoints;

  if (DRY_RUN) {
    checkpoints = await loadCheckpoints();
  } else {
    await ensureTables();
    checkpoints = await loadCheckpoints();
  }

  const headerCheckpoint =
    checkpoints.get(HEADER_CHECKPOINT) ?? null;

  const lineCheckpoint =
    checkpoints.get(LINE_CHECKPOINT) ?? null;

  if (Boolean(headerCheckpoint) !== Boolean(lineCheckpoint)) {
    throw new Error(
      'Header and lines checkpoints are inconsistent'
    );
  }

  const initial =
    !headerCheckpoint && !lineCheckpoint;

  const fetchFrom = initial
    ? null
    : subtractMinutes(
        headerCheckpoint < lineCheckpoint
          ? headerCheckpoint
          : lineCheckpoint,
        OVERLAP_MINUTES
      );

  log(`Header checkpoint: ${headerCheckpoint ?? 'NONE'}`);
  log(`Lines checkpoint : ${lineCheckpoint ?? 'NONE'}`);
  log(`Fetch from       : ${fetchFrom ?? 'FULL PERIOD'}`);

  const accessToken = await token();

  log('OAuth: SUCCESS');

  // ===================================================
  // FETCH SALES ORDER HEADERS
  // ===================================================

  const sourceHeaders = await fetchHeaders(
    accessToken,
    fetchFrom
  );

  log(`Changed Sales Orders: ${sourceHeaders.length}`);

  // ===================================================
  // FETCH SALES ORDER LINES
  // ===================================================

  const ids = sourceHeaders.map(row => row.id);

  const sourceLines = ids.length
    ? await fetchLines(accessToken, ids)
    : [];

  // ===================================================
  // SOURCE VALIDATION
  // ===================================================

  const mapped = mapSource(
    sourceHeaders,
    sourceLines
  );

  log('');
  log('SOURCE VALIDATION');
  log(`Headers : ${mapped.headers.length}`);
  log(`Lines   : ${mapped.lines.length}`);

  const headerIds = new Set(
    mapped.headers.map(row => row.internal_id)
  );

  if (headerIds.size !== mapped.headers.length) {
    throw new Error('Duplicate source headers');
  }

  if (initial && mapped.headers.length === 0) {
    throw new Error(
      'Initial load returned zero Sales Orders'
    );
  }

  log('SOURCE VALIDATION: PASS');

  // ===================================================
  // DRY RUN
  // ===================================================

  if (DRY_RUN) {
    log('');
    log('DRY RUN PASS: BigQuery unchanged');
    return;
  }

  // ===================================================
  // EMPTY DELTA
  // ===================================================

  if (!initial && sourceHeaders.length === 0) {
    log('No changed Sales Orders');
    log('SALES ORDER SYNC SUCCESS');
    return;
  }

  // ===================================================
  // WATERMARK
  // ===================================================

  const maxModified = getMaxModified(sourceHeaders);

  if (!maxModified) {
    throw new Error('Source lastmodifieddate missing');
  }

  const watermark = initial
    ? maxModified
    : maxModified > headerCheckpoint
      ? maxModified
      : headerCheckpoint;

  log(`New checkpoint: ${watermark}`);

  // ===================================================
  // STAGING NAMES
  // ===================================================

  const suffix = crypto
    .randomUUID()
    .replaceAll('-', '')
    .slice(0, 20);

  const stageHeaders = `_so_h_${suffix}`;
  const stageLines = `_so_l_${suffix}`;

  try {
    // =================================================
    // STAGE HEADERS
    // =================================================

    log('');
    log('Loading header staging...');

    await createStageTable(
      stageHeaders,
      mapped.headers,
      HEADER_SCHEMA
    );

    // =================================================
    // STAGE LINES
    // =================================================

    log('Loading line staging...');

    await createStageTable(
      stageLines,
      mapped.lines,
      LINE_SCHEMA
    );

    // =================================================
    // VALIDATE STAGING
    // =================================================

    await validateStaging(
      stageHeaders,
      stageLines,
      mapped.headers.length,
      mapped.lines.length
    );

    // =================================================
    // ATOMIC COMMIT
    // =================================================

    await atomicCommit({
      stageHeaders,
      stageLines,
      watermark,
      initial
    });

    // =================================================
    // POST SYNC VALIDATION
    // =================================================

    await validateBigQuery(
      stageHeaders,
      stageLines
    );

    log('');
    log('==========================================');
    log('SALES ORDER SYNC SUCCESS');
    log('==========================================');
  } finally {
    // =================================================
    // CLEANUP STAGING
    // =================================================

    for (const tableName of [
      stageHeaders,
      stageLines
    ]) {
      try {
        await bq
          .dataset(DATASET)
          .table(tableName)
          .delete({
            ignoreNotFound: true
          });
      } catch (error) {
        console.error(
          `Staging cleanup warning: ${tableName}`,
          error.message
        );
      }
    }
  }
}

// =====================================================
// ENTRY POINT
// =====================================================

run().catch(error => {
  console.error('');
  console.error(
    'SALES ORDER SYNC ERROR:',
    error.stack ?? error.message
  );

  process.exitCode = 1;
});