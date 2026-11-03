import { defs, source, state, compareIds, stored, status, intro, finish } from './audit-common.mjs';
import { buildInventory } from './deletion-inventory.mjs';

async function main(){
 if(process.argv.includes('--deletion-inventory')) {
  if(process.argv.length !== 3) throw Error('Unsupported deletion inventory arguments');
  const s=await state();
  if(s.mode!=='INITIALIZED') throw Error(`BLOCKED: Purchase Return is ${s.mode}; deletion inventory unavailable until INITIALIZED`);
  const m=await source();
  const rows=await stored(defs[0]);
  const inventory=buildInventory(m.headers,rows);
  console.log(JSON.stringify(inventory));
  if(inventory.sourceDuplicate || inventory.bigQueryDuplicate) {process.exitCode=1;return;}
  if(inventory.onlyNetSuite.length || inventory.onlyBigQuery.length) process.exitCode=3;
  return;
 }
 if(process.argv.length!==2) throw Error('Unsupported presence arguments');
 const m=await source(), s=await state();intro('PRESENCE',s);
 if(s.mode==='SCHEMA_ONLY'){
  if(defs.some(d=>m[d.group].length))throw Error('SCHEMA_ONLY but source records exist: NEEDS_SYNC');
  for(const d of defs){const rows=await stored(d);if(rows.length)throw Error('SCHEMA_ONLY has unexpected target rows: '+d.table);}
  finish('PRESENCE',s);return;
 }
 if(s.mode==='NOT_INITIALIZED'){
  if(defs.some(d=>m[d.group].length))throw Error('Source records exist but target not initialized: NEEDS_SYNC');
  finish('PRESENCE',s);return;
 }
 let failed=false;
 for(const d of defs){const c=compareIds(m[d.group],await stored(d),d.keys);c.status=status(c);console.log(d.table,JSON.stringify(c));if(c.status!=='PASS')failed=true;}
 if(failed)throw Error('PRESENCE FAILED');finish('PRESENCE',s);
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1});
