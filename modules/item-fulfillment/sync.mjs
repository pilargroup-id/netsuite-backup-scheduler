import { validateNumericRows } from '../../common/decimal-precision.mjs';
import { bq as sharedBQ } from '../../common/bigquery-client.mjs';
import { token as sharedToken } from '../../common/netsuite-client.mjs';
import { buildData } from './mapping.mjs';

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// ============================================================
// CONFIGURATION
// ============================================================

const PRIVATE_KEY_PATH =
  'C:\\netsuite-backup-cert\\private.pem';

const BASE_URL =
  'https://6930902.suitetalk.api.netsuite.com';

const TOKEN_URL =
  `${BASE_URL}/services/rest/auth/oauth2/v1/token`;

const PROJECT_ID = 'even-gearbox-255203';
const DATASET_ID = 'netsuite_backup';
const BQ_LOCATION = 'asia-southeast1';

const HEADER_TABLE = 'item_fulfillment_headers';
const LINE_TABLE = 'item_fulfillment_lines';
const CHECKPOINT_TABLE = 'sync_checkpoints';

const HEADER_RECORD_TYPE = 'item_fulfillment';
const LINE_RECORD_TYPE = 'item_fulfillment_lines';

const INITIAL_CHECKPOINT = '2026-10-01 00:00:00';
const DATE_FROM = '2026-10-01';

const OVERLAP_MINUTES = 5;
const ACCOUNTING_BOOK = '1';
const BATCH_SIZE = 25;
const PAGE_SIZE = 1000;

const DRY_RUN = process.argv.includes('--dry-run');

const bigquery = sharedBQ;

const dataset = bigquery.dataset(DATASET_ID);

const table = name =>
  `\`${PROJECT_ID}.${DATASET_ID}.${name}\``;

// ============================================================
// HELPERS
// ============================================================

function num(value) {
  const result = Number(value ?? 0);

  if (!Number.isFinite(result)) {
    throw new Error(`Invalid number: ${value}`);
  }

  return result;
}

function integer(value) {
  const result = Number(value);

  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`Invalid integer: ${value}`);
  }

  return result;
}

function nullableId(value) {
  return value == null || value === ''
    ? null
    : integer(value);
}

function sum(rows, field) {
  return rows.reduce(
    (total, row) => total + num(row[field]),
    0
  );
}

function chunks(rows, size) {
  const result = [];

  for (let i = 0; i < rows.length; i += size) {
    result.push(rows.slice(i, i + size));
  }

  return result;
}

function money(value) {
  return num(value).toFixed(2);
}

function quantity(value) {
  return num(value).toFixed(6);
}

function cents(value) {
  return Math.round(num(value) * 100);
}

function validDateTime(value) {
  const text = String(value ?? '');

  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    throw new Error(`Invalid DATETIME: ${text}`);
  }

  return text;
}

async function bqQuery(query, params = {}) {
  const [rows] = await bigquery.query({
    query,
    params,
    location: BQ_LOCATION
  });

  return rows;
}

// ============================================================
// NETSUITE AUTHENTICATION
// ============================================================

const getToken = sharedToken;

