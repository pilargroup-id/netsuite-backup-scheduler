import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const target = join(root, 'modules', 'item-fulfillment', 'reconcile-accounting.mjs');

const apply = process.argv.includes('--apply');

if (
  process.argv.length > 3 ||
  (process.argv.length === 3 && !apply)
) {
  throw Error(
    'Usage: node modules/item-fulfillment/repair-accounting-bounded.mjs [--apply]'
  );
}

// Maximum transactions per batch.
const MAX_PER_BATCH = 8;

// Maximum batches in one recovery execution.
const MAX_BATCHES = 4;

const MAX_PER_RUN = MAX_PER_BATCH * MAX_BATCHES;

function run(args) {
  const r = spawnSync(process.execPath, [target, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });

  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);

  if (r.error || r.status !== 0) {
    throw Error(
      'Accounting command failed: ' + args.join(' ')
    );
  }

  return r.stdout;
}

function mismatches(output) {
  const ids = [
    ...output.matchAll(
      /^([1-9][0-9]*) (DO[^:]+): source=.* BQ=.* diff=[-0-9.]+$/gm
    )
  ].map(x => x[1]);

  const end = output.match(
    /ACCOUNTING RECONCILIATION COMPLETE; differences=(\d+); mode=READ ONLY/
  );

  if (
    !end ||
    Number(end[1]) !== ids.length ||
    new Set(ids).size !== ids.length
  ) {
    throw Error(
      'Incomplete/ambiguous accounting mismatch inventory'
    );
  }

  return ids;
}

console.log(
  'IF BOUNDED ACCOUNTING RECOVERY | ' +
  (apply ? 'PRODUCTION WRITE' : 'READ ONLY')
);

console.log(
  'LIMITS: batch=' + MAX_PER_BATCH +
  ' batches=' + MAX_BATCHES +
  ' maxPerRun=' + MAX_PER_RUN
);

// Initial full accounting audit.
const initial = mismatches(run([]));

console.log(
  'ACCOUNTING CANDIDATES=' +
  initial.join(',') +
  ' count=' +
  initial.length
);

if (!initial.length) {
  console.log('ACCOUNTING CLEAN: PASS');
  process.exit(0);
}

// Dry-run validates the complete mismatch inventory.
// A backlog larger than the per-run limit is allowed.
// Actual writes remain strictly bounded.
if (!apply) {
  console.log(
    'ACCOUNTING DRY RUN PASS: no changes'
  );

  console.log(
    'PLANNED FIRST RUN=' +
    Math.min(initial.length, MAX_PER_RUN) +
    ' REMAINING AFTER BUDGET=' +
    Math.max(0, initial.length - MAX_PER_RUN)
  );

  process.exit(0);
}

let repaired = 0;
let completedBatches = 0;

for (
  let batchNumber = 1;
  batchNumber <= MAX_BATCHES;
  batchNumber++
) {
  // Re-read complete accounting state before each batch.
  const pending = mismatches(run([]));

  if (!pending.length) {
    console.log('ACCOUNTING BACKLOG CLEARED');
    break;
  }

  const batchIds = pending.slice(0, MAX_PER_BATCH);

  console.log(
    'ACCOUNTING BATCH ' +
    batchNumber +
    '/' +
    MAX_BATCHES +
    ' candidates=' +
    batchIds.length
  );

  for (const id of batchIds) {
    // Independent NetSuite/BQ revalidation immediately
    // before each individual accounting repair.
    const pre = run(['--id', id]);

    if (
      !pre.includes(
        'ACCOUNTING RECONCILIATION COMPLETE; differences=1; mode=READ ONLY'
      )
    ) {
      throw Error(
        'Candidate changed before repair ' + id
      );
    }

    // Uses existing per-ID safeguards:
    // - matching line keys
    // - matching quantities
    // - matching modified timestamp
    // - atomic header/line COGS update
    // - post-write COGS assertion
    // - rollback on failure
    const out = run(['--id', id, '--apply']);

    if (
      !out.includes(
        'ACCOUNTING REPAIRED: ' + id
      )
    ) {
      throw Error(
        'Repair completion evidence missing ' + id
      );
    }

    repaired++;
  }

  completedBatches++;

  // Verify progress after every batch.
  const remaining = mismatches(run([]));

  console.log(
    'ACCOUNTING BATCH COMPLETE ' +
    batchNumber +
    ' repairedTotal=' +
    repaired +
    ' remaining=' +
    remaining.length
  );

  if (!remaining.length) {
    break;
  }
}

// Mandatory final full accounting audit.
const finalPending = mismatches(run([]));

console.log(
  'ACCOUNTING FINAL AUDIT repaired=' +
  repaired +
  ' batches=' +
  completedBatches +
  ' remaining=' +
  finalPending.length
);

if (finalPending.length) {
  console.log(
    'BOUNDED REVIEW: remaining accounting candidates=' +
    finalPending.length +
    '; next scheduled recovery required'
  );

  // Partial recovery must NEVER be reported as FINAL_PASS.
  process.exit(3);
}

console.log(
  'IF ACCOUNTING AUTO RECOVERY PASS repaired=' +
  repaired +
  ' batches=' +
  completedBatches +
  ' postAudit=0'
);