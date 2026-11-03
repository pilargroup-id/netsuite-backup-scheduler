// Purchase Return scheduler gate: read only, no DDL, no checkpoint, no deletion.
// NO_SOURCE is operationally healthy but NEVER FINAL_PASS/SYNC_OK.
import { state } from './audit-common.mjs';
import { token, fetchHeaders } from './mapping.mjs';

async function main() {
  if (process.argv.length !== 2) throw Error('Usage: node modules/purchase-return/scheduler-gate.mjs');
  const s = await state();
  const h = await fetchHeaders(await token());
  const n = h.length;
  console.log(`PURCHASE RETURN SCHEDULER PRECHECK: state=${s.mode}; sourceHeaders=${n}; checkpoints=${s.checkpointRows}`);
  if ((s.mode === 'SCHEMA_ONLY' || s.mode === 'NOT_INITIALIZED') && n === 0) {
    console.log('PURCHASE RETURN GATE: NO_SOURCE');
    return;
  }
  if ((s.mode === 'SCHEMA_ONLY' || s.mode === 'NOT_INITIALIZED') && n > 0) {
    console.log('PURCHASE RETURN GATE: SOURCE_PENDING_INITIAL_SYNC');
    return;
  }
  if (s.mode === 'INITIALIZED') {
    if (s.checkpointRows !== 5 || !s.watermark) throw Error('INVALID_PURCHASE_RETURN_CHECKPOINT');
    console.log('PURCHASE RETURN GATE: READY');
    return;
  }
  throw Error('UNKNOWN_PURCHASE_RETURN_STATE');
}
main().catch(e => {console.error('PURCHASE RETURN GATE ERROR:', e.stack ?? e);process.exitCode=1;});
