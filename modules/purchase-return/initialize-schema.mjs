import { dataset, query, T, DATASET, LOCATION } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders } from './mapping.mjs';

// Exact schema copied from the validated Phase B sync.mjs; no sync/checkpoint mutations.
const groups = [
  { table:'purchase_return_headers', source:'headers', key:['internal_id'], parent:null, fields:[
    ['internal_id','STRING'],['authorization_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],
    ['status','STRING'],['vendor_id','STRING'],['vendor_name','STRING'],['currency_id','STRING'],
    ['exchange_rate','NUMERIC'],['foreign_total','NUMERIC'],['total_amount','NUMERIC'],['memo','STRING'],['subsidiary_id','STRING']
  ]},
  { table:'purchase_return_lines', source:'transactionLines', key:['authorization_internal_id','line_unique_key'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['line_unique_key','STRING'],['line_id','STRING'],['line_number','STRING'],
    ['item_id','STRING'],['quantity','NUMERIC'],['rate_raw','STRING'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC'],
    ['location_id','STRING'],['units_id','STRING'],['is_cogs','BOOL'],['accounting_line_type','STRING']
  ]},
  { table:'purchase_return_accounting_lines', source:'accountingLines', key:['authorization_internal_id','accounting_book_id','line_id','account_id'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['accounting_book_id','STRING'],['line_id','STRING'],['account_id','STRING'],
    ['debit','NUMERIC'],['credit','NUMERIC'],['posting','BOOL']
  ]},
  { table:'purchase_return_source_links', source:'sourceLinks', key:['authorization_internal_id','source_internal_id','link_type'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['source_internal_id','STRING'],['source_type','STRING'],['source_number','STRING'],
    ['source_date','DATE'],['link_type','STRING']
  ]},
  { table:'purchase_return_downstream_links', source:'downstreamLinks', key:['authorization_internal_id','related_internal_id','link_type'], parent:'authorization_internal_id', fields:[
    ['authorization_internal_id','STRING'],['related_internal_id','STRING'],['related_type','STRING'],['related_number','STRING'],
    ['related_date','DATE'],['link_type','STRING']
  ]}
];
const APPLY = process.argv.includes('--apply-schema');
const DRY = process.argv.includes('--dry-run');
if (APPLY === DRY || process.argv.length !== 3) throw Error('Choose exactly one --dry-run or --apply-schema');
const cpNames=groups.map(g=>`'${g.table}'`).join(',');
async function main() {
  console.log(`PURCHASE RETURN SCHEMA-ONLY | ${APPLY?'APPLY':'DRY RUN'} | ${DATASET} | ${LOCATION}`);
  const [cpExists]=await dataset.table('sync_checkpoints').exists();
  if (!cpExists) throw Error('BLOCKED: shared sync_checkpoints missing');
  const cp=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames})`);
  if (cp.length) throw Error('BLOCKED: Purchase Return checkpoints already exist; schema-only init is forbidden');
  const access=await token();
  const headers=await fetchHeaders(access);
  if (headers.length) throw Error(`BLOCKED: ${headers.length} source headers exist; use normal production sync after validation, not empty schema initialization`);
  const states=[];
  for(const g of groups) {
    const [exists]=await dataset.table(g.table).exists();
    let rows=null;
    if(exists) {
      const result=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);
      rows=Number(result[0].n);
      if(rows!==0) throw Error(`BLOCKED: ${g.table} contains ${rows} rows`);
    }
    states.push({table:g.table,exists,rows});
  }
  console.log('BEFORE',JSON.stringify(states));
  if(DRY) { console.log('SCHEMA DRY RUN PASS: no DDL, no checkpoint writes, no source mutations');return; }
  // If interrupted after some CREATE TABLE calls, rerun is safe ONLY with existing empty tables.
  for(const g of groups) {
    const defs=g.fields.map(([name,type])=>`${name} ${type}${g.key.includes(name)?' NOT NULL':''}`).join(',');
    const header=g===groups[0];
    const extra=header?',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP':',synced_at TIMESTAMP';
    const partition=header?' PARTITION BY transaction_date':'';
    const cluster=header?' CLUSTER BY internal_id':` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
    await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
  }
  for(const g of groups) {
    const [exists]=await dataset.table(g.table).exists();
    if(!exists) throw Error(`Schema missing after init: ${g.table}`);
    const rows=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);
    if(Number(rows[0].n)!==0) throw Error(`Unexpected rows after init: ${g.table}`);
  }
  const cpAfter=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames})`);
  if(cpAfter.length) throw Error('Checkpoint changed during schema-only init; investigate concurrency');
  console.log('SCHEMA_ONLY PASS: five empty tables, zero Purchase Return checkpoint rows; NOT FINAL_PASS');
}
main().catch(e=>{console.error('PURCHASE RETURN SCHEMA ERROR:',e.stack??e);process.exitCode=1;});
