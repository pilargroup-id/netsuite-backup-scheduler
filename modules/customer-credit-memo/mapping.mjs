// Module 10 — source mapping only. No BigQuery writes, DDL, checkpoint, or deletion.
import {token,fetchAll} from '../../common/netsuite-client.mjs';
import {validateNumeric,validateBigNumeric} from '../../common/decimal-precision.mjs';
// Inlined decimal validation and financial-classification helpers (no algorithm changes).
const HEADER_DECIMAL_TYPES = Object.freeze({
  exchange_rate: 'NUMERIC', foreign_total: 'NUMERIC', base_total: 'NUMERIC'
});
const LINE_DECIMAL_TYPES = Object.freeze({
  quantity: 'NUMERIC', rate: 'BIGNUMERIC', foreign_amount: 'NUMERIC', net_amount: 'NUMERIC'
});
const ACCOUNTING_DECIMAL_TYPES = Object.freeze({debit: 'NUMERIC', credit: 'NUMERIC'});
const LINK_DECIMAL_TYPES = Object.freeze({applied_amount: 'NUMERIC'});

function mapDecimal(field, value, type, recordId) {
  const context = {module: 'customer-credit-memo', recordId, field};
  if (type === 'NUMERIC') return validateNumeric(value, context);
  if (type === 'BIGNUMERIC') return validateBigNumeric(value, context);
  throw new Error(`Unsupported decimal type ${type} for ${field}`);
}

function validateDecimalRecord(row, types, recordId) {
  const out = {...row};
  for (const [field, type] of Object.entries(types)) {
    if (Object.hasOwn(out, field)) out[field] = mapDecimal(field, out[field], type, recordId);
  }
  return out;
}

