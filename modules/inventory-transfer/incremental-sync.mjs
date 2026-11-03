// Module 14 ONLY: atomic scoped incremental, no automatic header deletion.
// --dry-run is strictly read-only. --sync requires an explicit Module 14 confirmation.
import {dataset,query,T,LOCATION} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,mapSource} from './mapping.mjs';
import {GROUPS} from './schema-contract.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const H=GROUPS[0],L=GROUPS[1],names=GROUPS.map(g=>g.table),quoted=names.map(s=>`'${s}'`).join(',');
const assert=(x,m)=>{if(!x)throw Error('MODULE 14 INCREMENTAL BLOCKED: '+m);};
const mode=process.argv[2];
function normalize(t,v){
 if(v==null)return null;
 if(typeof v==='object'&&'value' in v)v=v.value;
 if(t==='BOOL')return v===true||String(v).toLowerCase()==='true'||String(v).toUpperCase()==='T'?'true':'false';
 if(t==='DATETIME')return String(v).replace('T',' ').slice(0,19);
 if(t==='DATE')return String(v).slice(0,10);
 if(t==='NUMERIC'){
  const s=String(v).trim(),m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  assert(m,'invalid decimal '+s);const exp=Number(m[4]??0),shift=9-(m[3]?.length??0)+exp;
  assert(Math.abs(exp)<100,'invalid decimal exponent '+s);
  const n=BigInt(m[2]+(m[3]??''));let scaled;
  if(shift>=0)scaled=n*10n**BigInt(shift);
  else {const d=10n**BigInt(-shift);assert(n%d===0n,'quantity more than nine decimals');scaled=n/d;}
  return String(m[1]==='-'?-scaled:scaled);
 }
 return String(v);
}
function rowSignature(g,r){return JSON.stringify(g.fields.map(([k,t])=>normalize(t,r[k])));}
function rowIndex(g,rows){const index=new Map();for(const r of rows){const k=JSON.stringify(g.key.map(f=>String(r[f])));assert(!index.has(k),'duplicate '+g.table+' key '+k);index.set(k,r);}return index;}
async function checkpoint(){const rows=await query(`SELECT record_type,CAST(last_successful_modified_at AS STRING) wm FROM ${T('sync_checkpoints')} WHERE record_type IN (${quoted}) ORDER BY record_type`);assert(rows.length===2&&rows[0].record_type!==rows[1].record_type&&rows[0].wm===rows[1].wm,'two aligned Module 14 checkpoints required');return rows[0].wm;}
async function stored(g){const cols=g.fields.map(([f])=>`CAST(\`${f}\` AS STRING) AS \`${f}\``).join(',');return query(`SELECT ${cols}${g===H?',is_deleted,CAST(deleted_at AS STRING) deleted_at':''} FROM ${T(g.table)}`);}
function validateSnapshot(mapped){
 const ids=new Set(),lineKeys=new Set(),main=new Map(),sum=new Map(),loc=new Map();let nullAdj=0;
 for(const h of mapped.headers){assert(!ids.has(h.internal_id),'duplicate header');ids.add(h.internal_id);}
 assert(ids.size>0,'empty source scope');
 for(const l of mapped.lines){const id=l.transfer_internal_id;assert(ids.has(id),'orphan line');const k=id+'|'+l.line_unique_key;assert(!lineKeys.has(k),'duplicate line');lineKeys.add(k);
  if(l.is_mainline){main.set(id,(main.get(id)??0)+1);continue;}
  assert(l.item_id!=null&&l.location_id!=null,'missing stock item/location '+k);
  if(l.quantity==null){assert(String(l.memo??'').trim().toLowerCase()==='cost of sales adjustment','non-adjustment NULL qty '+k);nullAdj++;continue;}
  const value=BigInt(normalize('NUMERIC',l.quantity));const group=id+'|'+l.item_id;
  sum.set(group,(sum.get(group)??0n)+value);if(!loc.has(group))loc.set(group,new Set());loc.get(group).add(l.location_id);
 }
 for(const id of ids)assert(main.get(id)===1,'mainline !=1 '+id);
 for(const [k,v] of sum){assert(v===0n,'unbalanced qty '+k);assert(loc.get(k).size>=2,'single-location '+k);}
 return {headers:ids.size,lines:lineKeys.size,nullAdjustment:nullAdj,balancedItemGroups:sum.size};
}
async function snapshot(){const a=await token();console.log('OAuth: SUCCESS');const h=await fetchHeaders(a);const lines=await fetchLines(a,h.map(x=>x.internal_id));const mapped=mapSource(h,lines);const stats=validateSnapshot(mapped);const watermark=mapped.headers.map(x=>x.last_modified).sort().at(-1);return {mapped,stats,watermark};}
function canonical(mapped){const hash=crypto.createHash('sha256');for(const g of GROUPS){const rows=g===H?mapped.headers:mapped.lines;hash.update(g.table+'\n');for(const s of rows.map(r=>rowSignature(g,r)).sort())hash.update(s+'\n');}return hash.digest('hex');}
function plan(mapped,targetH,targetL,cp){
 const srcH=rowIndex(H,mapped.headers),srcL=rowIndex(L,mapped.lines),bqH=rowIndex(H,targetH),bqL=rowIndex(L,targetL);
 for(const h of targetH){assert(h.is_deleted===false||String(h.is_deleted).toLowerCase()==='false','soft-deleted row in target requires separate deletion-aware workflow '+h.internal_id);assert(h.deleted_at==null,'deleted_at exists '+h.internal_id);assert(srcH.has(JSON.stringify([String(h.internal_id)])),'source-absent header requires independent deletion proof '+h.internal_id);}
 const changed=new Set();for(const [k,s] of srcH){const b=bqH.get(k);if(!b||rowSignature(H,s)!==rowSignature(H,b))changed.add(s.internal_id);}
 for(const [k,s] of srcL){const b=bqL.get(k);if(!b||rowSignature(L,s)!==rowSignature(L,b))changed.add(s.transfer_internal_id);}
 for(const [k,b] of bqL){if(!srcL.has(k)){const id=String(b.transfer_internal_id);assert(srcH.has(JSON.stringify([id])),'orphan BQ line of absent source header '+id);changed.add(id);}}
 const newer=mapped.headers.filter(h=>h.last_modified>cp).length;
 return {changed:[...changed].sort(),newer,sourceHeaders:mapped.headers.length,sourceLines:mapped.lines.length,storedHeaders:targetH.length,storedLines:targetL.length};
}
async function stage(g,rows,suffix){const name=`_stage_invtrnfr_delta_${g===H?'h':'l'}_${suffix}`;const f=path.join(os.tmpdir(),`invtrnfr-${crypto.randomUUID()}.ndjson`);assert(rows.length>0,'unexpected empty stage');await fs.writeFile(f,rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});try{await dataset.table(name).load(f,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:g.fields.map(([name,type])=>({name,type}))},location:LOCATION});}finally{await fs.rm(f,{force:true});}const r=await query(`SELECT COUNT(*) n FROM ${T(name)}`);assert(Number(r[0].n)===rows.length,'stage count mismatch '+g.table);return {g,name,count:rows.length};}
function commitSql(sh,sl){
 const h=T(sh.name),l=T(sl.name),th=T(H.table),tl=T(L.table),cp=T('sync_checkpoints');
 const hfields=H.fields.map(([n])=>n),lfields=L.fields.map(([n])=>n);
 const update=hfields.filter(n=>n!=='internal_id').map(n=>`d.\`${n}\`=s.\`${n}\``).concat('d.synced_at=CURRENT_TIMESTAMP()').join(',');
 const headerInsert=hfields.map(n=>`\`${n}\``).concat('synced_at','is_deleted','deleted_at');
 const headerValues=hfields.map(n=>`s.\`${n}\``).concat('CURRENT_TIMESTAMP()','FALSE','NULL');
 return `BEGIN\nBEGIN TRANSACTION;
ASSERT (SELECT COUNT(*) FROM ${cp} WHERE record_type IN (${quoted}) AND last_successful_modified_at=DATETIME(@oldCp))=2 AS 'Module14 checkpoint changed';
ASSERT (SELECT COUNT(*) FROM ${h})=${sh.count} AS 'header stage count';
ASSERT (SELECT COUNT(*) FROM ${l})=${sl.count} AS 'line stage count';
ASSERT (SELECT COUNT(*) FROM (SELECT internal_id FROM ${h} GROUP BY internal_id HAVING COUNT(*)>1))=0 AS 'header stage duplicate';
ASSERT (SELECT COUNT(*) FROM (SELECT transfer_internal_id,line_unique_key FROM ${l} GROUP BY 1,2 HAVING COUNT(*)>1))=0 AS 'line stage duplicate';
ASSERT (SELECT COUNT(*) FROM ${th} d JOIN ${h} s USING(internal_id) WHERE d.is_deleted IS DISTINCT FROM FALSE OR d.deleted_at IS NOT NULL)=0 AS 'deleted header resurrection blocked';
DELETE FROM ${tl} d WHERE EXISTS(SELECT 1 FROM ${h} s WHERE s.internal_id=d.transfer_internal_id);
MERGE ${th} d USING ${h} s ON d.internal_id=s.internal_id
WHEN MATCHED THEN UPDATE SET ${update}
WHEN NOT MATCHED THEN INSERT(${headerInsert.join(',')}) VALUES(${headerValues.join(',')});
INSERT INTO ${tl} (${lfields.map(n=>`\`${n}\``).join(',')},synced_at) SELECT ${lfields.map(n=>`\`${n}\``).join(',')},CURRENT_TIMESTAMP() FROM ${l};
ASSERT (SELECT COUNT(*) FROM ${tl} d JOIN ${h} s ON d.transfer_internal_id=s.internal_id)=${sl.count} AS 'replaced line count mismatch';
UPDATE ${cp} SET last_successful_modified_at=DATETIME(@newCp),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP() WHERE record_type IN (${quoted});
COMMIT TRANSACTION;
EXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;
END;`;
}
async function main(){
 assert(process.argv.length===3&&['--dry-run','--sync'].includes(mode),'use --dry-run or --sync');
 if(mode==='--sync')assert(process.env.NETSUITE_INVENTORY_TRANSFER_INCREMENTAL_CONFIRM==='MODULE14_ONLY','explicit Module14 sync confirmation required');
 console.log('MODULE 14 ISOLATED INCREMENTAL',mode);
 const cp=await checkpoint();const first=await snapshot();assert(first.watermark>=cp,'source watermark behind checkpoint');
 const targetH=await stored(H),targetL=await stored(L),p=plan(first.mapped,targetH,targetL,cp);
 console.log('PLAN',JSON.stringify({checkpoint:cp,sourceWatermark:first.watermark,...first.stats,...p,schedulerChanges:0,otherModuleWrites:0,automaticDeletions:0}));
 if(mode==='--dry-run'){console.log('MODULE 14 INCREMENTAL DRY RUN PASS: ZERO WRITES');return;}
 if(!p.changed.length){console.log('MODULE 14 INCREMENTAL PASS_NO_CHANGE: ZERO WRITES');return;}
 assert(await checkpoint()===cp,'checkpoint changed before staging');
 const second=await snapshot();assert(first.watermark===second.watermark&&canonical(first.mapped)===canonical(second.mapped),'source changed during validation');
 const targetH2=await stored(H),targetL2=await stored(L),p2=plan(second.mapped,targetH2,targetL2,cp);
 assert(JSON.stringify(p.changed)===JSON.stringify(p2.changed),'target changed before staging');
 const changed=new Set(p.changed),headRows=second.mapped.headers.filter(r=>changed.has(r.internal_id)),lineRows=second.mapped.lines.filter(r=>changed.has(r.transfer_internal_id));
 assert(headRows.length>0&&lineRows.length>0,'changed document missing header/line');
 const stages=[],suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);
 try{
  stages.push(await stage(H,headRows,suffix));stages.push(await stage(L,lineRows,suffix));
  const third=await snapshot();assert(third.watermark===second.watermark&&canonical(second.mapped)===canonical(third.mapped),'source changed during staging');
  assert(await checkpoint()===cp,'checkpoint changed during staging');
  const sql=commitSql(stages[0],stages[1]);
  for(let attempt=1;attempt<=6;attempt++){
   try{await query(sql,{oldCp:cp,newCp:second.watermark});break;}
   catch(e){const m=String(e.message??e);if(!/Transaction is aborted due to concurrent update/i.test(m)||attempt===6)throw e;assert(await checkpoint()===cp,'checkpoint changed after concurrency conflict');console.log('CHECKPOINT_CONFLICT_RETRY',JSON.stringify({attempt}));await new Promise(r=>setTimeout(r,Math.min(30000,750*2**(attempt-1))));}
  }
  console.log('MODULE 14 INCREMENTAL COMMIT PASS',JSON.stringify({changedDocuments:p.changed.length,replacedLines:lineRows.length,checkpoint:second.watermark,otherModuleWrites:0,schedulerChanges:0,automaticDeletions:0}));
 }finally{for(const s of stages){try{await dataset.table(s.name).delete({ignoreNotFound:true});}catch(e){console.warn('STAGING CLEANUP WARNING',s.name,e.message);}}}
}
main().catch(e=>{console.error('MODULE 14 INCREMENTAL BLOCKED',e.stack??e.message);process.exitCode=1;});
