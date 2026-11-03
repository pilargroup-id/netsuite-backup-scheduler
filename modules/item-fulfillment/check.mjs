import { bq as sharedBQ } from '../../common/bigquery-client.mjs';
import { token as sharedToken } from '../../common/netsuite-client.mjs';

import fs from 'fs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
  CLIENT_ID,
  CERTIFICATE_ID,
  PRIVATE_KEY_PATH
} from '../../credentials/netsuite-secrets.mjs';

// =====================================================
// CONFIGURATION
// =====================================================

const BASE_URL =
  'https://6930902.suitetalk.api.netsuite.com';

const TOKEN_URL =
  `${BASE_URL}/services/rest/auth/oauth2/v1/token`;

const PROJECT_ID = 'even-gearbox-255203';
const DATASET_ID = 'netsuite_backup';
const LOCATION = 'asia-southeast1';

const DATE_FROM = '2026-10-01';
const DATE_TO = '2026-11-01';

const ACCOUNTING_BOOK = '1';
const BATCH_SIZE = 25;
const PAGE_SIZE = 1000;

const bq = sharedBQ;

const table = name =>
  `\`${PROJECT_ID}.${DATASET_ID}.${name}\``;

// =====================================================
// HELPERS
// =====================================================

function n(value) {
  const raw =
    value && typeof value === 'object' &&
    'value' in value ? value.value : value;

  const result = Number(raw ?? 0);

  if (!Number.isFinite(result)) {
    throw new Error(`Invalid numeric value: ${raw}`);
  }

  return result;
}

function sum(rows, field) {
  return rows.reduce(
    (total, row) => total + n(row[field]),
    0
  );
}

function money(value) {
  return n(value).toFixed(2);
}

function fmt(value) {
  return n(value).toLocaleString('en-US', {
    maximumFractionDigits: 6
  });
}

function amountMatch(a, b) {
  return Math.abs(n(a) - n(b)) < 0.005;
}

function quantityMatch(a, b) {
  return Math.abs(n(a) - n(b)) < 0.000001;
}

function chunks(array, size) {
  const result = [];

  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }

  return result;
}

