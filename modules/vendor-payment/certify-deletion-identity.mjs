// Module 12 Vendor Payment: independent historical deletedrecord identity evidence.
// Strict read-only. Does not authorize deletion apply or expand October backup scope.
import { token } from './mapping.mjs';
import { fetchAll } from '../../common/netsuite-client.mjs';
import { matchDeletedRecordProof } from '../../common/verified-deletion-proof.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--dry-run') {
  throw Error('Usage: node modules/vendor-payment/certify-deletion-identity.mjs --dry-run');
}

const identity = Object.freeze({recordtypeid:'vendorpayment', type:'VENDORPAYMENT'});
const validId = value => /^[1-9][0-9]{0,14}$/.test(String(value ?? ''));
const cap = 3;

async function main() {
  console.log('MODULE 12 DELETEDRECORD IDENTITY CERTIFICATION | READ ONLY');
  console.log('SCOPE: identity discovery only; no historical backfill, no deletion authorization');
  const access = await token();
  console.log('OAuth: SUCCESS');

  // Use the exact tuple, not a fuzzy name/record-type match.
  const evidence = await fetchAll(access,
    "SELECT recordid,recordtypeid,type,name,deleteddate,deletedby,context FROM deletedrecord WHERE recordtypeid = 'vendorpayment' AND type = 'VENDORPAYMENT'");
  const ids = new Set();
  const malformed = [];
  const duplicateIds = [];
  const candidates = [];
  for (const row of evidence) {
    if (!validId(row.recordid)) {malformed.push(String(row.recordid ?? ''));continue;}
    const id = String(row.recordid);
    if (ids.has(id)) duplicateIds.push(id);
    ids.add(id);
    if (matchDeletedRecordProof([row], id, identity).length === 1) candidates.push(row);
  }
  console.log('TUPLE_INVENTORY', JSON.stringify({tuple:identity,rows:evidence.length,validProofRows:candidates.length,distinctIds:ids.size,malformedIds:malformed.slice(0,5),duplicateIds:duplicateIds.slice(0,5)}));
  if (malformed.length || duplicateIds.length || !candidates.length || candidates.length !== evidence.length) {
    throw Error('IDENTITY BLOCKED: no trustworthy unique deletedrecord proof set');
  }

  // Independently verify absence on live Transaction for a bounded set of historic IDs.
  const sample = candidates.slice(0,cap);
  const checks = [];
  for (const row of sample) {
    const id = String(row.recordid);
    const visible = await fetchAll(access, `SELECT id,type FROM Transaction WHERE id = ${id}`);
    const exact = matchDeletedRecordProof([row],id,identity);
    checks.push({recordid:id,recordtypeid:row.recordtypeid,type:row.type,deleteddate:row.deleteddate,exactProof:exact.length===1,sourceAbsent:visible.length===0,visibleRows:visible.length});
  }
  const pass = checks.length > 0 && checks.every(x=>x.exactProof && x.sourceAbsent);
  console.log('INDEPENDENT_SAMPLES',JSON.stringify(checks));
  console.log('PHASE B14 RESULT',JSON.stringify({
    status:pass?'IDENTITY_EVIDENCE_PASS':'IDENTITY_EVIDENCE_BLOCKED',
    proposedIdentity:identity,
    independentlyChecked:checks.length,
    historicalEvidenceRows:evidence.length,
    identityCertificationCandidate:pass,
    identityCertificationFileWritten:false,
    currentTargetDeletionAuthorized:false,
    scope:'October 2026 onward only; historical IDs used solely for identity evidence',
    writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0
  }));
  if (!pass) process.exitCode=2;
}
main().catch(e=>{console.error('PHASE B14 BLOCKED:',e.stack??e);process.exitCode=1;});
