import { query, T } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, FROM, TO } from './mapping.mjs';

async function main() {
  console.log('SALES RETURN PRESENCE | READ ONLY');
  const source = await fetchHeaders(await token());
  const ns = new Set(source.map(row => String(row.internal_id)));
  const rows = await query(`SELECT internal_id FROM ${T('sales_return_headers')} WHERE transaction_date>=DATE '${FROM}' AND transaction_date<DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`);
  const bq = new Set(rows.map(row => String(row.internal_id)));
  const onlyNetSuite = [...ns].filter(id => !bq.has(id));
  const onlyBigQuery = [...bq].filter(id => !ns.has(id));
  const sourceDuplicate = ns.size !== source.length;
  const bigQueryDuplicate = bq.size !== rows.length;

  console.log(JSON.stringify({
    netSuite: ns.size,
    bigQuery: bq.size,
    onlyNetSuite,
    onlyBigQuery,
    sourceDuplicate,
    bigQueryDuplicate
  }, null, 2));

  if (sourceDuplicate || bigQueryDuplicate) throw Error('SALES RETURN PRESENCE INTEGRITY FAILED');
  if (onlyNetSuite.length || onlyBigQuery.length) {
    console.log('SALES RETURN PRESENCE NEEDS_REVIEW');
    process.exitCode = 3;
    return;
  }
  console.log('SALES RETURN PRESENCE PASS');
}

main().catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});
