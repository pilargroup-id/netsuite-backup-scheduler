// October 2026 Item Fulfillment accounting reconciliation.
// Read-only by default. Apply one verified document at a time with --id N --apply.
// Does NOT touch checkpoints, historical/deleted documents, or SI/SO.
import { token, fetchAll } from '../../common/netsuite-client.mjs';
import { query, T } from '../../common/bigquery-client.mjs';
import { buildData } from './mapping.mjs';

const FROM = '2026-10-01';
const TO = '2026-11-01';
const apply = process.argv.includes('--apply');
const idArg = process.argv.indexOf('--id');
const selected = idArg === -1 ? null : process.argv[idArg + 1];
if (selected !== null && !/^[1-9][0-9]*$/.test(selected)) throw new Error('Usage: --id <positive integer>');
if (apply && !selected) throw new Error('--apply requires --id; bulk writes are disabled');
const cents = v => Math.round(Number(v ?? 0) * 100);
const numericId = v => { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`Invalid ID ${v}`); return n; };
const batches = (a, size) => Array.from({length: Math.ceil(a.length / size)}, (_, i) => a.slice(i * size, (i + 1) * size));

async function sourceHeaders(access) {
  const only = selected ? `AND t.id = ${numericId(selected)}` : '';
  return fetchAll(access, `SELECT t.id AS internal_id, t.tranid AS fulfillment_number,
    TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,
    BUILTIN.DF(t.postingperiod) AS posting_period,
    BUILTIN.DF(t.status) AS status,
    TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS netsuite_last_modified_at
    FROM Transaction t WHERE t.type='ItemShip'
    AND t.trandate >= TO_DATE('${FROM}','YYYY-MM-DD')
    AND t.trandate < TO_DATE('${TO}','YYYY-MM-DD') ${only} ORDER BY t.id`);
}
async function details(access, ids, kind) {
  const out = [];
  for (const batch of batches(ids, 25)) {
    const list = batch.map(numericId).join(',');
    const sql = kind === 'lines'
      ? `SELECT transaction,id,uniquekey,linesequencenumber,item,mainline,taxline,iscogs,accountinglinetype,quantity,rate,units,location,entity,createdfrom FROM TransactionLine WHERE transaction IN (${list}) ORDER BY transaction,id`
      : `SELECT transaction,transactionline,accountingbook,posting,account,debit,credit,netamount FROM TransactionAccountingLine WHERE transaction IN (${list}) ORDER BY transaction,transactionline`;
    out.push(...await fetchAll(access, sql));
  }
  return out;
}

async function activeBQHeaders() {
  const filter = selected ? `AND internal_id = ${numericId(selected)}` : '';
  return query(`SELECT internal_id, fulfillment_number, CAST(total_cogs_amount AS STRING) AS cogs,
    FORMAT_DATETIME('%Y-%m-%d %H:%M:%S', netsuite_last_modified_at) AS modified
    FROM ${T('item_fulfillment_headers')}
    WHERE transaction_date >= DATE '${FROM}' AND transaction_date < DATE '${TO}'
    AND COALESCE(is_deleted,FALSE)=FALSE ${filter}`);
}

