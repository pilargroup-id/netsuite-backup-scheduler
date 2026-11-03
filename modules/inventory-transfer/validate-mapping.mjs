// Module 14 Phase D: complete source-to-schema validation. NO WRITES.
import {token,fetchHeaders,fetchLines,mapSource} from './mapping.mjs';
import {dataset,query,T} from '../../common/bigquery-client.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
const must=(ok,msg)=>{if(!ok)throw Error('MODULE 14 MAPPING BLOCKED: '+msg);};
function units(value){const s=String(value??'0');must(/^-?\d+(?:\.\d{1,9})?$/.test(s),'bad quantity '+s);const neg=s.startsWith('-');const [i,f='']=s.replace('-','').split('.');const n=BigInt(i)*1000000000n+BigInt(f.padEnd(9,'0'));return neg?-n:n;}
async function main(){
 must(process.argv.length===2,'this command takes no flags');
 console.log('MODULE 14 INVENTORY TRANSFER FULL MAPPING GATE | STRICT READ ONLY');
 for(const g of GROUPS){const tb=dataset.table(g.table);const [exists]=await tb.exists();must(exists,'missing table '+g.table);const [meta]=await tb.getMetadata();const cols=meta.schema?.fields??[];for(const [name,type] of columnDefinitions(g)){const c=cols.find(x=>x.name.toLowerCase()===name.toLowerCase());must(c&&String(c.type).toUpperCase().replace('BOOLEAN','BOOL')===type,'schema mismatch '+g.table+'.'+name);}const result=await query(`SELECT COUNT(*) AS n FROM ${T(g.table)}`);must(Number(result[0]?.n)===0,'target not empty '+g.table);}
 const cp=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN ('inventory_transfer_headers','inventory_transfer_lines')`);must(cp.length===0,'Module 14 checkpoint already exists');
 const a=await token();console.log('OAuth: SUCCESS');const headers=await fetchHeaders(a);must(headers.length>0,'no source headers');const lines=await fetchLines(a,headers.map(h=>h.internal_id));const m=mapSource(headers,lines);
 must(m.headers.length===headers.length&&m.lines.length===lines.length,'mapping count changed');const mainlines=new Map(),totals=new Map(),locs=new Map();let positive=0,negative=0,zero=0,nullQuantityAdjustment=0;
 for(const l of m.lines){if(l.is_mainline){mainlines.set(l.transfer_internal_id,(mainlines.get(l.transfer_internal_id)??0)+1);continue;}must(l.item_id!=null,'nonmainline missing item '+l.transfer_internal_id);if(l.quantity==null){must(l.memo?.trim()==='Cost of Sales Adjustment','unexpected null quantity memo '+l.transfer_internal_id+'|'+l.line_unique_key);must(l.location_id!=null,'adjustment missing location '+l.transfer_internal_id+'|'+l.line_unique_key);must(l.units_id==null,'adjustment with units '+l.transfer_internal_id+'|'+l.line_unique_key);nullQuantityAdjustment++;continue;}const q=units(l.quantity);positive+=Number(q>0n);negative+=Number(q<0n);zero+=Number(q===0n);const k=l.transfer_internal_id+'|'+l.item_id;totals.set(k,(totals.get(k)??0n)+q);if(!locs.has(k))locs.set(k,new Set());if(l.location_id!=null)locs.get(k).add(l.location_id);}
 must(mainlines.size===m.headers.length,'missing mainlines');for(const h of m.headers)must(mainlines.get(h.internal_id)===1,'mainline not exactly one '+h.internal_id);for(const [k,n] of totals){must(n===0n,'unbalanced transfer item '+k);must((locs.get(k)?.size??0)>=2,'single-location group '+k);}
 const watermark=m.headers.map(h=>h.last_modified).sort().at(-1);console.log('MAPPING',JSON.stringify({headers:m.headers.length,lines:m.lines.length,mainlines:mainlines.size,positive,negative,zero,nullQuantityAdjustment,balancedItemGroups:totals.size,watermark,sourceLocationField:'Transaction.location',destinationLocationField:'Transaction.transferlocation',bqWrites:0,checkpointChanges:0,schedulerChanges:0}));
 console.log('MODULE 14 PHASE D FULL MAPPING PASS');
}
main().catch(e=>{console.error('MODULE 14 PHASE D MAPPING BLOCKED',e.stack??e.message);process.exitCode=1;});
