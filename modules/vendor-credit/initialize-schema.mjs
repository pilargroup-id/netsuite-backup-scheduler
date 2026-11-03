// Module 11 Vendor Credit - schema-only init. No transaction sync, checkpoint changes or deletion.
// Pattern: customer-credit-memo/initialize-schema.mjs with isolated Vendor Credit tables.
import {dataset,query,T,DATASET,LOCATION} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';

const DRY=process.argv.includes('--dry-run');
const APPLY=process.argv.includes('--apply-schema');
if (DRY===APPLY || process.argv.length!==3) throw Error('Choose exactly one --dry-run or --apply-schema');
const tableNames=GROUPS.map(g=>`'${g.table}'`).join(',');
const assert=(condition,message)=>{if(!condition)throw Error('BLOCKED: '+message);};
const expected=g=>columnDefinitions(g).map(([name,type])=>({name,type}));
function checkSchema(g,meta){
 const actual=meta.schema?.fields??[];
 for(const col of expected(g)){
  const found=actual.find(f=>f.name.toLowerCase()===col.name.toLowerCase());
  assert(found,`${g.table}: missing ${col.name}`);
  const type=found.type.toUpperCase()==='BOOLEAN'?'BOOL':found.type.toUpperCase();
  assert(type===col.type,`${g.table}.${col.name}: expected ${col.type}, got ${found.type}`);
 }
 assert(actual.length===expected(g).length,`${g.table}: unexpected extra columns`);
}
async function inspect(){
 const states=[];
 for(const g of GROUPS){
  const table=dataset.table(g.table);
  const [exists]=await table.exists();let rows=null;
  if(exists){
   const [meta]=await table.getMetadata();checkSchema(g,meta);
   const data=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);
   rows=Number(data[0].n);
   assert(rows===0,`${g.table} already has ${rows} rows. Do not reinitialize a populated table.`);
  }
  states.push({table:g.table,exists,rows,fields:expected(g).length});
 }
 return states;
}
async function checkpoints(){
 const [exists]=await dataset.table('sync_checkpoints').exists();
 assert(exists,'shared sync_checkpoints table missing');
 const rows=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${tableNames})`);
 assert(rows.length===0,'Vendor Credit checkpoints already exist');
}
async function main(){
 console.log(`MODULE 11 VENDOR CREDIT SCHEMA ONLY | ${DRY?'DRY RUN':'APPLY'} | ${DATASET} | ${LOCATION}`);
 await checkpoints();const before=await inspect();
 console.log('BEFORE',JSON.stringify(before));
 console.log('CONTRACT',JSON.stringify(GROUPS.map(g=>({table:g.table,source:g.source,fields:expected(g)}))));
 if(DRY){console.log('PHASE B4 SCHEMA DRY RUN PASS: zero DDL, zero inserts, zero checkpoints, zero deletions, zero scheduler changes');return;}
 const a=await token();const headers=await fetchHeaders(a);
 assert(headers.length>0,'VendCred live source empty; refusing schema initialization');
 console.log('LIVE SOURCE HEADER COUNT',headers.length);
 for(const g of GROUPS){
  const must=new Set(g.source==='headers'?['vendor_credit_id']:g.source==='transactionLines'?['vendor_credit_id','line_unique_key']:g.source==='accountingLines'?['vendor_credit_id','accounting_book_id','line_id']:['vendor_credit_id','previous_doc_id','next_doc_id']);
  const defs=g.fields.map(([name,type])=>`${name} ${type}${must.has(name)?' NOT NULL':''}`).join(',');
  const extra=g===GROUPS[0]?',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP':',synced_at TIMESTAMP';
  const partition=g===GROUPS[0]?' PARTITION BY transaction_date':'';
  const cluster=g===GROUPS[0]?' CLUSTER BY vendor_credit_id':` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
  await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
 }
 const after=await inspect();assert(after.every(x=>x.exists),'missing table after initialization');
 await checkpoints();
 console.log('PHASE B4 SCHEMA APPLY PASS: five empty Vendor Credit tables; zero transaction writes, checkpoints, deletions, scheduler changes');
}
main().catch(err=>{console.error('PHASE B4 SCHEMA BLOCKED',err.stack??String(err));process.exitCode=1;});