async function suiteql(token, sql, limit = PAGE_SIZE, offset = 0) {
  const url =
    `${BASE_URL}/services/rest/query/v1/suiteql` +
    `?limit=${limit}&offset=${offset}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'transient'
      },
      body: JSON.stringify({ q: sql })
    });

    const text = await response.text();

    if (response.ok) {
      return JSON.parse(text);
    }

    if (
      attempt === 3 ||
      ![429, 500, 502, 503, 504].includes(response.status)
    ) {
      throw new Error(
        `SuiteQL HTTP ${response.status}: ${text}\nSQL:\n${sql}`
      );
    }

    await new Promise(
      resolve => setTimeout(resolve, attempt * 2000)
    );
  }
}

async function getAll(token, sql) {
  const rows = [];
  let offset = 0;

  while (true) {
    const page = await suiteql(
      token,
      sql,
      PAGE_SIZE,
      offset
    );

    const items = page.items ?? [];
    rows.push(...items);

    if (!page.hasMore) {
      break;
    }

    if (items.length === 0) {
      throw new Error('Invalid SuiteQL pagination');
    }

    offset += PAGE_SIZE;

    if (offset > 1000000) {
      throw new Error('SuiteQL pagination limit exceeded');
    }
  }

  return rows;
}

// ============================================================
// CHECKPOINT - SAME PATTERN AS SALES INVOICE
// ============================================================

async function getCheckpoint() {
  const rows = await bqQuery(`
    SELECT
      record_type,
      FORMAT_DATETIME(
        '%Y-%m-%d %H:%M:%S',
        last_successful_modified_at
      ) AS checkpoint_at
    FROM ${table(CHECKPOINT_TABLE)}
    WHERE record_type IN (
      @headerType,
      @lineType
    )
  `, {
    headerType: HEADER_RECORD_TYPE,
    lineType: LINE_RECORD_TYPE
  });

  const checkpointMap = new Map(
    rows.map(row => [
      row.record_type,
      row.checkpoint_at
    ])
  );

  const headerCheckpoint =
    checkpointMap.get(HEADER_RECORD_TYPE) ??
    INITIAL_CHECKPOINT;

  const lineCheckpoint =
    checkpointMap.get(LINE_RECORD_TYPE) ??
    INITIAL_CHECKPOINT;

  // Use the earliest checkpoint to keep both datasets aligned.
  const earliest =
    headerCheckpoint < lineCheckpoint
      ? headerCheckpoint
      : lineCheckpoint;

  const result = await bqQuery(`
    SELECT
      FORMAT_DATETIME(
        '%Y-%m-%d %H:%M:%S',
        DATETIME_SUB(
          CAST(@checkpoint AS DATETIME),
          INTERVAL ${OVERLAP_MINUTES} MINUTE
        )
      ) AS fetch_from
  `, {
    checkpoint: earliest
  });

  return {
    headerCheckpoint,
    lineCheckpoint,
    fetchFrom: result[0].fetch_from,
    headerExists: checkpointMap.has(HEADER_RECORD_TYPE),
    lineExists: checkpointMap.has(LINE_RECORD_TYPE)
  };
}

// ============================================================
// FETCH CHANGED FULFILLMENTS
// ============================================================

async function fetchChangedHeaders(token, fetchFrom) {
  validDateTime(fetchFrom);

  const sql = `
    SELECT
      t.id AS internal_id,
      t.tranid AS fulfillment_number,
      TO_CHAR(
        t.trandate,
        'YYYY-MM-DD'
      ) AS transaction_date,
      BUILTIN.DF(
        t.postingperiod
      ) AS posting_period,
      BUILTIN.DF(
        t.status
      ) AS status,
      TO_CHAR(
        t.lastmodifieddate,
        'YYYY-MM-DD HH24:MI:SS'
      ) AS netsuite_last_modified_at
    FROM Transaction t
    WHERE t.type = 'ItemShip'
      AND t.trandate >= TO_DATE(
        '${DATE_FROM}',
        'YYYY-MM-DD'
      )
      AND t.lastmodifieddate >= TO_DATE(
        '${fetchFrom}',
        'YYYY-MM-DD HH24:MI:SS'
      )
    ORDER BY
      t.lastmodifieddate,
      t.id
  `;

  return getAll(token, sql);
}

// ============================================================
// FETCH LINES AND ACCOUNTING
// ============================================================

async function fetchDetails(token, ids, type) {
  const results = [];
  const batches = chunks(ids, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const idsText = batches[i].join(',');

    let sql;

    if (type === 'lines') {
      sql = `
        SELECT
          transaction,
          id,
          uniquekey,
          linesequencenumber,
          item,
          mainline,
          taxline,
          iscogs,
          accountinglinetype,
          quantity,
          rate,
          units,
          location,
          entity,
          createdfrom
        FROM TransactionLine
        WHERE transaction IN (${idsText})
        ORDER BY transaction, id
      `;
    } else {
      sql = `
        SELECT
          transaction,
          transactionline,
          accountingbook,
          posting,
          account,
          debit,
          credit,
          netamount
        FROM TransactionAccountingLine
        WHERE transaction IN (${idsText})
        ORDER BY transaction, transactionline
      `;
    }

    const rows = await getAll(token, sql);
    results.push(...rows);

    console.log(
      `${type} batch ${i + 1}/${batches.length}: ${rows.length}`
    );
  }

  return results;
}

// ============================================================
// TRANSFORM AND VALIDATE
// ============================================================

function writeJsonl(filePath, rows) {
  const content =
    rows.map(row => JSON.stringify(row)).join('\n') + '\n';

  fs.writeFileSync(filePath, content, 'utf8');
}

async function createStage(stageName, targetName) {
  await bqQuery(`
    CREATE TABLE ${table(stageName)}
    AS
    SELECT *
    FROM ${table(targetName)}
    WHERE FALSE
  `);
}

async function loadStage(stageName, filePath) {
  await dataset.table(stageName).load(filePath, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON',
    writeDisposition: 'WRITE_TRUNCATE',
    ignoreUnknownValues: false,
    maxBadRecords: 0,
    location: BQ_LOCATION
  });

  const [metadata] =
    await dataset.table(stageName).getMetadata();

  return Number(metadata.numRows);
}

// ============================================================
// ATOMIC MERGE + REPLACE + CHECKPOINT
// ============================================================

async function commit(headerStage, lineStage, source, maxModified) {
  const headerColumns = [
    'internal_id',
    'fulfillment_number',
    'transaction_date',
    'posting_period',
    'status',
    'created_from_id',
    'customer_internal_id',
    'location_internal_id',
    'total_quantity_shipped',
    'total_cogs_amount',
    'accounting_book_id',
    'netsuite_last_modified_at',
    'synced_at',
    'first_synced_at',
    'is_deleted',
    'deleted_at'
  ];

  const lineColumns = [
    'fulfillment_internal_id',
    'fulfillment_number',
    'line_unique_key',
    'line_number',
    'item_internal_id',
    'item_name',
    'quantity_shipped',
    'unit_internal_id',
    'unit_cost',
    'cogs_amount',
    'accounting_book_id',
    'location_internal_id',
    'created_from_id',
    'transaction_date',
    'posting_period',
    'netsuite_last_modified_at',
    'synced_at'
  ];

  const updateColumns = headerColumns.filter(
    col => col !== 'internal_id' &&
           col !== 'first_synced_at'
  );

  const sql = `
    BEGIN TRANSACTION;

    -- HEADER MERGE
    MERGE ${table(HEADER_TABLE)} AS target
    USING ${table(headerStage)} AS source
    ON target.internal_id = source.internal_id

    WHEN MATCHED THEN
      UPDATE SET
        ${updateColumns.map(
          col => `${col} = source.${col}`
        ).join(',\n        ')}

    WHEN NOT MATCHED THEN
      INSERT (${headerColumns.join(', ')})
      VALUES (
        ${headerColumns.map(col => `source.${col}`).join(', ')}
      );

    -- REPLACE ONLY CHANGED FULFILLMENT LINES
    DELETE FROM ${table(LINE_TABLE)}
    WHERE fulfillment_internal_id IN (
      SELECT internal_id
      FROM ${table(headerStage)}
    );

    INSERT INTO ${table(LINE_TABLE)}
    (${lineColumns.join(', ')})
    SELECT
      ${lineColumns.map(col => `s.${col}`).join(', ')}
    FROM ${table(lineStage)} s;

    -- UPDATE BOTH CHECKPOINTS
    MERGE ${table(CHECKPOINT_TABLE)} AS target
    USING (
      SELECT
        record_type,
        CAST(@maxModified AS DATETIME) AS modified_at
      FROM UNNEST([
        @headerType,
        @lineType
      ]) AS record_type
    ) AS source
    ON target.record_type = source.record_type

    WHEN MATCHED THEN
      UPDATE SET
        last_successful_modified_at = GREATEST(
          COALESCE(
            target.last_successful_modified_at,
            source.modified_at
          ),
          source.modified_at
        ),
        last_successful_sync_at = CURRENT_TIMESTAMP(),
        updated_at = CURRENT_TIMESTAMP()

    WHEN NOT MATCHED THEN
      INSERT (
        record_type,
        last_successful_modified_at,
        last_successful_sync_at,
        updated_at
      )
      VALUES (
        source.record_type,
        source.modified_at,
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
      );

    -- INTEGRITY ASSERTIONS
    ASSERT (
      (
        SELECT COUNT(*)
        FROM ${table(HEADER_TABLE)}
        WHERE internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) = @expectedHeaders
    ) AS 'Header count mismatch';

    ASSERT (
      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) = @expectedLines
    ) AS 'Line count mismatch';

    ASSERT (
      (
        SELECT COUNT(*)
        FROM (
          SELECT fulfillment_internal_id, line_unique_key
          FROM ${table(LINE_TABLE)}
          WHERE fulfillment_internal_id IN (
            SELECT internal_id FROM ${table(headerStage)}
          )
          GROUP BY fulfillment_internal_id, line_unique_key
          HAVING COUNT(*) > 1
        )
      ) = 0
    ) AS 'Duplicate line keys';

    ASSERT (
      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)} l
        LEFT JOIN ${table(HEADER_TABLE)} h
          ON h.internal_id = l.fulfillment_internal_id
        WHERE l.fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
        AND h.internal_id IS NULL
      ) = 0
    ) AS 'Orphan lines';

    COMMIT TRANSACTION;
  `;

  await bqQuery(sql, {
    maxModified: validDateTime(maxModified),
    headerType: HEADER_RECORD_TYPE,
    lineType: LINE_RECORD_TYPE,
    expectedHeaders: source.headerRows.length,
    expectedLines: source.lineRows.length
  });
}

// ============================================================
// POST-COMMIT RECONCILIATION
// ============================================================

async function reconcile(source, headerStage) {
  const rows = await bqQuery(`
    SELECT
      (
        SELECT COUNT(*)
        FROM ${table(HEADER_TABLE)}
        WHERE internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS header_count,

      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS line_count,

      (
        SELECT COALESCE(SUM(total_cogs_amount), 0)
        FROM ${table(HEADER_TABLE)}
        WHERE internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS header_cogs,

      (
        SELECT COALESCE(SUM(cogs_amount), 0)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS line_cogs,

      (
        SELECT COALESCE(SUM(quantity_shipped), 0)
        FROM ${table(LINE_TABLE)}
        WHERE fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
      ) AS shipped_qty,

      (
        SELECT COUNT(*)
        FROM (
          SELECT fulfillment_internal_id, line_unique_key
          FROM ${table(LINE_TABLE)}
          WHERE fulfillment_internal_id IN (
            SELECT internal_id FROM ${table(headerStage)}
          )
          GROUP BY fulfillment_internal_id, line_unique_key
          HAVING COUNT(*) > 1
        )
      ) AS duplicates,

      (
        SELECT COUNT(*)
        FROM ${table(LINE_TABLE)} l
        LEFT JOIN ${table(HEADER_TABLE)} h
          ON h.internal_id = l.fulfillment_internal_id
        WHERE l.fulfillment_internal_id IN (
          SELECT internal_id FROM ${table(headerStage)}
        )
        AND h.internal_id IS NULL
      ) AS orphans
  `);

  const r = rows[0];

  const checks = {
    headers:
      num(r.header_count) === source.headerRows.length,

    lines:
      num(r.line_count) === source.lineRows.length,

    header_cogs:
      cents(r.header_cogs) === cents(source.totalCogs),

    line_cogs:
      cents(r.line_cogs) === cents(source.totalCogs),

    quantity:
      Math.abs(num(r.shipped_qty) - source.totalQty) < 0.000001,

    duplicates:
      num(r.duplicates) === 0,

    orphans:
      num(r.orphans) === 0
  };

  console.log('\nBIGQUERY DELTA RECONCILIATION');

  for (const [name, passed] of Object.entries(checks)) {
    console.log(`${name}: ${passed ? 'PASS' : 'FAIL'}`);
  }

  if (!Object.values(checks).every(Boolean)) {
    throw new Error('BIGQUERY DELTA RECONCILIATION FAILED');
  }

  console.log('BIGQUERY DELTA RECONCILIATION: PASS');
}

// ============================================================
// CHECKPOINT UPDATE WHEN NO CHANGES
// ============================================================

async function markNoChanges() {
  const sql = `
    MERGE ${table(CHECKPOINT_TABLE)} AS target
    USING (
      SELECT record_type
      FROM UNNEST([
        @headerType,
        @lineType
      ]) AS record_type
    ) AS source
    ON target.record_type = source.record_type

    WHEN MATCHED THEN
      UPDATE SET
        last_successful_sync_at = CURRENT_TIMESTAMP(),
        updated_at = CURRENT_TIMESTAMP()

    WHEN NOT MATCHED THEN
      INSERT (
        record_type,
        last_successful_modified_at,
        last_successful_sync_at,
        updated_at
      )
      VALUES (
        source.record_type,
        CAST(@initialCheckpoint AS DATETIME),
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
      )
  `;

  await bqQuery(sql, {
    headerType: HEADER_RECORD_TYPE,
    lineType: LINE_RECORD_TYPE,
    initialCheckpoint: INITIAL_CHECKPOINT
  });
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('\n==========================================');
  console.log('NETSUITE ITEM FULFILLMENT DELTA SYNC');
  console.log('==========================================');
  console.log(`Mode     : ${DRY_RUN ? 'DRY RUN' : 'SYNC'}`);
  console.log(`Overlap  : ${OVERLAP_MINUTES} minutes`);

  const checkpoint = await getCheckpoint();

  console.log(
    `Header checkpoint : ${checkpoint.headerCheckpoint}`
  );

  console.log(
    `Lines checkpoint  : ${checkpoint.lineCheckpoint}`
  );

  console.log(
    `Fetching from     : ${checkpoint.fetchFrom}`
  );

  if (!checkpoint.headerExists || !checkpoint.lineExists) {
    console.log('First-run catch-up: ENABLED');
  }

  console.log('\nRequesting NetSuite OAuth...');

  const token = await getToken();
  console.log('NetSuite OAuth: SUCCESS');

  const headers = await fetchChangedHeaders(
    token,
    checkpoint.fetchFrom
  );

  console.log(`Changed fulfillments: ${headers.length}`);

  if (headers.length === 0) {
    if (!DRY_RUN) {
      await markNoChanges();
    }

    console.log(
      DRY_RUN
        ? 'DRY RUN PASS: No changes'
        : 'NO CHANGES. DELTA SYNC SUCCESS'
    );

    return;
  }

  const ids = headers.map(
    row => integer(row.internal_id)
  );

  const lines = await fetchDetails(token, ids, 'lines');

  const accounting = await fetchDetails(
    token,
    ids,
    'accounting'
  );

  const source = buildData(
    headers,
    lines,
    accounting
  );

  let maxModified = null;

  for (const row of headers) {
    const modified = validDateTime(
      row.netsuite_last_modified_at
    );

    if (!maxModified || modified > maxModified) {
      maxModified = modified;
    }
  }

  console.log(`Max modified: ${maxModified}`);

  if (DRY_RUN) {
    console.log('\nDRY RUN PASS: BigQuery unchanged');
    return;
  }

  const suffix = crypto.randomUUID().replaceAll('-', '');

  const headerStage = `_stage_if_h_${suffix}`;
  const lineStage = `_stage_if_l_${suffix}`;

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'netsuite-if-delta-')
  );

  const headerFile = path.join(tempDir, 'headers.jsonl');
  const lineFile = path.join(tempDir, 'lines.jsonl');

  const createdStages = [];

  try {
    validateNumericRows(source.headerRows, [
      ['total_quantity_shipped', 'NUMERIC'],
      ['total_cogs_amount', 'NUMERIC']
    ], { module: 'item-fulfillment-headers' });

    validateNumericRows(source.lineRows, [
      ['quantity_shipped', 'NUMERIC'],
      ['unit_cost', 'NUMERIC'],
      ['cogs_amount', 'NUMERIC']
    ], { module: 'item-fulfillment-lines' });
    writeJsonl(headerFile, source.headerRows);
    writeJsonl(lineFile, source.lineRows);

    await createStage(headerStage, HEADER_TABLE);
    createdStages.push(headerStage);

    await createStage(lineStage, LINE_TABLE);
    createdStages.push(lineStage);

    const stagedHeaders = await loadStage(
      headerStage,
      headerFile
    );

    const stagedLines = await loadStage(
      lineStage,
      lineFile
    );

    if (
      stagedHeaders !== source.headerRows.length ||
      stagedLines !== source.lineRows.length
    ) {
      throw new Error('STAGING VALIDATION FAILED');
    }

    console.log('STAGING VALIDATION: PASS');

    await commit(
      headerStage,
      lineStage,
      source,
      maxModified
    );

    console.log('ATOMIC MERGE + CHECKPOINT: SUCCESS');

    await reconcile(source, headerStage);

    console.log('\n==========================================');
    console.log('ITEM FULFILLMENT DELTA SYNC SUCCESS');
    console.log('==========================================');
  } finally {
    for (const stage of createdStages) {
      try {
        await dataset.table(stage).delete({
          ignoreNotFound: true
        });
      } catch (error) {
        console.error(
          `Stage cleanup warning: ${error.message}`
        );
      }
    }

    fs.rmSync(tempDir, {
      recursive: true,
      force: true
    });
  }
}

main().catch(error => {
  console.error('\nITEM FULFILLMENT DELTA SYNC ERROR');
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});

