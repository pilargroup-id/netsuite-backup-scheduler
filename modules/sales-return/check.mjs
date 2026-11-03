import { query, T } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, fetchLines, fetchGL, fetchSourceLinks, mapSource, FROM, TO } from './mapping.mjs';

const defs = [
  {
    table: 'sales_return_headers', source: 'headers', keys: ['internal_id'],
    fields: ['internal_id','receipt_number','transaction_date','last_modified','status','customer_id','customer_name','memo','subsidiary_id'], numbers: []
  },
  {
    table: 'sales_return_lines', source: 'transactionLines', keys: ['return_internal_id','line_unique_key'],
    fields: ['return_internal_id','line_unique_key','line_id','line_number','line_type','item_id','quantity','rate','foreign_amount','net_amount','location_id','units_id','is_cogs','accounting_line_type'],
    numbers: ['quantity','rate','foreign_amount','net_amount']
  },
  {
    table: 'sales_return_accounting_lines', source: 'accountingLines', keys: ['return_internal_id','accounting_book_id','line_id','account_id'],
    fields: ['return_internal_id','accounting_book_id','line_id','account_id','debit','credit','posting'], numbers: ['debit','credit']
  },
  {
    table: 'sales_return_source_links', source: 'sourceLinks', keys: ['return_internal_id','source_internal_id','link_type'],
    fields: ['return_internal_id','source_internal_id','source_type','source_number','source_date','link_type'], numbers: []
  }
];

function canonicalDecimal(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw Error(`Invalid decimal ${raw}`);
  const negative = match[1] === '-';
  const whole = match[2] ?? '';
  const fraction = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw Error(`Unsupported decimal exponent ${raw}`);
  const digits = (whole + fraction).replace(/^0+/, '') || '0';
  const shift = exponent - fraction.length;
  let result;
  if (shift >= 0) result = digits + '0'.repeat(shift);
  else {
    const point = digits.length + shift;
    result = point > 0 ? digits.slice(0,point) + '.' + digits.slice(point) : '0.' + '0'.repeat(-point) + digits;
  }
  let [integer, frac = ''] = result.split('.');
  integer = integer.replace(/^0+(?=\d)/, '');
  frac = frac.replace(/0+$/, '');
  const normalized = integer + (frac ? '.' + frac : '');
  return negative && normalized !== '0' ? '-' + normalized : normalized;
}

