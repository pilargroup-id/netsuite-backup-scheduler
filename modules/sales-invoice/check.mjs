import { bq as sharedBQ } from '../../common/bigquery-client.mjs';
import { token as sharedToken } from '../../common/netsuite-client.mjs';
import { CLIENT_ID, CERTIFICATE_ID } from '../../credentials/netsuite-secrets.mjs';
import fs from 'fs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/*
|--------------------------------------------------------------------------
| CONFIG - NETSUITE
|--------------------------------------------------------------------------
|
| Isi credential yang sama dari script yang sudah berhasil.
|
*/

;

;

const NETSUITE_BASE_URL =
  'https://6930902.suitetalk.api.netsuite.com';

const PRIVATE_KEY_PATH =
  'C:\\netsuite-backup-cert\\private.pem';

const TOKEN_URL =
  `${NETSUITE_BASE_URL}/services/rest/auth/oauth2/v1/token`;

/*
|--------------------------------------------------------------------------
| CONFIG - BIGQUERY
|--------------------------------------------------------------------------
*/

const PROJECT_ID =
  'even-gearbox-255203';

const DATASET_ID =
  'netsuite_backup';

const HEADER_TABLE =
  'sales_invoice_headers';

const LINE_TABLE =
  'sales_invoice_lines';

const BQ_LOCATION =
  'asia-southeast1';

const POSTING_PERIOD =
  'Oct 2026';

/*
|--------------------------------------------------------------------------
| BIGQUERY CLIENT
|--------------------------------------------------------------------------
*/

const bigquery = sharedBQ;

/*
|--------------------------------------------------------------------------
| NETSUITE OAUTH
|--------------------------------------------------------------------------
*/

const getNetSuiteAccessToken = sharedToken;

async function runSuiteQL(
  accessToken,
  query,
  limit = 10
) {
  const url =
    `${NETSUITE_BASE_URL}` +
    `/services/rest/query/v1/suiteql` +
    `?limit=${limit}`;

  const response =
    await fetch(
      url,
      {
        method:
          'POST',

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          'Content-Type':
            'application/json',

          Prefer:
            'transient'
        },

        body:
          JSON.stringify({
            q: query
          })
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `SuiteQL failed. HTTP ${response.status}: ${text}`
    );
  }

  return JSON.parse(text);
}

/*
|--------------------------------------------------------------------------
| NETSUITE HEADER KPI
|--------------------------------------------------------------------------
*/

async function getNetSuiteHeaderKpi(
  accessToken
) {
  const query = `
    SELECT
      COUNT(*) AS transaction_count,

      SUM(
        foreigntotal
      ) AS total_amount

    FROM
      Transaction

    WHERE
      type = 'CustInvc'

      AND BUILTIN.DF(
        postingperiod
      ) = '${POSTING_PERIOD}'
  `;

  const result =
    await runSuiteQL(
      accessToken,
      query
    );

  if (
    !result.items ||
    result.items.length === 0
  ) {
    throw new Error(
      'NetSuite header KPI returned no rows.'
    );
  }

  return result.items[0];
}

/*
|--------------------------------------------------------------------------
| NETSUITE LINE KPI
|--------------------------------------------------------------------------
|
| Filter harus sama dengan loader:
|
| mainline = F
| taxline  = F
| item     != NULL
| iscogs   = F
|
| foreignamount di Sales Invoice accounting sign-nya negatif.
| Kita balik sign-nya agar sama dengan BigQuery.
|
*/

