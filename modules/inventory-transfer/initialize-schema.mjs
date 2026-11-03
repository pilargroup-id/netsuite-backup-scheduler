// Module 14 isolated schema initializer. No existing module, checkpoint, or scheduler writes.
import { dataset, query, T, PROJECT, DATASET, LOCATION } from '../../common/bigquery-client.mjs';
import { GROUPS, columnDefinitions } from './schema-contract.mjs';
const dry = process.argv.includes('--dry-run');
const apply = process.argv.includes('--apply-schema');
const assert = (ok, msg) => { if (!ok) throw Error('MODULE 14 SCHEMA BLOCKED: '+msg); };
const fq = `${PROJECT}.${DATASET}`;
function sameType(actual,want){return String(actual).toUpperCase().replace('BOOLEAN','BOOL')===want;}
async function inspect(){
  const states=[];
  for(const g of GROUPS){
    const table=dataset.table(g.table); const [exists]=await table.exists();let rows=null;
    if(exists){
      const [metadata]=await table.getMetadata(); const actual=metadata.schema?.fields??[];
      const expected=columnDefinitions(g);
      assert(actual.length===expected.length,`unexpected column count ${g.table}`);
      for(const [name,type] of expected){
        const field=actual.find(x=>x.name.toLowerCase()===name.toLowerCase());
        assert(field && sameType(field.type,type),`column mismatch ${g.table}.${name}:${type}`);
      }
      const count=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);
      rows=Number(count[0].n);
      assert(rows===0,`existing table has data ${g.table}`);
    }
    states.push({table:g.table,exists,rows});
  }
  return states;
}
async function checkpoints(){
  const [exists]=await dataset.table('sync_checkpoints').exists();
  assert(exists,'shared checkpoints table missing');
  const names=GROUPS.map(g=>`'${g.table}'`).join(',');
  const rows=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${names})`);
  assert(rows.length===0,'Module 14 checkpoints already exist');
}
async function main(){
  assert(process.argv.length===3 && dry!==apply,'choose exactly one --dry-run or --apply-schema');
  console.log('MODULE 14 INVENTORY TRANSFER SCHEMA',dry?'DRY RUN':'APPLY',fq,LOCATION);
  await checkpoints();
  console.log('BEFORE',JSON.stringify(await inspect()));
  console.log('CONTRACT',JSON.stringify(GROUPS.map(g=>({table:g.table,key:g.key,fields:columnDefinitions(g)}))));
  if(dry){console.log('MODULE 14 SCHEMA DRY RUN PASS: ZERO WRITES');return;}
  assert(process.env.NETSUITE_INVENTORY_TRANSFER_SCHEMA_CONFIRM==='MODULE14_ONLY','requires NETSUITE_INVENTORY_TRANSFER_SCHEMA_CONFIRM=MODULE14_ONLY');
  for(const g of GROUPS){
    const mandatory=new Set(g.key);
    const columns=g.fields.map(([n,t])=>`${n} ${t}${mandatory.has(n)?' NOT NULL':''}`).join(',');
    const extra=(g===GROUPS[0])?',synced_at TIMESTAMP,is_deleted BOOL DEFAULT FALSE,deleted_at TIMESTAMP':',synced_at TIMESTAMP';
    const partition=(g===GROUPS[0])?' PARTITION BY transaction_date':'';
    const cluster=` CLUSTER BY ${g.key.join(',')}`;
    await query(`CREATE TABLE IF NOT EXISTS ${T(g.table)} (${columns}${extra})${partition}${cluster}`);
  }
  console.log('AFTER',JSON.stringify(await inspect()));
  await checkpoints();
  console.log('MODULE 14 SCHEMA APPLY PASS: two isolated empty tables; ZERO checkpoint/scheduler changes');
}
main().catch(e=>{console.error('MODULE 14 SCHEMA BLOCKED',e.stack??String(e));process.exitCode=1;});
