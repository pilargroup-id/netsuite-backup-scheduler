// Shared, semantics-preserving helpers for future module additions.
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function chunks(rows, size) {
  if (!Number.isInteger(size) || size <= 0) throw new Error('Invalid chunk size');
  const result = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
}
export function subtractMinutes(datetime, minutes = 5) {
  const date = new Date(String(datetime).replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) throw new Error('Invalid datetime: ' + datetime);
  date.setUTCMinutes(date.getUTCMinutes() - minutes);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
