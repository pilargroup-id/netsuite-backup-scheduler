// Module 14 ONLY. Standalone orchestration, not scheduler registration.
// Verified deletion is intentionally NEVER applied by this runner.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(moduleDir, '../..');
const ok = (condition, message) => { if (!condition) throw new Error(`MODULE 14 RUNNER BLOCKED: ${message}`); };
const secretNames = [
  'NETSUITE_INVENTORY_TRANSFER_INCREMENTAL_CONFIRM',
  'NETSUITE_INVENTORY_TRANSFER_DELETE_CONFIRM',
  'NETSUITE_VERIFIED_DELETE_CONFIRM',
  'NETSUITE_INVENTORY_TRANSFER_INITIAL_CONFIRM',
];

export function cleanEnv(env) {
  const result = { ...env };
  for (const key of secretNames) delete result[key];
  return result;
}

export function runWorkflow(mode, call, env = process.env, emit = console.log) {
  ok(['--dry-run', '--sync'].includes(mode), 'usage: --dry-run or --sync');
  emit(`MODULE 14 STANDALONE RUNNER ${mode} | MODULE14_ONLY | NO SCHEDULER CHANGES`);
  if (mode === '--dry-run') {
    const inc = call('incremental-sync.mjs', ['--dry-run'], cleanEnv(env));
    ok(/MODULE 14 INCREMENTAL DRY RUN PASS: ZERO WRITES/.test(inc), 'incremental dry-run PASS marker missing');
    // Deletion inventory intentionally requires the source and backup to be in sync.
    // If a new/changed transfer exists, report a successful incremental plan and
    // explicitly skip deletion inventory; never weaken its source-consistency guard.
    const planLine = inc.split(/\r?\n/).find(line => line.startsWith('PLAN '));
    ok(Boolean(planLine), 'incremental dry-run PLAN missing');
    let plan;
    try { plan = JSON.parse(planLine.slice(5)); }
    catch { ok(false, 'incremental dry-run PLAN invalid JSON'); }
    ok(Array.isArray(plan.changed) && Number.isInteger(plan.sourceHeaders) &&
       Number.isInteger(plan.storedHeaders) && Number.isInteger(plan.sourceLines) &&
       Number.isInteger(plan.storedLines) && Number.isInteger(plan.newer),
       'incremental dry-run PLAN incomplete');
    const hasDelta = plan.changed.length > 0 || plan.newer > 0 ||
      plan.sourceHeaders !== plan.storedHeaders || plan.sourceLines !== plan.storedLines;
    if (hasDelta) {
      emit('MODULE 14 DELETION INVENTORY SKIPPED: SOURCE AHEAD OF BACKUP; SYNC REQUIRED FIRST; ZERO WRITES');
      emit('MODULE 14 STANDALONE RUNNER DRY RUN PASS: DELTA DETECTED; ZERO WRITES; NO DELETION APPLY');
      return;
    }
    const del = call('verified-deletion.mjs', ['--dry-run'], cleanEnv(env));
    ok(/MODULE 14 VERIFIED DELETION (?:CLEAN PASS: NO CANDIDATES|DRY RUN PASS: ZERO WRITES)/.test(del), 'verified deletion dry-run PASS marker missing');
    emit('MODULE 14 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES; NO DELETION APPLY');
    return;
  }
  ok(env.NETSUITE_INVENTORY_TRANSFER_RUNNER_CONFIRM === 'MODULE14_STANDALONE_RUNNER_AUTHORIZED', 'explicit runner authorization missing');
  const inc = call('incremental-sync.mjs', ['--sync'], {
    ...cleanEnv(env),
    NETSUITE_INVENTORY_TRANSFER_INCREMENTAL_CONFIRM: 'MODULE14_ONLY',
  });
  ok(/MODULE 14 INCREMENTAL (?:COMMIT PASS|PASS_NO_CHANGE)/.test(inc), 'incremental sync PASS marker missing');
  // No deletion apply, ever. Audit runs without any write confirmations.
  const audit = call('check-financial.mjs', ['--audit-only'], cleanEnv(env));
  ok(/MODULE 14 EXACT RECONCILIATION PASS/.test(audit), 'exact reconciliation PASS marker missing');
  emit('MODULE 14 STANDALONE RUNNER FINAL_PASS: INCREMENTAL + EXACT RECONCILIATION; NO DELETION APPLY');
}

function callChild(filename, args, env) {
  const result = spawnSync(process.execPath, [join(moduleDir, filename), ...args], {
    cwd: root, env, encoding: 'utf8', windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  ok(!result.error && !result.signal && result.status === 0,
    `${filename} failed: ${result.error?.message || result.signal || `exit ${result.status}`}`);
  return result.stdout || '';
}

async function main() {
  ok(process.argv.length === 3, 'exactly one mode required');
  runWorkflow(process.argv[2], callChild);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.stack || String(e)); process.exitCode = 1; });
}
