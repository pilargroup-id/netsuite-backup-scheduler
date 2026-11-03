import { defs, source, state, stored, intro, finish } from './audit-common.mjs';
import { query,T } from '../../common/bigquery-client.mjs';
async function main(){
 const m=await source(),s=await state();intro('FINANCIAL',s);
 const nonPosting=m.accountingLines.filter(r=>r.posting===true);
 if(nonPosting.length)throw Error('VendAuth unexpectedly has posting GL');
 if(s.mode==='SCHEMA_ONLY'){
  if(defs.some(d=>m[d.group].length))throw Error('SCHEMA_ONLY but source records exist: NEEDS_SYNC');
  for(const d of defs){const rows=await stored(d);if(rows.length)throw Error('SCHEMA_ONLY has unexpected target rows: '+d.table);}
  finish('FINANCIAL',s);return;
 }
 if(s.mode==='NOT_INITIALIZED'){
  if(defs.some(d=>m[d.group].length))throw Error('Missing target with nonzero source');
  console.log('SOURCE FINANCIAL',JSON.stringify({headers:0,lines:0,gl:0,postingGL:0}));finish('FINANCIAL',s);return;
 }
 const h=await stored(defs[0]),l=await stored(defs[1]),g=await stored(defs[2]);
 const glPosting=g.filter(r=>r.posting===true||r.posting==='T');
 const orphans=await query(`SELECT (SELECT COUNT(*) FROM ${T('purchase_return_lines')} l LEFT JOIN ${T('purchase_return_headers')} h ON h.internal_id=l.authorization_internal_id WHERE h.internal_id IS NULL) AS orphan_lines,(SELECT COUNT(*) FROM ${T('purchase_return_accounting_lines')} a LEFT JOIN ${T('purchase_return_headers')} h ON h.internal_id=a.authorization_internal_id WHERE h.internal_id IS NULL) AS orphan_gl,(SELECT COUNT(*) FROM ${T('purchase_return_source_links')} a LEFT JOIN ${T('purchase_return_headers')} h ON h.internal_id=a.authorization_internal_id WHERE h.internal_id IS NULL) AS orphan_sources,(SELECT COUNT(*) FROM ${T('purchase_return_downstream_links')} a LEFT JOIN ${T('purchase_return_headers')} h ON h.internal_id=a.authorization_internal_id WHERE h.internal_id IS NULL) AS orphan_downstream`);
 const fail=glPosting.length!==0||h.length!==m.headers.length||l.length!==m.transactionLines.length||g.length!==m.accountingLines.length||Object.values(orphans[0]).some(v=>Number(v)!==0);
 console.log(JSON.stringify({source:{headers:m.headers.length,lines:m.transactionLines.length,gl:m.accountingLines.length},target:{headers:h.length,lines:l.length,gl:g.length,postingGL:glPosting.length},orphans:orphans[0],status:fail?'FAIL':'PASS'},null,2));
 if(fail)throw Error('FINANCIAL CHECK FAILED');finish('FINANCIAL',s);
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1});
