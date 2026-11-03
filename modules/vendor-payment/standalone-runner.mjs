// Module 12 ONLY. Standalone operator/eligible future scheduler entry point.
// No production scheduler registration, shared controller or shared lock changes.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const mod=join(root,'modules','vendor-payment');
const argv=process.argv.slice(2);
if(argv.length!==1||!['--dry-run','--sync'].includes(argv[0]))throw Error('Usage: node modules/vendor-payment/standalone-runner.mjs --dry-run|--sync');
const mode=argv[0];
const ACTIVE_APPROVAL='MODULE12_STANDALONE_RUNNER_AUTHORIZED';
if(mode==='--sync'&&process.env.NETSUITE_VENDOR_PAYMENT_RUNNER_CONFIRM!==ACTIVE_APPROVAL)throw Error('MODULE 12 RUNNER BLOCKED: explicit standalone runner authorization missing');
const opts={cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,timeout:20*60*1000};
function call(file,args,env){
  const result=spawnSync(process.execPath,[join(mod,file),...args],{...opts,env});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.error||result.signal||result.status!==0)throw Error('MODULE 12 RUNNER BLOCKED: '+file+' '+(result.error?.message??result.signal??`exit ${result.status}`));
  return result.stdout??'';
}
function assertMarker(text,patterns,phase){if(!patterns.some(r=>r.test(text)))throw Error('MODULE 12 RUNNER BLOCKED: '+phase+' success marker missing');}
try{
  console.log('MODULE 12 STANDALONE RUNNER '+mode+' | scope MODULE12_ONLY | no scheduler registration');
  if(mode==='--dry-run'){
    const preview=call('incremental-sync.mjs',['--dry-run'],process.env);
    assertMarker(preview,[/MODULE 12 INCREMENTAL DRY RUN PASS: ZERO WRITES/], 'dry-run');
    console.log('MODULE 12 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES | NOT FINAL RECONCILIATION');
  }else{
    const env={...process.env,
      NETSUITE_VENDOR_PAYMENT_INCREMENTAL_CONFIRM:'MODULE12_ONLY',
      NETSUITE_VENDOR_PAYMENT_DELETE_CONFIRM:'MODULE12_VERIFIED_HEADER_ONLY',
      NETSUITE_VERIFIED_DELETE_CONFIRM:'I_CONFIRM_VERIFIED_SOFT_DELETE'};
    const sync=call('incremental-sync.mjs',['--sync'],env);
    assertMarker(sync,[/MODULE 12 INCREMENTAL ATOMIC COMMIT PASS/,/MODULE 12 INCREMENTAL PASS_NO_CHANGE/],'incremental');
    // Deliberately do not pass write authorizations to reconciliation child.
    const audit=call('check-financial.mjs',[],process.env);
    assertMarker(audit,[/MODULE 12 EXACT FINANCIAL AUDIT PASS/], 'financial reconciliation');
    console.log('MODULE 12 STANDALONE RUNNER FINAL_PASS: VERIFIED INCREMENTAL AND EXACT AUDIT');
  }
}catch(e){console.error(e.stack??String(e));process.exitCode=1;}
