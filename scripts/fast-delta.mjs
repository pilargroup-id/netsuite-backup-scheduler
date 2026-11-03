// Single Fast Delta controller: sequential, lock-protected, streaming subprocesses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSharedLock } from '../common/shared-lock.mjs';
import { runChild } from '../common/child-runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = process.argv.slice(2);
if (flags.length !== 1 || !['--sync', '--dry-run'].includes(flags[0])) {
  console.error('Usage: node scripts/fast-delta.mjs --sync|--dry-run');
  process.exit(2);
}
const write = flags[0] === '--sync';
const stateDir = path.join(root, 'logs', 'fast-delta');
const stateFile = path.join(stateDir, 'health-v2.json');
const shared = createSharedLock({ stateDir: path.join(root, 'logs', 'scheduler'), worker: 'fast-delta' });
const modules = ['sales-invoice', 'item-fulfillment', 'sales-order', 'item-receipt', 'purchase-order', 'purchase-invoice', 'sales-return', 'purchase-return', 'sales-payment', 'customer-credit-memo', 'vendor-credit', 'vendor-payment', 'journal-entry', 'inventory-transfer', 'inventory-adjustment'];
const markerMap = {
  'sales-invoice': ['SALES INVOICE DELTA SYNC SUCCESS', 'NO CHANGES: SUCCESS'],
  'item-fulfillment': ['ITEM FULFILLMENT DELTA SYNC SUCCESS', 'NO CHANGES. DELTA SYNC SUCCESS'],
  'sales-order': ['SALES ORDER SYNC SUCCESS'],
  'item-receipt': ['ITEM RECEIPT SYNC SUCCESS', 'ITEM RECEIPT NO CHANGES: SUCCESS'],
  'purchase-order': ['PURCHASE ORDER SYNC SUCCESS; RUN check.mjs + presence.mjs; NOT FINAL_PASS', 'PURCHASE ORDER NO CHANGES: SUCCESS'],
  'purchase-invoice': ['VENDOR BILL SYNC SUCCESS; RUN reconciliation checks; NOT FINAL_PASS', 'VENDOR BILL NO CHANGES: SUCCESS'],
  'sales-return': ['SALES RETURN SYNC SUCCESS; RUN presence/check/check-financial; NOT FINAL_PASS', 'SALES RETURN NO CHANGES: SUCCESS'],
  'purchase-return': ['PURCHASE RETURN SYNC SUCCESS; RUN presence/check/check-financial; NOT FINAL_PASS', 'PURCHASE RETURN NO CHANGES: SUCCESS'],
  'sales-payment': ['SALES PAYMENT SYNC SUCCESS; RUN reconciliation checks; NOT FINAL_PASS'],
  'customer-credit-memo': ['B6 INCREMENTAL NO_CHANGE:', 'B6 INCREMENTAL ATOMIC COMMIT PASS:'],
  'vendor-credit': ['PHASE B19 PASS_NO_CHANGE:', 'PHASE B19 ATOMIC COMMIT PASS'],
  'vendor-payment': ['MODULE 12 STANDALONE RUNNER FINAL_PASS: VERIFIED INCREMENTAL AND EXACT AUDIT'],
  'journal-entry': ['MODULE 13 STANDALONE RUNNER FINAL_PASS: VERIFIED INCREMENTAL AND EXACT AUDIT'],
  'inventory-transfer': ['MODULE 14 STANDALONE RUNNER FINAL_PASS: INCREMENTAL + EXACT RECONCILIATION; NO DELETION APPLY'],
  'inventory-adjustment': ['MODULE 15 STANDALONE RUNNER FINAL_PASS: INCREMENTAL + EXACT RECONCILIATION; NO DELETION APPLY']
};
// Per-module ceiling; timeout is reported explicitly and next scheduled run retries
// from the last committed checkpoint. Never mark a timed-out run successful.
const moduleTimeoutMs = 30 * 60 * 1000;
const startedAt = new Date().toISOString();
const token = `${process.pid}-${Date.now()}`;
let lockOwned = false;

