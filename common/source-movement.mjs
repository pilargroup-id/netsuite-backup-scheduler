// Read-only evidence that the NetSuite source changed between two reconciliation attempts.
// This is NOT a consistent snapshot; never use it to certify FINAL_PASS.
const rules = {
  'sales-invoice': [
    ['headers', /NetSuite COUNT\s*:\s*(\d+)/i],
    ['headerTotal', /NetSuite TOTAL\s*:\s*([-\d.]+)/i],
    ['lines', /NetSuite LINE COUNT\s*:\s*(\d+)/i],
    ['lineTotal', /NetSuite LINE AMOUNT\s*:\s*([-\d.]+)/i],
  ],
  'sales-order': [
    ['inventory', /NetSuite:\s*headers=(\d+),\s*lines=(\d+)/i],
    ['headerTotal', /HEADER TOTAL EXACT CENTS\s*:\s*(?:PASS|FAIL)\s*\|\s*NetSuite=([-\d.]+)/i],
    ['rawLineAmount', /RAW LINE AMOUNT MATCH\s*:\s*(?:PASS|FAIL)\s*\|\s*NS signed=([-\d.]+)/i],
  ],
  'item-fulfillment': [
    ['inventory', /NetSuite=(\d+),\s*BQ active=\d+/i],
    ['headers', /NetSuite COUNT\s*:\s*(\d+)/i],
    ['headerCogs', /NetSuite COGS\s*:\s*([-\d.]+)/i],
    ['lines', /NetSuite LINES\s*:\s*(\d+)/i],
  ],
};

export function sourceEvidence(mod, output) {
  const result = {};
  for (const [key, regex] of rules[mod] ?? []) {
    const matches = [...String(output ?? '').matchAll(new RegExp(regex.source, 'gi'))];
    if (matches.length) result[key] = matches.at(-1).slice(1).join('/');
  }
  return result;
}

export function detectSourceMovement(mod, beforeOutput, afterOutput) {
  const before = sourceEvidence(mod, beforeOutput);
  const after = sourceEvidence(mod, afterOutput);
  const changed = Object.keys(before).filter(key =>
    Object.hasOwn(after, key) && before[key] !== after[key]
  );
  return {moving:changed.length > 0, changed, before, after};
}
