// Read-only inventory. Never runs --apply; proof remains mandatory for every candidate.
import { inspectDeletionInventory, processVerifiedDeletionBatch } from '../common/verified-deletion-batch.mjs';
const inventory = inspectDeletionInventory('sales-payment');
console.log('SALES PAYMENT VERIFIED DELETION INVENTORY | READ ONLY');
console.log(JSON.stringify({onlyNetSuiteCount:inventory.onlyNetSuite.length,onlyBigQueryCount:inventory.onlyBigQuery.length,onlyNetSuite:inventory.onlyNetSuite.slice(0,10),onlyBigQuery:inventory.onlyBigQuery.slice(0,10)},null,2));
if (inventory.onlyNetSuite.length) {
  console.log('SOURCE MOVEMENT: Only NetSuite rows exist; run incremental sync before final certification.');
}
if (inventory.onlyBigQuery.length) {
  console.log('PROOF DRY RUN: maximum three candidates; no apply.');
  processVerifiedDeletionBatch('sales-payment', inventory, {apply:false});
} else {
  console.log('NO DELETION CANDIDATES. No writes performed.');
}
