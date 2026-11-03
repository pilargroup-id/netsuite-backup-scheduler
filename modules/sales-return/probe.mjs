// Module 7 Sales Return discovery — READ ONLY, no BigQuery/DDL/checkpoints.
// Never infer absent transactions from permissions/query errors.
import { token, fetchAll } from '../../common/netsuite-client.mjs';

const FROM = '2026-10-01';
const TO = '2026-11-01';
const PERIOD = `t.trandate >= TO_DATE('${FROM}','YYYY-MM-DD') AND t.trandate < TO_DATE('${TO}','YYYY-MM-DD')`;
const TYPES = ['RtnAuth','CustCred','ItemRcpt']; // Candidates only; inspect raw type inventory first.
const validId = x => /^\d+$/.test(String(x)) && Number.isSafeInteger(Number(x)) && Number(x)>0;
const safeIds = rows => rows.map(r=>r.internal_id).filter(validId).slice(0,6).map(Number).join(',');
let failures = 0;
async function query(access,label,sql,limit=8) {
  console.log(`\n=== ${label} ===`);
  try {
    const rows = await fetchAll(access,sql);
    console.log('rows:',rows.length,'sample:',JSON.stringify(rows.slice(0,limit),null,2));
    return rows;
  } catch (error) {
    failures++;
    console.error('QUERY FAILED (do not infer empty results):',error.message);
    return null;
  }
}

console.log(`SALES RETURN | ${FROM} .. ${TO} | READ ONLY - NO WRITE`);
try {
  const access = await token();
  await query(access,'OCTOBER TRANSACTION TYPE INVENTORY',
    `SELECT t.type, COUNT(*) AS transaction_count FROM Transaction t WHERE ${PERIOD} GROUP BY t.type ORDER BY t.type`,200);
  const samples = new Map();
  for (const type of TYPES) {
    const rows = await query(access,`CANDIDATE HEADERS: ${type}`,
      `SELECT t.id AS internal_id,t.type,t.tranid AS document_number,`+
      `TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,`+
      `TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,`+
      `BUILTIN.DF(t.status) AS status,t.entity AS entity_id,`+
      `t.currency AS currency_id,t.exchangerate,t.foreigntotal,t.total `+
      `FROM Transaction t WHERE ${PERIOD} AND t.type='${type}' ORDER BY t.id`,6);
    if (rows) samples.set(type,rows);
  }
  const ids = [...samples.values()].flatMap(rows=>rows.slice(0,3)).map(r=>r.internal_id);
  const unique = [...new Set(ids)].filter(validId).slice(0,15);
  if (unique.length) {
    const list = unique.join(',');
    await query(access,'RAW TRANSACTION LINES (representative sample)',
      `SELECT transaction,id AS line_id,uniquekey AS line_unique_key,`+
      `linesequencenumber,item,quantity,rate,foreignamount,netamount,`+
      `mainline,taxline,iscogs,accountinglinetype,location `+
      `FROM TransactionLine WHERE transaction IN (${list}) ORDER BY transaction,id`,80);
    await query(access,'LINE CLASSIFICATION',
      `SELECT transaction,mainline,taxline,iscogs,accountinglinetype,`+
      `COUNT(*) AS n,SUM(foreignamount) AS foreign_sum,SUM(netamount) AS net_sum `+
      `FROM TransactionLine WHERE transaction IN (${list}) `+
      `GROUP BY transaction,mainline,taxline,iscogs,accountinglinetype`,80);
    await query(access,'POSTING GL SAMPLE',
      `SELECT transaction,transactionline,accountingbook,account,debit,credit,posting `+
      `FROM TransactionAccountingLine WHERE transaction IN (${list})`,80);
    await query(access,'PREVIOUS LINKS SAMPLE',
      `SELECT previousdoc,nextdoc,linktype FROM PreviousTransactionLineLink `+
      `WHERE nextdoc IN (${list})`,80);
    await query(access,'NEXT LINKS SAMPLE',
      `SELECT previousdoc,nextdoc,linktype FROM NextTransactionLineLink `+
      `WHERE previousdoc IN (${list})`,80);
  } else console.warn('No candidate rows accessible; verify roles / account workflow, not proof of no returns.');
  console.log('\nDISCOVERY COMPLETE; source mapping/financial rules NOT YET CERTIFIED.');
  if (failures) {console.error('PROBE FAILED QUERIES:',failures);process.exitCode=1;}
  else if (!unique.length) process.exitCode=2;
} catch(error) {console.error('PROBE FATAL:',error.stack??error);process.exitCode=1;}
