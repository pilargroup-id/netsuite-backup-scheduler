// Module 14: Inventory Transfer deletion candidate inventory. STRICT READ ONLY.
// Source absence is NEVER sufficient deletion proof. No automatic soft-delete.
import { token, fetchHeaders } from './mapping.mjs';
import { query, T } from '../../common/bigquery-client.mjs';

const assert = (ok, message) => { if (!ok) throw Error('MODULE 14 DELETION INVENTORY BLOCKED: ' + message); };
const normalizeId = value => {
  const id = String(value ?? '');
  assert(/^[1-9][0-9]*$/.test(id), 'invalid transaction id ' + id);
  return id;
};

async function main() {
  assert(process.argv.length === 3 && process.argv[2] === '--dry-run', 'usage: node modules/inventory-transfer/deletion-inventory.mjs --dry-run');
  console.log('MODULE 14 INVENTORY TRANSFER DELETION INVENTORY | STRICT READ ONLY');
  console.log('NO BIGQUERY WRITES / NO CHECKPOINT CHANGES / NO SCHEDULER CHANGES');
  const access = await token();
  console.log('OAuth: SUCCESS');
  const headers = await fetchHeaders(access);
  const sourceIds = headers.map(h => normalizeId(h.internal_id));
  const stored = await query(`SELECT CAST(internal_id AS STRING) AS internal_id, is_deleted, deleted_at FROM ${T('inventory_transfer_headers')}`);
  const targetIds = stored.filter(r => r.is_deleted !== true && String(r.is_deleted).toLowerCase() !== 'true').map(r => normalizeId(r.internal_id));
  const source = new Set(sourceIds);
  const target = new Set(targetIds);
  const duplicateSource = source.size !== sourceIds.length;
  const duplicateTarget = target.size !== targetIds.length;
  const missingBQ = [...source].filter(id => !target.has(id)).sort();
  const absentSource = [...target].filter(id => !source.has(id)).sort();
  const flagAnomalies = stored.filter(r =>
    (r.is_deleted === true || String(r.is_deleted).toLowerCase() === 'true') !== (r.deleted_at != null)
  ).map(r => String(r.internal_id));
  const status = duplicateSource || duplicateTarget || missingBQ.length || flagAnomalies.length
    ? 'BLOCKED'
    : absentSource.length ? 'UNVERIFIED_CANDIDATES' : 'CLEAN';
  const result = {
    status, sourceHeaders: sourceIds.length, bqActiveHeaders: targetIds.length,
    duplicateSource, duplicateTarget, activeBQAbsentFromSource: absentSource.length,
    absentSourceSamples: absentSource.slice(0, 20), sourceAbsentFromBQ: missingBQ.length,
    sourceAbsentFromBQSamples: missingBQ.slice(0, 20), deletionFlagAnomalies: flagAnomalies.length,
    flagAnomalySamples: flagAnomalies.slice(0, 20),
    independentDeletedRecordProof: false, identityCertified: false,
    maxApplyBatch: 3, applyAuthorized: false, bqWrites: 0,
    deletionOperations: 0, checkpointChanges: 0, schedulerChanges: 0
  };
  console.log('MODULE 14 DELETION INVENTORY', JSON.stringify(result));
  if (status === 'BLOCKED') process.exitCode = 2;
  else if (status === 'UNVERIFIED_CANDIDATES') {
    console.log('CANDIDATES ONLY. No deletion permitted without exact independent deletedrecord tuple, fresh source-absence proof, and separate certification.');
  } else console.log('MODULE 14 DELETION INVENTORY PASS: NO CANDIDATES; ZERO WRITES');
}

main().catch(error => { console.error('MODULE 14 DELETION INVENTORY ERROR', error.stack ?? error); process.exitCode = 1; });
