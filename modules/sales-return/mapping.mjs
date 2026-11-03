import { validateNumeric } from '../../common/decimal-precision.mjs';
import { token, fetchAll } from '../../common/netsuite-client.mjs';

export { token };
export const TYPE = 'ItemRcpt';
export const LINK_TYPE = 'CostRtrn';
export const SOURCE_TYPE = 'ItemShip';
export const FROM = '2026-10-01';
export const TO = '2026-11-01';

const period = `r.trandate >= TO_DATE('${FROM}','YYYY-MM-DD') AND r.trandate < TO_DATE('${TO}','YYYY-MM-DD')`;

function numberId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw Error(`Invalid NetSuite ID: ${value}`);
  return String(n);
}

function text(value) {
  return value == null ? null : String(value);
}

function flag(value) {
  return String(value ?? 'F').toUpperCase() === 'T';
}

// Preserve NetSuite's decimal text. Do not round inventory cost, quantity, debit, or credit.
function decimal(value, context = {}) {
  if (value == null || value === '') return null;
  return validateNumeric(String(value).trim(), context);
}

function numericUnits(value, context = {}) {
  const normalized = decimal(value, context);
  if (normalized == null) return 0n;
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const units = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  return negative ? -units : units;
}

async function grouped(access, ids, sqlFor) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 25) {
    const group = ids.slice(i, i + 25).map(numberId);
    if (!group.length) continue;
    rows.push(...await fetchAll(access, sqlFor(group.join(','))));
  }
  return rows;
}

export async function fetchHeaders(access, since = null) {
  if (since !== null && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since)) {
    throw Error('Invalid incremental watermark');
  }
  const modified = since
    ? ` AND r.lastmodifieddate >= TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')`
    : '';

  return fetchAll(access, `
    SELECT DISTINCT
      r.id AS internal_id,
      r.tranid AS receipt_number,
      TO_CHAR(r.trandate,'YYYY-MM-DD') AS transaction_date,
      TO_CHAR(r.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,
      BUILTIN.DF(r.status) AS status,
      r.entity AS customer_id,
      BUILTIN.DF(r.entity) AS customer_name,
      r.memo,
      r.subsidiary AS subsidiary_id
    FROM Transaction r
    JOIN PreviousTransactionLineLink l ON l.nextdoc = r.id
    JOIN Transaction s ON s.id = l.previousdoc
    WHERE ${period}
      AND r.type = '${TYPE}'
      AND l.linktype = '${LINK_TYPE}'
      AND s.type = '${SOURCE_TYPE}'${modified}
    ORDER BY r.id`);
}

export async function fetchLines(access, ids) {
  return grouped(access, ids, inIds => `
    SELECT
      transaction AS transaction_id,
      id AS line_id,
      uniquekey AS line_unique_key,
      linesequencenumber AS line_number,
      item AS item_id,
      quantity,
      rate,
      foreignamount,
      netamount,
      location AS location_id,
      units AS units_id,
      mainline,
      taxline,
      iscogs,
      accountinglinetype
    FROM TransactionLine
    WHERE transaction IN (${inIds})
    ORDER BY transaction,id`);
}

export async function fetchGL(access, ids) {
  return grouped(access, ids, inIds => `
    SELECT
      transaction AS transaction_id,
      transactionline AS line_id,
      accountingbook AS accounting_book_id,
      account AS account_id,
      debit,
      credit,
      posting
    FROM TransactionAccountingLine
    WHERE transaction IN (${inIds})
    ORDER BY transaction,accountingbook,transactionline,account`);
}

export async function fetchSourceLinks(access, ids) {
  return grouped(access, ids, inIds => `
    SELECT
      l.nextdoc AS return_id,
      l.previousdoc AS source_id,
      l.linktype AS link_type,
      s.type AS source_type,
      s.tranid AS source_number,
      TO_CHAR(s.trandate,'YYYY-MM-DD') AS source_date
    FROM PreviousTransactionLineLink l
    JOIN Transaction s ON s.id = l.previousdoc
    WHERE l.nextdoc IN (${inIds})
      AND ((l.linktype = 'CostRtrn' AND s.type = 'ItemShip')
        OR (l.linktype = 'ShipRcpt' AND s.type = 'RtnAuth'))
    ORDER BY l.nextdoc,l.previousdoc,l.linktype`);
}

