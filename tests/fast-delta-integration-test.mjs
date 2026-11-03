import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const srcRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ns-fast-delta-test-'));
try {
  for (const sub of ['scripts','common','modules/sales-invoice','modules/item-fulfillment','modules/sales-order']) fs.mkdirSync(path.join(root,sub),{recursive:true});
  for (const [src,dst] of [['scripts/fast-delta.mjs','scripts/fast-delta.mjs'],['common/child-runner.mjs','common/child-runner.mjs'],['common/shared-lock.mjs','common/shared-lock.mjs']]) fs.copyFileSync(path.join(srcRoot,src),path.join(root,dst));
  fs.writeFileSync(path.join(root,'modules/sales-invoice/sync.mjs'),"console.log('SALES INVOICE DELTA SYNC SUCCESS');\n");
  fs.writeFileSync(path.join(root,'modules/item-fulfillment/sync.mjs'),"console.log('STAGING VALIDATION: PASS');\n");
  fs.writeFileSync(path.join(root,'modules/sales-order/sync.mjs'),"console.log('SALES ORDER SYNC SUCCESS');\n");
  const run=spawnSync(process.execPath,[path.join(root,'scripts/fast-delta.mjs'),'--sync'],{cwd:root,encoding:'utf8',timeout:10000});
  assert.equal(run.status,1,run.stderr);
  const state=JSON.parse(fs.readFileSync(path.join(root,'logs/fast-delta/health-v2.json'),'utf8'));
  assert.equal(state.modules['sales-invoice'].lastResult,'SYNC_OK');
  assert.equal(state.modules['item-fulfillment'].lastResult,'FAILED');
  assert.equal(state.modules['sales-order'].lastResult,'SYNC_OK');
  assert.equal(state.lastRunStatus,'FAILED');
  assert.equal(fs.existsSync(path.join(root,'logs/scheduler/.running.lock')),false);
  console.log('FAST DELTA INTEGRATION TESTS PASS');
} finally {fs.rmSync(root,{recursive:true,force:true});}
