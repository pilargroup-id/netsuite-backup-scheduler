// Module 13 only. Standalone entry point; registration is a separate, authorized phase.
// Does not edit shared controllers, Windows tasks, checkpoints or locks.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const mod=join(root,'modules','journal-entry');
const argv=process.argv.slice(2);
if(argv.length!==1||!['--dry-run','--sync'].includes(argv[0]))throw Error('Usage: node modules/journal-entry/standalone-runner.mjs --dry-run|--sync');
const mode=argv[0];
if(mode==='--sync'&&process.env.NETSUITE_JOURNAL_ENTRY_RUNNER_CONFIRM!=='MODULE13_STANDALONE_RUNNER_AUTHORIZED')
  throw Error('MODULE 13 RUNNER BLOCKED: explicit standalone runner authorization missing');
const opts={cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,timeout:20*60*1000};
function call(file,args,env){
  const result=spawnSync(process.execPath,[join(mod,file),...args],{...opts,env});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.error||result.signal||result.status!==0)
    throw Error('MODULE 13 RUNNER BLOCKED: '+file+' '+(result.error?.message??result.signal??`exit ${result.status}`));
  return result.stdout??'';
}
function marker(text,pattern,phase){if(!pattern.test(text))throw Error('MODULE 13 RUNNER BLOCKED: '+phase+' success marker missing');}
try{
  console.log('MODULE 13 STANDALONE RUNNER '+mode+' | MODULE13_ONLY | no scheduler registration');
  if(mode==='--dry-run'){
    const preview=call('incremental-sync.mjs',['--dry-run'],process.env);
    marker(preview,/MODULE 13 INCREMENTAL DRY RUN PASS: ZERO WRITES/,'dry-run');
    console.log('MODULE 13 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES | NOT FINAL RECONCILIATION');
  }else{
    const syncEnv={...process.env,
      NETSUITE_JOURNAL_ENTRY_INCREMENTAL_CONFIRM:'MODULE13_ONLY',
      NETSUITE_JOURNAL_ENTRY_DELETE_CONFIRM:'MODULE13_VERIFIED_HEADER_ONLY',
      NETSUITE_VERIFIED_DELETE_CONFIRM:'I_CONFIRM_VERIFIED_SOFT_DELETE'};
    const sync=call('incremental-sync.mjs',['--sync'],syncEnv);
    marker(sync,/MODULE 13 INCREMENTAL (?:ATOMIC COMMIT PASS|PASS_NO_CHANGE)/,'incremental');
    // Never leak write / deletion confirmations into the independent read-only audit.
    const auditEnv={...process.env};
    delete auditEnv.NETSUITE_JOURNAL_ENTRY_INCREMENTAL_CONFIRM;
    delete auditEnv.NETSUITE_JOURNAL_ENTRY_DELETE_CONFIRM;
    delete auditEnv.NETSUITE_VERIFIED_DELETE_CONFIRM;
    const audit=call('check-financial.mjs',['--audit-only'],auditEnv);
    marker(audit,/MODULE 13 EXACT FINANCIAL AUDIT PASS/,'financial reconciliation');
    console.log('MODULE 13 STANDALONE RUNNER FINAL_PASS: VERIFIED INCREMENTAL AND EXACT AUDIT');
  }
}catch(e){console.error(e.stack??String(e));process.exitCode=1;}
