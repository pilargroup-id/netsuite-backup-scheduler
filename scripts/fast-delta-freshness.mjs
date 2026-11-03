// Read-only check: do not equate SKIPPED_LOCKED with a successful sync.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'logs','fast-delta','health-v2.json');
const limit=Number(process.argv[2]??20);
if(!Number.isFinite(limit)||limit<10||limit>1440){console.error('Usage: node scripts/fast-delta-freshness.mjs [max-age-minutes=20]');process.exit(2);}
let state;
try {state=JSON.parse(fs.readFileSync(file,'utf8'));} catch {console.error('FRESHNESS UNKNOWN: health-v2.json not found/invalid');process.exit(2);}
const now=Date.now();let stale=0;
for(const mod of ['sales-invoice','item-fulfillment','sales-order']){
  const rec=state.modules?.[mod]??{};
  const date=Date.parse(rec.lastSuccessAt??'');
  const age=Number.isFinite(date)?Math.round((now-date)/60000):null;
  const ok=age!==null&&age>=0&&age<=limit;
  console.log(`${mod}: ${ok?'FRESH':'STALE'} ageMinutes=${age??'UNKNOWN'} threshold=${limit} lastResult=${rec.lastResult??'UNKNOWN'} lastSuccessAt=${rec.lastSuccessAt??'NONE'}`);
  if(!ok)stale++;
}
console.log(`FRESHNESS SUMMARY: ${stale?'STALE modules='+stale:'OK'}`);
process.exitCode=stale?2:0;
