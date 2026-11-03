// Pure, read-only inventory contract for the existing bounded deletion helper.
// Never interprets "only BigQuery" as deletion evidence.
function id(value) {
  const s = String(value ?? '');
  if (!/^[1-9][0-9]{0,14}$/.test(s)) throw Error(`Invalid transaction ID ${s}`);
  return s;
}
export function buildInventory(sourceRows, targetRows) {
  if (!Array.isArray(sourceRows) || !Array.isArray(targetRows)) throw Error('Missing inventory rows');
  const nsIds=sourceRows.map(x=>id(x.internal_id));
  const bqIds=targetRows.map(x=>id(x.internal_id));
  const ns=new Set(nsIds), bq=new Set(bqIds);
  const sourceDuplicate=ns.size!==nsIds.length;
  const bigQueryDuplicate=bq.size!==bqIds.length;
  return {
    netSuite:nsIds.length,
    bigQuery:bqIds.length,
    onlyNetSuite:[...ns].filter(x=>!bq.has(x)).sort((a,b)=>Number(a)-Number(b)),
    onlyBigQuery:[...bq].filter(x=>!ns.has(x)).sort((a,b)=>Number(a)-Number(b)),
    sourceDuplicate,
    bigQueryDuplicate
  };
}
