const ACCOUNTING_BOOK = '1';
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

export function buildData(headers, lines, accounting) {
  const linesByDoc = new Map();
  const glByLine = new Map();

  for (const line of lines) {
    const key = String(line.transaction);

    if (!linesByDoc.has(key)) {
      linesByDoc.set(key, []);
    }

    linesByDoc.get(key).push(line);
  }

  for (const gl of accounting) {
    const key = `${gl.transaction}:${gl.transactionline}`;

    if (!glByLine.has(key)) {
      glByLine.set(key, []);
    }

    glByLine.get(key).push(gl);
  }

  const headerRows = [];
  const lineRows = [];

  const seenHeaders = new Set();
  const seenLines = new Set();

  const errors = [];
  const syncedAt = new Date().toISOString();

  let totalQty = 0;
  let totalCogs = 0;

  for (const header of headers) {
    const id = integer(header.internal_id);
    const docKey = String(id);

    if (seenHeaders.has(docKey)) {
      errors.push(`Duplicate header: ${id}`);
      continue;
    }

    seenHeaders.add(docKey);

    const docLines = linesByDoc.get(docKey) ?? [];

    const cogsLines = docLines.filter(line =>
      line.mainline === 'F' &&
      line.iscogs === 'T' &&
      line.accountinglinetype === 'COGS' &&
      line.item != null
    );

    const assetLines = docLines.filter(line =>
      line.mainline === 'F' &&
      line.accountinglinetype === 'ASSET'
    );

    if (!cogsLines.length) {
      errors.push(`No COGS lines: ${header.fulfillment_number}`);
    }

    if (cogsLines.length !== assetLines.length) {
      errors.push(
        `COGS/ASSET line mismatch: ${header.fulfillment_number}`
      );
    }

    let docQty = 0;
    let assetQty = 0;
    let docCogs = 0;
    let assetCredit = 0;

    const mainLine = docLines.find(
      line => line.mainline === 'T'
    );

    for (const line of cogsLines) {
      const glKey = `${docKey}:${line.id}`;

      const glRows = (glByLine.get(glKey) ?? []).filter(
        gl =>
          gl.posting === 'T' &&
          String(gl.accountingbook) === ACCOUNTING_BOOK
      );

      if (!glRows.length) {
        errors.push(
          `Missing COGS GL: ${header.fulfillment_number}/${line.id}`
        );
      }

      const debit = sum(glRows, 'debit');
      const credit = sum(glRows, 'credit');

      if (Math.abs(credit) > 0.01) {
        errors.push(
          `Unexpected COGS credit: ${header.fulfillment_number}`
        );
      }

      const uniqueKey = nullableId(line.uniquekey);

      if (uniqueKey == null) {
        errors.push(
          `Missing unique key: ${header.fulfillment_number}`
        );
        continue;
      }

      const compositeKey = `${docKey}:${uniqueKey}`;

      if (seenLines.has(compositeKey)) {
        errors.push(`Duplicate line: ${compositeKey}`);
        continue;
      }

      seenLines.add(compositeKey);

      const qty = num(line.quantity);

      if (qty < 0) {
        errors.push(
          `Negative COGS quantity: ${header.fulfillment_number}`
        );
      }

      docQty += qty;
      docCogs += debit;

      lineRows.push({
        fulfillment_internal_id: id,
        fulfillment_number: String(header.fulfillment_number),
        line_unique_key: uniqueKey,
        line_number: nullableId(line.linesequencenumber),

        item_internal_id: nullableId(line.item),
        item_name: null,

        quantity_shipped: quantity(qty),
        unit_internal_id: nullableId(line.units),

        unit_cost: line.rate == null
          ? null
          : num(line.rate).toFixed(6),

        cogs_amount: money(debit),

        accounting_book_id: 1,
        location_internal_id: nullableId(line.location),
        created_from_id: nullableId(line.createdfrom),

        transaction_date: header.transaction_date,
        posting_period: header.posting_period ?? null,

        netsuite_last_modified_at:
          validDateTime(header.netsuite_last_modified_at),

        synced_at: syncedAt
      });
    }

    for (const line of assetLines) {
      const glKey = `${docKey}:${line.id}`;

      const glRows = (glByLine.get(glKey) ?? []).filter(
        gl =>
          gl.posting === 'T' &&
          String(gl.accountingbook) === ACCOUNTING_BOOK
      );

      if (!glRows.length) {
        errors.push(
          `Missing ASSET GL: ${header.fulfillment_number}/${line.id}`
        );
      }

      assetQty += num(line.quantity);
      assetCredit += sum(glRows, 'credit');

      if (Math.abs(sum(glRows, 'debit')) > 0.01) {
        errors.push(
          `Unexpected ASSET debit: ${header.fulfillment_number}`
        );
      }
    }

    if (cents(docCogs) !== cents(assetCredit)) {
      errors.push(
        `COGS/ASSET amount mismatch: ${header.fulfillment_number}`
      );
    }

    if (Math.abs(docQty + assetQty) > 0.000001) {
      errors.push(
        `COGS/ASSET quantity mismatch: ${header.fulfillment_number}`
      );
    }

    const firstCogs = cogsLines[0];

    headerRows.push({
      internal_id: id,
      fulfillment_number: String(header.fulfillment_number),
      transaction_date: header.transaction_date,
      posting_period: header.posting_period ?? null,
      status: header.status ?? null,

      created_from_id: nullableId(
        mainLine?.createdfrom ?? firstCogs?.createdfrom
      ),

      customer_internal_id: nullableId(mainLine?.entity),

      location_internal_id: nullableId(
        firstCogs?.location ?? mainLine?.location
      ),

      total_quantity_shipped: quantity(docQty),
      total_cogs_amount: money(docCogs),
      accounting_book_id: 1,

      netsuite_last_modified_at:
        validDateTime(header.netsuite_last_modified_at),

      synced_at: syncedAt,
      first_synced_at: syncedAt,

      is_deleted: false,
      deleted_at: null
    });

    totalQty += docQty;
    totalCogs += docCogs;
  }

  const accountingBooks = new Set(
    accounting
      .filter(row => row.posting === 'T')
      .map(row => String(row.accountingbook))
  );

  if (
    accountingBooks.size !== 1 ||
    !accountingBooks.has(ACCOUNTING_BOOK)
  ) {
    errors.push(
      `Unexpected accounting books: ${[...accountingBooks].join(',')}`
    );
  }

  if (headerRows.length !== headers.length) {
    errors.push('Header count mismatch');
  }

  if (lineRows.length !== seenLines.size) {
    errors.push('Line count mismatch');
  }

  console.log('\nSOURCE VALIDATION');
  console.log(`Headers    : ${headerRows.length}`);
  console.log(`Lines      : ${lineRows.length}`);
  console.log(`Quantity   : ${quantity(totalQty)}`);
  console.log(`COGS       : ${money(totalCogs)}`);
  console.log(`Errors     : ${errors.length}`);

  if (errors.length) {
    errors.slice(0, 30).forEach(
      error => console.error(`FAIL: ${error}`)
    );

    throw new Error(
      `SOURCE VALIDATION FAILED: ${errors.length} errors`
    );
  }

  console.log('SOURCE VALIDATION: PASS');

  return {
    headerRows,
    lineRows,
    totalQty,
    totalCogs
  };
}

// ============================================================
// BIGQUERY STAGING
// ============================================================