async function getNetSuiteLineKpi(
  accessToken
) {
  const query = `
    SELECT
      COUNT(*)
        AS line_count,

      COUNT(
        DISTINCT t.id
      )
        AS invoice_count,

      SUM(
        0 - tl.foreignamount
      )
        AS total_line_amount

    FROM
      TransactionLine tl

    INNER JOIN
      Transaction t
        ON t.id =
           tl.transaction

    WHERE
      t.type =
        'CustInvc'

      AND BUILTIN.DF(
        t.postingperiod
      ) = '${POSTING_PERIOD}'

      AND tl.mainline =
        'F'

      AND tl.taxline =
        'F'

      AND tl.item
        IS NOT NULL

      AND NVL(
        tl.iscogs,
        'F'
      ) = 'F'
  `;

  const result =
    await runSuiteQL(
      accessToken,
      query
    );

  if (
    !result.items ||
    result.items.length === 0
  ) {
    throw new Error(
      'NetSuite line KPI returned no rows.'
    );
  }

  return result.items[0];
}

/*
|--------------------------------------------------------------------------
| BIGQUERY HEADER KPI
|--------------------------------------------------------------------------
*/

async function getBigQueryHeaderKpi() {
  const query = `
    SELECT
      COUNT(*)
        AS transaction_count,

      SUM(total_amount)
        AS total_amount

    FROM
      \`${PROJECT_ID}.${DATASET_ID}.${HEADER_TABLE}\`

    WHERE
      posting_period =
        @postingPeriod

      AND is_deleted =
        FALSE
  `;

  const [rows] =
    await bigquery.query({
      query,

      params: {
        postingPeriod:
          POSTING_PERIOD
      },

      location:
        BQ_LOCATION
    });

  return rows[0];
}

/*
|--------------------------------------------------------------------------
| BIGQUERY LINE KPI
|--------------------------------------------------------------------------
*/

async function getBigQueryLineKpi() {
  const query = `
    SELECT
      COUNT(*)
        AS line_count,

      COUNT(
        DISTINCT l.invoice_internal_id
      )
        AS invoice_count,

      SUM(l.amount)
        AS total_line_amount

    FROM
      \`${PROJECT_ID}.${DATASET_ID}.${LINE_TABLE}\` l

    INNER JOIN
      \`${PROJECT_ID}.${DATASET_ID}.${HEADER_TABLE}\` h
      ON h.internal_id = l.invoice_internal_id

    WHERE
      l.posting_period = @postingPeriod
      AND h.posting_period = @postingPeriod
      AND h.is_deleted = FALSE
  `;

  const [rows] =
    await bigquery.query({
      query,

      params: {
        postingPeriod:
          POSTING_PERIOD
      },

      location:
        BQ_LOCATION
    });

  return rows[0];
}

/*
|--------------------------------------------------------------------------
| DUPLICATE CHECK
|--------------------------------------------------------------------------
|
| Key:
|
| invoice_internal_id + line_number
|
*/

async function getDuplicateCount() {
  const query = `
    SELECT
      COUNT(*) AS duplicate_keys

    FROM
    (
      SELECT
        invoice_internal_id,
        line_number

      FROM
        \`${PROJECT_ID}.${DATASET_ID}.${LINE_TABLE}\`

      WHERE
        posting_period =
          @postingPeriod

      GROUP BY
        invoice_internal_id,
        line_number

      HAVING
        COUNT(*) > 1
    )
  `;

  const [rows] =
    await bigquery.query({
      query,

      params: {
        postingPeriod:
          POSTING_PERIOD
      },

      location:
        BQ_LOCATION
    });

  return Number(
    rows[0]?.duplicate_keys ||
    0
  );
}

/*
|--------------------------------------------------------------------------
| ORPHAN LINE CHECK
|--------------------------------------------------------------------------
|
| Line ada tetapi header fisiknya tidak ditemukan.
| Historical lines milik soft-deleted header bukan orphan.
|
*/

async function getOrphanLineCount() {
  const query = `
    SELECT
      COUNT(*) AS orphan_lines

    FROM
      \`${PROJECT_ID}.${DATASET_ID}.${LINE_TABLE}\` l

    LEFT JOIN
      \`${PROJECT_ID}.${DATASET_ID}.${HEADER_TABLE}\` h

      ON h.internal_id =
         l.invoice_internal_id


    WHERE
      l.posting_period =
        @postingPeriod

      AND h.internal_id
        IS NULL
  `;

  const [rows] =
    await bigquery.query({
      query,

      params: {
        postingPeriod:
          POSTING_PERIOD
      },

      location:
        BQ_LOCATION
    });

  return Number(
    rows[0]?.orphan_lines ||
    0
  );
}