export function mapSource(headers, rawLines, rawGL, rawLinks) {
  const mappedHeaders = [];
  const mappedLines = [];
  const mappedGL = [];
  const mappedLinks = [];

  const headerIds = new Set();
  const physicalLineCounts = new Map();
  const glCounts = new Map();
  const debitTotals = new Map();
  const creditTotals = new Map();
  const linkCounts = new Map();

  for (const row of headers) {
    const id = numberId(row.internal_id);
    if (headerIds.has(id)) throw Error(`Duplicate Sales Return header ${id}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.transaction_date ?? ''))) throw Error(`Invalid transaction date ${id}`);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(row.last_modified ?? ''))) throw Error(`Invalid last_modified ${id}`);
    headerIds.add(id);
    physicalLineCounts.set(id, 0);
    glCounts.set(id, 0);
    debitTotals.set(id, 0n);
    creditTotals.set(id, 0n);
    linkCounts.set(id, 0);
    mappedHeaders.push({
      internal_id: id,
      receipt_number: text(row.receipt_number),
      transaction_date: row.transaction_date,
      last_modified: row.last_modified,
      status: text(row.status),
      customer_id: text(row.customer_id),
      customer_name: text(row.customer_name),
      memo: text(row.memo),
      subsidiary_id: text(row.subsidiary_id)
    });
  }

  const lineKeys = new Set();
  for (const row of rawLines) {
    const id = numberId(row.transaction_id);
    if (!headerIds.has(id)) throw Error(`Orphan Sales Return line ${id}`);
    if (flag(row.mainline) || flag(row.taxline)) continue;

    const lineUniqueKey = text(row.line_unique_key);
    if (!lineUniqueKey) throw Error(`Missing Sales Return line uniquekey ${id}`);
    const key = `${id}:${lineUniqueKey}`;
    if (lineKeys.has(key)) throw Error(`Duplicate Sales Return line ${key}`);
    lineKeys.add(key);

    const isCogs = flag(row.iscogs);
    const quantity = decimal(row.quantity, { module: 'sales-return', recordId: id, field: 'quantity' });
    if (!isCogs && row.item_id != null && numericUnits(quantity, { module: 'sales-return', recordId: id, field: 'quantity' }) !== 0n) {
      physicalLineCounts.set(id, physicalLineCounts.get(id) + 1);
    }

    mappedLines.push({
      return_internal_id: id,
      line_unique_key: lineUniqueKey,
      line_id: text(row.line_id),
      line_number: text(row.line_number),
      line_type: isCogs ? (text(row.accountinglinetype) ?? 'COST') : 'RETURN_ITEM',
      item_id: text(row.item_id),
      quantity,
      rate: decimal(row.rate, { module: 'sales-return', recordId: id, field: 'rate' }),
      foreign_amount: decimal(row.foreignamount, { module: 'sales-return', recordId: id, field: 'foreign_amount' }),
      net_amount: decimal(row.netamount, { module: 'sales-return', recordId: id, field: 'net_amount' }),
      location_id: text(row.location_id),
      units_id: text(row.units_id),
      is_cogs: isCogs,
      accounting_line_type: text(row.accountinglinetype)
    });
  }

  const glKeys = new Set();
  for (const row of rawGL) {
    const id = numberId(row.transaction_id);
    if (!headerIds.has(id)) throw Error(`Orphan Sales Return GL ${id}`);
    if (!flag(row.posting)) continue;
    if (row.account_id == null) continue;
    if ((row.debit == null || row.debit === '') && (row.credit == null || row.credit === '')) continue;

    const accountingBookId = text(row.accounting_book_id);
    const lineId = text(row.line_id);
    const accountId = text(row.account_id);
    const key = [id, accountingBookId, lineId, accountId].join(':');
    if (glKeys.has(key)) throw Error(`Duplicate Sales Return GL key ${key}`);
    glKeys.add(key);

    const debit = decimal(row.debit, { module: 'sales-return', recordId: id, field: 'debit' });
    const credit = decimal(row.credit, { module: 'sales-return', recordId: id, field: 'credit' });
    debitTotals.set(id, debitTotals.get(id) + numericUnits(debit, { module: 'sales-return', recordId: id, field: 'debit' }));
    creditTotals.set(id, creditTotals.get(id) + numericUnits(credit, { module: 'sales-return', recordId: id, field: 'credit' }));
    glCounts.set(id, glCounts.get(id) + 1);

    mappedGL.push({
      return_internal_id: id,
      accounting_book_id: accountingBookId,
      line_id: lineId,
      account_id: accountId,
      debit,
      credit,
      posting: true
    });
  }

  const linkKeys = new Set();
  for (const row of rawLinks) {
    const returnId = numberId(row.return_id);
    const sourceId = numberId(row.source_id);
    if (!headerIds.has(returnId)) throw Error(`Orphan Sales Return source link ${returnId}`);
    const type = text(row.link_type);
    const sourceType = text(row.source_type);
    if (!((type === 'CostRtrn' && sourceType === 'ItemShip') || (type === 'ShipRcpt' && sourceType === 'RtnAuth'))) {
      throw Error(`Unexpected Sales Return link ${type}/${sourceType}`);
    }
    const key = `${returnId}:${sourceId}:${type}`;
    if (linkKeys.has(key)) continue;
    linkKeys.add(key);
    if (type === LINK_TYPE) linkCounts.set(returnId, linkCounts.get(returnId) + 1);
    mappedLinks.push({
      return_internal_id: returnId,
      source_internal_id: sourceId,
      source_type: sourceType,
      source_number: text(row.source_number),
      source_date: text(row.source_date),
      link_type: type
    });
  }

  for (const header of mappedHeaders) {
    const id = header.internal_id;
    if (physicalLineCounts.get(id) < 1) throw Error(`Sales Return ${id} has no physical RETURN_ITEM line`);
    if (linkCounts.get(id) < 1) throw Error(`Sales Return ${id} has no CostRtrn ItemShip link`);
    if (glCounts.get(id) < 1) throw Error(`Sales Return ${id} has no posting GL rows with accounts`);
    if (debitTotals.get(id) !== creditTotals.get(id)) {
      throw Error(`Sales Return GL imbalance ${id}: debit=${debitTotals.get(id)} credit=${creditTotals.get(id)}`);
    }
  }

  return {
    headers: mappedHeaders,
    transactionLines: mappedLines,
    accountingLines: mappedGL,
    sourceLinks: mappedLinks,
    counts: {
      headers: mappedHeaders.length,
      transaction_lines: mappedLines.length,
      accounting_lines: mappedGL.length,
      source_links: mappedLinks.length
    }
  };
}
