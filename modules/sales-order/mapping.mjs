import { normalizeNumericRate } from '../../common/decimal-precision.mjs';
import { token as sharedToken, BASE_URL as BASE } from '../../common/netsuite-client.mjs';



import { PROJECT, DATASET, LOCATION, bq, T, query } from '../../common/bigquery-client.mjs';
export { PROJECT, DATASET, LOCATION, bq, T, query };
export const FROM = '2026-10-01';
export const TO = '2026-11-01';

export function N(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return n;
}

export const flag = value =>
  String(value ?? 'F').toUpperCase() === 'T';

export function chunk(array, size) {
  const results = [];
  for (let i = 0; i < array.length; i += size) {
    results.push(array.slice(i, i + size));
  }
  return results;
}

export function cleanDateTime(value) {
  if (value == null) return null;
  const text = String(value);

  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    throw new Error(`Invalid datetime: ${text}`);
  }

  return text;
}

// =====================================================
// LINE CLASSIFICATION
// =====================================================

export function classify(l) {
  if (flag(l.mainline)) return 'MAINLINE';

  if (flag(l.taxline) || l.itemtype === 'TaxItem') {
    return 'TAX';
  }

  if (flag(l.iscogs)) return 'COGS';

  if (
    l.accountinglinetype === 'INCOME' &&
    l.item != null
  ) {
    return 'PRODUCT_INCOME';
  }

  if (l.itemtype === 'Discount') {
    return 'DISCOUNT';
  }

  if (l.item != null) return 'OTHER_ITEM';

  return 'OTHER_NON_ITEM';
}

// =====================================================
// NETSUITE OAUTH
// =====================================================

export const token = sharedToken;

export async function suiteql(
  access,
  sql,
  limit = 1000,
  offset = 0
) {
  const url =
    `${BASE}/services/rest/query/v1/suiteql` +
    `?limit=${limit}&offset=${offset}`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': 'application/json',
        Prefer: 'transient'
      },
      body: JSON.stringify({ q: sql })
    });

    const body = await response.text();

    if (response.ok) {
      return JSON.parse(body);
    }

    if (
      attempt === 4 ||
      ![429, 500, 502, 503, 504].includes(response.status)
    ) {
      throw new Error(
        `SuiteQL HTTP ${response.status}: ${body}\nSQL: ${sql}`
      );
    }

    await sleep(attempt * 1000);
  }
}

export async function fetchAll(access, sql) {
  const rows = [];
  let offset = 0;

  while (true) {
    const page = await suiteql(
      access,
      sql,
      1000,
      offset
    );

    const items = page.items ?? [];
    rows.push(...items);

    if (!page.hasMore) break;

    if (items.length === 0) {
      throw new Error('SuiteQL pagination stalled');
    }

    offset += 1000;

    if (offset > 1000000) {
      throw new Error('SuiteQL pagination limit exceeded');
    }
  }

  return rows;
}

// =====================================================
// SALES ORDER HEADERS
// =====================================================

export async function fetchHeaders(
  access,
  changedAfter = null
) {
  const modified = changedAfter
    ? `AND lastmodifieddate >= TO_DATE(
         '${changedAfter}',
         'YYYY-MM-DD HH24:MI:SS'
       )`
    : '';

  // Transaction.subsidiary is not available in
  // this NetSuite account's SuiteQL Transaction table.

  const sql = `
    SELECT
      id,
      tranid,
      status,
      entity,
      currency,
      foreigntotal,
      TO_CHAR(
        trandate,
        'YYYY-MM-DD'
      ) AS transaction_date,
      TO_CHAR(
        lastmodifieddate,
        'YYYY-MM-DD HH24:MI:SS'
      ) AS last_modified
    FROM Transaction
    WHERE type = 'SalesOrd'
      AND trandate >= TO_DATE(
        '${FROM}', 'YYYY-MM-DD'
      )
      AND trandate < TO_DATE(
        '${TO}', 'YYYY-MM-DD'
      )
      ${modified}
    ORDER BY id
  `;

  return fetchAll(access, sql);
}

