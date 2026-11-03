import { validateNumericRows } from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataset, DATASET, LOCATION, T, query } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, fetchLines, fetchGL, fetchSourceLinks, mapSource } from './mapping.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const SYNC = process.argv.includes('--sync');
const TIMING = process.argv.includes('--timing');
const PERF_START = process.hrtime.bigint();
function elapsedMs(start) { return Number(process.hrtime.bigint() - start) / 1e6; }
function perf(label, value) {
  if (TIMING) console.log(`[SR-PERF] ${label} ${value.toFixed(1)}ms since_start=${elapsedMs(PERF_START).toFixed(1)}ms`);
}
async function timed(label, run) {
  const start = process.hrtime.bigint();
  try {
    return await run();
  } finally {
    perf(label, elapsedMs(start));
  }
}

if (DRY_RUN === SYNC) throw Error('Specify exactly one: --dry-run OR --sync');

const C = 'sync_checkpoints';
const groups = [
  {
    table: 'sales_return_headers',
    source: 'headers',
    key: ['internal_id'],
    parent: null,
    fields: [
      ['internal_id','STRING'],['receipt_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],
      ['status','STRING'],['customer_id','STRING'],['customer_name','STRING'],['memo','STRING'],['subsidiary_id','STRING']
    ]
  },
  {
    table: 'sales_return_lines',
    source: 'transactionLines',
    key: ['return_internal_id','line_unique_key'],
    parent: 'return_internal_id',
    fields: [
      ['return_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],['line_number','STRING'],['line_type','STRING'],
      ['item_id','STRING'],['quantity','NUMERIC'],['rate','NUMERIC'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC'],
      ['location_id','STRING'],['units_id','STRING'],['is_cogs','BOOL'],['accounting_line_type','STRING']
    ]
  },
  {
    table: 'sales_return_accounting_lines',
    source: 'accountingLines',
    key: ['return_internal_id','accounting_book_id','line_id','account_id'],
    parent: 'return_internal_id',
    fields: [
      ['return_internal_id','STRING'],['accounting_book_id','STRING'],['line_id','STRING'],['account_id','STRING'],
      ['debit','NUMERIC'],['credit','NUMERIC'],['posting','BOOL']
    ]
  },
  {
    table: 'sales_return_source_links',
    source: 'sourceLinks',
    key: ['return_internal_id','source_internal_id','link_type'],
    parent: 'return_internal_id',
    fields: [
      ['return_internal_id','STRING'],['source_internal_id','STRING'],['source_type','STRING'],['source_number','STRING'],['source_date','DATE'],['link_type','STRING']
    ]
  }
];

const names = groups.map(g => g.table);
const cpList = names.map(name => `'${name}'`).join(',');
const columns = g => g.fields.map(([name]) => name);

function overlap(value) {
  const d = new Date(value.replace(' ','T') + 'Z');
  if (Number.isNaN(+d)) throw Error(`Invalid checkpoint ${value}`);
  return new Date(+d - 300000).toISOString().slice(0,19).replace('T',' ');
}

async function checkpoints() {
  return query(`SELECT record_type,FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS modified FROM ${T(C)} WHERE record_type IN (${cpList})`);
}

const RETRY_DELAYS_MS = [1500, 3500, 7000];
function isCheckpointConflict(error) {
  const message = String(error?.message ?? error);
  return /transaction is aborted due to concurrent update against table/i.test(message) && /netsuite_backup[.:]sync_checkpoints/i.test(message);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function atomicCommitWithGuard(sql, params, originalCheckpoint) {
  for (let attempt = 0; ; attempt++) {
    try { return await query(sql, params); }
    catch (error) {
      if (!isCheckpointConflict(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
      const latest = await checkpoints();
      const expected = originalCheckpoint ? groups.length : 0;
      if (latest.length !== expected || new Set(latest.map(r => r.record_type)).size !== latest.length || latest.some(r => !names.includes(r.record_type) || r.modified !== originalCheckpoint)) {
        throw new Error(`Sales Return checkpoint changed after aborted transaction (before=${originalCheckpoint ?? 'INITIAL'}). Refusing replay; run fresh --dry-run and --sync.`, { cause: error });
      }
      const wait = RETRY_DELAYS_MS[attempt];
      console.warn(`Sales Return checkpoint write conflict; transaction aborted. Retry ${attempt + 1}/${RETRY_DELAYS_MS.length} after ${wait}ms (staging retained).`);
      await sleep(wait);
    }
  }
}

async function ensureTables() {
  const [hasCP] = await dataset.table(C).exists();
  if (!hasCP) throw Error('Shared sync_checkpoints missing; refusing to create it');

  for (const g of groups) {
    const defs = g.fields.map(([name,type]) => `${name} ${type}${g.key.includes(name) ? ' NOT NULL' : ''}`).join(',');
    const extra = g === groups[0]
      ? ',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP'
      : ',synced_at TIMESTAMP';
    const partition = g === groups[0] ? ' PARTITION BY transaction_date' : '';
    const cluster = g === groups[0] ? ' CLUSTER BY internal_id' : ` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
    await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
  }
}

async function stage(name, rows, fields) {
  validateNumericRows(rows, fields, { module: 'sales-return' });
  if (!rows.length) {
    await query(`CREATE TABLE ${T(name)} AS SELECT ${fields.map(([k,t]) => `CAST(NULL AS ${t}) AS ${k}`).join(',')} FROM UNNEST([1]) AS dummy WHERE FALSE`);
    return;
  }
  const filename = path.join(os.tmpdir(), `netsuite-sales-return-${crypto.randomUUID()}.ndjson`);
  await fs.writeFile(filename, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
  try {
    await dataset.table(name).load(filename, {
      sourceFormat: 'NEWLINE_DELIMITED_JSON',
      writeDisposition: 'WRITE_TRUNCATE',
      schema: { fields: fields.map(([fieldName,type]) => ({ name: fieldName, type })) },
      location: LOCATION
    });
  } finally {
    await fs.rm(filename, { force: true });
  }
  const [count] = await query(`SELECT COUNT(*) AS n FROM ${T(name)}`);
  if (Number(count.n) !== rows.length) throw Error(`Stage count mismatch ${name}`);
}

async function main() {
  console.log(`SALES RETURN | ${DRY_RUN ? 'DRY RUN' : 'PRODUCTION SYNC'} | ${DATASET} | ${LOCATION}`);

  const [hasCP] = await timed('checkpoint_table_exists', () => dataset.table(C).exists());
  if (!hasCP) throw Error('Shared sync_checkpoints missing');
  const cp = await timed('checkpoint_read', () => checkpoints());
  if (cp.length !== 0 && cp.length !== groups.length) throw Error('Partial Sales Return checkpoints; refuse to continue');
  if (new Set(cp.map(row => row.record_type)).size !== cp.length) throw Error('Duplicate Sales Return checkpoints');
  const baseline = cp.length ? cp[0].modified : null;
  if (cp.some(row => row.modified !== baseline)) throw Error('Sales Return checkpoints diverged');
  const since = baseline ? overlap(baseline) : null;

  const access = await timed('netsuite_oauth', () => token());
  const headers = await timed('netsuite_headers', () => fetchHeaders(access, since));
  const ids = headers.map(row => row.internal_id);
  const [lines, gl, links] = ids.length
    ? await Promise.all([
        timed('netsuite_lines', () => fetchLines(access, ids)),
        timed('netsuite_gl', () => fetchGL(access, ids)),
        timed('netsuite_source_links', () => fetchSourceLinks(access, ids))
      ])
    : [[], [], []];
  const mapStart = process.hrtime.bigint();
  const mapped = mapSource(headers, lines, gl, links);
  perf('map_and_decimal', elapsedMs(mapStart));
  const counts = Object.fromEntries(groups.map(g => [g.table, mapped[g.source].length]));
  console.log('Source mapped:', JSON.stringify(counts));
  console.log(`Checkpoint=${baseline ?? 'INITIAL'}; overlap from=${since ?? 'FULL OCTOBER'}`);

  // October source was previously certified by read-only probe. Empty initial source is a permission/workflow regression.
  if (!baseline && !headers.length) throw Error('Initial Sales Return source empty; verify CostRtrn ItemRcpt workflow and permissions before DDL/checkpoint');
  if (DRY_RUN) {
    console.log('DRY RUN PASS: source validated; inventory-cost decimals preserved exactly; BigQuery/checkpoints unchanged.');
    perf('dry_run_total', elapsedMs(PERF_START));
    return;
  }
  if (baseline && !headers.length) {
    console.log('SALES RETURN NO CHANGES: SUCCESS; checkpoint not moved');
    return;
  }

  await timed('ensure_tables', () => ensureTables());
  const suffix = crypto.randomUUID().replaceAll('-','').slice(0,20);
  const stages = groups.map((g,index) => ({ ...g, stageName: `_stage_sr_${index}_${suffix}` }));

  try {
    for (const g of stages) await timed(`stage_${g.table}`, () => stage(g.stageName, mapped[g.source], g.fields));
    const watermark = headers.map(row => row.last_modified).filter(Boolean).sort().at(-1);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(watermark ?? '')) throw Error('Invalid Sales Return source watermark');

    const stageChecks = stages.map(g => {
      const key = g.key.join(',');
      const count = mapped[g.source].length;
      return `ASSERT (SELECT COUNT(*) FROM ${T(g.stageName)})=${count} AS 'Stage row count mismatch ${g.table}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${key} FROM ${T(g.stageName)} GROUP BY ${key} HAVING COUNT(*)>1))=0 AS 'Duplicate stage key ${g.table}';`;
    }).join('\n');

    const mutations = stages.map((g,index) => {
      const fields = columns(g);
      if (index === 0) {
        return `MERGE ${T(g.table)} d USING ${T(g.stageName)} s ON d.internal_id=s.internal_id
WHEN MATCHED AND COALESCE(d.is_deleted,FALSE)=FALSE THEN UPDATE SET ${fields.filter(f => f !== 'internal_id').map(f => `${f}=s.${f}`).join(',')},synced_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(${fields.join(',')},synced_at,is_deleted,deleted_at) VALUES(${fields.map(f => `s.${f}`).join(',')},CURRENT_TIMESTAMP(),FALSE,NULL);`;
      }
      return `DELETE FROM ${T(g.table)} WHERE ${g.parent} IN (SELECT internal_id FROM ${T(stages[0].stageName)});
INSERT INTO ${T(g.table)} (${fields.join(',')},synced_at) SELECT ${fields.join(',')},CURRENT_TIMESTAMP() FROM ${T(g.stageName)};`;
    }).join('\n');

    const checkpointGuard = baseline
      ? `ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}) AND last_successful_modified_at=DATETIME('${baseline}'))=${groups.length} AS 'Sales Return checkpoint advanced';`
      : '';

    const checkpointSql = `MERGE ${T(C)} d USING (SELECT record_type FROM UNNEST([${cpList}]) AS record_type) s ON d.record_type=s.record_type
WHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());`;

    const orphanChecks = stages.slice(1).map(g => `ASSERT (SELECT COUNT(*) FROM ${T(g.table)} d LEFT JOIN ${T(stages[0].table)} h ON h.internal_id=d.${g.parent} WHERE h.internal_id IS NULL)=0 AS 'Orphan ${g.table}';`).join('\n');

    const sql = `BEGIN
BEGIN TRANSACTION;
${stageChecks}
ASSERT (SELECT COUNT(*) FROM ${T(C)} WHERE record_type IN (${cpList}))=${baseline ? groups.length : 0} AS 'Sales Return checkpoint row count changed';
${checkpointGuard}
${mutations}
${checkpointSql}
${orphanChecks}
COMMIT TRANSACTION;
EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
END;`;

    await timed('atomic_commit_with_retry', () => atomicCommitWithGuard(sql, { wm: watermark }, baseline));
    console.log('ATOMIC MERGE + DETAIL REPLACE + FOUR CHECKPOINTS: SUCCESS');
    console.log('SALES RETURN SYNC SUCCESS; RUN presence/check/check-financial; NOT FINAL_PASS');
  } finally {
    for (const g of stages) {
      try { await timed(`cleanup_${g.table}`, () => dataset.table(g.stageName).delete({ ignoreNotFound: true })); }
      catch (error) { console.error('Stage cleanup warning', g.stageName, error.message); }
    }
  }
  perf('sync_total', elapsedMs(PERF_START));
}

main().catch(error => {
  console.error('SALES RETURN ERROR:', error.stack ?? error);
  process.exitCode = 1;
});
