// Module 14 only. All quantities are signed NetSuite TransactionLine quantities.
// Source coverage: 609 InvTrnfr headers / 29,705 lines, including mainline rows.
export const GROUPS = [
  { table: 'inventory_transfer_headers', key: ['internal_id'], fields: [
    ['internal_id','STRING'],['tranid','STRING'],['transaction_date','DATE'],
    ['last_modified','DATETIME'],['memo','STRING'],['subsidiary_id','STRING'],
    ['source_location_id','STRING'],['destination_location_id','STRING']
  ]},
  { table: 'inventory_transfer_lines', key: ['transfer_internal_id','line_unique_key'], fields: [
    ['transfer_internal_id','STRING'],['line_id','STRING'],['line_unique_key','STRING'],
    ['item_id','STRING'],['location_id','STRING'],['quantity','NUMERIC'],
    ['units_id','STRING'],['memo','STRING'],['is_mainline','BOOL']
  ]}
];
export const EXTRA_HEADER = [['synced_at','TIMESTAMP'],['is_deleted','BOOL'],['deleted_at','TIMESTAMP']];
export const EXTRA_DETAIL = [['synced_at','TIMESTAMP']];
export const columnDefinitions = g => [...g.fields,...(g===GROUPS[0]?EXTRA_HEADER:EXTRA_DETAIL)];