// =====================================================
// SALES ORDER LINES
// =====================================================

export async function fetchLines(access, ids) {
  const rows = [];
  const batches = chunk(ids, 20);

  for (let i = 0; i < batches.length; i++) {
    const idList = batches[i]
      .map(id => {
        const n = Number(id);
        if (!Number.isSafeInteger(n) || n <= 0) {
          throw new Error(`Invalid Sales Order ID: ${id}`);
        }
        return n;
      })
      .join(',');

    const sql = `
      SELECT
        transaction,
        id,
        uniquekey,
        item,
        itemtype,
        accountinglinetype,
        mainline,
        taxline,
        iscogs,
        quantity,
        rate,
        foreignamount,
        netamount,
        tax1amt,
        location,
        units,
        memo,
        isclosed
      FROM TransactionLine
      WHERE transaction IN (${idList})
      ORDER BY transaction, id
    `;

    const result = await fetchAll(access, sql);
    rows.push(...result);

    console.log(
      `SO line batch ${i + 1}/${batches.length}: ${result.length}`
    );
  }

  return rows;
}

// =====================================================
// SOURCE MAPPING
// =====================================================

export function mapSource(headers, rawLines) {
  const mappedHeaders = headers.map(h => ({
    internal_id: String(h.id),
    tranid: h.tranid ?? null,
    transaction_date: h.transaction_date,
    status: h.status ?? null,
    customer_id:
      h.entity == null ? null : String(h.entity),

    // Not available from Transaction header.
    subsidiary_id: null,

    currency_id:
      h.currency == null ? null : String(h.currency),

    total_amount: N(h.foreigntotal).toFixed(2),
    last_modified: cleanDateTime(h.last_modified)
  }));

  const headerMap = new Map(
    mappedHeaders.map(h => [h.internal_id, h])
  );

  if (headerMap.size !== mappedHeaders.length) {
    throw new Error('Duplicate Sales Order header IDs');
  }

  const mappedLines = [];
  const uniqueKeys = new Set();

  let mainlineCount = 0;

  for (const l of rawLines) {
    const documentId = String(l.transaction);
    const header = headerMap.get(documentId);

    if (!header) {
      throw new Error(
        `Source orphan line: ${documentId}:${l.id}`
      );
    }

    if (flag(l.mainline)) {
      mainlineCount++;
      continue;
    }

    if (l.uniquekey == null) {
      throw new Error(
        `Missing line unique key: ${documentId}:${l.id}`
      );
    }

    const key = `${documentId}:${l.uniquekey}`;

    if (uniqueKeys.has(key)) {
      throw new Error(`Duplicate line key: ${key}`);
    }

    uniqueKeys.add(key);

    mappedLines.push({
      sales_order_internal_id: documentId,
      line_unique_key: String(l.uniquekey),
      line_id: l.id == null ? null : String(l.id),
      line_type: classify(l),
      item_id: l.item == null ? null : String(l.item),
      item_type: l.itemtype ?? null,
      accounting_line_type:
        l.accountinglinetype ?? null,
      quantity:
        l.quantity == null ? null : String(l.quantity),
      rate:
        l.rate == null ? null : normalizeNumericRate(l.rate, { module: "sales-order", recordId: l.transaction, field: "rate" }),
      foreign_amount:
        l.foreignamount == null
          ? null
          : String(l.foreignamount),
      net_amount:
        l.netamount == null
          ? null
          : String(l.netamount),
      tax_amount:
        l.tax1amt == null ? null : String(l.tax1amt),
      location_id:
        l.location == null ? null : String(l.location),
      units_id:
        l.units == null ? null : String(l.units),
      memo: l.memo ?? null,
      is_closed: flag(l.isclosed),
      last_modified: header.last_modified
    });
  }

  if (mainlineCount !== mappedHeaders.length) {
    throw new Error(
      `MAINLINE mismatch: ${mainlineCount} vs ` +
      `${mappedHeaders.length} headers`
    );
  }

  return {
    headers: mappedHeaders,
    lines: mappedLines,
    rawLineCount: rawLines.length
  };
}

