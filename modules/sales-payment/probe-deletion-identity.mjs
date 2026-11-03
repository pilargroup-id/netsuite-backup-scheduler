// Phase B5: independent, read-only deletedrecord identity discovery.
// No BigQuery access, no soft deletes, no registry changes, no checkpoints.
import { token, fetchAll } from '../../common/netsuite-client.mjs';

const candidate = 'customerpayment'; // DISCOVERY FILTER ONLY: not a certified deletion registry entry.
const limit = 40;
const printable = (r) => ({
  recordid: String(r.recordid ?? ''),
  recordtypeid: String(r.recordtypeid ?? ''),
  type: String(r.type ?? ''),
  name: String(r.name ?? ''),
  deleteddate: String(r.deleteddate ?? ''),
  deletedby: String(r.deletedby ?? ''),
  context: String(r.context ?? '')
});
const isPaymentProof = (r, type) =>
  String(r.recordtypeid ?? '').toLowerCase() === candidate &&
  String(r.type ?? '').toUpperCase() === type &&
  Boolean(r.deleteddate);
const safeId = x => /^[1-9]\d{0,14}$/.test(String(x));

console.log('SALES PAYMENT B5 | DELETEDRECORD IDENTITY DISCOVERY | READ ONLY');
console.log('No BigQuery, checkpoint, scheduler, registry, or deletion mutations.');
try {
  const access = await token();
  console.log('OAuth: SUCCESS');
  // Both queries are bounded, each has native server-side filters.
  const queries = [
    ['EXACT RECORDTYPEID CANDIDATE', `SELECT recordid, recordtypeid, type, name, deleteddate, deletedby, context FROM deletedrecord WHERE LOWER(recordtypeid) = '${candidate}' AND ROWNUM <= ${limit}`],
    ['PAYMENT NAME DISCOVERY', `SELECT recordid, recordtypeid, type, name, deleteddate, deletedby, context FROM deletedrecord WHERE LOWER(name) LIKE '%payment%' AND ROWNUM <= ${limit}`]
  ];
  const unique = new Map();
  let queryFailures = 0;
  for (const [label, sql] of queries) {
    console.log(`\n=== ${label} ===`);
    try {
      const rows = await fetchAll(access, sql);
      console.log(`Rows=${rows.length}; bounded_limit=${limit}`);
      console.log(JSON.stringify(rows.slice(0, 20).map(printable), null, 2));
      for (const row of rows) {
        if (!safeId(row.recordid)) continue;
        unique.set(`${row.recordid}\u001f${row.recordtypeid}\u001f${row.type}`, row);
      }
    } catch (err) {
      queryFailures++;
      console.log(`QUERY BLOCKED: ${err.message}`);
    }
  }
  console.log('\n=== EXACT TYPE DISTRIBUTION FOR CANDIDATE RECORDTYPEID ===');
  const matches = [...unique.values()].filter(x => String(x.recordtypeid).toLowerCase() === candidate);
  const types = [...new Set(matches.map(x => String(x.type).toUpperCase()))];
  console.log(JSON.stringify({candidateRecordtypeid:candidate, types, records:matches.length, queryFailures}, null, 2));
  console.log('\n=== INDEPENDENT POSITIVE PROOF / SOURCE ABSENCE ===');
  let positive = 0;
  for (const r of matches.slice(0, 8)) {
    const id = String(r.recordid);
    const reProof = await fetchAll(access, `SELECT recordid, recordtypeid, type, name, deleteddate FROM deletedrecord WHERE recordid = ${id}`);
    const matchingProof = reProof.filter(x => String(x.recordid) === id && isPaymentProof(x, String(r.type).toUpperCase()));
    const strict = matchingProof.length === 1;
    const visible = await fetchAll(access, `SELECT id, type FROM Transaction WHERE id = ${id}`);
    if (strict && visible.length === 0) positive++;
    console.log(JSON.stringify({id,expectedType:String(r.type),deletedrecordRows:reProof.length,matchingProofRows:matchingProof.length,collisionRows:reProof.length-matchingProof.length,strictProof:strict,sourceVisible:visible.length,positive:strict && !visible.length,otherRecordTypes:reProof.filter(x=>!isPaymentProof(x,String(r.type).toUpperCase())).map(x=>({recordtypeid:x.recordtypeid,type:x.type}))}));
  }
  console.log('\n=== NEGATIVE GUARD: KNOWN VISIBLE CUSTOMER PAYMENT ===');
  const live = await fetchAll(access, `SELECT id, type FROM Transaction WHERE type = 'CustPymt' AND ROWNUM <= 1`);
  if (live.length !== 1 || !safeId(live[0].id)) throw Error('Cannot establish live negative control');
  const liveId = String(live[0].id);
  const collision = await fetchAll(access, `SELECT recordid, recordtypeid, type, deleteddate FROM deletedrecord WHERE recordid = ${liveId}`);
  const knownType = types.length === 1 ? types[0] : null;
  const negativePass = !knownType || !collision.some(x => isPaymentProof(x,knownType));
  console.log(JSON.stringify({livePaymentId:liveId,liveTransactionType:live[0].type,deletedrecordRows:collision.map(printable),candidateType:knownType,negativeGuardPass:negativePass},null,2));
  if (!negativePass) throw Error('Negative guard failed: visible customer payment has matching deletion proof');
  console.log('\n=== PHASE B5 RESULT ===');
  console.log(JSON.stringify({queryFailures,candidateTypes:types,positiveProven:positive,negativeGuardPass:true,registryEligible:queryFailures===0 && types.length===1 && positive>0},null,2));
  if (queryFailures || types.length !== 1 || !positive) {
    console.log('IDENTITY NOT CERTIFIED: no registry changes. Additional independent evidence required.');
    process.exitCode = 3;
  } else {
    console.log('IDENTITY EVIDENCE PASS; follow-up offline regression and controlled registry integration still required.');
  }
} catch (err) {
  console.error('B5 BLOCKED:',err.message);
  process.exitCode = 2;
}
