// MODULE 15 ONLY. Standalone orchestration; does NOT register a scheduler.
// Verified deletion is NEVER applied by this runner.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '../..');
const must = (ok, message) => { if (!ok) throw new Error('MODULE 15 RUNNER BLOCKED: ' + message); };
const sensitive = [
  'NETSUITE_INVENTORY_ADJUSTMENT_INCREMENTAL_CONFIRM',
  'NETSUITE_INVENTORY_ADJUSTMENT_DELETE_CONFIRM',
  'NETSUITE_VERIFIED_DELETE_CONFIRM',
  'NETSUITE_INVENTORY_ADJUSTMENT_INITIAL_CONFIRM',
  'NETSUITE_INVENTORY_ADJUSTMENT_SCHEMA_CONFIRM',
  'NETSUITE_INVENTORY_ADJUSTMENT_RUNNER_CONFIRM',
];
export function cleanEnv(env) {
  const out = {...env};
  for (const name of sensitive) delete out[name];
  return out;
}
function getPlan(output) {
  const rows = output.split(/\r?\n/).filter(x => x.startsWith('INCREMENTAL_PLAN '));
  must(rows.length === 1, 'exactly one INCREMENTAL_PLAN required');
  let p;
  try { p = JSON.parse(rows[0].slice('INCREMENTAL_PLAN '.length)); }
  catch { must(false, 'invalid incremental plan JSON'); }
  must(p && Array.isArray(p.changed) && p.changed.every(x => typeof x === 'string') &&
    Number.isSafeInteger(p.newDocs) && Number.isSafeInteger(p.newer) &&
    Array.isArray(p.sourceCounts) && p.sourceCounts.length === 3 &&
    Array.isArray(p.storedCounts) && p.storedCounts.length === 3 &&
    [...p.sourceCounts,...p.storedCounts].every(x => Number.isSafeInteger(x) && x >= 0) &&
    p.automaticDeletions === 0 && p.otherModuleWrites === 0 && p.schedulerChanges === 0 &&
    typeof p.checkpoint === 'string' && typeof p.sourceWatermark === 'string',
    'incomplete or unsafe incremental plan');
  return p;
}
export function runWorkflow(mode, call, env = process.env, emit = console.log) {
  must(['--dry-run','--sync'].includes(mode), 'expected --dry-run or --sync');
  emit(`MODULE 15 STANDALONE RUNNER ${mode} | MODULE15_ONLY | NO SCHEDULER CHANGES`);
  const baseEnv = cleanEnv(env);
  if (mode === '--dry-run') {
    const inc = call('incremental-sync.mjs', ['--dry-run'], baseEnv);
    must(inc.includes('MODULE 15 PHASE H INCREMENTAL DRY RUN PASS: ZERO WRITES; NO CHECKPOINT CHANGES; NO SCHEDULER CHANGES'), 'incremental dry-run PASS marker absent');
    const plan = getPlan(inc);
    const delta = plan.changed.length > 0 || plan.newer > 0 || plan.newDocs > 0 ||
      plan.sourceCounts.some((n,i) => n !== plan.storedCounts[i]) ||
      plan.sourceWatermark !== plan.checkpoint;
    if (delta) {
      emit('MODULE 15 DELETION INVENTORY SKIPPED: SOURCE DELTA OR COUNT MISMATCH; ZERO WRITES');
      emit('MODULE 15 STANDALONE RUNNER DRY RUN PASS: DELTA DETECTED; ZERO WRITES; NO DELETION APPLY');
      return;
    }
    const deletion = call('verified-deletion.mjs', ['--dry-run'], baseEnv);
    must(/MODULE 15 VERIFIED DELETION (?:CLEAN PASS: NO CANDIDATES|DRY RUN PASS: ZERO WRITES)/.test(deletion), 'verified deletion dry-run PASS marker absent');
    emit('MODULE 15 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES; NO DELETION APPLY');
    return;
  }
  must(env.NETSUITE_INVENTORY_ADJUSTMENT_RUNNER_CONFIRM === 'MODULE15_STANDALONE_RUNNER_AUTHORIZED', 'explicit Module15 runner authorization missing');
  const inc = call('incremental-sync.mjs', ['--sync'], {
    ...baseEnv,
    NETSUITE_INVENTORY_ADJUSTMENT_INCREMENTAL_CONFIRM: 'MODULE15_INCREMENTAL_ONLY',
  });
  must(/MODULE 15 INCREMENTAL (?:COMMIT PASS|PASS_NO_CHANGE)/.test(inc), 'incremental sync PASS marker absent');
  const audit = call('check-financial.mjs', ['--audit-only'], baseEnv);
  must(audit.includes('MODULE 15 EXACT RECONCILIATION PASS'), 'post-sync exact reconciliation PASS marker absent');
  emit('MODULE 15 STANDALONE RUNNER FINAL_PASS: INCREMENTAL + EXACT RECONCILIATION; NO DELETION APPLY');
}
function child(filename, args, env) {
  must(['incremental-sync.mjs','verified-deletion.mjs','check-financial.mjs'].includes(filename),'unapproved child');
  const result = spawnSync(process.execPath, [join(dir, filename), ...args], {
    cwd: root, env, encoding: 'utf8', windowsHide: true,
    timeout: 20 * 60 * 1000, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  must(!result.error && !result.signal && result.status === 0,
    `${filename} failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}`);
  return result.stdout ?? '';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { must(process.argv.length===3,'exactly one mode required'); runWorkflow(process.argv[2],child); }
  catch(e) { console.error(e.stack ?? String(e)); process.exitCode=1; }
}
