// Module 11: scoped Vendor Credit deleted-record candidate inventory. Strictly read-only.
// Source scope is inherited from the already-tested October 2026 mapping.
import {token,fetchHeaders} from './mapping.mjs';
import {query,T} from '../../common/bigquery-client.mjs';
const valid=x=>{const v=String(x??'');if(!/^[1-9][0-9]{0,14}$/.test(v))throw Error('Invalid Vendor Credit ID '+v);return v;};
if(process.argv.length!==3||process.argv[2]!=='--dry-run')throw Error('Usage: node modules/vendor-credit/deletion-inventory.mjs --dry-run');
async function main(){
 console.log('MODULE 11 VENDOR CREDIT DELETION INVENTORY | READ ONLY | SCOPE 2026-10-01..OPEN ENDED');
 const a=await token();console.log('OAuth: SUCCESS');
 const headers=await fetchHeaders(a);
 const rows=await query(`SELECT vendor_credit_id FROM ${T('vendor_credit_headers')} WHERE COALESCE(is_deleted,FALSE)=FALSE`);
 const sourceIds=headers.map(x=>valid(x.internal_id)),targetIds=rows.map(x=>valid(x.vendor_credit_id));
 const source=new Set(sourceIds),target=new Set(targetIds);
 const onlyNS=[...source].filter(id=>!target.has(id)).sort();
 const onlyBQ=[...target].filter(id=>!source.has(id)).sort();
 const duplicateSource=source.size!==sourceIds.length,duplicateTarget=target.size!==targetIds.length;
 const out={status:duplicateSource||duplicateTarget||onlyNS.length?'BLOCKED':onlyBQ.length?'CANDIDATES_REQUIRE_INDEPENDENT_PROOF':'CLEAN',source:sourceIds.length,bigQueryActive:targetIds.length,onlyNetSuite:onlyNS,onlyBigQuery:onlyBQ,duplicateSource,duplicateTarget,maxApplyBatch:3,identityCertified:false,applyAuthorized:false,writeOperations:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0};
 console.log('DELETION_INVENTORY_RESULT',JSON.stringify(out));
 if(out.status==='BLOCKED')process.exitCode=2;
 if(out.status==='CANDIDATES_REQUIRE_INDEPENDENT_PROOF')console.log('CANDIDATE IS NOT A DELETE PERMISSION. Run deletion-proof.mjs --id <id> for each candidate; never use a missing source row alone as proof.');
}
main().catch(e=>{console.error('MODULE 11 DELETION INVENTORY ERROR:',e.stack??e);process.exitCode=1;});
