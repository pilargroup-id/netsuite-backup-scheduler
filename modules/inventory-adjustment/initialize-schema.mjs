// MODULE 15 — Phase C isolated BigQuery schema initializer.
// Default --dry-run: no BigQuery mutations. --apply requires explicit authorization.
import {dataset,T,query} from '../../common/bigquery-client.mjs';
import {TABLES,ddl} from './schema-contract.mjs';
const mode=process.argv[2]??'--dry-run';
const must=(ok,msg)=>{if(!ok)throw Error(msg);};
const norm=t=>t==='BOOLEAN'?'BOOL':t==='DECIMAL'?'NUMERIC':t==='BIGDECIMAL'?'BIGNUMERIC':t;
async function inspect(t){
 const tab=dataset.table(t.name);const [exists]=await tab.exists();
 if(!exists)return 'ABSENT';
 const [meta]=await tab.getMetadata();
 const actual=meta.schema?.fields??[];
 must(actual.length===t.fields.length,`${t.name}: existing field count ${actual.length}, expected ${t.fields.length}`);
 for(let i=0;i<t.fields.length;i++){
  const [name,type]=t.fields[i],a=actual[i];
  must(a.name.toLowerCase()===name.toLowerCase()&&norm(String(a.type).toUpperCase())===type,`${t.name}: existing field mismatch at ${i} (${a.name}:${a.type} vs ${name}:${type})`);
 }
 const partition=meta.timePartitioning;
 must(Boolean(partition)===Boolean(t.partition),`${t.name}: partition mismatch`);
 if(t.partition)must((partition.field??'')===t.partition,`${t.name}: partition field mismatch`);
 const clustering=meta.clustering?.fields??[];
 must(clustering.length===1&&clustering[0]===t.cluster,`${t.name}: clustering mismatch`);
 return 'SCHEMA_MATCH';
}
console.log('MODULE 15 PHASE C ISOLATED SCHEMA',mode,'| MODULE15_ONLY | NO SCHEDULER CHANGES');
try{
 must(['--dry-run','--apply'].includes(mode),'usage: --dry-run or --apply');
 if(mode==='--apply')must(process.env.NETSUITE_INVENTORY_ADJUSTMENT_SCHEMA_CONFIRM==='MODULE15_SCHEMA_ONLY','explicit Module15 schema authorization missing');
 const before=[];
 for(const t of TABLES)before.push({table:t.name,status:await inspect(t)});
 console.log('SCHEMA_PREFLIGHT',JSON.stringify(before));
 for(const t of TABLES)console.log('DDL_PLAN',ddl(t,T));
 if(mode==='--dry-run'){
  console.log('MODULE 15 PHASE C SCHEMA DRY RUN PASS: ZERO WRITES; NO CHECKPOINT CHANGES; NO SCHEDULER CHANGES');
 }else{
  for(const t of TABLES){if(before.find(x=>x.table===t.name).status==='ABSENT')await query(ddl(t,T));}
  const after=[];for(const t of TABLES)after.push({table:t.name,status:await inspect(t)});
  must(after.every(x=>x.status==='SCHEMA_MATCH'),'post-create schema validation failed');
  console.log('SCHEMA_POSTCHECK',JSON.stringify(after));
  console.log('MODULE 15 PHASE C SCHEMA APPLY PASS: MODULE15 TABLES ONLY; NO CHECKPOINT CHANGES; NO SCHEDULER CHANGES');
 }
}catch(e){console.error('MODULE 15 PHASE C BLOCKED:',String(e?.stack??e));process.exitCode=1;}