function normalize(field, value, def) {
  if (value == null) return null;
  if (def.numbers.includes(field)) return canonicalDecimal(value);
  if (['is_cogs','posting'].includes(field)) return value === true || String(value).toLowerCase() === 'true' || String(value) === '1' ? 'true' : 'false';
  return String(value);
}
function key(row, fields) { return fields.map(field => String(row[field] ?? 'NULL')).join('\u001f'); }
function units(value) {
  const normalized = canonicalDecimal(value);
  if (normalized == null) return 0n;
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  if (fraction.length > 9) throw Error(`Unexpected >9 scale after source validation: ${normalized}`);
  const n = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9,'0'));
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
  console.log('SALES RETURN FULL OCT 2026 CHECK | READ ONLY');
  const access = await token();
  const headers = await fetchHeaders(access);
  const ids = headers.map(row => row.internal_id);
  const [lines, gl, links] = ids.length
    ? await Promise.all([fetchLines(access, ids), fetchGL(access, ids), fetchSourceLinks(access, ids)])
    : [[], [], []];
  const mapped = mapSource(headers, lines, gl, links);

  const report = {};
  const samples = [];
  let failed = false;

  for (const def of defs) {
    const activeJoin = def.source === 'headers'
      ? ''
      : ` JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id`;
    const where = def.source === 'headers'
      ? ` WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`
      : ` WHERE h.transaction_date>=DATE '${FROM}' AND h.transaction_date<DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`;
    const alias = def.source === 'headers' ? '' : 'd.';
    const fieldSql = def.fields.map(field => {
      if (field === 'transaction_date' || field === 'source_date') return `CAST(${alias}${field} AS STRING) AS ${field}`;
      if (field === 'last_modified') return `FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',${alias}${field}) AS ${field}`;
      if (def.numbers.includes(field)) return `CAST(${alias}${field} AS STRING) AS ${field}`;
      return `${alias}${field}`;
    }).join(',');
    const stored = await query(`SELECT ${fieldSql} FROM ${T(def.table)}${def.source === 'headers' ? '' : ' d'}${activeJoin}${where}`);
    const source = mapped[def.source];

    const srcMap = new Map();
    const dstMap = new Map();
    let duplicates = 0;
    let mismatch = 0;
    let onlySource = 0;
    let onlyBq = 0;

    for (const row of source) {
      const k = key(row, def.keys);
      if (srcMap.has(k)) duplicates++;
      srcMap.set(k, row);
    }
    for (const row of stored) {
      const k = key(row, def.keys);
      if (dstMap.has(k)) duplicates++;
      dstMap.set(k, row);
    }

    for (const [k, row] of srcMap) {
      const target = dstMap.get(k);
      if (!target) {
        onlySource++;
        if (samples.length < 12) samples.push({ table: def.table, key: k, issue: 'MISSING_IN_BQ' });
        continue;
      }
      const differences = def.fields.filter(field => normalize(field,row[field],def) !== normalize(field,target[field],def));
      if (differences.length) {
        mismatch++;
        if (samples.length < 12) samples.push({ table: def.table, key: k, fields: differences.slice(0,8) });
      }
    }
    for (const k of dstMap.keys()) if (!srcMap.has(k)) onlyBq++;

    const ok = source.length === stored.length && !duplicates && !mismatch && !onlySource && !onlyBq;
    report[def.table] = { source: source.length, bigQuery: stored.length, duplicates, mismatch, onlySource, onlyBq, status: ok ? 'PASS' : 'FAIL' };
    if (!ok) failed = true;
  }

  const integrity = (await query(`SELECT
    (SELECT COUNT(*) FROM (SELECT internal_id FROM ${T('sales_return_headers')} GROUP BY 1 HAVING COUNT(*)>1)) AS duplicate_headers,
    (SELECT COUNT(*) FROM (SELECT return_internal_id,line_unique_key FROM ${T('sales_return_lines')} GROUP BY 1,2 HAVING COUNT(*)>1)) AS duplicate_lines,
    (SELECT COUNT(*) FROM (SELECT return_internal_id,accounting_book_id,line_id,account_id FROM ${T('sales_return_accounting_lines')} GROUP BY 1,2,3,4 HAVING COUNT(*)>1)) AS duplicate_gl,
    (SELECT COUNT(*) FROM (SELECT return_internal_id,source_internal_id,link_type FROM ${T('sales_return_source_links')} GROUP BY 1,2,3 HAVING COUNT(*)>1)) AS duplicate_links,
    (SELECT COUNT(*) FROM ${T('sales_return_lines')} d LEFT JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.internal_id IS NULL) AS orphan_lines,
    (SELECT COUNT(*) FROM ${T('sales_return_accounting_lines')} d LEFT JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.internal_id IS NULL) AS orphan_gl,
    (SELECT COUNT(*) FROM ${T('sales_return_source_links')} d LEFT JOIN ${T('sales_return_headers')} h ON h.internal_id=d.return_internal_id WHERE h.internal_id IS NULL) AS orphan_links`))[0];

  if (Object.values(integrity).some(value => Number(value) !== 0)) failed = true;
  console.log(JSON.stringify({ tables: report, integrity, samples }, null, 2));
  const physicalQty = mapped.transactionLines
    .filter(row => row.line_type === 'RETURN_ITEM' && !row.is_cogs)
    .reduce((sum,row) => sum + units(row.quantity), 0n);
  const glDebit = mapped.accountingLines.reduce((sum,row) => sum + units(row.debit), 0n);
  const glCredit = mapped.accountingLines.reduce((sum,row) => sum + units(row.credit), 0n);
  console.log(`SALES RETURN SOURCE EVIDENCE headers=${mapped.headers.length} lines=${mapped.transactionLines.length} gl=${mapped.accountingLines.length} links=${mapped.sourceLinks.length} physical_qty=${formatUnits(physicalQty)} gl_debit=${formatUnits(glDebit)} gl_credit=${formatUnits(glCredit)}`);

  if (failed) throw Error('SALES RETURN CHECK FAILED');
  console.log('SALES RETURN CHECK PASS (four-table field-by-field + source invariants + integrity)');
}

main().catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
