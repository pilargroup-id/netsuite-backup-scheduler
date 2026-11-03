// Module 13 Journal Entry - isolated initial backfill with 5-table atomic commit.
// Stage tables are temporary; production modules 1-12 and scheduler are untouched.
import {dataset,query,T,DATASET,LOCATION} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
import {validateNumeric} from '../../common/decimal-precision.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
if(process.argv.length!==3||process.argv[2]!=='--sync'||process.env.NETSUITE_JOURNAL_ENTRY_INITIAL_CONFIRM!=='MODULE13_ONLY')throw Error('Journal Entry initial sync requires exactly --sync and NETSUITE_JOURNAL_ENTRY_INITIAL_CONFIRM=MODULE13_ONLY; run validate-mapping.mjs first');
const must=(ok,msg)=>{if(!ok)throw Error('JOURNAL ENTRY INITIAL DRY-RUN BLOCKED: '+msg);};
const cpNames=GROUPS.map(x=>`'${x.table}'`).join(',');
const number=x=>Number(typeof x==='object'&&x!==null&&'value' in x?x.value:x);
const SCALE=1000000000n;
function units(v){if(v==null)return 0n;must(typeof v==='string'&&/^-?\d+(?:\.\d{1,9})?$/.test(v),'invalid exact decimal '+v);const neg=v.startsWith('-');const [i,f='']=v.replace('-','').split('.');const z=BigInt(i)*SCALE+BigInt(f.padEnd(9,'0'));return neg?-z:z;}
function checkTypes(g,rows){const keys=new Set();for(let i=0;i<rows.length;i++){const r=rows[i];for(const [k,t] of g.fields){const v=r[k];if(v==null)continue;must(t==='BOOL'?typeof v==='boolean':typeof v==='string',`${g.table}[${i}].${k} type`);if(t==='NUMERIC')must(validateNumeric(v,{module:'journal-entry',recordId:r.journal_entry_id,field:k})===v,`${g.table}[${i}].${k} decimal not canonical`);if(t==='DATE')must(/^\d{4}-\d\d-\d\d$/.test(v),`${g.table}[${i}].${k} date`);if(t==='DATETIME')must(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v),`${g.table}[${i}].${k} datetime`);}
 for(const k of g.key)if(!(g.nullableKey??[]).includes(k))must(r[k]!=null&&r[k]!=='',`${g.table}[${i}] missing key ${k}`);
 for(const k of Object.keys(r))must(g.fields.some(f=>f[0]===k),`${g.table}[${i}] unexpected ${k}`);
 const key=JSON.stringify(g.key.map(k=>r[k]??null));must(!keys.has(key),`${g.table}[${i}] duplicate ${key}`);keys.add(key);
}}
async function assertEmpty(){const [cpExists]=await dataset.table('sync_checkpoints').exists();must(cpExists,'shared checkpoint table absent');const cp=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames}) OR record_type IN ('journal-entry','journal_entry')`);must(!cp.length,'Journal Entry checkpoint already exists');
 for(const g of GROUPS){const table=dataset.table(g.table);const [exists]=await table.exists();must(exists,`missing ${g.table}`);const [meta]=await table.getMetadata();const actual=meta.schema?.fields??[],expected=columnDefinitions(g);must(actual.length===expected.length,`${g.table} field count`);for(const [name,type] of expected){const f=actual.find(x=>x.name.toLowerCase()===name.toLowerCase());must(f,`${g.table} missing ${name}`);must((f.type.toUpperCase()==='BOOLEAN'?'BOOL':f.type.toUpperCase())===type,`${g.table}.${name} type`);}const count=await query(`SELECT COUNT(*) n FROM ${T(g.table)}`);must(number(count[0].n)===0,`${g.table} not empty`);}}
function linkSignature(x){return [x.journal_entry_id,x.previous_doc_id,x.previous_line_id,x.next_doc_id,x.next_line_id,x.previous_type,x.next_type,x.link_type,x.applied_amount,x.last_modified].map(v=>v??'<NULL>').join('|');}
async function stage(st){
 const fields=st.g.fields;
 if(st.rows.length===0){
  await query(`CREATE TABLE ${T(st.name)} (${fields.map(([name,type])=>`\`${name}\` ${type}`).join(',')})`);
 }else{
  const filename=path.join(os.tmpdir(),`netsuite-je-${crypto.randomUUID()}.ndjson`);
  await fs.writeFile(filename,st.rows.map(x=>JSON.stringify(x)).join('\n')+'\n',{mode:0o600});
  try{await dataset.table(st.name).load(filename,{sourceFormat:'NEWLINE_DELIMITED_JSON',writeDisposition:'WRITE_TRUNCATE',schema:{fields:fields.map(([name,type])=>({name,type}))},location:LOCATION});}
  finally{await fs.rm(filename,{force:true});}
 }
 const [r]=await query(`SELECT COUNT(*) AS n FROM ${T(st.name)}`);
 must(number(r.n)===st.rows.length,'Staging row mismatch '+st.name);
}
async function checkSourceStability(originalMapped,originalWatermark){
 const a=await token();const hs=await fetchHeaders(a);const ids=hs.map(x=>x.internal_id);
 const [ls,gs,ps,ns]=await Promise.all([fetchLines(a,ids),fetchGL(a,ids),fetchPreviousLinks(a,ids),fetchNextLinks(a,ids)]);
 const now=mapSource(hs,ls,gs,ps,ns);
 for(const group of GROUPS){const sortRows=x=>x.map(r=>JSON.stringify(Object.entries(r).sort(([a],[b])=>a.localeCompare(b)))).sort();const before=sortRows(originalMapped[group.source]);const after=sortRows(now[group.source]);must(before.length===after.length&&before.every((v,i)=>v===after[i]),'live source changed after staging: '+group.table);}
 const wm=hs.map(x=>x.last_modified).filter(Boolean).sort().at(-1);must(wm===originalWatermark,'source watermark changed after staging');
 console.log('SOURCE STABILITY PASS',JSON.stringify({watermark:wm,counts:now.counts}));
}
async function main(){console.log(`MODULE 11 JOURNAL ENTRY INITIAL SYNC | STAGED ATOMIC WRITE | ${DATASET} | ${LOCATION}`);await assertEmpty();const a=await token();const h=await fetchHeaders(a);must(h.length>0,'no live VendCred headers');const ids=h.map(x=>x.internal_id);must(ids.length===new Set(ids.map(String)).size,'duplicate source headers');const [l,gl,p,n]=await Promise.all([fetchLines(a,ids),fetchGL(a,ids),fetchPreviousLinks(a,ids),fetchNextLinks(a,ids)]);const mapped=mapSource(h,l,gl,p,n);
 for(const g of GROUPS){checkTypes(g,mapped[g.source]);console.log('PAYLOAD CONTRACT PASS',g.table,mapped[g.source].length);}
 const balances=new Map();for(const x of mapped.accountingLines){must(x.posting,`GL not posting ${x.journal_entry_id}`);const key=x.journal_entry_id+'|'+x.accounting_book_id;const v=balances.get(key)??0n;balances.set(key,v+units(x.debit)-units(x.credit));}for(const [k,v] of balances)must(v===0n,'GL unbalanced '+k);
 const left=mapped.previousLinks.map(linkSignature).sort(),right=mapped.nextLinks.map(linkSignature).sort();must(left.length===right.length,'link counts unequal');for(let i=0;i<left.length;i++)must(left[i]===right[i],'link mismatch index '+i);
 const wm=h.map(x=>x.last_modified).filter(Boolean).sort().at(-1);must(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(wm??''),'invalid source watermark');await assertEmpty();console.log('SOURCE WATERMARK',wm);console.log('GL BALANCE PASS',balances.size);console.log('LINK MIRROR PASS',left.length);
 const suffix=crypto.randomUUID().replaceAll('-','').slice(0,20);
 const stages=GROUPS.map((g,i)=>({g,rows:mapped[g.source],name:`_stage_je_${i}_${suffix}`}));
 try{
  for(const st of stages){await stage(st);console.log('STAGED',st.g.table,st.rows.length);}
  const asserts=stages.map(st=>{
   const keys=st.g.key.map(k=>`\`${k}\``).join(',');
   return `ASSERT (SELECT COUNT(*) FROM ${T(st.name)})=${st.rows.length} AS 'Stage count ${st.g.table}';\nASSERT (SELECT COUNT(*) FROM (SELECT ${keys} FROM ${T(st.name)} GROUP BY ${keys} HAVING COUNT(*)>1))=0 AS 'Stage duplicate ${st.g.table}';`;
  }).join('\n');
  const inserts=stages.map((st,i)=>{
   const cols=st.g.fields.map(([k])=>`\`${k}\``);
   const extras=i===0?'synced_at,is_deleted,deleted_at':'synced_at';
   const values=i===0?'CURRENT_TIMESTAMP(),FALSE,NULL':'CURRENT_TIMESTAMP()';
   return `INSERT INTO ${T(st.g.table)} (${cols.join(',')},${extras}) SELECT ${cols.join(',')},${values} FROM ${T(st.name)};`;
  }).join('\n');
  const guard=GROUPS.map(g=>`ASSERT (SELECT COUNT(*) FROM ${T(g.table)})=0 AS 'Target already populated ${g.table}';`).join('\n');
  const orphans=GROUPS.slice(1).map(g=>`ASSERT (SELECT COUNT(*) FROM ${T(g.table)} d LEFT JOIN ${T(GROUPS[0].table)} h ON d.journal_entry_id=h.journal_entry_id WHERE h.journal_entry_id IS NULL)=0 AS 'Orphan ${g.table}';`).join('\n');
  const sql=`BEGIN\nBEGIN TRANSACTION;\n${asserts}\nASSERT (SELECT COUNT(*) FROM ${T('sync_checkpoints')} WHERE record_type IN (${cpNames}) OR record_type IN ('journal-entry','journal_entry'))=0 AS 'Journal Entry checkpoint exists';\n${guard}\n${inserts}\n${orphans}\nMERGE ${T('sync_checkpoints')} d USING (SELECT record_type FROM UNNEST([${cpNames}]) AS record_type) s ON d.record_type=s.record_type WHEN MATCHED THEN UPDATE SET last_successful_modified_at=DATETIME(@wm),last_successful_sync_at=CURRENT_TIMESTAMP(),updated_at=CURRENT_TIMESTAMP() WHEN NOT MATCHED THEN INSERT(record_type,last_successful_modified_at,last_successful_sync_at,updated_at) VALUES(s.record_type,DATETIME(@wm),CURRENT_TIMESTAMP(),CURRENT_TIMESTAMP());\nCOMMIT TRANSACTION;\nEXCEPTION WHEN ERROR THEN ROLLBACK TRANSACTION; RAISE;\nEND;`;
  const maxAttempts=3,delays=[1500,3000];
  for(let attempt=1;attempt<=maxAttempts;attempt++){
   await assertEmpty();
   await checkSourceStability(mapped,wm);
   try{await query(sql,{wm});console.log('INITIAL SYNC ATOMIC COMMIT PASS',JSON.stringify({status:'COMMITTED',attempts:attempt,counts:mapped.counts,checkpointRows:GROUPS.length,schedulerChanges:0,deletionOperations:0}));break;}
   catch(e){
    const message=String(e?.message??e);
    const conflict=/transaction is aborted due to concurrent update against table/i.test(message)&&/sync_checkpoints/i.test(message);
    if(!conflict)throw e;
    await assertEmpty();
    if(attempt===maxAttempts)throw Error('Journal Entry checkpoint conflict retries exhausted',{cause:e});
    console.warn('Standalone checkpoint conflict; module targets/checkpoints empty; retry',attempt);
    await new Promise(r=>setTimeout(r,delays[attempt-1]));
   }
  }
 }finally{
  for(const st of stages){try{await dataset.table(st.name).delete({ignoreNotFound:true});}catch(e){console.warn('Staging cleanup failed',st.name,e.message);}}
 }
}
main().catch(e=>{console.error('JOURNAL ENTRY INITIAL SYNC BLOCKED',e?.stack??String(e));process.exitCode=1;});
