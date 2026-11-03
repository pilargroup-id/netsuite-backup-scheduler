// Module 15: target-specific deletedrecord identity verification. Strictly read-only.
import { token, fetchAll } from '../../common/netsuite-client.mjs';

const EXPECTED_RECORDTYPE = 'inventoryadjustment';
const EXPECTED_TYPE = 'INVENTORYADJUSTMENT';
const LIVE_TYPE = 'InvAdjst';
// Distinct historical deleted Inventory Adjustments observed in Phase K discovery.
const PROOF_IDS = ['178', '187', '188', '189', '200', '212', '1462', '1928', '1949', '1951', '2545', '3120'];
const clean = x => String(x ?? '').trim();
const goodId = x => /^[1-9][0-9]{0,14}$/.test(clean(x));
const assert = (condition, reason) => { if (!condition) throw new Error(`MODULE 15 IDENTITY VERIFICATION BLOCKED: ${reason}`); };

async function main() {
  assert(process.argv.length === 2, 'unexpected arguments; read-only only');
  console.log('MODULE 15 TARGETED INVENTORYADJUSTMENT DELETION IDENTITY | STRICT READ ONLY');
  console.log('ZERO BQ WRITES / ZERO CHECKPOINT CHANGES / ZERO SCHEDULER CHANGES');
  const auth = await token();
  console.log('OAuth: SUCCESS');
  let positives = 0;
  let failed = 0;
  const proofs = [];
  for (const id of PROOF_IDS) {
    assert(goodId(id), 'invalid historical ID');
    try {
      // Query by exact record ID, then require the full identity tuple. IDs can overlap across record types.
      const records = await fetchAll(auth, `SELECT recordid,recordtypeid,type,name,deleteddate FROM deletedrecord WHERE recordid=${id}`);
      const matching = records.filter(r => clean(r.recordid) === id && clean(r.recordtypeid).toLowerCase() === EXPECTED_RECORDTYPE && clean(r.type).toUpperCase() === EXPECTED_TYPE && Boolean(clean(r.deleteddate)));
      const visible = await fetchAll(auth, `SELECT id,type FROM Transaction WHERE id=${id}`);
      const stillLive = visible.some(r => clean(r.id) === id && clean(r.type) === LIVE_TYPE);
      const passed = matching.length === 1 && !stillLive;
      if (passed) positives++; else failed++;
      const result = {recordId:id,matchingProofRows:matching.length, otherRecordTypeRows:records.length - matching.length,liveInvAdjstRows:visible.filter(r => clean(r.type) === LIVE_TYPE).length,deletedDate:matching.length === 1 ? clean(matching[0].deleteddate) : null,passed};
      proofs.push(result);
      console.log('TARGET_PROOF', JSON.stringify(result));
    } catch (error) {
      failed++;
      console.log('TARGET_PROOF_QUERY_FAILED', JSON.stringify({recordId:id,error:String(error?.message ?? error)}));
    }
  }
  // Negative control selects a genuinely live Inventory Adjustment; must have no same-tuple deletion evidence.
  const live = await fetchAll(auth, `SELECT id,type FROM Transaction WHERE type='${LIVE_TYPE}' AND trandate >= TO_DATE('2026-10-01','YYYY-MM-DD') AND ROWNUM <= 1`);
  assert(live.length === 1 && goodId(live[0].id) && clean(live[0].type) === LIVE_TYPE, 'live negative control unavailable');
  const liveId = clean(live[0].id);
  const neg = await fetchAll(auth, `SELECT recordid,recordtypeid,type,deleteddate FROM deletedrecord WHERE recordid=${liveId}`);
  const colliding = neg.filter(r => clean(r.recordid) === liveId && clean(r.recordtypeid).toLowerCase() === EXPECTED_RECORDTYPE && clean(r.type).toUpperCase() === EXPECTED_TYPE && Boolean(clean(r.deleteddate)));
  console.log('NEGATIVE_CONTROL', JSON.stringify({liveTransactionId:liveId,matchingDeletedProof:colliding.length,passed:colliding.length === 0}));
  const passed = positives >= 3 && failed === 0 && colliding.length === 0;
  console.log('MODULE 15 TARGETED IDENTITY RESULT', JSON.stringify({expectedRecordTypeId:EXPECTED_RECORDTYPE,expectedDeletedRecordType:EXPECTED_TYPE,liveTransactionType:LIVE_TYPE,positives,failed,negativeControlPassed:colliding.length === 0,identityCandidateVerified:passed,identityCertified:false,deletionAuthorized:false,bqWrites:0,checkpointChanges:0,schedulerChanges:0}));
  if (!passed) { console.log('MODULE 15 TARGETED IDENTITY BLOCKED: NOT CERTIFIED'); process.exitCode = 3; }
  else console.log('MODULE 15 TARGETED IDENTITY EVIDENCE PASS: READY FOR SEPARATE CERTIFICATION; NO DELETION AUTHORIZED');
}
main().catch(err => { console.error('MODULE 15 TARGETED IDENTITY ERROR',err?.stack ?? String(err)); process.exitCode=1; });
