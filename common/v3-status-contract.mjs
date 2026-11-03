// Pure parser for the V3 recovery summary. Never grants success from missing entries.
export const REQUIRED_V3_MODULES = Object.freeze([
  'sales-invoice', 'item-fulfillment', 'sales-order', 'item-receipt',
  'purchase-order', 'purchase-invoice', 'sales-return', 'purchase-return', 'sales-payment'
]);
const ALLOWED = new Set(['FINAL_PASS','NO_SOURCE','NEEDS_REVIEW','AUDIT_CLEAN','ERROR','FAILED']);
export function classifyV3Recovery(code, output, timedOut=false) {
  if (timedOut) return 'FAILED';
  if (code === 3) return 'NEEDS_REVIEW';
  if (code !== 0) return 'FAILED';
  const marker = '========== RECOVERY SUMMARY ==========';
  const at = String(output).lastIndexOf(marker);
  if (at < 0) return 'NEEDS_REVIEW';
  const tail = String(output).slice(at + marker.length);
  const statuses = new Map();
  for (const line of tail.split(/\r?\n/)) {
    const m = line.trim().match(/^([a-z]+(?:-[a-z]+)*):\s*([A-Z_]+)$/);
    if (!m || !REQUIRED_V3_MODULES.includes(m[1])) continue;
    if (statuses.has(m[1]) || !ALLOWED.has(m[2])) return 'NEEDS_REVIEW';
    statuses.set(m[1], m[2]);
  }
  if (statuses.size !== REQUIRED_V3_MODULES.length) return 'NEEDS_REVIEW';
  if (REQUIRED_V3_MODULES.some(name => ['FAILED','ERROR'].includes(statuses.get(name)))) return 'FAILED';
  for (const name of REQUIRED_V3_MODULES) {
    const value = statuses.get(name);
    if (name === 'purchase-return' && value === 'NO_SOURCE') continue;
    if (value === 'NO_SOURCE') return 'NEEDS_REVIEW';
    if (value !== 'FINAL_PASS') return 'NEEDS_REVIEW';
  }
  return 'FINAL_PASS';
}
