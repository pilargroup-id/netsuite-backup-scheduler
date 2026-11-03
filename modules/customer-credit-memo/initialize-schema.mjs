// Schema-only init matching Purchase Return convention. Never writes transaction rows/checkpoints.
import {dataset,query,T,DATASET,LOCATION} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';

const DRY=process.argv.includes('--dry-run'),APPLY=process.argv.includes('--apply-schema');
if(DRY===APPLY||process.argv.length!==3)throw Error('Choose exactly one --dry-run or --apply-schema');
const cpNames=GROUPS.map(g=>`'${g.table}'`).join(',');
function assert(ok,msg){if(!ok)throw Error('BLOCKED: '+msg);}
function expected(g){return columnDefinitions(g).map(([name,type])=>({name,type}));}
function compareSchema(g,metadata){
 const actual=metadata.schema?.fields??[];
 for(const x of expected(g)){
  const column=actual.find(y=>y.name.toLowerCase()===x.name.toLowerCase());
  assert(column,`${g.table} missing column ${x.name}`);
  assert((column.type.toUpperCase()==='BOOLEAN'?'BOOL':column.type.toUpperCase())===x.type,`${g.table}.${x.name} has ${column.type}, expected ${x.type}`);
 }
 assert(actual.length===expected(g).length,`${g.table} unexpected extra column(s)`);
}
async function checkTables(){
 const states=[];
 for(const g of GROUPS){
  const table=dataset.table(g.table);
  const [exists]=await table.exists();
  let n=null;
  if(exists){
   const [metadata]=await table.getMetadata();compareSchema(g,metadata);
   const rows=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);
   n=Number(rows[0].n);assert(n===0,`${g.table} already has ${n} rows; use sync/reconciliation workflow`);
  }
  states.push({table:g.table,exists,rows:n,fields:expected(g).length});
 }
 return states;
}
async function main(){
 console.log(`CUSTOMER CREDIT MEMO B3 SCHEMA-ONLY | ${DRY?'DRY RUN':'APPLY'} | ${DATASET} | ${LOCATION}`);
 const [cpExists]=await dataset.table('sync_checkpoints').exists();assert(cpExists,'shared sync_checkpoints missing');
 const checkpoints=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames})`);
 assert(checkpoints.length===0,'Customer Credit Memo checkpoints already exist');
 const before=await checkTables();console.log('BEFORE:',JSON.stringify(before));
 console.log('CONTRACT:',JSON.stringify(GROUPS.map(g=>({table:g.table,source:g.source,fields:expected(g)}))));
 if(DRY){console.log('B3 SCHEMA DRY RUN PASS: no DDL, no data writes, no checkpoints');return;}
 const access=await token();const headers=await fetchHeaders(access);
 assert(headers.length>0,'source has no CustCred headers; refusing to initialize');
 console.log('LIVE SOURCE HEADERS:',headers.length);
 for(const g of GROUPS){
  const mandatory = new Set(g.source==='headers'?['credit_memo_id']:g.source==='transactionLines'?['credit_memo_id','line_unique_key']:g.source==='accountingLines'?['credit_memo_id','accounting_book_id','line_id']:g.source==='financialClassification'?['credit_memo_id','accounting_book_id']:['credit_memo_id','previous_doc_id','next_doc_id']);
  const defs=g.fields.map(([name,type])=>`${name} ${type}${mandatory.has(name)?' NOT NULL':''}`).join(',');
  const extra=g===GROUPS[0]?',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP':',synced_at TIMESTAMP';
  const partition=g===GROUPS[0]?' PARTITION BY transaction_date':'';
  const cluster=g===GROUPS[0]?' CLUSTER BY credit_memo_id':` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
  await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
 }
 const after=await checkTables();assert(after.every(g=>g.exists),'one or more tables missing after schema init');
 const checkpointAfter=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames})`);
 assert(checkpointAfter.length===0,'checkpoint unexpectedly created');
 console.log('B3 SCHEMA ONLY PASS: 6 empty tables, 0 checkpoint rows; NOT SYNC PASS');
}
main().catch(e=>{console.error('B3 SCHEMA BLOCKED:',e.stack??String(e));process.exitCode=1;});
