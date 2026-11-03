// CCM B7 standalone verified deletion; mirrors existing verified-deletion baseline.
// No integration with existing scheduler or legacy module files.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {token,fetchHeaders} from './mapping.mjs';
import {fetchAll} from '../../common/netsuite-client.mjs';
import {query,T} from '../../common/bigquery-client.mjs';
import {matchDeletedRecordProof} from '../../common/verified-deletion-proof.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const mode=process.argv[2];
if(process.argv.length!==3||!['--dry-run','--apply'].includes(mode))throw Error('Usage: node modules/customer-credit-memo/verified-deletion.mjs --dry-run|--apply');
const apply=mode==='--apply', LIMIT=3, idRx=/^[1-9][0-9]{0,14}$/;
const table=T('customer_credit_memo_headers');
const idConfig=path.join(root,'modules','customer-credit-memo','deletion-identity.confirmed.json');
const fail=(s)=>{throw Error('CCM VERIFIED DELETION BLOCKED: '+s)};
const val=x=>typeof x==='object'&&x!==null&&'value' in x?x.value:x;
const recordId=x=>{const v=String(val(x));if(!idRx.test(v))fail('Invalid ID '+v);return v;};
function confirmedIdentity(){
 if(!fs.existsSync(idConfig))fail('No independently verified CCM deletedrecord identity; only CLEAN inventory is certifiable.');
 const c=JSON.parse(fs.readFileSync(idConfig,'utf8'));
 if(c.module!=='customer-credit-memo'||c.transactionType!=='CustCred'||!c.independentlyVerified||!c.evidenceRecordId||!idRx.test(String(c.evidenceRecordId))||!c.recordtypeid||!c.type||!c.confirmedBy||!c.confirmedAt)fail('Identity confirmation incomplete');
 if(!/^[a-z][a-z0-9_]*$/i.test(c.recordtypeid)||!/^[A-Z][A-Z0-9_]*$/.test(c.type))fail('Invalid identity tuple format');
 return {recordtypeid:c.recordtypeid,type:c.type,evidenceRecordId:String(c.evidenceRecordId)};
}
async function proof(access,id,identity){
 const rows=await fetchAll(access,`SELECT recordid,recordtypeid,type,name,deleteddate,deletedby,context FROM deletedrecord WHERE recordid = ${id}`);
 const matching=matchDeletedRecordProof(rows,id,identity);
 if(matching.length!==1)fail('Independent deletedrecord tuple is not unique for '+id+' (rows='+rows.length+',matches='+matching.length+')');
 return matching[0];
}
async function absence(access,id){
 const rows=await fetchAll(access,`SELECT id,type FROM Transaction WHERE id = ${id}`);
 if(rows.length)fail('Source still visible: '+id);
}
async function bqState(id){
 const rows=await query(`SELECT credit_memo_id,COALESCE(is_deleted,FALSE) AS is_deleted FROM ${table} WHERE credit_memo_id=@id`,{id});
 if(rows.length!==1||rows[0].is_deleted)fail('Invalid/soft-deleted BQ header '+id);
}
function audit(row){
 const dir=path.join(root,'logs','verified-deletions');fs.mkdirSync(dir,{recursive:true});
 fs.appendFileSync(path.join(dir,'audit.jsonl'),JSON.stringify(row)+'\n');
}
async function main(){
 console.log('CCM B7 VERIFIED DELETION |',mode,'| STANDALONE | MAX_BATCH=3');
 console.log('GUARD: proof + source absence + atomic header soft-delete; historical detail/checkpoint untouched');
 const access=await token();console.log('OAuth: SUCCESS');
 const [headers,raw]=await Promise.all([
   fetchHeaders(access),
   query(`SELECT credit_memo_id FROM ${table} WHERE COALESCE(is_deleted,FALSE)=FALSE`)
 ]);
 const srcIds=headers.map(x=>recordId(x.internal_id));
 const bqIds=raw.map(x=>recordId(x.credit_memo_id));
 const source=new Set(srcIds),bq=new Set(bqIds);
 if(source.size!==srcIds.length||bq.size!==bqIds.length)fail('Duplicate presence IDs');
 const onlyNS=[...source].filter(x=>!bq.has(x)).sort();
 const onlyBQ=[...bq].filter(x=>!source.has(x)).sort();
 console.log('INVENTORY',JSON.stringify({netSuite:srcIds.length,bigQuery:bqIds.length,onlyNetSuite:onlyNS,onlyBigQuery:onlyBQ}));
 if(onlyNS.length)fail('Unsynced NetSuite records: '+onlyNS.join(',')+'; sync/reconcile first');
 if(!onlyBQ.length){console.log('CCM B7 DELETION INVENTORY CLEAN: PASS | no candidate | ZERO writes');return;}
 if(onlyBQ.length>LIMIT)fail('Candidate count exceeds max 3; no automatic partial deletion');
 const identity=confirmedIdentity();
 const proofAccess=await token();
 for(const id of onlyBQ){await proof(proofAccess,id,identity);await absence(proofAccess,id);await bqState(id);console.log('VERIFIED CANDIDATE',id,JSON.stringify(identity));}
 if(!apply){console.log('CCM B7 VERIFIED DELETION DRY RUN PASS: candidates='+onlyBQ.length+' | ZERO writes');return;}
 if(process.env.NETSUITE_VERIFIED_DELETE_CONFIRM!=='I_CONFIRM_VERIFIED_SOFT_DELETE')fail('Explicit deletion confirmation missing');
 // Apply one proven deletion at a time, same as shared production baseline.
 for(const id of onlyBQ){
   const live=await token();const e=await proof(live,id,identity);await absence(live,id);await bqState(id);
   // The only persisted mutation: header soft-delete; no child deletes, no checkpoint update.
   await query(`BEGIN TRANSACTION;\nASSERT (SELECT COUNT(*) FROM ${table} WHERE credit_memo_id=@id AND COALESCE(is_deleted,FALSE)=FALSE)=1 AS 'Header state changed';
UPDATE ${table} SET is_deleted=TRUE,deleted_at=CURRENT_TIMESTAMP() WHERE credit_memo_id=@id AND COALESCE(is_deleted,FALSE)=FALSE;
ASSERT (SELECT COUNT(*) FROM ${table} WHERE credit_memo_id=@id AND is_deleted=TRUE)=1 AS 'Soft-delete assertion failed';
COMMIT TRANSACTION;`,{id});
   const check=await query(`SELECT is_deleted FROM ${table} WHERE credit_memo_id=@id`,{id});
   if(check.length!==1||check[0].is_deleted!==true)fail('Post-commit verification failed for '+id);
   audit({at:new Date().toISOString(),module:'customer-credit-memo',id,recordtypeid:e.recordtypeid,type:e.type,deleteddate:e.deleteddate,deletedby:e.deletedby,result:'SOFT_DELETED'});
   console.log('VERIFIED SOFT DELETE PASS',id);
 }
 console.log('CCM B7 VERIFIED DELETION APPLY PASS: deleted='+onlyBQ.length+' | detail/checkpoints untouched');
}
main().catch(e=>{console.error(e?.stack??String(e));process.exitCode=1;});
