// Module 13 Journal Entry: isolated 5-table schema contract, no I/O.
// Source: full coverage 188 Journal headers, 1164 TL, 1164 GL; links currently zero.
// Values in accounting lines are book currency, NOT transaction foreign amount.
export const GROUPS = [
 {table:'journal_entry_headers',source:'headers',key:['journal_entry_id'],fields:[['journal_entry_id','STRING'],['document_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],['memo','STRING'],['status_id','STRING'],['currency_id','STRING'],['exchange_rate','NUMERIC'],['posting_period_id','STRING'],['subsidiary_id','STRING'],['posting','BOOL'],['is_void','BOOL']]},
 {table:'journal_entry_lines',source:'transactionLines',key:['journal_entry_id','line_unique_key'],fields:[['journal_entry_id','STRING'],['line_id','STRING'],['line_unique_key','STRING'],['line_sequence_number','STRING'],['is_mainline','BOOL'],['account_id','STRING'],['department_id','STRING'],['class_id','STRING'],['location_id','STRING'],['subsidiary_id','STRING'],['memo','STRING'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC']]},
 {table:'journal_entry_accounting_lines',source:'accountingLines',key:['journal_entry_id','accounting_book_id','line_id','account_id'],fields:[['journal_entry_id','STRING'],['line_id','STRING'],['accounting_book_id','STRING'],['account_id','STRING'],['posting','BOOL'],['debit','NUMERIC'],['credit','NUMERIC']]},
 {table:'journal_entry_previous_links',source:'previousLinks',key:['journal_entry_id','previous_doc_id','previous_line_id','next_doc_id','next_line_id','link_type'],fields:[['journal_entry_id','STRING'],['previous_doc_id','STRING'],['previous_line_id','STRING'],['next_doc_id','STRING'],['next_line_id','STRING'],['previous_type','STRING'],['next_type','STRING'],['link_type','STRING'],['applied_amount','NUMERIC'],['last_modified','DATETIME']]},
 {table:'journal_entry_next_links',source:'nextLinks',key:['journal_entry_id','previous_doc_id','previous_line_id','next_doc_id','next_line_id','link_type'],fields:[['journal_entry_id','STRING'],['previous_doc_id','STRING'],['previous_line_id','STRING'],['next_doc_id','STRING'],['next_line_id','STRING'],['previous_type','STRING'],['next_type','STRING'],['link_type','STRING'],['applied_amount','NUMERIC'],['last_modified','DATETIME']]}
];
export const EXTRA_HEADER=[['synced_at','TIMESTAMP'],['is_deleted','BOOL'],['deleted_at','TIMESTAMP']];
export const EXTRA_DETAIL=[['synced_at','TIMESTAMP']];
export const columnDefinitions=g=>[...g.fields,...(g===GROUPS[0]?EXTRA_HEADER:EXTRA_DETAIL)];
