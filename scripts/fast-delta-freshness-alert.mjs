import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notify } from './monitor-alert.mjs';
import { classify, initialState, transition } from './freshness-incident-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'logs', 'fast-delta');
const healthFile = path.join(dir, 'health-v2.json');
const stateFile = path.join(dir, 'freshness-alert-state.json');
const args = process.argv.slice(2);
const test = args.includes('--test');
const thresholdArg = args.find(x => /^\d+$/.test(x));
const threshold = thresholdArg ? Number(thresholdArg) : 20;
if (!Number.isInteger(threshold) || threshold < 5 || threshold > 1440) {
  console.error('Threshold must be an integer between 5 and 1440 minutes');
  process.exit(1);
}
const now = Date.now();
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const health = test ? {
  version: 2,
  modules: {
    'sales-invoice': { lastSuccessAt: new Date(now - 25 * 60_000).toISOString() },
    'item-fulfillment': { lastSuccessAt: new Date(now - 2 * 60_000).toISOString() },
    'sales-order': { lastSuccessAt: new Date(now - 2 * 60_000).toISOString() },
  },
} : read(healthFile);
const result = classify(health, now, threshold);
console.log(`FRESHNESS ALERT STATUS: ${result.status}`);
for (const detail of result.details) console.log(detail);
if (test) {
  console.log('TEST MODE: no Telegram, no state changes');
  process.exit(0);
}

// Freshness Monitor task is configured IgnoreNew, so concurrent state writers
// are not expected. Do not run this file manually while its task is Running.
const oldState = read(stateFile) || initialState();
const moved = transition(oldState, result, new Date(now).toISOString(), notify, threshold);
for (const event of moved.events) console.log('TELEGRAM:', event);
fs.mkdirSync(dir, { recursive: true });
const temp = `${stateFile}.${process.pid}.tmp`;
fs.writeFileSync(temp, JSON.stringify(moved.state, null, 2));
fs.renameSync(temp, stateFile);
if (result.status === 'FRESH' && !moved.notificationFailure) console.log('FRESHNESS OK');
process.exitCode = moved.exitCode;
