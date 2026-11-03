// Module 11 Vendor Credit standalone verified soft-deletion (CCM baseline adaptation).
// Strict scoped inventory, independent deletedrecord proof, fresh source absence, max 3.
// Never touches lines, GL, links, checkpoints, other modules, or scheduler.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {token,fetchHeaders,FROM} from './mapping.mjs';
import {fetchAll} from '../../common/netsuite-client.mjs';
import {query,T} from '../../common/bigquery-client.mjs';
import {matchDeletedRecordProof} from '../../common/verified-deletion-proof.mjs';

const mode=process.argv[2];
if(process.argv.length!==3||!['--dry-run','--apply'].includes(mode))throw Error('Usage: node modules/vendor-credit/verified-deletion.mjs --dry-run|--apply');
const APPLY=mode==='--apply',MAX=3,ID=/^[1-9][0-9]{0,14}$/;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const table=T('vendor_credit_headers');
const identityPath=path.join(root,'modules','vendor-credit','deletion-identity.confirmed.json');
const fail=s=>{throw Error('VENDOR CREDIT VERIFIED DELETION BLOCKED: '+s)};
const get=x=>x&&typeof x==='object'&&'value' in x?x.value:x;
function id(x){const v=String(get(x)??'');if(!ID.test(v))fail('Invalid ID '+v);return v;}
function identity(){
 if(!fs.existsSync(identityPath))fail('Missing independent deletion identity confirmation');
 const c=JSON.parse(fs.readFileSync(identityPath,'utf8'));
 if(c.module!=='vendor-credit'||c.transactionType!=='VendCred'||c.independentlyVerified!==true||c.recordtypeid!=='vendorcredit'||c.type!=='VENDORCREDIT'||c.scope!==`${FROM}..open-ended`||!Array.isArray(c.evidenceRecordIds)||c.evidenceRecordIds.length!==3||new Set(c.evidenceRecordIds).size!==3||!c.evidenceRecordIds.every(x=>ID.test(x)))fail('Incomplete/mismatched identity contract');
 return c;
}
async function exactProof(access,rawId,c){
 const x=id(rawId);
 const rows=await fetchAll(access,`SELECT recordid,recordtypeid,type,deleteddate,deletedby,context FROM deletedrecord WHERE recordid=${x}`);
 const matches=matchDeletedRecordProof(rows,x,c);
 if(matches.length!==1)fail(`Missing/nonunique exact deletedrecord proof id=${x} matches=${matches.length}`);
 return matches[0];
}
async function absentGlobally(access,rawId){
 const x=id(rawId);
 const rows=await fetchAll(access,`SELECT id,type FROM Transaction WHERE id=${x}`);
 if(rows.length!==0)fail('Still present in Transaction source id='+x);
}
async function bqHeader(rawId){
 const x=id(rawId);
 const rows=await query(`SELECT vendor_credit_id,CAST(transaction_date AS STRING) AS transaction_date,COALESCE(is_deleted,FALSE) AS is_deleted FROM ${table} WHERE vendor_credit_id=@id`,{id:x});
 if(rows.length!==1||rows[0].is_deleted!==false||rows[0].transaction_date<FROM)fail('Target not unique/active/in scope id='+x);
}
async function inventory(access){
 const [source,targets]=await Promise.all([fetchHeaders(access),query(`SELECT vendor_credit_id FROM ${table} WHERE COALESCE(is_deleted,FALSE)=FALSE AND transaction_date >= DATE(@from)`,{from:FROM})]);
 const src=source.map(r=>id(r.internal_id)),tgt=targets.map(r=>id(r.vendor_credit_id));
 if(new Set(src).size!==src.length||new Set(tgt).size!==tgt.length)fail('Duplicate source/target ID');
 const ss=new Set(src),ts=new Set(tgt);
 const onlyNS=[...ss].filter(x=>!ts.has(x)).sort();
 const onlyBQ=[...ts].filter(x=>!ss.has(x)).sort();
 console.log('INVENTORY',JSON.stringify({source:src.length,bigQueryActive:tgt.length,onlyNetSuite:onlyNS,onlyBigQuery:onlyBQ}));
 if(onlyNS.length)fail('Unsynced NetSuite records: '+onlyNS.join(','));
 if(onlyBQ.length>MAX)fail('Candidates exceed max batch 3, refuse partial apply');
 return onlyBQ;
}
function audit(row){
 const dir=path.join(root,'logs','verified-deletions');fs.mkdirSync(dir,{recursive:true});
 fs.appendFileSync(path.join(dir,'audit.jsonl'),JSON.stringify(row)+'\n');
}
async function main(){
 console.log('MODULE 11 VENDOR CREDIT VERIFIED DELETION',mode,'| STANDALONE | MAX_BATCH=3');
 console.log(`SCOPE ${FROM}..OPEN ENDED | header-only | no checkpoint change`);
 const c=identity();
 const access=await token();console.log('OAuth: SUCCESS');
 const candidates=await inventory(access);
 if(!candidates.length){console.log('MODULE 11 VERIFIED DELETION CLEAN PASS: no candidates | ZERO WRITES');return;}
 // Verify all three historical tuple samples independently before considering new candidates.
 for(const evidenceId of c.evidenceRecordIds){await exactProof(access,evidenceId,c);await absentGlobally(access,evidenceId);}
 console.log('IDENTITY LIVE RECONFIRMED',JSON.stringify({recordtypeid:c.recordtypeid,type:c.type,evidence:3}));
 for(const x of candidates){await exactProof(access,x,c);await absentGlobally(access,x);await bqHeader(x);console.log('CANDIDATE PROOF PASS',x);}
 if(!APPLY){console.log('MODULE 11 VERIFIED DELETION DRY RUN PASS | candidates='+candidates.length+' | ZERO WRITES');return;}
 if(process.env.NETSUITE_VERIFIED_DELETE_CONFIRM!=='I_CONFIRM_VERIFIED_SOFT_DELETE')fail('Explicit apply confirmation absent');
 // Refresh the complete inventory before any mutation; never blindly use old candidates.
 const again=await inventory(await token());
 if(JSON.stringify(again)!==JSON.stringify(candidates))fail('Candidate inventory changed before apply');
 for(const x of candidates){
   const live=await token();
   const e=await exactProof(live,x,c);await absentGlobally(live,x);await bqHeader(x);
   // Only the specific header can change; child records and checkpoint never change.
   await query(`BEGIN\nBEGIN TRANSACTION;\nASSERT (SELECT COUNT(*) FROM ${table} WHERE vendor_credit_id=@id AND transaction_date >= DATE(@from) AND COALESCE(is_deleted,FALSE)=FALSE)=1 AS 'Scoped active header changed';\nUPDATE ${table} SET is_deleted=TRUE,deleted_at=CURRENT_TIMESTAMP() WHERE vendor_credit_id=@id AND transaction_date >= DATE(@from) AND COALESCE(is_deleted,FALSE)=FALSE;\nASSERT (SELECT COUNT(*) FROM ${table} WHERE vendor_credit_id=@id AND is_deleted=TRUE AND deleted_at IS NOT NULL)=1 AS 'Soft-delete failed';\nCOMMIT TRANSACTION;`,{id:x,from:FROM});
   const check=await query(`SELECT is_deleted,deleted_at FROM ${table} WHERE vendor_credit_id=@id`,{id:x});
   if(check.length!==1||check[0].is_deleted!==true||!check[0].deleted_at)fail('Post-commit verification failed id='+x);
   audit({at:new Date().toISOString(),module:'vendor-credit',id:x,recordtypeid:e.recordtypeid,type:e.type,deleteddate:e.deleteddate,deletedby:e.deletedby,result:'SOFT_DELETED'});
   console.log('VERIFIED SOFT DELETE PASS',x);
 }
 console.log('MODULE 11 VERIFIED DELETION APPLY PASS | deleted='+candidates.length+' | children/checkpoints untouched');
}
main().catch(e=>{console.error(e?.stack??String(e));process.exitCode=1;});
