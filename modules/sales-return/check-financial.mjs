// Sales Return inventory/GL reconciliation. READ ONLY; no checkpoint or BigQuery mutation.
import { validateNumeric } from '../../common/decimal-precision.mjs';
import { query, T } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, fetchLines, fetchGL, fetchSourceLinks, mapSource, FROM, TO } from './mapping.mjs';

function units(value, context = {}) {
  const normalized = validateNumeric(value, context);
  if (normalized == null) return 0n;
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const n = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  return negative ? -n : n;
}
function formatUnits(value) {
  const negative = value < 0n;
  const n = negative ? -value : value;
  const whole = n / 1000000000n;
  const fraction = (n % 1000000000n).toString().padStart(9,'0').replace(/0+$/,'');
  return `${negative ? '-' : ''}${whole}${fraction ? '.' + fraction : ''}`;
}

async function main() {
  console.log(`SALES RETURN FINANCIAL CHECK | READ ONLY | ${FROM} to ${TO}`);
  const access = await token();
  const headers = await fetchHeaders(access);
  const ids = headers.map(row => row.internal_id);
  const [rawLines, rawGL, rawLinks] = ids.length
    ? await Promise.all([fetchLines(access, ids), fetchGL(access, ids), fetchSourceLinks(access, ids)])
    : [[], [], []];
  const source = mapSource(headers, rawLines, rawGL, rawLinks);

  const bqLines = await query(`SELECT d.return_internal_id,d.line_unique_key,d.line_type,CAST(d.quantity AS STRING) AS quantity,CAST(d.rate AS STRING) AS rate,d.is_cogs FROM ${T('sales_return_lines')} d JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);
  const bqGL = await query(`SELECT d.return_internal_id,d.accounting_book_id,d.line_id,d.account_id,CAST(d.debit AS STRING) AS debit,CAST(d.credit AS STRING) AS credit FROM ${T('sales_return_accounting_lines')} d JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);
  const bqLinks = await query(`SELECT d.return_internal_id,d.source_internal_id,d.link_type FROM ${T('sales_return_source_links')} d JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`);

  const aggregate = rows => {
    let quantity = 0n;
    for (const row of rows) {
      if (String(row.line_type) === 'RETURN_ITEM' && !row.is_cogs) {
        quantity += units(row.quantity, { module: 'sales-return', recordId: row.return_internal_id, field: 'quantity' });
      }
    }
    return quantity;
  };
  const glAggregate = rows => {
    let debit = 0n, credit = 0n;
    for (const row of rows) {
      debit += units(row.debit, { module: 'sales-return', recordId: row.return_internal_id, field: 'debit' });
      credit += units(row.credit, { module: 'sales-return', recordId: row.return_internal_id, field: 'credit' });
    }
    return { debit, credit };
  };

  const nsQuantity = aggregate(source.transactionLines);
  const bqQuantity = aggregate(bqLines);
  const nsGL = glAggregate(source.accountingLines);
  const bqGLTotals = glAggregate(bqGL);

  const sourceLinkKeys = new Set(source.sourceLinks.map(row => `${row.return_internal_id}:${row.source_internal_id}:${row.link_type}`));
  const bqLinkKeys = new Set(bqLinks.map(row => `${row.return_internal_id}:${row.source_internal_id}:${row.link_type}`));
  const missingLinks = [...sourceLinkKeys].filter(key => !bqLinkKeys.has(key));
  const extraLinks = [...bqLinkKeys].filter(key => !sourceLinkKeys.has(key));

  const report = {
    sourceHeaders: source.headers.length,
    sourceLines: source.transactionLines.length,
    bigQueryLines: bqLines.length,
    sourceAccountingLines: source.accountingLines.length,
    bigQueryAccountingLines: bqGL.length,
    sourceLinks: source.sourceLinks.length,
    bigQueryLinks: bqLinks.length,
    physicalReturnQuantity: { netSuite: formatUnits(nsQuantity), bigQuery: formatUnits(bqQuantity) },
    gl: {
      netSuiteDebit: formatUnits(nsGL.debit), netSuiteCredit: formatUnits(nsGL.credit),
      bigQueryDebit: formatUnits(bqGLTotals.debit), bigQueryCredit: formatUnits(bqGLTotals.credit)
    },
    missingLinks,
    extraLinks
  };
  console.log(JSON.stringify(report, null, 2));

  const failed = source.transactionLines.length !== bqLines.length ||
    source.accountingLines.length !== bqGL.length ||
    source.sourceLinks.length !== bqLinks.length ||
    nsQuantity !== bqQuantity ||
    nsGL.debit !== nsGL.credit ||
    bqGLTotals.debit !== bqGLTotals.credit ||
    nsGL.debit !== bqGLTotals.debit ||
    nsGL.credit !== bqGLTotals.credit ||
    missingLinks.length || extraLinks.length;

  if (failed) throw Error('SALES RETURN FINANCIAL CHECK FAILED');
  console.log('SALES RETURN FINANCIAL CHECK PASS (physical quantity + exact GL + CostRtrn links)');
}

main().catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
