// Read-only diagnostic for an apparent NetSuite-only/BigQuery-only transaction.
// Run from C:\netsuite-backup: node scripts/diagnose-transaction.mjs sales-invoice 3152379
import { token, BASE_URL } from '../common/netsuite-client.mjs';
import { query, T } from '../common/bigquery-client.mjs';

const MODULES = {
  'sales-invoice': { type: 'CustInvc', table: 'sales_invoice_headers' },
  'item-fulfillment': { type: 'ItemShip', table: 'item_fulfillment_headers' },
  'sales-order': { type: 'SalesOrd', table: 'sales_order_headers' },
};
const [moduleName, inputId] = process.argv.slice(2);
const config = MODULES[moduleName];
if (!config || !/^[1-9][0-9]{0,14}$/.test(inputId ?? '')) {
  console.error('Usage: node scripts/diagnose-transaction.mjs <sales-invoice|item-fulfillment|sales-order> <numeric-id>');
  process.exit(2);
}
const id = Number(inputId);
if (!Number.isSafeInteger(id)) throw new Error('ID must be a safe integer');

async function suiteql(access, statement) {
  const url = `${BASE_URL}/services/rest/query/v1/suiteql?limit=1000&offset=0`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Prefer: 'transient' },
      body: JSON.stringify({ q: statement }),
    });
    const body = await response.text();
    if (response.ok) return JSON.parse(body).items ?? [];
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error(`NetSuite SuiteQL HTTP ${response.status}: ${body}`);
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 1500));
  }
}

console.log('DIAGNOSTIC ONLY | NO BIGQUERY OR NETSUITE WRITES');
console.log(`Module=${moduleName} ID=${id}`);
const access = await token();
const allTypes = await suiteql(access, `SELECT id, type, tranid, TO_CHAR(trandate, 'YYYY-MM-DD') AS transaction_date FROM Transaction WHERE id = ${id}`);
const expectedType = await suiteql(access, `SELECT id FROM Transaction WHERE id = ${id} AND type = '${config.type}'`);
const [bq] = await query(`SELECT CAST(internal_id AS STRING) AS id, CAST(transaction_date AS STRING) AS transaction_date, COALESCE(is_deleted, FALSE) AS is_deleted FROM ${T(config.table)} WHERE CAST(internal_id AS STRING) = '${id}'`);

console.log('NETSUITE unfiltered:', JSON.stringify(allTypes));
console.log('NETSUITE expected type visible:', expectedType.length > 0);
console.log('BIGQUERY header:', JSON.stringify(bq ?? null));
if (allTypes.length > 1) {
  console.log('RESULT: INCONSISTENT SOURCE -- multiple transactions returned for same ID');
} else if (allTypes.length === 0) {
  console.log('RESULT: NOT VISIBLE THROUGH SUITEQL. This does NOT prove deletion (permissions/type/deletion remain possible).');
} else {
  const r = allTypes[0];
  console.log('RESULT:', r.type === config.type ? 'EXPECTED TYPE, CHECK DATE/PERIOD' : `TYPE CHANGED OR DIFFERENT: ${r.type}`);
}
console.log('No apply, no deletion, no checkpoint changes.');