const SCALE = 1000000000n;
const ctx = (id, field) => ({ module: 'customer-credit-memo', recordId: String(id), field });
function units(value, id, field) {
  if (value === null || value === undefined || value === '') return 0n;
  const s = validateNumeric(String(value), ctx(id, field));
  if (s === null) return 0n;
  const negative = s.startsWith('-');
  const [whole, fraction = ''] = (negative ? s.slice(1) : s).split('.');
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(9, '0'));
  return negative ? -result : result;
}
function formatUnits(value) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const frac = String(abs % SCALE).padStart(9, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${abs / SCALE}${frac ? '.' + frac : ''}`;
}
const classStr = v => v === undefined || v === null ? null : String(v);
const isTrue = v => String(v ?? 'F').toUpperCase() === 'T';
const keyFor = r => classStr(r.line_id ?? r.transactionline);

// classification is per document AND accounting book. Allowed adjustment is evidence,
// not a financial tolerance and not a replacement journal entry.
function classifyDocument({ header, transactionLines, accountingLines, bookId = '1' }) {
  const id = classStr(header.internal_id ?? header.credit_memo_id ?? header.transaction_id);
  if (!/^\d+$/.test(id ?? '')) throw Error('Invalid credit memo ID');
  const lines = transactionLines.filter(r => classStr(r.transaction_id ?? r.credit_memo_id) === id);
  const gl = accountingLines.filter(r => classStr(r.transaction_id ?? r.credit_memo_id) === id && classStr(r.accounting_book_id ?? r.book_id) === classStr(bookId));
  if (!gl.length) return { id, bookId: classStr(bookId), classification: 'BLOCKED', reason: 'MISSING_GL' };
  let debit = 0n, credit = 0n;
  for (const g of gl) {
    if (isTrue(g.posting) === false) return { id, bookId: classStr(bookId), classification: 'BLOCKED', reason: 'NONPOSTING_GL_ROW' };
    debit += units(g.debit, id, 'debit');
    credit += units(g.credit, id, 'credit');
  }
  const delta = debit - credit;
  if (delta === 0n) return { id, bookId: classStr(bookId), classification: 'GL_EXACT_BALANCED', gl_delta: '0', adjustment_lines: 0 };
  // All conditions required: dedicated adjustment item, non-mainline, non-tax, non-COGS,
  // no account, zero net amount, one matching GL row without account, exact foreignamount.
  const candidates = [];
  for (const l of lines) {
    if (classStr(l.item_id) !== '17653' || isTrue(l.mainline) || isTrue(l.taxline) || isTrue(l.iscogs) || classStr(l.account_id) !== null) continue;
    if (units(l.netamount, id, 'netamount') !== 0n) continue;
    const amount = units(l.foreignamount, id, 'foreignamount');
    if (amount === 0n) continue;
    const matching = gl.filter(g => keyFor(g) === keyFor(l) && classStr(g.account_id) === null);
    if (matching.length !== 1) continue;
    const glDelta = units(matching[0].debit, id, 'debit') - units(matching[0].credit, id, 'credit');
    if (amount !== glDelta || glDelta === 0n) continue;
    candidates.push({ line: l, gl: matching[0], amount, glDelta });
  }
  if (candidates.length !== 1 || candidates[0].glDelta !== delta) return {
    id, bookId: classStr(bookId), classification: 'BLOCKED', reason: 'UNEXPLAINED_GL_DELTA',
    gl_delta: formatUnits(delta), adjustment_candidates: candidates.length
  };
  const selected = candidates[0];
  return {
    id, bookId: classStr(bookId), classification: 'SOURCE_ADJUSTMENT_VERIFIED',
    gl_delta: formatUnits(delta), adjustment_line_id: keyFor(selected.line),
    adjustment_unique_key: classStr(selected.line.line_unique_key),
    adjustment_foreign_amount: formatUnits(selected.amount),
    non_adjustment_gl_delta: '0'
  };
}

export {token};
export const TYPE='CustCred', FROM='2026-10-01', TO='2027-01-01';
const PERIOD=`t.type='${TYPE}' AND t.trandate>=TO_DATE('${FROM}','YYYY-MM-DD') AND t.trandate<TO_DATE('${TO}','YYYY-MM-DD')`;
const str=x=>x==null?null:String(x);
const flag=x=>String(x??'F').toUpperCase()==='T';
const linkDatetime=(value,creditMemoId)=>{if(value==null||value==='')return null;const v=String(value);if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v))throw Error('Invalid link lastmodifieddate for '+creditMemoId+': '+v);return v;};
const id=x=>{const v=str(x);if(!/^[1-9]\d*$/.test(v??''))throw Error('Invalid NetSuite identity: '+v);return v;};
async function batches(access,ids,sql){const result=[];for(let i=0;i<ids.length;i+=25){const part=ids.slice(i,i+25).map(id).join(',');result.push(...await fetchAll(access,sql(part)));}return result;}
export async function fetchHeaders(access,since=null){if(since!==null&&!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(since))throw Error('Invalid watermark');const extra=since?` AND t.lastmodifieddate>=TO_DATE('${since}','YYYY-MM-DD HH24:MI:SS')`:'';return fetchAll(access,`SELECT t.id AS internal_id,t.tranid AS document_number,TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,t.status AS status_id,t.entity AS customer_id,BUILTIN.DF(t.entity) AS customer_name,t.currency AS currency_id,BUILTIN.DF(t.currency) AS currency_name,t.exchangerate,t.foreigntotal,t.total,t.postingperiod AS posting_period_id,t.subsidiary AS subsidiary_id,t.void,t.voided FROM Transaction t WHERE ${PERIOD}${extra} ORDER BY t.id`);}
export async function fetchLines(access,ids){return batches(access,ids,s=>`SELECT tl.transaction AS transaction_id,tl.id AS line_id,tl.uniquekey AS line_unique_key,tl.linesequencenumber AS line_number,tl.mainline,tl.taxline,tl.iscogs,tl.accountinglinetype,tl.expenseaccount AS account_id,tl.item AS item_id,tl.quantity,tl.rate,tl.foreignamount,tl.netamount FROM TransactionLine tl WHERE tl.transaction IN (${s}) ORDER BY tl.transaction,tl.id`);}
export async function fetchGL(access,ids){return batches(access,ids,s=>`SELECT transaction AS transaction_id,transactionline AS line_id,accountingbook AS accounting_book_id,account AS account_id,posting,debit,credit FROM TransactionAccountingLine WHERE transaction IN (${s}) ORDER BY transaction,accountingbook,transactionline,account`);}
export async function fetchPreviousLinks(access,ids){return batches(access,ids,s=>`SELECT previousdoc,previousline,nextdoc,nextline,previoustype,nexttype,linktype,foreignamount,discount,TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS lastmodifieddate FROM PreviousTransactionLineLink WHERE nextdoc IN (${s}) ORDER BY nextdoc,previousdoc,previousline,nextline`);}
export async function fetchNextLinks(access,ids){return batches(access,ids,s=>`SELECT previousdoc,previousline,nextdoc,nextline,previoustype,nexttype,linktype,foreignamount,TO_CHAR(lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS lastmodifieddate FROM NextTransactionLineLink WHERE previousdoc IN (${s}) ORDER BY previousdoc,nextdoc,previousline,nextline`);}
export function mapSource(headers,lines,gl,previousLinks,nextLinks){
 const out={headers:[],transactionLines:[],accountingLines:[],previousLinks:[],nextLinks:[],financialClassification:[]};
 const lookup=new Map(),byLines=new Map(),byGL=new Map(),lineKeys=new Set(),glKeys=new Set(),linkKeys=new Set(),mainlines=new Map();
 for(const h of headers){const p=id(h.internal_id);if(lookup.has(p))throw Error('Duplicate header '+p);if(!/^\d{4}-\d\d-\d\d$/.test(h.transaction_date??''))throw Error('Invalid transaction date '+p);if(h.last_modified!=null&&!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(h.last_modified))throw Error('Invalid modified date '+p);
 const row=validateDecimalRecord({credit_memo_id:p,document_number:str(h.document_number),transaction_date:h.transaction_date,last_modified:str(h.last_modified),status_id:str(h.status_id),customer_id:str(h.customer_id),customer_name:str(h.customer_name),currency_id:str(h.currency_id),currency_name:str(h.currency_name),exchange_rate:h.exchangerate,foreign_total:h.foreigntotal,base_total:h.total,posting_period_id:str(h.posting_period_id),subsidiary_id:str(h.subsidiary_id),is_void:flag(h.void)||flag(h.voided)},HEADER_DECIMAL_TYPES,p);if(row.foreign_total==null||row.base_total==null)throw Error('Missing header financial '+p);lookup.set(p,row);out.headers.push(row);}
 const known=p=>{if(!lookup.has(p))throw Error('Orphan detail '+p);};
 for(const l of lines){const p=id(l.transaction_id);known(p);const unique=id(l.line_unique_key),key=p+':'+unique;if(lineKeys.has(key))throw Error('Duplicate line '+key);lineKeys.add(key);const row=validateDecimalRecord({credit_memo_id:p,line_id:str(l.line_id),line_unique_key:unique,line_number:str(l.line_number),is_mainline:flag(l.mainline),is_taxline:flag(l.taxline),is_cogs:flag(l.iscogs),accounting_line_type:str(l.accountinglinetype),account_id:str(l.account_id),item_id:str(l.item_id),quantity:l.quantity,rate:l.rate,foreign_amount:l.foreignamount,net_amount:l.netamount},LINE_DECIMAL_TYPES,p);out.transactionLines.push(row);if(!byLines.has(p))byLines.set(p,[]);byLines.get(p).push({...l,transaction_id:p});if(row.is_mainline){mainlines.set(p,(mainlines.get(p)||0)+1);if(row.net_amount==null||units(row.net_amount,p,'mainline_net')!==units(lookup.get(p).base_total,p,'base_total'))throw Error('Mainline mismatch '+p);}}
 for(const a of gl){const p=id(a.transaction_id);known(p);const book=id(a.accounting_book_id),key=[p,book,str(a.line_id),str(a.account_id)].join(':');if(glKeys.has(key))throw Error('Duplicate GL grain '+key);glKeys.add(key);const row=validateDecimalRecord({credit_memo_id:p,line_id:str(a.line_id),accounting_book_id:book,account_id:str(a.account_id),posting:flag(a.posting),debit:a.debit,credit:a.credit},ACCOUNTING_DECIMAL_TYPES,p);out.accountingLines.push(row);if(!byGL.has(p))byGL.set(p,[]);byGL.get(p).push({...a,transaction_id:p});}
 const addLink=(l,direction)=>{const p=id(direction==='previous'?l.nextdoc:l.previousdoc);known(p);const key=[direction,p,str(l.previousdoc),str(l.previousline),str(l.nextdoc),str(l.nextline),str(l.linktype),str(l.previoustype),str(l.nexttype)].join('|');if(linkKeys.has(key))throw Error('Duplicate link identity '+key);linkKeys.add(key);const type=direction==='previous'&&l.linktype==='Payment'&&l.previoustype==='CustInvc'?'INVOICE_APPLICATION':'RELATED_TRANSACTION';const row=validateDecimalRecord({credit_memo_id:p,previous_doc_id:id(l.previousdoc),previous_line_id:str(l.previousline),next_doc_id:id(l.nextdoc),next_line_id:str(l.nextline),previous_type:str(l.previoustype),next_type:str(l.nexttype),link_type:str(l.linktype),relationship_class:type,applied_amount:l.foreignamount,discount_flag:str(l.discount),last_modified:linkDatetime(l.lastmodifieddate,p)},LINK_DECIMAL_TYPES,p);out[direction==='previous'?'previousLinks':'nextLinks'].push(row);};
 for(const l of previousLinks)addLink(l,'previous');for(const l of nextLinks)addLink(l,'next');
 for(const [p,h] of lookup){if(mainlines.get(p)!==1)throw Error('Exactly one AR mainline required '+p);if((byLines.get(p)||[]).length<2)throw Error('Missing detail lines '+p);if(!byGL.has(p))throw Error('Missing GL '+p);const books=new Set(byGL.get(p).map(g=>id(g.accounting_book_id)));for(const b of books){const status=classifyDocument({header:{internal_id:p},transactionLines:byLines.get(p)||[],accountingLines:byGL.get(p),bookId:b});if(status.classification==='BLOCKED')throw Error('GL BLOCKED '+p+': '+status.reason);out.financialClassification.push({...status,credit_memo_id:p});}}
 out.counts={headers:out.headers.length,transaction_lines:out.transactionLines.length,accounting_lines:out.accountingLines.length,previous_links:out.previousLinks.length,next_links:out.nextLinks.length,financial_book_groups:out.financialClassification.length};return out;
}
