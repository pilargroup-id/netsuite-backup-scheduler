function asNumericRate(value) {
  const s = asDecimal(value);
  if (s == null) return null;

  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Invalid rate: ${s}`);

  const sign = m[1] === '-' ? '-' : '';
  const whole = m[2];
  const frac = m[3] ?? '';

  if (frac.length <= 9) return s;

  let scaled = BigInt(whole + frac.slice(0, 9));

  if (frac[9] >= '5') scaled += 1n;

  const digits = scaled.toString().padStart(10, '0');
  const result = digits.slice(0, -9) + '.' + digits.slice(-9);

  return scaled === 0n ? result : sign + result;
}
export function asDecimal(value) {
  if (value == null || value === '') return null;
  let s = String(value).trim();
  if (!/[eE]/.test(s)) return s;
  let negative = false;
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  const [coefficient, exponentText] = s.toLowerCase().split('e');
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw new Error('Invalid decimal exponent');
  const [whole, frac = ''] = coefficient.split('.');
  const digits = whole + frac;
  const point = whole.length + exponent;
  const out = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` :
    point >= digits.length ? digits + '0'.repeat(point - digits.length) :
      digits.slice(0, point) + '.' + digits.slice(point);
  return (negative ? '-' : '') + out;
}
export function negate(value) {
  const s = asDecimal(value);
  if (s == null) return null;
  if (Number(s) === 0) return '0';
  return s.startsWith('-') ? s.slice(1) : '-' + s;
}
export function safeInt(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Invalid ID: ${value}`);
  return n;
}
export function strTime(value) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) throw new Error(`Invalid datetime: ${s}`);
  return s;
}
export function normalize(headers, rawLines) {
  const now = new Date().toISOString();
  const seenHeaders = new Set();
  const seenLines = new Set();
  const h = headers.map(r => {
    const id = safeInt(r.internal_id);
    if (seenHeaders.has(id)) throw new Error(`Duplicate source header ${id}`);
    seenHeaders.add(id);
    return {
      internal_id: id,
      invoice_number: String(r.invoice_number),
      transaction_date: r.transaction_date,
      posting_period: r.posting_period ?? null,
      status: r.status ?? null,
      total_amount: asDecimal(r.total_amount),
      netsuite_last_modified_at: strTime(r.netsuite_last_modified_at),
      synced_at: now,
      first_synced_at: now,
      is_deleted: false,
      deleted_at: null
    };
  });
  const l = rawLines.map(r => {
    const id = safeInt(r.invoice_internal_id);
    const line = safeInt(r.line_number);
    const key = `${id}:${line}`;
    if (seenLines.has(key)) throw new Error(`Duplicate source line ${key}`);
    if (!seenHeaders.has(id)) throw new Error(`Orphan source line ${key}`);
    seenLines.add(key);
    return {
      invoice_internal_id: id,
      invoice_number: String(r.invoice_number),
      line_number: line,
      item_internal_id: r.item_internal_id == null ? null : safeInt(r.item_internal_id),
      item_name: r.item_name ?? null,
      description: r.description ?? null,
      quantity: negate(r.raw_quantity),
      unit: r.unit ?? null,
      rate: asNumericRate(r.rate),
      amount: negate(r.raw_amount),
      transaction_date: r.transaction_date,
      posting_period: r.posting_period ?? null,
      netsuite_last_modified_at: strTime(r.netsuite_last_modified_at),
      synced_at: now
    };
  });
  return { headers: h, lines: l };
}

