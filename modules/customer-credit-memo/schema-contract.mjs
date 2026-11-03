// Module 10 CustCred schema contract. No I/O. Keep numeric fields exact.
export const GROUPS = [
 {table:'customer_credit_memo_headers',source:'headers',key:['credit_memo_id'],fields:[
  ['credit_memo_id','STRING'],['document_number','STRING'],['transaction_date','DATE'],['last_modified','DATETIME'],['status_id','STRING'],['customer_id','STRING'],['customer_name','STRING'],['currency_id','STRING'],['currency_name','STRING'],['exchange_rate','NUMERIC'],['foreign_total','NUMERIC'],['base_total','NUMERIC'],['posting_period_id','STRING'],['subsidiary_id','STRING'],['is_void','BOOL']]},
 {table:'customer_credit_memo_lines',source:'transactionLines',key:['credit_memo_id','line_unique_key'],fields:[
  ['credit_memo_id','STRING'],['line_id','STRING'],['line_unique_key','STRING'],['line_number','STRING'],['is_mainline','BOOL'],['is_taxline','BOOL'],['is_cogs','BOOL'],['accounting_line_type','STRING'],['account_id','STRING'],['item_id','STRING'],['quantity','NUMERIC'],['rate','BIGNUMERIC'],['foreign_amount','NUMERIC'],['net_amount','NUMERIC']]},
 {table:'customer_credit_memo_accounting_lines',source:'accountingLines',key:['credit_memo_id','accounting_book_id','line_id','account_id'],nullableKey:['account_id'],fields:[
  ['credit_memo_id','STRING'],['line_id','STRING'],['accounting_book_id','STRING'],['account_id','STRING'],['posting','BOOL'],['debit','NUMERIC'],['credit','NUMERIC']]},
 {table:'customer_credit_memo_previous_links',source:'previousLinks',key:['credit_memo_id','previous_doc_id','previous_line_id','next_doc_id','next_line_id','link_type','previous_type','next_type'],fields:[
  ['credit_memo_id','STRING'],['previous_doc_id','STRING'],['previous_line_id','STRING'],['next_doc_id','STRING'],['next_line_id','STRING'],['previous_type','STRING'],['next_type','STRING'],['link_type','STRING'],['relationship_class','STRING'],['applied_amount','NUMERIC'],['discount_flag','STRING'],['last_modified','DATETIME']]},
 {table:'customer_credit_memo_next_links',source:'nextLinks',key:['credit_memo_id','previous_doc_id','previous_line_id','next_doc_id','next_line_id','link_type','previous_type','next_type'],fields:[
  ['credit_memo_id','STRING'],['previous_doc_id','STRING'],['previous_line_id','STRING'],['next_doc_id','STRING'],['next_line_id','STRING'],['previous_type','STRING'],['next_type','STRING'],['link_type','STRING'],['relationship_class','STRING'],['applied_amount','NUMERIC'],['discount_flag','STRING'],['last_modified','DATETIME']]},
 {table:'customer_credit_memo_financial_classification',source:'financialClassification',key:['credit_memo_id','accounting_book_id'],fields:[
  ['credit_memo_id','STRING'],['accounting_book_id','STRING'],['classification','STRING'],['gl_delta','NUMERIC'],['adjustment_line_id','STRING'],['adjustment_unique_key','STRING'],['adjustment_foreign_amount','NUMERIC'],['non_adjustment_gl_delta','NUMERIC']]} 
];
export const EXTRA_HEADER = [['synced_at','TIMESTAMP'],['is_deleted','BOOL'],['deleted_at','TIMESTAMP']];
export const EXTRA_DETAIL = [['synced_at','TIMESTAMP']];
export const columnDefinitions = (g) => [...g.fields,...(g===GROUPS[0]?EXTRA_HEADER:EXTRA_DETAIL)];
