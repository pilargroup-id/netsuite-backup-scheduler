const MAX_INTEGER_DIGITS = 29;
const SCALE = 9;

function canonical(value) {
  if (value === null || value === undefined || value === '') return null;

  const raw = String(value).trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw new Error(`Invalid decimal: ${raw}`);

  const negative = match[1] === '-';
  const whole = match[2] ?? '';
  const frac = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? 0);

  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) {
    throw new Error(`Unsupported decimal exponent: ${raw}`);
  }

  const digits = (whole + frac).replace(/^0+/, '') || '0';
  const shift = exponent - frac.length;

  let result;
  if (shift >= 0) {
    result = digits + '0'.repeat(shift);
  } else {
    const position = digits.length + shift;
    result = position > 0
      ? digits.slice(0, position) + '.' + digits.slice(position)
      : '0.' + '0'.repeat(-position) + digits;
  }

  let [integer, fractional = ''] = result.split('.');
  integer = integer.replace(/^0+(?=\d)/, '');
  fractional = fractional.replace(/0+$/, '');

  const normalized = integer + (fractional ? '.' + fractional : '');
  return negative && normalized !== '0' ? '-' + normalized : normalized;
}

function contextLabel(context) {
  return [
    context.module,
    context.recordId && `record=${context.recordId}`,
    context.field && `field=${context.field}`
  ].filter(Boolean).join(' ');
}

export function validateNumeric(value, context = {}) {
  const s = canonical(value);
  if (s === null) return null;

  const unsigned = s.replace(/^-/, '');
  const [integer, fraction = ''] = unsigned.split('.');

  if (fraction.length > SCALE || integer.length > MAX_INTEGER_DIGITS) {
    throw new Error(
      `BigQuery NUMERIC precision violation [${contextLabel(context)}]: ${s}`
    );
  }

  return s;
}

export function normalizeNumericRate(value, context = {}) {
  const s = canonical(value);
  if (s === null) return null;

  const negative = s.startsWith('-');
  const [integer, fraction = ''] = s.replace(/^-/, '').split('.');

  if (fraction.length <= SCALE) {
    return validateNumeric(s, context);
  }

  let units = BigInt(integer + fraction.slice(0, SCALE));
  if (fraction[SCALE] >= '5') units += 1n;

  const padded = units.toString().padStart(SCALE + 1, '0');
  const split = padded.length - SCALE;

  const rounded = (
    padded.slice(0, split) + '.' + padded.slice(split)
  ).replace(/0+$/, '').replace(/\.$/, '');

  return validateNumeric(
    negative && units !== 0n ? '-' + rounded : rounded,
    context
  );
}

export function validateNumericRows(rows, fields, context = {}) {
  const numericFields = fields
    .filter(([, type]) => type === 'NUMERIC')
    .map(([name]) => name);

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];

    const recordId =
      row.internal_id ??
      row.bill_internal_id ??
      row.po_internal_id ??
      row.receipt_internal_id ??
      row.invoice_internal_id ??
      row.sales_order_internal_id ??
      `row-${index + 1}`;

    for (const field of numericFields) {
      validateNumeric(row[field], {
        ...context,
        recordId,
        field
      });
    }
  }

  return rows;
}

// Additive BIGNUMERIC validator. Existing NUMERIC behavior is unchanged.
// Store as a string in BigQuery inserts, never convert monetary values to JS Number.
// For BIGNUMERIC, a conservative exact range guard is 38 integer digits and
// 38 fractional digits; any value outside these bounds fails closed.
export function validateBigNumeric(value, context = {}) {
  const s = canonical(value);
  if (s === null) return null;

  const [integer, fraction = ''] = s.replace(/^-/, '').split('.');
  if (integer.length > 38 || fraction.length > 38) {
    throw new Error(
      `BigQuery BIGNUMERIC precision violation [${contextLabel(context)}]: ${s}`
    );
  }
  return s;
}
