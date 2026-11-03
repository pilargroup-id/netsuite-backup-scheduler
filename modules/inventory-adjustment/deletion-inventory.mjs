// Module 15 Inventory Adjustment deletion inventory. STRICT READ ONLY.
// Absence from source is never deletion proof. No mutations permitted.
import { token, fetchHeaders } from './mapping.mjs';
import { query, T } from '../../common/bigquery-client.mjs';

const must = (ok, reason) => { if (!ok) throw Error('MODULE 15 DELETION INVENTORY BLOCKED: ' + reason); };
const normId = value => {
  const id = String(value ?? '').trim();
  must(/^[1-9][0-9]*$/.test(id), 'invalid header internal_id ' + id);
  return id;
};
const deleted = value => value === true || String(value).toLowerCase() === 'true';

async function main() {
  must(process.argv.length === 3 && process.argv[2] === '--dry-run', 'usage: node modules/inventory-adjustment/deletion-inventory.mjs --dry-run');
  console.log('MODULE 15 INVENTORY ADJUSTMENT DELETION INVENTORY | STRICT READ ONLY');
  console.log('SOURCE ABSENCE IS NOT DELETION PROOF | ZERO WRITES | NO SCHEDULER CHANGES');
  const access = await token();
  console.log('OAuth: SUCCESS');
  const sourceRows = await fetchHeaders(access);
  const sourceIds = sourceRows.map(row => normId(row.internal_id));
  const stored = await query(`SELECT CAST(internal_id AS STRING) AS internal_id, is_deleted, deleted_at FROM ${T('inventory_adjustment_headers')}`);
  const source = new Set(sourceIds);
  const activeRows = stored.filter(row => !deleted(row.is_deleted));
  const activeIds = activeRows.map(row => normId(row.internal_id));
  const active = new Set(activeIds);
  const duplicateSource = source.size !== sourceIds.length;
  const duplicateActiveBQ = active.size !== activeIds.length;
  const missingBQ = [...source].filter(id => !active.has(id)).sort();
  const absentSource = [...active].filter(id => !source.has(id)).sort();
  const deletionFlagAnomalies = stored.filter(row => deleted(row.is_deleted) !== (row.deleted_at != null)).map(row => String(row.internal_id));
  const status = (duplicateSource || duplicateActiveBQ || missingBQ.length || deletionFlagAnomalies.length)
    ? 'BLOCKED' : absentSource.length ? 'UNVERIFIED_CANDIDATES' : 'CLEAN';
  const result = {
    status, sourceHeaders: sourceIds.length, bqActiveHeaders: activeIds.length,
    duplicateSource, duplicateActiveBQ,
    sourceAbsentFromBQ: missingBQ.length, sourceAbsentFromBQSamples: missingBQ.slice(0, 20),
    activeBQAbsentFromSource: absentSource.length, absentSourceSamples: absentSource.slice(0, 20),
    deletionFlagAnomalies: deletionFlagAnomalies.length, flagAnomalySamples: deletionFlagAnomalies.slice(0, 20),
    independentDeletedRecordProof: false, identityCertified: false, deleteAuthorized: false,
    maxApplyBatch: 3, bqWrites: 0, checkpointChanges: 0, schedulerChanges: 0, otherModuleWrites: 0
  };
  console.log('MODULE 15 DELETION INVENTORY', JSON.stringify(result));
  if (status === 'BLOCKED') {
    console.log('MODULE 15 DELETION INVENTORY BLOCKED: reconcile anomalies read-only before proceeding');
    process.exitCode = 2;
  } else if (status === 'UNVERIFIED_CANDIDATES') {
    console.log('UNVERIFIED CANDIDATES ONLY: no deletion without independent exact deletedrecord tuple and live nonvisibility evidence.');
  } else {
    console.log('MODULE 15 PHASE J DELETION INVENTORY PASS: CLEAN; ZERO WRITES');
  }
}
main().catch(error => { console.error('MODULE 15 PHASE J ERROR', error?.stack ?? error); process.exitCode = 1; });
