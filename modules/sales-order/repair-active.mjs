import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { bq, DATASET, LOCATION, FROM, TO, T, N, token, fetchAll, fetchLines, mapSource, query } from './mapping.mjs';

// V5.2.2 targeted ACTIVE SO revalidation/repair. No checkpoint updates. Guarded independent source checks.
const args = process.argv.slice(2);
const at = args.indexOf('--id');
const rawId = at >= 0 ? args[at + 1] : undefined;
const apply = args.includes('--apply');
const dry = args.includes('--dry-run');
if (at < 0 || args.filter(x => x === '--id').length !== 1 || !/^[1-9][0-9]{0,14}$/.test(rawId ?? '') ||
    (apply && dry) || args.some((x, i) => i !== at + 1 && !['--id','--apply','--dry-run'].includes(x))) {
  console.error('Usage: node modules/sales-order/repair-active.mjs --id 3152083 [--dry-run|--apply]');
  process.exit(2);
}
const id = String(rawId);
if (!Number.isSafeInteger(Number(id))) throw new Error('Unsafe ID');
const H = T('sales_order_headers');
const L = T('sales_order_lines');
const dataset = bq.dataset(DATASET);
const HEADER_FIELDS = ['internal_id','tranid','transaction_date','status','customer_id','subsidiary_id','currency_id','total_amount','last_modified'];
const LINE_FIELDS = ['sales_order_internal_id','line_unique_key','line_id','line_type','item_id','item_type','accounting_line_type','quantity','rate','foreign_amount','net_amount','tax_amount','location_id','units_id','memo','is_closed','last_modified'];
const HEADER_SCHEMA = [
  ['internal_id','STRING'],['tranid','STRING'],['transaction_date','DATE'],['status','STRING'],
  ['customer_id','STRING'],['subsidiary_id','STRING'],['currency_id','STRING'],
  ['total_amount','NUMERIC'],['last_modified','DATETIME']
];
const LINE_SCHEMA = [
  ['sales_order_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],
  ['line_type','STRING'],['item_id','STRING'],['item_type','STRING'],['accounting_line_type','STRING'],
  ['quantity','NUMERIC'],['rate','NUMERIC'],['foreign_amount','NUMERIC'],
  ['net_amount','NUMERIC'],['tax_amount','NUMERIC'],['location_id','STRING'],
  ['units_id','STRING'],['memo','STRING'],['is_closed','BOOLEAN'],['last_modified','DATETIME']
];

async function state() {
  const rows = await query(`SELECT internal_id, is_deleted, FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', last_modified) AS modified
    FROM ${H} WHERE internal_id = '${id}'`);
  if (rows.length > 1) throw new Error('Duplicate SO headers; abort');
  return rows[0] ?? null;
}
async function source(access) {
  const headers = await fetchAll(access, `SELECT id, tranid, status, entity, currency, foreigntotal,
    TO_CHAR(trandate, 'YYYY-MM-DD') AS transaction_date,
    TO_CHAR(lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS last_modified
    FROM Transaction WHERE type = 'SalesOrd' AND id = ${id}`);
  if (headers.length !== 1) throw new Error('SO NOT_VISIBLE_IN_NETSUITE: recovery forbidden');
  if (headers[0].transaction_date < FROM || headers[0].transaction_date >= TO) {
    throw new Error(`SO outside October window (${headers[0].transaction_date}); review manually`);
  }
  const rawLines = await fetchLines(access, [id]);
  const data = mapSource(headers, rawLines);
  if (data.headers.length !== 1 || data.headers[0].internal_id !== id || data.lines.length === 0) {
    throw new Error('SO source has invalid/empty details');
  }
  for (const row of data.lines) {
    if (row.sales_order_internal_id !== id) throw new Error('Foreign SO line');
  }
  return data;
}
function stable(data) {
  return JSON.stringify({ headers: data.headers, lines: [...data.lines].sort((a,b) =>
    a.line_unique_key.localeCompare(b.line_unique_key, 'en', {numeric:true})) });
}
async function stage(name, rows, schema, dir) {
  const local = path.join(dir, `${name}.ndjson`);
  await fs.writeFile(local, rows.map(x => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 });
  await dataset.table(name).load(local, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON', writeDisposition: 'WRITE_TRUNCATE',
    schema: { fields: schema.map(([field,type]) => ({name:field,type})) },
    location: LOCATION, ignoreUnknownValues:false, maxBadRecords:0
  });
  const [r] = await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);
  if (N(r.n) !== rows.length) throw new Error('Staging row count mismatch');
}
async function commit(hs, ls, expectedState, lineCount) {
  const predicate = `(SELECT COUNT(*) FROM ${H} WHERE internal_id = '${id}' AND COALESCE(is_deleted,FALSE)=FALSE AND FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_modified) = '${expectedState}')=1`;
  const changes = HEADER_FIELDS.filter(x => x !== 'internal_id').map(x => `d.${x} = s.${x}`);
  changes.push('d.synced_at = CURRENT_TIMESTAMP()', 'd.is_deleted = FALSE', 'd.deleted_at = NULL');
  const sql = `BEGIN
    BEGIN TRANSACTION;
    ASSERT ${predicate} AS 'Header state changed; abort recovery';
    ASSERT (SELECT COUNT(*) FROM ${T(hs)}) = 1 AS 'Staging header count changed';
    ASSERT (SELECT COUNT(*) FROM ${T(ls)}) = ${lineCount} AS 'Staging line count changed';
    ASSERT (SELECT COUNT(*) FROM (SELECT line_unique_key FROM ${T(ls)} GROUP BY 1 HAVING COUNT(*) > 1)) = 0 AS 'Duplicate staged line';
    MERGE ${H} d USING ${T(hs)} s ON d.internal_id = s.internal_id
    WHEN MATCHED THEN UPDATE SET ${changes.join(', ')}
    WHEN NOT MATCHED THEN INSERT (${HEADER_FIELDS.join(', ')}, synced_at, is_deleted, deleted_at)
    VALUES (${HEADER_FIELDS.map(x => `s.${x}`).join(', ')}, CURRENT_TIMESTAMP(), FALSE, NULL);
    DELETE FROM ${L} WHERE sales_order_internal_id = '${id}';
    INSERT INTO ${L} (${LINE_FIELDS.join(', ')}, synced_at)
    SELECT ${LINE_FIELDS.join(', ')}, CURRENT_TIMESTAMP() FROM ${T(ls)};
    ASSERT (SELECT COUNT(*) FROM ${H} WHERE internal_id = '${id}' AND is_deleted = FALSE) = 1 AS 'Header restore failed';
    ASSERT (SELECT COUNT(*) FROM ${L} WHERE sales_order_internal_id = '${id}') = ${lineCount} AS 'Line count mismatch';
    COMMIT TRANSACTION;
  EXCEPTION WHEN ERROR THEN
    ROLLBACK TRANSACTION;
    RAISE;
  END;`;
  await query(sql);
}
async function main() {
  console.log(`SO ACTIVE REFRESH | ID ${id} | ${apply ? 'APPLY' : 'READ ONLY'}`);
  console.log('Checkpoint: NEVER MODIFIED');
  const access = await token();
  console.log('NetSuite OAuth: SUCCESS');
  const previous = await state();
  console.log(`BigQuery header: ${previous ? (previous.is_deleted === true ? 'SOFT_DELETED' : 'ACTIVE') : 'MISSING'}`);
  if (!previous || previous.is_deleted === true) throw new Error('Expected exactly one ACTIVE BQ header; use original recover.mjs for missing/deleted');
  const data = await source(access);
  const action = 'REFRESH';
  console.log(`SOURCE VALIDATION: PASS | 1 header | ${data.lines.length} lines`);
  console.log(`ACTION: ${action}`);
  if (!apply) {
    console.log('DRY RUN PASS: BigQuery unchanged');
    return;
  }
  const fresh = await source(access);
  if (stable(data) !== stable(fresh)) throw new Error('Source changed during recovery; retry');
  const tag = crypto.randomUUID().replaceAll('-','').slice(0,20);
  const hs = `_so_rec_h_${tag}`, ls = `_so_rec_l_${tag}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'so-recovery-'));
  const staged = [];
  try {
    staged.push(hs);
    await stage(hs, fresh.headers, HEADER_SCHEMA, temp);
    staged.push(ls);
    await stage(ls, fresh.lines, LINE_SCHEMA, temp);
    console.log('STAGING VALIDATION: PASS');
    await commit(hs, ls, previous.modified, fresh.lines.length);
    console.log(`ATOMIC ${action}: SUCCESS | header + ${fresh.lines.length} lines | checkpoint unchanged`);
  } finally {
    for (const name of staged) {
      try { await dataset.table(name).delete({ignoreNotFound:true}); }
      catch (e) { console.error(`Cleanup warning: ${name}: ${e.message}`); }
    }
    await fs.rm(temp,{recursive:true,force:true});
  }
}
main().catch(err => { console.error('SO ACTIVE REFRESH ERROR:',err); process.exitCode=1; });