/*
|--------------------------------------------------------------------------
| HEADER WITHOUT ITEM LINE
|--------------------------------------------------------------------------
|
| Ini bukan otomatis error.
|
| Kita tampilkan sebagai diagnostic.
|
| Yang menentukan correctness adalah:
|
| NetSuite invoices-with-lines
| vs
| BigQuery invoices-with-lines
|
*/

async function getHeadersWithoutLines() {
  const query = `
    SELECT
      COUNT(*) AS header_without_lines

    FROM
      \`${PROJECT_ID}.${DATASET_ID}.${HEADER_TABLE}\` h

    LEFT JOIN
    (
      SELECT DISTINCT
        invoice_internal_id

      FROM
        \`${PROJECT_ID}.${DATASET_ID}.${LINE_TABLE}\`

      WHERE
        posting_period =
          @postingPeriod

    ) l

      ON l.invoice_internal_id =
         h.internal_id

    WHERE
      h.posting_period =
        @postingPeriod

      AND h.is_deleted =
        FALSE

      AND l.invoice_internal_id
        IS NULL
  `;

  const [rows] =
    await bigquery.query({
      query,

      params: {
        postingPeriod:
          POSTING_PERIOD
      },

      location:
        BQ_LOCATION
    });

  return Number(
    rows[0]?.header_without_lines ||
    0
  );
}

/*
|--------------------------------------------------------------------------
| VALUE HELPERS
|--------------------------------------------------------------------------
*/

function normalizeValue(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return '0';
  }

  if (
    typeof value === 'object' &&
    value.value !== undefined
  ) {
    return String(
      value.value
    );
  }

  return String(value);
}

/*
|--------------------------------------------------------------------------
| SCIENTIFIC NOTATION -> PLAIN DECIMAL
|--------------------------------------------------------------------------
*/

function toPlainDecimal(
  value
) {
  let text =
    normalizeValue(
      value
    ).trim();

  if (
    !text.includes('e') &&
    !text.includes('E')
  ) {
    return text;
  }

  let negative =
    false;

  if (
    text.startsWith('-')
  ) {
    negative =
      true;

    text =
      text.substring(1);

  } else if (
    text.startsWith('+')
  ) {
    text =
      text.substring(1);
  }

  const parts =
    text
      .toLowerCase()
      .split('e');

  if (
    parts.length !== 2
  ) {
    throw new Error(
      `Invalid decimal: ${value}`
    );
  }

  const coefficient =
    parts[0];

  const exponent =
    Number(
      parts[1]
    );

  let [
    whole,
    decimal = ''
  ] =
    coefficient.split('.');

  whole =
    whole || '0';

  const digits =
    `${whole}${decimal}`;

  const position =
    whole.length +
    exponent;

  let result;

  if (
    position <= 0
  ) {
    result =
      '0.' +
      '0'.repeat(
        Math.abs(
          position
        )
      ) +
      digits;

  } else if (
    position >=
    digits.length
  ) {
    result =
      digits +
      '0'.repeat(
        position -
        digits.length
      );

  } else {
    result =
      digits.substring(
        0,
        position
      ) +
      '.' +
      digits.substring(
        position
      );
  }

  return negative
    ? `-${result}`
    : result;
}

/*
|--------------------------------------------------------------------------
| DECIMAL -> CENTS
|--------------------------------------------------------------------------
*/