async function reconcileOne(header, docLines, target) {
  const id = numericId(header.internal_id);
  const data = { lineRows: docLines };
  if (!data.lineRows.length) throw new Error(`Incomplete source details for ${id}`);
  const before = cents(target.cogs);
  const after = cents(header.total_cogs_amount);
  const diff = (after - before) / 100;
  console.log(`${id} ${header.fulfillment_number}: source=${header.total_cogs_amount} BQ=${target.cogs} diff=${diff.toFixed(2)}`);
  if (before === after) return false;
  if (!apply) return true;

  // Accounting-only repair is safe only when all line keys and quantities already match.
  const existing = await query(`SELECT CAST(line_unique_key AS STRING) AS key,
    CAST(quantity_shipped AS STRING) AS qty, CAST(cogs_amount AS STRING) AS cogs
    FROM ${T('item_fulfillment_lines')} WHERE fulfillment_internal_id = ${id}`);
  const sourceKeys = new Map(data.lineRows.map(l => [String(l.line_unique_key), l]));
  const existingKeys = new Map(existing.map(l => [String(l.key), l]));
  if (sourceKeys.size !== existing.length || existingKeys.size !== existing.length || sourceKeys.size !== existingKeys.size)
    throw new Error(`Line keys/count differ for ${id}; run normal sync or investigate rather than accounting-only apply`);
  for (const [key, line] of sourceKeys) {
    const old = existingKeys.get(key);
    if (!old || Math.abs(Number(old.qty) - Number(line.quantity_shipped)) > 0.000001)
      throw new Error(`Line missing or quantity changed: ${id}:${key}; accounting-only apply aborted`);
  }
  if (target.modified !== header.netsuite_last_modified_at)
    throw new Error(`Header timestamp changed for ${id}; use standard sync first`);

  // Build exact NUMERIC literals only from validated, mapped numeric values.
  const vals = data.lineRows.map(l => {
    const key = numericId(l.line_unique_key);
    const cogs = String(l.cogs_amount);
    if (!/^-?\d+(\.\d+)?$/.test(cogs)) throw new Error(`Invalid COGS ${cogs}`);
    return `STRUCT(${key} AS line_unique_key, NUMERIC '${cogs}' AS cogs_amount)`;
  });
  const amount = String(header.total_cogs_amount);
  const oldAmount = String(target.cogs);
  if (!/^-?\d+(\.\d+)?$/.test(amount) || !/^-?\d+(\.\d+)?$/.test(oldAmount)) throw new Error('Invalid header amount');
  const updated = await query(`BEGIN
    CREATE TEMP TABLE expected AS SELECT * FROM UNNEST([${vals.join(',')}]);
    ASSERT (SELECT COUNT(*) FROM expected) = ${vals.length} AS 'Expected line count incorrect';
    ASSERT (SELECT COUNT(*) FROM ${T('item_fulfillment_lines')} WHERE fulfillment_internal_id = ${id}) = ${vals.length} AS 'BQ line count changed';
    ASSERT (SELECT COUNT(*) FROM ${T('item_fulfillment_lines')} l JOIN expected e ON l.line_unique_key=e.line_unique_key WHERE l.fulfillment_internal_id=${id}) = ${vals.length} AS 'BQ line keys changed';
    BEGIN TRANSACTION;
    ASSERT (SELECT COUNT(*) FROM ${T('item_fulfillment_headers')} WHERE internal_id=${id} AND COALESCE(is_deleted,FALSE)=FALSE AND total_cogs_amount=NUMERIC '${oldAmount}' AND netsuite_last_modified_at=DATETIME '${header.netsuite_last_modified_at}')=1 AS 'Header changed before update';
    UPDATE ${T('item_fulfillment_headers')} SET total_cogs_amount=NUMERIC '${amount}', synced_at=CURRENT_TIMESTAMP() WHERE internal_id=${id} AND COALESCE(is_deleted,FALSE)=FALSE;
    UPDATE ${T('item_fulfillment_lines')} l SET cogs_amount=e.cogs_amount, synced_at=CURRENT_TIMESTAMP() FROM expected e WHERE l.fulfillment_internal_id=${id} AND l.line_unique_key=e.line_unique_key;
    ASSERT (SELECT COALESCE(SUM(cogs_amount),0) FROM ${T('item_fulfillment_lines')} WHERE fulfillment_internal_id=${id})=NUMERIC '${amount}' AS 'Post-write line COGS mismatch';
    COMMIT TRANSACTION;
  EXCEPTION WHEN ERROR THEN
    ROLLBACK TRANSACTION;
    RAISE;
  END;`);
  console.log(`ACCOUNTING REPAIRED: ${id} (header + ${vals.length} lines; checkpoints unchanged)`);
  return true;
}

async function main() {
  console.log(`IF ACCOUNTING RECONCILIATION | ${apply ? 'APPLY' : 'READ ONLY'} | ${selected ?? 'ALL OCTOBER'}`);
  const access = await token();
  console.log('OAuth: SUCCESS');
  const [source, target] = await Promise.all([sourceHeaders(access), activeBQHeaders()]);
  const sourceMap = new Map(source.map(h => [String(h.internal_id), h]));
  const targetMap = new Map(target.map(h => [String(h.internal_id), h]));
  if (!source.length || !target.length || sourceMap.size !== source.length || targetMap.size !== target.length) throw new Error('Empty/duplicate snapshot; aborting');
  const missingSource = [...targetMap.keys()].filter(id => !sourceMap.has(id));
  const missingBQ = [...sourceMap.keys()].filter(id => !targetMap.has(id));
  console.log(`NetSuite=${source.length}, BQ active=${target.length}, missing NS=${missingSource.length}, missing BQ=${missingBQ.length}`);
  if (missingSource.length || missingBQ.length) {
    console.log(`Only BQ: ${missingSource.slice(0,20).join(',') || 'NONE'}`);
    console.log(`Only NS: ${missingBQ.slice(0,20).join(',') || 'NONE'}`);
    throw new Error('Document inventory mismatch; run normal sync/presence first');
  }
  const ids = source.map(h => numericId(h.internal_id));
  const [rawLines, rawGL] = await Promise.all([details(access, ids, 'lines'), details(access, ids, 'gl')]);
  const mapped = buildData(source, rawLines, rawGL);
  const byId = new Map(mapped.headerRows.map(h => [String(h.internal_id), h]));
  const linesById = new Map();
  for (const l of mapped.lineRows) {
    const id = String(l.fulfillment_internal_id);
    if (!linesById.has(id)) linesById.set(id, []);
    linesById.get(id).push(l);
  }
  let count = 0;
  for (const [id, h] of byId) {
    const targetRow = targetMap.get(id);
    if (cents(h.total_cogs_amount) !== cents(targetRow.cogs)) {
      if (await reconcileOne(h, linesById.get(id) ?? [], targetRow)) count++;
    }
  }
  console.log(`ACCOUNTING RECONCILIATION COMPLETE; differences=${count}; mode=${apply ? 'APPLY' : 'READ ONLY'}`);
}
main().catch(err => { console.error('IF ACCOUNTING RECONCILIATION ERROR:', err.stack ?? err); process.exitCode=1; });
