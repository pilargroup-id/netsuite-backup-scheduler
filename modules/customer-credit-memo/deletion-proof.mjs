// Module 10 standalone deletedrecord evidence probe. READ ONLY; no writes.
import {token} from './mapping.mjs';
import {fetchAll} from '../../common/netsuite-client.mjs';
import {query,T} from '../../common/bigquery-client.mjs';
const args=process.argv.slice(2),pos=args.indexOf('--id');
if(args.length!==2||pos!==0||!/^[1-9][0-9]{0,14}$/.test(args[1]))throw Error('Usage: node modules/customer-credit-memo/deletion-proof.mjs --id <numericId>');
const id=args[1];
async function main(){
 const access=await token();
 const evidence=await fetchAll(access,`SELECT recordid,recordtypeid,type,name,deleteddate,deletedby,context FROM deletedrecord WHERE recordid = ${id}`);
 const visible=await fetchAll(access,`SELECT id,type FROM Transaction WHERE id = ${id}`);
 const stored=await query(`SELECT credit_memo_id,is_deleted FROM ${T('customer_credit_memo_headers')} WHERE credit_memo_id=@id`,{id});
 console.log('CCM DELETION PROOF | READ ONLY | NOT AN APPLY');
 console.log(JSON.stringify({id,evidence,sourceVisible:visible,headers:stored}));
 console.log('APPLY: DISABLED until exact CustCred deletedrecord recordtypeid/type tuple independently validated.');
}
main().catch(e=>{console.error('CCM DELETION PROOF BLOCKED:',e.stack??e);process.exitCode=1;});
