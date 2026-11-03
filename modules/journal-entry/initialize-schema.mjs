// Module 13 isolated schema only. Never writes checkpoints, transaction data, or scheduler.
import {dataset,query,T,PROJECT,DATASET,LOCATION} from '../../common/bigquery-client.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
const dry=process.argv.includes('--dry-run'),apply=process.argv.includes('--apply-schema');
const assert=(yes,msg)=>{if(!yes)throw Error('BLOCKED: '+msg)};
const expected=g=>columnDefinitions(g).map(([name,type])=>({name,type}));
const sameType=(actual,want)=>String(actual).toUpperCase().replace('BOOLEAN','BOOL')===want;
const fq=`${PROJECT}.${DATASET}`;
async function inspect(){
 const states=[];
 for(const g of GROUPS){
  const table=dataset.table(g.table);
  const [exists]=await table.exists();let rows=null;
  if(exists){
   const [metadata]=await table.getMetadata();const actual=metadata.schema?.fields??[];
   assert(actual.length===expected(g).length,`unexpected column count ${g.table}`);
   for(const col of expected(g)){
    const field=actual.find(x=>x.name.toLowerCase()===col.name.toLowerCase());
    assert(field,`missing ${g.table}.${col.name}`);
    assert(sameType(field.type,col.type),`type mismatch ${g.table}.${col.name}`);
   }
   const count=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);
   rows=Number(count[0].n);
   assert(rows===0,`existing records in ${g.table}`);
  }
  states.push({table:g.table,exists,rows});
 }
 return states;
}
async function checkCheckpoints(){
 const [exists]=await dataset.table('sync_checkpoints').exists();
 assert(exists,'shared sync_checkpoints missing');
 const names=GROUPS.map(g=>`'${g.table}'`).join(',');
 const rows=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${names})`);
 assert(rows.length===0,'Module 13 checkpoint already exists');
}
async function main(){
 assert(process.argv.length===3&&dry!==apply,'exactly one --dry-run or --apply-schema');
 console.log('MODULE 13 JOURNAL ENTRY SCHEMA',dry?'DRY RUN':'APPLY',fq,LOCATION);
 await checkCheckpoints();
 console.log('BEFORE',JSON.stringify(await inspect()));
 console.log('CONTRACT',JSON.stringify(GROUPS.map(g=>({table:g.table,key:g.key,fields:expected(g)}))));
 if(dry){console.log('MODULE 13 SCHEMA DRY RUN PASS: zero writes');return;}
 assert(process.env.NETSUITE_JOURNAL_ENTRY_SCHEMA_CONFIRM==='MODULE13_ONLY','set NETSUITE_JOURNAL_ENTRY_SCHEMA_CONFIRM=MODULE13_ONLY explicitly');
 // Each DDL is isolated to a brand new Module 13 table. If a DDL fails, existing production tables stay intact.
 for(const g of GROUPS){
  const must=new Set(g.key.filter(key=>key!=='account_id'));
  const defs=g.fields.map(([name,type])=>`${name} ${type}${must.has(name)?' NOT NULL':''}`).join(',');
  const extra=g===GROUPS[0]?',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP':',synced_at TIMESTAMP';
  const partition=g===GROUPS[0]?' PARTITION BY transaction_date':'';
  const cluster=` CLUSTER BY ${g.key.slice(0,4).join(',')}`;
  await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${defs}${extra})${partition}${cluster}`);
 }
 console.log('AFTER',JSON.stringify(await inspect()));
 await checkCheckpoints();
 console.log('MODULE 13 SCHEMA APPLY PASS: five empty isolated tables; zero checkpoint and scheduler changes');
}
main().catch(e=>{console.error('MODULE 13 SCHEMA BLOCKED',e.stack??String(e));process.exitCode=1});
