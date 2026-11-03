// Module 12 Vendor Payment: bounded, strictly read-only diagnosis.
// No BigQuery import, DDL/DML, checkpoint, scheduling, or file writes.
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks} from './mapping.mjs';
const target = '3161565';
const val=x=>x==null?null:String(x);
const out=(label,data)=>console.log(label,JSON.stringify(data));
async function main(){
 console.log('MODULE 12 VENDOR PAYMENT NONPOSTING DIAGNOSTIC | READ ONLY');
 const a=await token();
 const all=await fetchHeaders(a);
 const non=all.filter(x=>val(x.posting)==='F');
 const specific=all.find(x=>val(x.internal_id)===target);
 if(!specific)throw Error('Target not found in source window: '+target);
 out('SOURCE HEADER COUNTS',{all:all.length,nonposting:non.length});
 out('TARGET HEADER',specific);
 const ids=non.map(x=>val(x.internal_id));
 const gl=await fetchGL(a,ids);
 const glById=new Map();
 for(const g of gl){const k=val(g.transaction_id);if(!glById.has(k))glById.set(k,[]);glById.get(k).push(g);}
 const flags={};for(const g of gl){const k=val(g.posting)??'NULL';flags[k]=(flags[k]??0)+1;}
 out('ALL NONPOSTING GL SUMMARY',{nonpostingHeaders:non.length,nonpostingHeadersWithGL:glById.size,glRows:gl.length,glPostingFlags:flags});
 out('NONPOSTING HEADER GL COUNTS',non.map(h=>({id:val(h.internal_id),status:val(h.status_id),posting:val(h.posting),void:val(h.void),voided:val(h.voided),reversal:val(h.isreversal),glRows:(glById.get(val(h.internal_id))??[]).length,glFlags:[...new Set((glById.get(val(h.internal_id))??[]).map(g=>val(g.posting)))]})).filter(x=>x.glRows>0).slice(0,100));
 out('TARGET GL',glById.get(target)??[]);
 out('TARGET LINES',await fetchLines(a,[target]));
 out('TARGET PREVIOUS LINKS',await fetchPreviousLinks(a,[target]));
 out('TARGET NEXT LINKS',await fetchNextLinks(a,[target]));
 console.log('MODULE 12 NONPOSTING DIAGNOSTIC COMPLETE | ZERO WRITES');
}
main().catch(e=>{console.error('MODULE 12 NONPOSTING DIAGNOSTIC BLOCKED',e?.stack??String(e));process.exitCode=1;});
