import { defs, source, state, compareIds, stored, status, intro, finish, key } from './audit-common.mjs';
const trim = x => x===null||x===undefined||x===''?null:String(x);
// Compare invariant fields only where BQ client may serialize dates/NUMERIC differently.
function canonical(v){const x=trim(v);if(x===null)return null;if(typeof v==='boolean')return v?'true':'false';if(x==='T')return 'true';if(x==='F')return 'false';if(/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(x)){
 const z=x.match(/^([-+]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
 if(z){const digits=(z[2]+(z[3]??'')).replace(/^0+/,'')||'0';const shift=Number(z[4]??0)-(z[3]??'').length;if(Math.abs(shift)>100)return x;const pt=digits.length+shift;const n=pt<=0?'0.'+'0'.repeat(-pt)+digits:pt>=digits.length?digits+'0'.repeat(pt-digits.length):digits.slice(0,pt)+'.'+digits.slice(pt);const [a,b='']=n.split('.');const out=a.replace(/^0+(?=\d)/,'')+(b.replace(/0+$/,'')?'.'+b.replace(/0+$/,''):'');return (z[1]==='-'&&out!=='0'?'-':'')+out;}
 }return x.replace('T',' ');}
async function main(){
 const m=await source(),s=await state();intro('CHECK',s);
 if(s.mode==='SCHEMA_ONLY'){
  if(defs.some(d=>m[d.group].length))throw Error('SCHEMA_ONLY but source records exist: NEEDS_SYNC');
  for(const d of defs){const rows=await stored(d);if(rows.length)throw Error('SCHEMA_ONLY has unexpected target rows: '+d.table);}
  finish('CHECK',s);return;
 }
 if(s.mode==='NOT_INITIALIZED'){
  if(defs.some(d=>m[d.group].length))throw Error('Source present but target missing: NEEDS_SYNC');finish('CHECK',s);return;
 }
 let fail=false;
 for(const d of defs){
  const src=m[d.group],dst=await stored(d),count=compareIds(src,dst,d.keys),byKey=new Map(dst.map(r=>[key(r,d.keys),r]));let mismatch=0;const sample=[];
  for(const r of src){const t=byKey.get(key(r,d.keys));if(!t)continue;const fields=Object.keys(r).filter(f=>f in t);const diff=fields.filter(f=>canonical(r[f])!==canonical(t[f]));if(diff.length){mismatch++;if(sample.length<5)sample.push({key:key(r,d.keys),fields:diff});}}
  const ok=status(count)==='PASS'&&mismatch===0;console.log(d.table,JSON.stringify({...count,fieldMismatch:mismatch,samples:sample,status:ok?'PASS':'FAIL'}));if(!ok)fail=true;
 }
 if(fail)throw Error('CHECK FAILED');finish('CHECK',s);
}
main().catch(e=>{console.error(e.stack??e);process.exitCode=1});
