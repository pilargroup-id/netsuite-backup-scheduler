import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const supported = new Set([
  'item-receipt',
  'purchase-order',
  'purchase-invoice',
  'sales-return',
  'purchase-return',
  'sales-payment'
]);

function run(module, args) {
  const file = args[0] === 'presence'
    ? join(root, 'modules', module, 'presence.mjs')
    : join(root, 'scripts', 'verified-deletion.mjs');

  const argv = args[0] === 'presence'
    ? (['purchase-return', 'sales-payment'].includes(module) ? ['--deletion-inventory'] : [])
    : ['--module', module, '--id', args[1], args[2]];

  const result = spawnSync(process.execPath, [file, ...argv], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: args[2] === '--apply'
      ? {
          ...process.env,
          NETSUITE_VERIFIED_DELETE_CONFIRM:
            'I_CONFIRM_VERIFIED_SOFT_DELETE'
        }
      : process.env
  });

  if (result.error || result.signal) {
    throw Error(
      `Execution failed: ${result.error?.message ?? result.signal}`
    );
  }

  return {
    exit: result.status,
    out: result.stdout ?? '',
    err: result.stderr ?? ''
  };
}

function validIds(ids) {
  return Array.isArray(ids) &&
    ids.every(id => /^[1-9]\d{0,14}$/.test(String(id))) &&
    new Set(ids.map(String)).size === ids.length;
}

function parsePresence(module, result) {
  if (![0, 3].includes(result.exit)) {
    throw Error(`${module} presence execution failed: ${result.err}`);
  }

  if (module === 'item-receipt') {
    const totals = result.out.match(
      /NETSUITE\s+(\d+)\s+BIGQUERY\s+(\d+)\s+ONLY NETSUITE\s+(\d+)\s+ONLY BIGQUERY\s+(\d+)/
    );

    const nsList = result.out.match(
      /ONLY NETSUITE IDs:\s*\[([^\]]*)\]/
    );

    const bqList = result.out.match(
      /ONLY BIGQUERY IDs:\s*\[([^\]]*)\]/
    );

    if (!totals || !nsList || !bqList) {
      throw Error('IR presence output incomplete');
    }

    const parseList = text => {
      const trimmed = text.trim();
      if (!trimmed) return [];

      const quoted = [...trimmed.matchAll(/['"](\d+)['"]/g)]
        .map(m => m[1]);

      const residue = trimmed
        .replace(/['"]\d+['"]/g, '')
        .replace(/[\s,]/g, '');

      if (residue) throw Error('IR presence list ambiguous');
      return quoted;
    };

    const onlyNetSuite = parseList(nsList[1]);
    const onlyBigQuery = parseList(bqList[1]);

    if (
      onlyNetSuite.length !== Number(totals[3]) ||
      onlyBigQuery.length !== Number(totals[4])
    ) {
      throw Error('IR presence count/list mismatch');
    }

    return { onlyNetSuite, onlyBigQuery };
  }

  const start = result.out.indexOf('{');
  const end = result.out.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw Error(`${module} missing JSON presence inventory`);
  }

  const data = JSON.parse(result.out.slice(start, end + 1));

  if (
    !Array.isArray(data.onlyNetSuite) ||
    !Array.isArray(data.onlyBigQuery)
  ) {
    throw Error(`${module} presence lists missing`);
  }

  if (
    data.sourceDuplicate === true ||
    data.bigQueryDuplicate === true ||
    Number(data.sourceDuplicates ?? 0) !== 0 ||
    Number(data.bigQueryDuplicates ?? 0) !== 0
  ) {
    throw Error(`${module} duplicate inventory`);
  }

  // Refuse truncated/mismatched inventory: deletion must see every candidate.
  if ((data.onlyNetSuiteCount !== undefined && Number(data.onlyNetSuiteCount) !== data.onlyNetSuite.length) ||
      (data.onlyBigQueryCount !== undefined && Number(data.onlyBigQueryCount) !== data.onlyBigQuery.length)) {
    throw Error(`${module} incomplete deletion inventory; refusing batch`);
  }
  return {
    onlyNetSuite: data.onlyNetSuite.map(String),
    onlyBigQuery: data.onlyBigQuery.map(String)
  };
}

export function inspectDeletionInventory(module) {
  if (!supported.has(module)) {
    throw Error(`Unsupported deletion module: ${module}`);
  }

  const result = run(module, ['presence']);
  const inventory = parsePresence(module, result);

  if (
    !validIds(inventory.onlyNetSuite) ||
    !validIds(inventory.onlyBigQuery)
  ) {
    throw Error(`${module} invalid or duplicate inventory IDs`);
  }

  const clean = !inventory.onlyNetSuite.length &&
    !inventory.onlyBigQuery.length;

  if (clean && result.exit !== 0) {
    throw Error(`${module} conflicting clean presence exit`);
  }

  if (!clean && result.exit !== 3) {
    throw Error(`${module} conflicting discrepancy exit`);
  }

  return inventory;
}

export function processVerifiedDeletionBatch(
  module,
  inventory,
  { apply = false } = {}
) {
  if (!supported.has(module)) {
    throw Error(`Unsupported deletion module: ${module}`);
  }

  if (
    !validIds(inventory.onlyBigQuery) ||
    !validIds(inventory.onlyNetSuite)
  ) {
    throw Error('Deletion inventory is not auditable');
  }

  const candidates = inventory.onlyBigQuery.slice(0, 3);
  let applied = 0;

  for (const id of candidates) {
    const dry = run(module, ['delete', id, '--dry-run']);

    if (
      dry.exit !== 0 ||
      !dry.out.includes('DRY RUN PASS')
    ) {
      console.log(
        `VERIFIED DELETION BLOCKED ${module} id=${id}: no valid proof`
      );
      continue;
    }

    console.log(
      `VERIFIED DELETION PROOF PASS ${module} id=${id}`
    );

    if (!apply) continue;

    const result = run(module, ['delete', id, '--apply']);

    if (
      result.exit !== 0 ||
      !result.out.includes('VERIFIED SOFT DELETE PASS')
    ) {
      console.error(result.err || result.out);
      throw Error(
        `VERIFIED DELETION APPLY FAILED ${module} id=${id}`
      );
    }

    applied++;
    console.log(
      `VERIFIED SOFT DELETE PASS ${module} id=${id}`
    );
  }

  console.log(
    `VERIFIED DELETION BATCH ${module}: ` +
    `applied=${applied} candidates=${candidates.length} ` +
    `backlog=${inventory.onlyBigQuery.length}`
  );

  return { applied, candidates: candidates.length };
}