function assertId(value) {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid transaction ID: ${value}`);
  }

  return id;
}

async function bqQuery(sql) {
  const [rows] = await bq.query({
    query: sql,
    location: LOCATION
  });

  return rows;
}

// =====================================================
// NETSUITE OAUTH
// =====================================================

const getToken = sharedToken;

async function suiteql(
  token,
  sql,
  limit = PAGE_SIZE,
  offset = 0
) {
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
        `SuiteQL HTTP ${response.status}: ${text}\n${sql}`
      );
    }

    await new Promise(resolve =>
      setTimeout(resolve, attempt * 2000)
    );
  }
}

async function getAllRows(token, sql) {
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

    if (!page.hasMore) break;

    if (!items.length) {
      throw new Error('SuiteQL pagination failed');
    }

    offset += PAGE_SIZE;

    if (offset > 1000000) {
      throw new Error('Pagination safety limit reached');
    }
  }

  return rows;
}

// =====================================================
// FETCH NETSUITE HEADERS
// =====================================================

async function getHeaders(token) {
  return getAllRows(token, `
    SELECT
      id,
      tranid,
      TO_CHAR(trandate, 'YYYY-MM-DD')
        AS transaction_date
    FROM Transaction
    WHERE type = 'ItemShip'
      AND trandate >= TO_DATE(
        '${DATE_FROM}', 'YYYY-MM-DD'
      )
      AND trandate < TO_DATE(
        '${DATE_TO}', 'YYYY-MM-DD'
      )
    ORDER BY id
  `);
}

// =====================================================
// FETCH NETSUITE LINES AND GL
// =====================================================

async function getDetails(token, ids, type) {
  const results = [];
  const batches = chunks(ids, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const idList = batches[i].join(',');

    const sql = type === 'lines'
      ? `
        SELECT
          transaction,
          id,
          uniquekey,
          item,
          mainline,
          iscogs,
          accountinglinetype,
          quantity
        FROM TransactionLine
        WHERE transaction IN (${idList})
        ORDER BY transaction, id
      `
      : `
        SELECT
          transaction,
          transactionline,
          accountingbook,
          posting,
          debit,
          credit,
          netamount
        FROM TransactionAccountingLine
        WHERE transaction IN (${idList})
        ORDER BY transaction, transactionline
      `;

    const rows = await getAllRows(token, sql);

    results.push(...rows);

    console.log(
      `${type} batch ${i + 1}/${batches.length}: ${rows.length}`
    );
  }

  return results;
}

// =====================================================
// NETSUITE KPI
// =====================================================

function calculateNetSuite(headers, lines, accounting) {
  const headerIds = new Set(
    headers.map(row => String(row.id))
  );

  const cogsLines = lines.filter(row =>
    row.mainline === 'F' &&
    row.iscogs === 'T' &&
    row.accountinglinetype === 'COGS' &&
    row.item != null
  );

  const assetLines = lines.filter(row =>
    row.mainline === 'F' &&
    row.accountinglinetype === 'ASSET'
  );

  const accountingMap = new Map();

  for (const row of accounting) {
    if (
      String(row.accountingbook) !== ACCOUNTING_BOOK ||
      row.posting !== 'T'
    ) {
      continue;
    }

    const key = `${row.transaction}:${row.transactionline}`;

    if (!accountingMap.has(key)) {
      accountingMap.set(key, []);
    }

    accountingMap.get(key).push(row);
  }

  const errors = [];
  const uniqueKeys = new Set();
  const lineDocumentIds = new Set();

  let cogsAmount = 0;
  let assetCredit = 0;
  let totalQty = 0;
  let assetQty = 0;

  for (const line of cogsLines) {
    const key =
      `${line.transaction}:${line.uniquekey}`;

    if (
      line.uniquekey == null ||
      uniqueKeys.has(key)
    ) {
      errors.push(`Duplicate/missing COGS key: ${key}`);
    }

    uniqueKeys.add(key);
    lineDocumentIds.add(String(line.transaction));

    if (!headerIds.has(String(line.transaction))) {
      errors.push(`Orphan source line: ${key}`);
    }

    const gl =
      accountingMap.get(
        `${line.transaction}:${line.id}`
      ) ?? [];

    if (!gl.length) {
      errors.push(`Missing COGS GL: ${key}`);
    }

    cogsAmount += sum(gl, 'debit');
    totalQty += n(line.quantity);
  }

  for (const line of assetLines) {
    const gl =
      accountingMap.get(
        `${line.transaction}:${line.id}`
      ) ?? [];

    if (!gl.length) {
      errors.push(
        `Missing ASSET GL: ${line.transaction}:${line.id}`
      );
    }

    assetCredit += sum(gl, 'credit');
    assetQty += n(line.quantity);
  }

  const withoutLines =
    [...headerIds].filter(
      id => !lineDocumentIds.has(id)
    ).length;

  if (cogsLines.length !== assetLines.length) {
    errors.push('COGS and ASSET line count mismatch');
  }

  if (!amountMatch(cogsAmount, assetCredit)) {
    errors.push('COGS debit and ASSET credit mismatch');
  }

  if (!quantityMatch(totalQty, -assetQty)) {
    errors.push('COGS and ASSET quantity mismatch');
  }

  if (withoutLines > 0) {
    errors.push(`${withoutLines} headers without COGS lines`);
  }

  return {
    count: headers.length,
    lineCount: cogsLines.length,
    documentCount: lineDocumentIds.size,
    quantity: totalQty,
    cogs: cogsAmount,
    assetCredit,
    assetLineCount: assetLines.length,
    withoutLines,
    errors
  };
}

// =====================================================
// BIGQUERY KPI
// =====================================================

async function getBigQueryKpi() {
  const rows = await bqQuery(`
    WITH h AS (
      SELECT *
      FROM ${table('item_fulfillment_headers')}
      WHERE transaction_date >= DATE '${DATE_FROM}'
        AND transaction_date < DATE '${DATE_TO}'
        AND is_deleted = FALSE
    ),
    l AS (
      SELECT l.*
      FROM ${table('item_fulfillment_lines')} l
      JOIN h
        ON h.internal_id = l.fulfillment_internal_id
      WHERE l.transaction_date >= DATE '${DATE_FROM}'
        AND l.transaction_date < DATE '${DATE_TO}'
    )
    SELECT
      (SELECT COUNT(*) FROM h) AS header_count,

      (SELECT COUNT(*) FROM l) AS line_count,

      (SELECT COUNT(DISTINCT fulfillment_internal_id)
       FROM l) AS document_count,

      (SELECT COALESCE(SUM(total_quantity_shipped), 0)
       FROM h) AS header_qty,

      (SELECT COALESCE(SUM(quantity_shipped), 0)
       FROM l) AS line_qty,

      (SELECT COALESCE(SUM(total_cogs_amount), 0)
       FROM h) AS header_cogs,

      (SELECT COALESCE(SUM(cogs_amount), 0)
       FROM l) AS line_cogs,

      (SELECT COUNT(*) FROM (
        SELECT internal_id
        FROM h
        GROUP BY internal_id
        HAVING COUNT(*) > 1
      )) AS duplicate_headers,

      (SELECT COUNT(*) FROM (
        SELECT
          fulfillment_internal_id,
          line_unique_key
        FROM l
        GROUP BY
          fulfillment_internal_id,
          line_unique_key
        HAVING COUNT(*) > 1
      )) AS duplicate_lines,

      (SELECT COUNT(*)
       FROM l
       LEFT JOIN h
         ON h.internal_id = l.fulfillment_internal_id
       WHERE h.internal_id IS NULL) AS orphan_lines,

      (SELECT COUNT(*)
       FROM h
       LEFT JOIN (
         SELECT DISTINCT fulfillment_internal_id
         FROM l
       ) x
         ON x.fulfillment_internal_id = h.internal_id
       WHERE x.fulfillment_internal_id IS NULL)
       AS headers_without_lines
  `);

  return rows[0];
}

// =====================================================
// DOCUMENT-LEVEL COGS DIAGNOSTIC (READ ONLY)
// =====================================================

async function showCogsDifferences(headers, lines, accounting) {
  const sourceById = new Map(headers.map(h => [String(h.id), {
    number: h.tranid ?? null,
    cogs: 0
  }]));
  const cogsKeys = new Set(
    lines.filter(l => l.mainline === 'F' && l.iscogs === 'T' &&
      l.accountinglinetype === 'COGS' && l.item != null)
      .map(l => `${l.transaction}:${l.id}`)
  );
  for (const gl of accounting) {
    if (String(gl.accountingbook) !== ACCOUNTING_BOOK || gl.posting !== 'T') continue;
    if (!cogsKeys.has(`${gl.transaction}:${gl.transactionline}`)) continue;
    const doc = sourceById.get(String(gl.transaction));
    if (doc) doc.cogs += n(gl.debit);
  }

  const rows = await bqQuery(`
    SELECT internal_id, fulfillment_number, total_cogs_amount,
           FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', netsuite_last_modified_at) AS last_modified
    FROM ${table('item_fulfillment_headers')}
    WHERE transaction_date >= DATE '${DATE_FROM}'
      AND transaction_date < DATE '${DATE_TO}'
      AND COALESCE(is_deleted, FALSE) = FALSE
  `);
  const targetById = new Map(rows.map(r => [String(r.internal_id), r]));
  const differences = [];
  for (const [id, doc] of sourceById) {
    const target = targetById.get(id);
    if (!target) {
      differences.push({ id, document: doc.number, issue: 'MISSING_IN_BIGQUERY' });
      continue;
    }
    const diff = doc.cogs - n(target.total_cogs_amount);
    if (Math.abs(diff) >= 0.005) {
      differences.push({ id, document: doc.number, source_cogs: money(doc.cogs),
        bigquery_cogs: money(target.total_cogs_amount), difference: money(diff),
        bigquery_last_modified: target.last_modified });
    }
  }
  for (const [id, target] of targetById) {
    if (!sourceById.has(id)) {
      differences.push({ id, document: target.fulfillment_number,
        issue: 'ACTIVE_ONLY_IN_BIGQUERY' });
    }
  }
  console.log('\nDOCUMENT-LEVEL COGS DIAGNOSTIC (READ ONLY)');
  console.log(`Different documents: ${differences.length}`);
  for (const item of differences.slice(0, 40)) console.log(JSON.stringify(item));
  if (differences.length > 40) console.log(`Additional mismatches: ${differences.length - 40}`);
}

// =====================================================
// COMPARISON
// =====================================================

function compare(source, target) {
  const checks = [];

  function check(name, a, b, comparator = quantityMatch) {
    const pass = comparator(a, b);

    checks.push({ name, pass });

    console.log(
      `${name.padEnd(27)} : ${pass ? 'PASS' : 'FAIL'}`
    );

    return pass;
  }

  console.log('\n==========================================');
  console.log('HEADER RECONCILIATION');
  console.log('==========================================');

  console.log(`NetSuite COUNT : ${source.count}`);
  console.log(`BigQuery COUNT : ${target.header_count}`);

  console.log(
    `NetSuite COGS  : ${money(source.cogs)}`
  );

  console.log(
    `BigQuery COGS  : ${money(target.header_cogs)}`
  );

  check('HEADER COUNT',
    source.count, target.header_count);

  check('HEADER COGS',
    source.cogs, target.header_cogs, amountMatch);

  check('HEADER QUANTITY',
    source.quantity, target.header_qty);

  console.log('\n==========================================');
  console.log('LINE RECONCILIATION');
  console.log('==========================================');

  console.log(`NetSuite LINES : ${source.lineCount}`);
  console.log(`BigQuery LINES : ${target.line_count}`);

  console.log(`NetSuite QTY   : ${fmt(source.quantity)}`);
  console.log(`BigQuery QTY   : ${fmt(target.line_qty)}`);

  console.log(`NetSuite COGS  : ${money(source.cogs)}`);
  console.log(`BigQuery COGS  : ${money(target.line_cogs)}`);

  check('LINE COUNT',
    source.lineCount, target.line_count);

  check('DOCUMENTS WITH LINES',
    source.documentCount, target.document_count);

  check('LINE QUANTITY',
    source.quantity, target.line_qty);

  check('LINE COGS',
    source.cogs, target.line_cogs, amountMatch);

  console.log('\n==========================================');
  console.log('INTEGRITY CHECK');
  console.log('==========================================');

  console.log(`Source COGS lines  : ${source.lineCount}`);
  console.log(`Source ASSET lines : ${source.assetLineCount}`);

  console.log(`COGS debit         : ${money(source.cogs)}`);
  console.log(`ASSET credit       : ${money(source.assetCredit)}`);

  console.log(`Duplicate headers  : ${target.duplicate_headers}`);
  console.log(`Duplicate lines    : ${target.duplicate_lines}`);
  console.log(`Orphan lines       : ${target.orphan_lines}`);
  console.log(`Headers no lines   : ${target.headers_without_lines}`);

  check('COGS/ASSET LINE COUNT',
    source.lineCount, source.assetLineCount);

  check('COGS/ASSET AMOUNT',
    source.cogs, source.assetCredit, amountMatch);

  check('DUPLICATE HEADERS',
    target.duplicate_headers, 0);

  check('DUPLICATE LINES',
    target.duplicate_lines, 0);

  check('ORPHAN LINES',
    target.orphan_lines, 0);

  check('HEADERS WITHOUT LINES',
    target.headers_without_lines, 0);

  check('NETSUITE SOURCE ERRORS',
    source.errors.length, 0);

  return checks.every(row => row.pass);
}

// =====================================================
// MAIN
// =====================================================

async function main() {
  console.log('\n==========================================');
  console.log('ITEM FULFILLMENT FINAL RECONCILIATION');
  console.log('==========================================');
  console.log('Period: October 2026');
  console.log('Accounting Book: 1');
  console.log('Mode: READ ONLY');

  console.log('\nRequesting NetSuite OAuth token...');

  const token = await getToken();

  console.log('NetSuite OAuth: SUCCESS');

  console.log('\nFetching NetSuite headers...');

  const headers = await getHeaders(token);

  console.log(`Fulfillments found: ${headers.length}`);

  const ids = headers.map(row => assertId(row.id));

  console.log('\nFetching NetSuite lines...');

  const lines = await getDetails(
    token, ids, 'lines'
  );

  console.log('\nFetching NetSuite GL impact...');

  const accounting = await getDetails(
    token, ids, 'accounting'
  );

  console.log('\nCalculating NetSuite KPI...');

  const source = calculateNetSuite(
    headers, lines, accounting
  );

  console.log('\nFetching BigQuery KPI...');

  const target = await getBigQueryKpi();

  const passed = compare(source, target);

  if (!passed) {
    await showCogsDifferences(headers, lines, accounting);
  }

  if (source.errors.length > 0) {
    console.log('\nSOURCE ERRORS:');

    source.errors.slice(0, 20).forEach(
      error => console.log(`- ${error}`)
    );
  }

  console.log('\n==========================================');
  console.log('FINAL RESULT');
  console.log('==========================================');

  if (passed) {
    console.log('ITEM FULFILLMENT CHECK: PASS');
    console.log('NetSuite and BigQuery are synchronized.');
  } else {
    console.log('ITEM FULFILLMENT CHECK: FAIL');
    console.log('Review mismatched KPI before continuing.');
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('\nITEM FULFILLMENT CHECK ERROR');
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
