// Module 15 ONLY. Incremental reconciliation with exact decimals; no automatic deletion.
// Run --dry-run for read-only validation. --sync is separately gated and NOT a test command.
import {dataset,query,T,LOCATION} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,mapSource,decimalExact,scaledDecimal} from './mapping.mjs';
import {TABLES} from './schema-contract.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const must=(x,m)=>{if(!x)throw Error('MODULE 15 INCREMENTAL BLOCKED: '+m);};
const G=[{t:TABLES[0],data:'headers',key:['internal_id']},{t:TABLES[1],data:'lines',key:['adjustment_internal_id','line_unique_key']},{t:TABLES[2],data:'accountingLines',key:['adjustment_internal_id','line_id','accounting_book_id','account_id']}];
const cpNames=G.map(g=>`'${g.t.name}'`).join(',');
const fields=g=>g.t.fields.filter(([n])=>!['synced_at','is_deleted','deleted_at'].includes(n));
const names=g=>fields(g).map(([n])=>n);
const num=x=>{const v=Number(x);must(Number.isSafeInteger(v)&&v>=0,'unsafe count');return v;};
const idOf=(g,r)=>g===G[0]?r.internal_id:r.adjustment_internal_id;
const keyOf=(g,r)=>JSON.stringify(g.key.map(k=>String(r[k])));
const norm=(t,v)=>{if(v==null)return null;if(typeof v==='object'&&'value'in v)v=v.value;if(t==='BIGNUMERIC')return decimalExact(v);if(t==='BOOL')return v===true||String(v).toUpperCase()==='TRUE'||String(v).toUpperCase()==='T';if(t==='DATETIME')return String(v).replace('T',' ').slice(0,19);if(t==='DATE')return String(v).slice(0,10);return String(v);};
const signature=(g,r)=>JSON.stringify(fields(g).map(([k,t])=>norm(t,r[k])));
function idx(g,rs){const m=new Map();for(const r of rs){const k=keyOf(g,r);must(!m.has(k),'duplicate '+g.t.name+' '+k);m.set(k,r);}return m;}
async function checkpoint(){const r=await query(`SELECT record_type,CAST(last_successful_modified_at AS STRING) wm FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames}) ORDER BY record_type`);must(r.length===3&&new Set(r.map(x=>x.record_type)).size===3&&r.every(x=>x.wm===r[0].wm),'3 aligned Module15 checkpoints required');return r[0].wm;}
async function stored(g){const cols=fields(g).map(([f])=>`CAST(\`${f}\` AS STRING) AS \`${f}\``).join(',');return query(`SELECT ${cols}${g===G[0]?',is_deleted,CAST(deleted_at AS STRING) deleted_at':''} FROM ${T(g.t.name)}`);}
async function snapshot(){const a=await token();const heads=await fetchHeaders(a);must(heads.length>0,'NO_SOURCE');const ids=heads.map(x=>x.internal_id);const [lines,gl]=await Promise.all([fetchLines(a,ids),fetchGL(a,ids)]);const x=mapSource(heads,lines,gl);return x;}
function digest(data){const h=crypto.createHash('sha256');for(const g of G){h.update(g.t.name+'\n');for(const v of data[g.data].map(r=>signature(g,r)).sort())h.update(v+'\n');}return h.digest('hex');}
function plan(source,target,cp){
 const hIndex=idx(G[0],source.headers),bh=idx(G[0],target[0]);
 const active=new Set(source.headers.map(r=>r.internal_id));
 for(const r of target[0]){must(r.is_deleted===false||String(r.is_deleted).toLowerCase()==='false','soft-deleted target header requires separate deletion workflow '+r.internal_id);must(r.deleted_at==null,'deleted_at populated '+r.internal_id);must(active.has(String(r.internal_id)),'source-absent header requires independent deletion proof '+r.internal_id);}
 const changed=new Set();let newDocs=0;
 for(const [k,s] of hIndex){const t=bh.get(k);if(!t){newDocs++;changed.add(s.internal_id);}else if(signature(G[0],s)!==signature(G[0],t))changed.add(s.internal_id);}
 for(let j=1;j<3;j++){const g=G[j],si=idx(g,source[g.data]),ti=idx(g,target[j]);
  for(const [k,s] of si)if(!ti.has(k)||signature(g,s)!==signature(g,ti.get(k)))changed.add(idOf(g,s));
  for(const [k,t] of ti)if(!si.has(k)){must(active.has(idOf(g,t)),'orphan target row of absent document '+idOf(g,t));changed.add(idOf(g,t));}
 }
 must(source.headers.every(h=>h.last_modified<=source.headers.map(x=>x.last_modified).sort().at(-1)),'invalid header watermark');
 const newer=source.headers.filter(h=>h.last_modified>cp).length;
 return {changed:[...changed].sort(),newDocs,newer,sourceCounts:G.map(g=>source[g.data].length),storedCounts:target.map(x=>x.length)};
}
async function stage(g,rows,name){must(rows.length>0,'empty stage '+g.t.name);const f=path.join(os.tmpdir(),`invadj-${crypto.randomUUID()}.ndjson`);await fs.writeFile(f,rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});try{await dataset.table(name).load(f,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:fields(g).map(([name,type])=>({name,type}))},location:LOCATION});}finally{await fs.rm(f,{force:true});}const x=await query(`SELECT COUNT(*) n FROM ${T(name)}`);must(num(x[0].n)===rows.length,'stage mismatch '+name);}
function sql(st,oldCp,newCp){
 const [sh,sl,sg]=st.map(s=>T(s.name)),[th,tl,tg]=G.map(g=>T(g.t.name)),c=T('sync_checkpoints');
 const hFields=names(G[0]);const hu=hFields.filter(x=>x!=='internal_id').map(x=>`d.\`${x}\`=s.\`${x}\``).concat('d.synced_at=CURRENT_TIMESTAMP()').join(',');
 const hCols=hFields.map(x=>`\`${x}\``);const headerInsert=[...hCols,'synced_at','is_deleted','deleted_at'].join(',');const headerValues=[...hCols.map(x=>`s.${x}`),'CURRENT_TIMESTAMP()','FALSE','NULL'].join(',');
 const checks=st.map((s,i)=>`ASSERT (SELECT COUNT(*) FROM ${T(s.name)})=${s.count} AS 'stage count ${i}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${G[i].key.map(x=>`\`${x}\``).join(',')} FROM ${T(s.name)} GROUP BY ${G[i].key.map(x=>`\`${x}\``).join(',')} HAVING COUNT(*)>1))=0 AS 'stage key duplicate ${i}';`).join('\n');
 const ins=G.slice(1).map((g,i)=>{const cs=names(g).map(x=>`\`${x}\``);return `INSERT INTO ${T(g.t.name)} (${cs.join(',')},synced_at) SELECT ${cs.join(',')},CURRENT_TIMESTAMP() FROM ${T(st[i+1].name)};`;});
 return `BEGIN\nBEGIN TRANSACTION;
ASSERT (SELECT COUNT(*) FROM ${c} WHERE record_type IN (${cpNames}) AND last_successful_modified_at=DATETIME(@oldCp))=3 AS 'Module15 checkpoint changed';
${checks}
ASSERT (SELECT COUNT(*) FROM ${th} d JOIN ${sh} s USING(internal_id) WHERE d.is_deleted IS DISTINCT FROM FALSE OR d.deleted_at IS NOT NULL)=0 AS 'deleted header resurrection denied';
DELETE FROM ${tl} d WHERE EXISTS(SELECT 1 FROM ${sh} s WHERE d.adjustment_internal_id=s.internal_id);
DELETE FROM ${tg} d WHERE EXISTS(SELECT 1 FROM ${sh} s WHERE d.adjustment_internal_id=s.internal_id);
MERGE ${th} d USING ${sh} s ON d.internal_id=s.internal_id WHEN MATCHED THEN UPDATE SET ${hu} WHEN NOT MATCHED THEN INSERT(${headerInsert}) VALUES(${headerValues});
${ins.join('\n')}
ASSERT (SELECT COUNT(*) FROM ${tl} d JOIN ${sh} s ON d.adjustment_internal_id=s.internal_id)=${st[1].count} AS 'line replacement mismatch';
ASSERT (SELECT COUNT(*) FROM ${tg} d JOIN ${sh} s ON d.adjustment_internal_id=s.internal_id)=${st[2].count} AS 'GL replacement mismatch';
UPDATE ${c} SET last_successful_modified_at=DATETIME(@newCp),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP() WHERE record_type IN (${cpNames});
COMMIT TRANSACTION;
EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
END;`;
}
async function main(){const mode=process.argv[2]??'--dry-run';must(process.argv.length<=3&&['--dry-run','--sync'].includes(mode),'usage: --dry-run or --sync');if(mode==='--sync')must(process.env.NETSUITE_INVENTORY_ADJUSTMENT_INCREMENTAL_CONFIRM==='MODULE15_INCREMENTAL_ONLY','explicit Module15 incremental authorization missing');console.log('MODULE 15 INCREMENTAL',mode,'| MODULE15_ONLY | NO SCHEDULER CHANGES');
 const cp=await checkpoint(),first=await snapshot(),wm=first.stats.sourceWatermark;must(wm>=cp,'source watermark behind checkpoint');const target=await Promise.all(G.map(stored));const p=plan(first.data,target,cp);console.log('INCREMENTAL_PLAN',JSON.stringify({checkpoint:cp,sourceWatermark:wm,...p,automaticDeletions:0,otherModuleWrites:0,schedulerChanges:0}));
 if(mode==='--dry-run'){console.log('MODULE 15 PHASE H INCREMENTAL DRY RUN PASS: ZERO WRITES; NO CHECKPOINT CHANGES; NO SCHEDULER CHANGES');return;}
 if(!p.changed.length){console.log('MODULE 15 INCREMENTAL PASS_NO_CHANGE: ZERO WRITES');return;}
 must(await checkpoint()===cp,'checkpoint changed before staging');const second=await snapshot();must(wm===second.stats.sourceWatermark&&digest(first.data)===digest(second.data),'source changed during validation');const target2=await Promise.all(G.map(stored));const p2=plan(second.data,target2,cp);must(JSON.stringify(p.changed)===JSON.stringify(p2.changed),'target changed during validation');const ids=new Set(p.changed),st=[];const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);
 try{for(let i=0;i<G.length;i++){const g=G[i],rows=second.data[g.data].filter(r=>ids.has(idOf(g,r)));must(rows.length>0,'changed document missing '+g.t.name);const s={g,name:`_stage_invadj_delta_${i}_${suffix}`,count:rows.length};st.push(s);await stage(g,rows,s.name);}
  const third=await snapshot();must(third.stats.sourceWatermark===wm&&digest(third.data)===digest(second.data),'source changed during staging');must(await checkpoint()===cp,'checkpoint changed during staging');
  const statement=sql(st,cp,wm);for(let attempt=1;attempt<=6;attempt++){try{await query(statement,{oldCp:cp,newCp:wm});break;}catch(e){const m=String(e?.message??e);if(attempt===6||!/transaction is aborted due to concurrent update/i.test(m))throw e;must(await checkpoint()===cp,'checkpoint changed after conflict');console.log('CHECKPOINT_CONFLICT_RETRY',JSON.stringify({attempt}));await new Promise(r=>setTimeout(r,Math.min(30000,750*2**(attempt-1))));}}
  console.log('MODULE 15 INCREMENTAL COMMIT PASS',JSON.stringify({changedDocuments:p.changed.length,replacedLines:st[1].count,replacedGL:st[2].count,checkpoint:wm,automaticDeletions:0,schedulerChanges:0,otherModuleWrites:0}));
 }finally{for(const x of st)try{await dataset.table(x.name).delete({ignoreNotFound:true});}catch(e){console.warn('STAGE CLEANUP WARNING',x.name,String(e.message??e));}}
}
main().catch(e=>{console.error('MODULE 15 INCREMENTAL BLOCKED',e.stack??e.message);process.exitCode=1;});
