// Phase D: no BigQuery writes or scheduler changes.
import {token,fetchHeaders,fetchLines,fetchGL,mapSource,decimalExact} from './mapping.mjs';
const must=(v,m)=>{if(!v)throw Error(m);};
console.log('MODULE 15 PHASE D EXACT MAPPING | STRICT READ ONLY');
try {
 must(decimalExact('-2.3322597963E8')==='-233225979.63','scientific decimal regression');
 must(decimalExact('0.00000000000000000000000000000000000001')==='0.00000000000000000000000000000000000001','scale 38 regression');
 const a=await token();console.log('OAuth: SUCCESS');
 const h=await fetchHeaders(a);const ids=h.map(x=>x.internal_id);
 const [l,g]=await Promise.all([fetchLines(a,ids),fetchGL(a,ids)]);
 const mapped=mapSource(h,l,g);
 const totals={headers:mapped.stats.headers,lines:mapped.stats.lines,glLines:mapped.stats.accountingLines,mainline:mapped.data.lines.filter(x=>x.is_mainline).length,itemLines:mapped.data.lines.filter(x=>!x.is_mainline).length,nullDebit:mapped.data.accountingLines.filter(x=>x.debit==null).length,nullCredit:mapped.data.accountingLines.filter(x=>x.credit==null).length,nullNetAmount:mapped.data.lines.filter(x=>!x.is_mainline&&x.net_amount==null).length,glBooks:mapped.stats.glBooks,sourceWatermark:mapped.stats.sourceWatermark,scope:mapped.stats.scope};
 console.log('MAPPING_REPORT',JSON.stringify(totals));
 must(totals.headers===19&&totals.lines===438&&totals.glLines===438,'source count changed since Phase B; revalidate coverage before backfill');
 must(totals.mainline===totals.headers&&totals.itemLines===419,'line structure changed');
 console.log('MODULE 15 PHASE D MAPPING PASS '+JSON.stringify({exactDecimal:true,writeOperations:0,checkpointChanges:0,schedulerChanges:0,otherModuleWrites:0}));
}catch(e){console.error('MODULE 15 PHASE D BLOCKED:',e?.stack??String(e));process.exitCode=1;}
