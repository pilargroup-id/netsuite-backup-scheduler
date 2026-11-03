// Reusable strict NetSuite deletedrecord proof; unrelated record-ID collisions are ignored.
// Fail closed when the exact record tuple has zero or multiple candidates.
export function matchDeletedRecordProof(rows, rawId, record) {
  if (!Array.isArray(rows) || !record) return [];
  return rows.filter(row =>
    String(row.recordid ?? '') === String(rawId) &&
    String(row.recordtypeid ?? '').toLowerCase() === String(record.recordtypeid ?? '').toLowerCase() &&
    String(row.type ?? '').toUpperCase() === String(record.type ?? '').toUpperCase() &&
    Boolean(row.deleteddate)
  );
}