function decimalToCents(
  value
) {
  let text =
    toPlainDecimal(
      value
    );

  const negative =
    text.startsWith('-');

  if (negative) {
    text =
      text.substring(1);
  }

  let [
    whole,
    decimal = ''
  ] =
    text.split('.');

  decimal =
    (decimal + '00')
      .substring(
        0,
        2
      );

  const cents =
    BigInt(
      whole || '0'
    ) *
      100n +
    BigInt(decimal);

  return negative
    ? -cents
    : cents;
}

function centsToDisplay(
  cents
) {
  const negative =
    cents < 0n;

  const value =
    negative
      ? -cents
      : cents;

  const whole =
    value / 100n;

  const decimal =
    String(
      value % 100n
    ).padStart(
      2,
      '0'
    );

  return (
    (negative ? '-' : '') +
    `${whole}.${decimal}`
  );
}

/*
|--------------------------------------------------------------------------
| MAIN
|--------------------------------------------------------------------------
*/

async function main() {
  try {
    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      'SALES INVOICE FINAL RECONCILIATION'
    );

    console.log(
      `Period: ${POSTING_PERIOD}`
    );

    console.log(
      '=========================================='
    );

    console.log('');

    /*
     * NetSuite
     */

    const accessToken =
      await getNetSuiteAccessToken();

    console.log('');

    console.log(
      'Checking NetSuite header KPI...'
    );

    const nsHeader =
      await getNetSuiteHeaderKpi(
        accessToken
      );

    console.log(
      'Checking NetSuite line KPI...'
    );

    const nsLines =
      await getNetSuiteLineKpi(
        accessToken
      );

    /*
     * BigQuery
     */

    console.log(
      'Checking BigQuery header KPI...'
    );

    const bqHeader =
      await getBigQueryHeaderKpi();

    console.log(
      'Checking BigQuery line KPI...'
    );

    const bqLines =
      await getBigQueryLineKpi();

    console.log(
      'Checking duplicate lines...'
    );

    const duplicateKeys =
      await getDuplicateCount();

    console.log(
      'Checking orphan lines...'
    );

    const orphanLines =
      await getOrphanLineCount();

    console.log(
      'Checking headers without lines...'
    );

    const headersWithoutLines =
      await getHeadersWithoutLines();

    /*
     * Normalize Header
     */

    const nsHeaderCount =
      Number(
        normalizeValue(
          nsHeader.transaction_count
        )
      );

    const bqHeaderCount =
      Number(
        normalizeValue(
          bqHeader.transaction_count
        )
      );

    const nsHeaderAmount =
      decimalToCents(
        nsHeader.total_amount
      );

    const bqHeaderAmount =
      decimalToCents(
        bqHeader.total_amount
      );

    /*
     * Normalize Lines
     */

    const nsLineCount =
      Number(
        normalizeValue(
          nsLines.line_count
        )
      );

    const bqLineCount =
      Number(
        normalizeValue(
          bqLines.line_count
        )
      );

    const nsLineInvoiceCount =
      Number(
        normalizeValue(
          nsLines.invoice_count
        )
      );

    const bqLineInvoiceCount =
      Number(
        normalizeValue(
          bqLines.invoice_count
        )
      );

    const nsLineAmount =
      decimalToCents(
        nsLines.total_line_amount
      );

    const bqLineAmount =
      decimalToCents(
        bqLines.total_line_amount
      );

    /*
     * Comparisons
     */

    const headerCountMatch =
      nsHeaderCount ===
      bqHeaderCount;

    const headerAmountMatch =
      nsHeaderAmount ===
      bqHeaderAmount;

    const lineCountMatch =
      nsLineCount ===
      bqLineCount;

    const lineInvoiceMatch =
      nsLineInvoiceCount ===
      bqLineInvoiceCount;

    const lineAmountMatch =
      nsLineAmount ===
      bqLineAmount;

    const duplicateCheck =
      duplicateKeys === 0;

    const orphanCheck =
      orphanLines === 0;

    /*
     * Output
     */

    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      'HEADER RECONCILIATION'
    );

    console.log(
      '=========================================='
    );

    console.log('');

    console.log(
      `NetSuite COUNT : ${nsHeaderCount}`
    );

    console.log(
      `BigQuery COUNT : ${bqHeaderCount}`
    );

    console.log('');

    console.log(
      `NetSuite TOTAL : ${centsToDisplay(nsHeaderAmount)}`
    );

    console.log(
      `BigQuery TOTAL : ${centsToDisplay(bqHeaderAmount)}`
    );

    console.log('');

    console.log(
      `HEADER COUNT MATCH  : ${
        headerCountMatch
          ? 'YES'
          : 'NO'
      }`
    );

    console.log(
      `HEADER AMOUNT MATCH : ${
        headerAmountMatch
          ? 'YES'
          : 'NO'
      }`
    );

    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      'LINE RECONCILIATION'
    );

    console.log(
      '=========================================='
    );

    console.log('');

    console.log(
      `NetSuite LINE COUNT : ${nsLineCount}`
    );

    console.log(
      `BigQuery LINE COUNT : ${bqLineCount}`
    );

    console.log('');

    console.log(
      `NetSuite INVOICES WITH LINES : ${nsLineInvoiceCount}`
    );

    console.log(
      `BigQuery INVOICES WITH LINES : ${bqLineInvoiceCount}`
    );

    console.log('');

    console.log(
      `NetSuite LINE AMOUNT : ${centsToDisplay(nsLineAmount)}`
    );

    console.log(
      `BigQuery LINE AMOUNT : ${centsToDisplay(bqLineAmount)}`
    );

    console.log('');

    console.log(
      `LINE COUNT MATCH   : ${
        lineCountMatch
          ? 'YES'
          : 'NO'
      }`
    );

    console.log(
      `LINE INVOICE MATCH : ${
        lineInvoiceMatch
          ? 'YES'
          : 'NO'
      }`
    );

    console.log(
      `LINE AMOUNT MATCH  : ${
        lineAmountMatch
          ? 'YES'
          : 'NO'
      }`
    );

    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      'INTEGRITY CHECK'
    );

    console.log(
      '=========================================='
    );

    console.log('');

    console.log(
      `Duplicate line keys   : ${duplicateKeys}`
    );

    console.log(
      `Orphan lines          : ${orphanLines}`
    );

    console.log(
      `Headers without lines : ${headersWithoutLines}`
    );

    console.log('');

    console.log(
      `DUPLICATE CHECK : ${
        duplicateCheck
          ? 'YES'
          : 'NO'
      }`
    );

    console.log(
      `ORPHAN CHECK    : ${
        orphanCheck
          ? 'YES'
          : 'NO'
      }`
    );

    /*
     * Final
     */

    const allPassed =
      headerCountMatch &&
      headerAmountMatch &&
      lineCountMatch &&
      lineInvoiceMatch &&
      lineAmountMatch &&
      duplicateCheck &&
      orphanCheck;

    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      'FINAL RESULT'
    );

    console.log(
      '=========================================='
    );

    console.log('');

    if (allPassed) {
      console.log(
        'SALES INVOICE CHECK: PASS'
      );

      console.log(
        'NetSuite and BigQuery are synchronized.'
      );

      console.log(
        'Header, lines, duplicates, and orphan checks are OK.'
      );

    } else {
      console.log(
        'SALES INVOICE CHECK: FAIL'
      );

      console.log('');

      console.log(
        'Run sync scripts again:'
      );

      console.log(
        'node .\\sync-sales-invoice.mjs'
      );

      console.log(
        'node .\\sync-sales-invoice-lines.mjs'
      );

      console.log('');

      console.log(
        'Then run this checker again.'
      );

      process.exitCode =
        1;
    }

  } catch (error) {
    console.error('');

    console.error(
      'SALES INVOICE CHECK ERROR'
    );

    console.error(
      error?.message ||
      error
    );

    process.exitCode =
      1;
  }
}

main();
