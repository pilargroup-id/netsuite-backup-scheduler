// Module 13 Journal Entry: read-only independent identity certificate validation.
// Does not write to NetSuite, BigQuery, checkpoints, scheduler, or deletion logs.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { token, fetchAll } from '../../common/netsuite-client.mjs';

const must = (ok, why) => { if (!ok) throw Error('MODULE 13 CERTIFICATION BLOCKED: ' + why); };
const asText = x => String(x ?? '').trim();
const positiveId = x => /^[1-9][0-9]{0,14}$/.test(asText(x));

async function main() {
  must(process.argv.length === 2, 'this is read-only and accepts no arguments');
  console.log('MODULE 13 JOURNAL IDENTITY CERTIFICATION | READ ONLY');
  const file = fileURLToPath(new URL('./deletion-identity.confirmed.json', import.meta.url));
  const cert = JSON.parse(await readFile(file, 'utf8'));
  must(cert.module === 'journal-entry' && cert.transactionType === 'Journal', 'certificate module/type mismatch');
  must(cert.recordtypeid === 'journalentry' && cert.type === 'JOURNALENTRY', 'tuple mismatch');
  must(cert.scope === '2026-10-01..open-ended', 'scope mismatch');
  must(cert.independentlyVerified === true, 'certificate not confirmed');
  must(Array.isArray(cert.evidenceRecordIds) && cert.evidenceRecordIds.length >= 3, 'three independent historical IDs required');
  must(new Set(cert.evidenceRecordIds.map(String)).size === cert.evidenceRecordIds.length, 'duplicate certificate IDs');
  must(cert.evidenceRecordIds.every(positiveId), 'invalid historical record ID');
  const auth = await token();
  console.log('OAuth: SUCCESS');
  for (const value of cert.evidenceRecordIds) {
    const id = asText(value);
    const records = await fetchAll(auth, `SELECT recordid,recordtypeid,type,deleteddate FROM deletedrecord WHERE recordid=${id}`);
    const matching = records.filter(r => asText(r.recordid) === id && asText(r.recordtypeid).toLowerCase() === 'journalentry' && asText(r.type).toUpperCase() === 'JOURNALENTRY' && asText(r.deleteddate));
    const visible = await fetchAll(auth, `SELECT id,type FROM Transaction WHERE id=${id}`);
    const valid = matching.length === 1 && visible.length === 0;
    console.log('CERTIFICATE_EVIDENCE', JSON.stringify({ id, exactProofCount: matching.length, globalTransactionVisible: visible.length, verified: valid }));
    must(valid, 'independent exact proof or global absence failed for ID ' + id);
  }
  const living = await fetchAll(auth, `SELECT id,type FROM Transaction WHERE type='Journal' AND trandate>=TO_DATE('2026-10-01','YYYY-MM-DD') AND ROWNUM<=1`);
  must(living.length === 1 && positiveId(living[0].id), 'active negative control unavailable');
  const livingId = asText(living[0].id);
  const negativeRows = await fetchAll(auth, `SELECT recordid,recordtypeid,type,deleteddate FROM deletedrecord WHERE recordid=${livingId}`);
  const falsePositive = negativeRows.some(r => asText(r.recordid) === livingId && asText(r.recordtypeid).toLowerCase() === 'journalentry' && asText(r.type).toUpperCase() === 'JOURNALENTRY' && asText(r.deleteddate));
  must(!falsePositive, 'active Journal reported as deleted');
  console.log('NEGATIVE_CONTROL', JSON.stringify({liveJournalId: livingId, exactDeletedRecord: false, passed: true}));
  console.log('MODULE 13 DELETION IDENTITY CERTIFICATION PASS', JSON.stringify({ tuple: 'journalentry|JOURNALENTRY', evidenceCount: cert.evidenceRecordIds.length, identityCertified: true, perCandidateDeletionAuthorized: false, writeOperations: 0, checkpointChanges: 0, deletionOperations: 0, schedulerChanges: 0 }));
}
main().catch(e => { console.error('MODULE 13 DELETION IDENTITY CERTIFICATION ERROR', e?.stack ?? String(e)); process.exitCode = 1; });