function saveState(mutator) {
  if (!write) return;
  fs.mkdirSync(stateDir, { recursive: true });
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch { state = { version: 2, modules: {} }; }
  mutator(state);
  state.version = 2;
  state.updatedAt = new Date().toISOString();
  const tmp = `${stateFile}.${token}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, stateFile);
}

async function main() {
  const lock = shared.acquire();
  if (!lock.acquired) {
    console.log('FAST DELTA STATUS: SKIPPED_LOCKED; reason=' + lock.reason);
    return; // Not a successful sync; health state is deliberately unchanged.
  }
  lockOwned = true;
  console.log(`FAST DELTA | ${write ? 'PRODUCTION WRITE' : 'READ ONLY'} | modules=${modules.join(',')}`);
  if (write) saveState(s => {
    if (s.lastRunStatus === 'RUNNING') s.previousInterruptedRun = {lastAttemptAt:s.lastAttemptAt,detectedAt:startedAt};
    s.lastAttemptAt = startedAt;
    s.lastRunStatus = 'RUNNING';
  });
  const outcomes = [];
  for (const mod of modules) {
    const file = path.join(root, 'modules', mod, ['vendor-payment','journal-entry','inventory-transfer','inventory-adjustment'].includes(mod) ? 'standalone-runner.mjs' : ['customer-credit-memo','vendor-credit'].includes(mod) ? 'incremental-sync.mjs' : 'sync.mjs');
    console.log(`\n=== ${mod} ===`);
    let r;
    if (!fs.existsSync(file)) {
      r = {ok:false,exit:null,detail:'MODULE_FILE_MISSING',timedOut:false,markerFound:false};
    } else if (mod === 'customer-credit-memo') {
      // B9: same shared lock and sequential execution; CCM uses B6 incremental, NEVER initial sync.
      r = await runChild(process.execPath, [file, write ? '--sync' : '--dry-run'], {
        cwd: root, timeoutMs: moduleTimeoutMs,
        markers: write ? markerMap[mod] : ['B6 INCREMENTAL NO_CHANGE:', 'B6 INCREMENTAL DRY RUN PASS:'],
        onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
      });
    } else if (mod === 'vendor-payment') {
      // Module 12 only. Reuses the existing Fast Delta shared lock and cadence.
      // The isolated runner validates exact deletion proof (max 3), commits atomically,
      // and requires exact financial reconciliation before reporting success.
      r = await runChild(process.execPath, [file, write ? '--sync' : '--dry-run'], {
        cwd: root, timeoutMs: moduleTimeoutMs,
        markers: write ? markerMap[mod] : ['MODULE 12 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES'],
        env: write ? {...process.env, NETSUITE_VENDOR_PAYMENT_RUNNER_CONFIRM:'MODULE12_STANDALONE_RUNNER_AUTHORIZED'} : process.env,
        onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
      });
    } else if (mod === 'journal-entry') {
      // Module 13 only. Keep sequential Fast Delta shared lock and existing cadence.
      r = await runChild(process.execPath, [file, write ? '--sync' : '--dry-run'], {
        cwd: root, timeoutMs: moduleTimeoutMs,
        markers: write ? markerMap[mod] : ['MODULE 13 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES'],
        env: write ? {...process.env, NETSUITE_JOURNAL_ENTRY_RUNNER_CONFIRM:'MODULE13_STANDALONE_RUNNER_AUTHORIZED'} : process.env,
        onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
      });
    } else if (mod === 'inventory-transfer') {
      // Module 14 only. Existing modules, lock, scheduling and deletion apply are unchanged.
      r = await runChild(process.execPath, [file, write ? '--sync' : '--dry-run'], {
        cwd: root, timeoutMs: moduleTimeoutMs,
        markers: write ? markerMap[mod] : [
          'MODULE 14 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES; NO DELETION APPLY',
          'MODULE 14 STANDALONE RUNNER DRY RUN PASS: DELTA DETECTED; ZERO WRITES; NO DELETION APPLY'
        ],
        env: write ? {...process.env, NETSUITE_INVENTORY_TRANSFER_RUNNER_CONFIRM:'MODULE14_STANDALONE_RUNNER_AUTHORIZED'} : process.env,
        onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
      });
    } else if (mod === 'inventory-adjustment') {
      // Module 15 only: certified standalone incremental + exact audit; no deletion apply.
      // Do not alter existing module branches, shared lock, or scheduler configuration.
      r = await runChild(process.execPath, [file, write ? '--sync' : '--dry-run'], {
        cwd: root, timeoutMs: moduleTimeoutMs,
        markers: write ? markerMap[mod] : [
          'MODULE 15 STANDALONE RUNNER DRY RUN PASS: ZERO WRITES; NO DELETION APPLY',
          'MODULE 15 STANDALONE RUNNER DRY RUN PASS: DELTA DETECTED; ZERO WRITES; NO DELETION APPLY'
        ],
        env: write ? {...process.env, NETSUITE_INVENTORY_ADJUSTMENT_RUNNER_CONFIRM:'MODULE15_STANDALONE_RUNNER_AUTHORIZED'} : process.env,
        onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
      });
    } else if (mod === 'vendor-credit') {
      // Standalone B19 writer; existing modules and scheduling are unchanged.
      r = await runChild(process.execPath, [file, write ? '--sync' : '--dry-run'], {
        cwd: root, timeoutMs: moduleTimeoutMs,
        markers: write ? markerMap[mod] : ['PHASE B19 DRY RUN PASS: ZERO WRITES'],
        onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
      });
    } else if (mod === 'purchase-return') {
      // Independent, read-only gate. No initial sync until real-source validation.
      let gateText = '';
      const gate = await runChild(process.execPath, [path.join(root, 'modules', mod, 'scheduler-gate.mjs')], {
        cwd: root, timeoutMs: moduleTimeoutMs,
        markers: ['PURCHASE RETURN GATE:'],
        onOutput: (text, isErr) => { gateText += text; (isErr ? process.stderr : process.stdout).write(text); }
      });
      if (!gate.ok) r = { ...gate, prStatus: 'FAILED' };
      else if (gateText.includes('PURCHASE RETURN GATE: NO_SOURCE')) r = { ...gate, prStatus: 'NO_SOURCE' };
      else if (gateText.includes('PURCHASE RETURN GATE: SOURCE_PENDING_INITIAL_SYNC')) r = { ...gate, prStatus: 'NEEDS_REVIEW' };
      else if (gateText.includes('PURCHASE RETURN GATE: READY')) {
        r = await runChild(process.execPath, [file, write ? '--sync' : '--dry-run'], {
          cwd: root, timeoutMs: moduleTimeoutMs,
          markers: write ? markerMap[mod] : ['DRY RUN PASS'],
          onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
        });
        r.prStatus = r.ok ? 'SYNC_OK' : 'FAILED';
      } else r = { ...gate, ok: false, detail: 'UNKNOWN_PURCHASE_RETURN_GATE', prStatus: 'FAILED' };
    } else {
      r = await runChild(process.execPath, [file, ...(write ? (['item-receipt','purchase-order','purchase-invoice','sales-return','sales-payment'].includes(mod) ? ['--sync'] : []) : ['--dry-run'])], {
        cwd: root,
        timeoutMs: moduleTimeoutMs,
        markers: write ? markerMap[mod] : ['DRY RUN PASS'],
        onOutput: (text, isErr) => (isErr ? process.stderr : process.stdout).write(text)
      });
    }
    const status = mod === 'purchase-return' ? r.prStatus : (r.ok ? 'SYNC_OK' : 'FAILED');
    outcomes.push({module:mod,status,exit:r.exit,error:r.detail ?? null});
    if (write) saveState(s => {
      s.modules ??= {};
      const rec = s.modules[mod] ?? {};
      rec.lastAttemptAt = new Date().toISOString();
      rec.lastResult = status;
      if (status === 'SYNC_OK') { rec.lastSuccessAt = rec.lastAttemptAt; delete rec.lastError; }
      else if (status === 'NO_SOURCE') { delete rec.lastError; }
      else rec.lastError = r.detail ?? 'UNKNOWN';
      s.modules[mod] = rec;
    });
    if (status === 'NEEDS_REVIEW') console.error('PURCHASE RETURN: real source detected before initial sync; manual production validation required');
    if (status === 'FAILED') console.error(`MODULE FAILURE (${mod}): ${r.detail ?? 'UNKNOWN'}; exit=${r.exit}; timedOut=${r.timedOut}; markerFound=${r.markerFound}`);
    // Continue to remaining independent modules; no failed module checkpoint is advanced here.
  }
  const allOk = outcomes.length === modules.length && outcomes.every(x => x.status === 'SYNC_OK' || (x.module === 'purchase-return' && x.status === 'NO_SOURCE'));
  if (write) saveState(s => {
    s.lastRunStatus = allOk ? 'SYNC_OK' : 'FAILED';
    s.lastFinishedAt = new Date().toISOString();
  });
  console.log('\nFAST DELTA SUMMARY:', JSON.stringify(outcomes));
  if (allOk) console.log(`FAST DELTA ${write ? 'SYNC' : 'DRY RUN'} PASS; FULL RECONCILIATION NOT PERFORMED`);
  else process.exitCode = 1;
}
try { await main(); }
catch (e) {
  console.error('FAST DELTA ERROR:', e.stack ?? e);
  if (lockOwned && write) {
    try { saveState(s => {s.lastRunStatus='FAILED';s.lastFinishedAt=new Date().toISOString();s.lastError=e.message;}); }
    catch (stateError) {console.error('HEALTH WRITE ERROR:', stateError.message);}
  }
  process.exitCode = 1;
} finally {
  if (lockOwned) {
    const r = shared.release();
    if (!r.released) {console.error('LOCK RELEASE NEEDS REVIEW:', r.reason);process.exitCode=1;}
  }
}

