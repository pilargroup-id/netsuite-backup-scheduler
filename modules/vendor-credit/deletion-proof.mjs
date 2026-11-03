// Module 11: independent evidence inspection only. Never certifies tuple or performs writes.
import {token} from './mapping.mjs';
import {fetchAll} from '../../common/netsuite-client.mjs';
import {query,T} from '../../common/bigquery-client.mjs';
import {matchDeletedRecordProof} from '../../common/verified-deletion-proof.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--id'||!/^[1-9][0-9]{0,14}$/.test(args[1]))throw Error('Usage: node modules/vendor-credit/deletion-proof.mjs --id <numericId>');
const id=args[1];
async function main(){
 console.log('MODULE 11 VENDOR CREDIT DELETION PROOF | READ ONLY | UNCONFIRMED TUPLE');
 const access=await token();console.log('OAuth: SUCCESS');
 const evidence=await fetchAll(access,`SELECT recordid,recordtypeid,type,name,deleteddate,deletedby,context FROM deletedrecord WHERE recordid = ${id}`);
 const live=await fetchAll(access,`SELECT id,type,TO_CHAR(trandate,'YYYY-MM-DD') AS transaction_date FROM Transaction WHERE id = ${id}`);
 const stored=await query(`SELECT vendor_credit_id,transaction_date,is_deleted,deleted_at FROM ${T('vendor_credit_headers')} WHERE vendor_credit_id=@id`,{id});
 const identity={recordtypeid:'vendorcredit',type:'VENDORCREDIT'};
 const matched=matchDeletedRecordProof(evidence,id,identity);
 const result={id,identityCandidate:identity,deletedRecordRows:evidence,matchedCandidateRows:matched,sourceVisible:live,bigQueryHeaders:stored,sourceAbsent:live.length===0,exactCandidateEvidence:matched.length===1,identityCertified:false,applyAuthorized:false,writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0};
 console.log('DELETION_PROOF_RESULT',JSON.stringify(result));
 console.log('PROOF INSPECTION ONLY. Manual independent identity certification and source/target safeguards are still required before any future soft-delete apply.');
 if(matched.length!==1||live.length||stored.length!==1||stored[0].is_deleted===true)process.exitCode=2;
}
main().catch(e=>{console.error('MODULE 11 DELETION PROOF ERROR:',e.stack??e);process.exitCode=1;});
