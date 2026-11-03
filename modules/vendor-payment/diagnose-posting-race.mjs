// Module 12 standalone diagnosis: NetSuite read-only. No BigQuery writes.
import {token,fetchHeaders,fetchGL,fetchLines,fetchPreviousLinks,fetchNextLinks} from './mapping.mjs';
const target='3164728';
if(process.argv.length!==2)throw Error('Usage: node modules/vendor-payment/diagnose-posting-race.mjs');
const rows=x=>x.map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!=='links')));
async function snapshot(auth,label){
 const headers=await fetchHeaders(auth);
 const h=headers.find(x=>String(x.internal_id)===target);
 if(!h)throw Error('Target header not visible; STOP; do not infer deletion');
 const ids=[target];
 const [gl,lines,previous,next]=await Promise.all([fetchGL(auth,ids),fetchLines(auth,ids),fetchPreviousLinks(auth,ids),fetchNextLinks(auth,ids)]);
 const flags={};for(const r of gl){const k=String(r.posting??'NULL');flags[k]=(flags[k]??0)+1;}
 const result={label,header:{internal_id:h.internal_id,transaction_number:h.transaction_number,last_modified:h.last_modified,status_id:h.status_id,posting:h.posting,void:h.void,voided:h.voided,isreversal:h.isreversal,amount_used:h.amount_used,amount_unused:h.amount_unused},glCount:gl.length,glPostingFlags:flags,gl:rows(gl),lineCount:lines.length,previousCount:previous.length,nextCount:next.length};
 console.log('SNAPSHOT',JSON.stringify(result));
 return result;
}
async function main(){console.log('MODULE 12 TARGET POSTING RACE DIAGNOSTIC | NETSUITE READ ONLY | '+target);const auth=await token();console.log('OAuth: SUCCESS');const a=await snapshot(auth,'A');const b=await snapshot(auth,'B');const same=JSON.stringify({...a,label:''})===JSON.stringify({...b,label:''});const consistent=x=>x.glCount>0&&Object.keys(x.glPostingFlags).every(k=>k===x.header.posting);
 console.log('DIAGNOSIS',JSON.stringify({stableDoubleRead:same,postingConsistentA:consistent(a),postingConsistentB:consistent(b),status:same&&consistent(a)&&consistent(b)?'TARGET_STABLE_NOW_ONLY':'BLOCKED_INVESTIGATE_SOURCE_OR_PERMISSION',writes:0,checkpointChanges:0,schedulerChanges:0}));
 if(!same||!consistent(a)||!consistent(b))process.exitCode=2;
}
main().catch(e=>{console.error('DIAGNOSTIC BLOCKED',e.stack??String(e));process.exitCode=1;});
