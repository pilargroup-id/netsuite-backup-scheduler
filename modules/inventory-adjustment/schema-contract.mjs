// MODULE 15 — Inventory Adjustment, Phase C schema only.
// Source-confirmed fields from Phase A/B. No global schema/checkpoint changes.
export const TABLES = Object.freeze([
  {
    name: 'inventory_adjustment_headers',
    partition: 'transaction_date',
    cluster: 'internal_id',
    fields: [
      ['internal_id','STRING'],['tranid','STRING'],['transaction_date','DATE'],
      ['last_modified','DATETIME'],['memo','STRING'],['subsidiary_id','STRING'],
      ['location_id','STRING'],['adjustment_account_id','STRING'],
      ['posting_period_id','STRING'],['status_id','STRING'],
      ['synced_at','TIMESTAMP'],['is_deleted','BOOL'],['deleted_at','TIMESTAMP']
    ]
  },
  {
    name: 'inventory_adjustment_lines',
    partition: null,
    cluster: 'adjustment_internal_id',
    fields: [
      ['adjustment_internal_id','STRING'],['line_id','STRING'],['line_unique_key','STRING'],
      ['line_sequence_number','STRING'],['is_mainline','BOOL'],['item_id','STRING'],
      ['location_id','STRING'],['quantity','BIGNUMERIC'],['units_id','STRING'],
      ['rate','BIGNUMERIC'],['foreign_amount','BIGNUMERIC'],
      ['net_amount','BIGNUMERIC'],['memo','STRING'],['is_cogs','BOOL'],
      ['accounting_line_type','STRING'],['synced_at','TIMESTAMP']
    ]
  },
  {
    name: 'inventory_adjustment_accounting_lines',
    partition: null,
    cluster: 'adjustment_internal_id',
    fields: [
      ['adjustment_internal_id','STRING'],['line_id','STRING'],
      ['accounting_book_id','STRING'],['account_id','STRING'],['is_posting','BOOL'],
      ['debit','BIGNUMERIC'],['credit','BIGNUMERIC'],['synced_at','TIMESTAMP']
    ]
  }
]);
export const ddl = (t,T) => {
 const cols=t.fields.map(([name,type])=>`\`${name}\` ${type}`).join(',\n  ');
 return `CREATE TABLE ${T(t.name)} (\n  ${cols}\n)${t.partition?` PARTITION BY ${t.partition}`:''}${t.cluster?` CLUSTER BY ${t.cluster}`:''}`;
};
