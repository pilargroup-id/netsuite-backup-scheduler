// Module 13 Journal Entry - full population source discovery, strictly read only.
// No project shared files or production module changes.
import {token,fetchAll,suiteql} from '../../common/netsuite-client.mjs';
const type='Journal', start='2026-10-01';
const scope=`t.type='${type}' AND t.trandate >= TO_DATE('${start}','YYYY-MM-DD')`;
const result={mode:'READ_ONLY',headers:0,lines:0,glLines:0,books:[],links:{previous:0,next:0},issues:[],writes:0,checkpointChanges:0,schedulerChanges:0};
async function pull(a,label,sql){console.log(`\n=== ${label} ===`);const r=await fetchAll(a,sql);console.log(`ROWS ${r.length}`);return r;}
async function count(a,label,sql){const r=await suiteql(a,sql,100,0);console.log(`${label} ${JSON.stringify(r.items??[])}`);return r.items??[];}
function fail(message,sample){result.issues.push({message,sample});}
const numeric=/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE]([+-]?\d+))?$/;
function exact(s){if(s==null||s==='')return 0n;const m=String(s).trim().match(numeric);if(!m)throw Error(`invalid decimal ${s}`);const negative=m[1][0]==='-';const t=m[1].replace(/^[+-]/,'');const pieces=t.split('.');const digits=(pieces[0]+(pieces[1]??'')).replace(/^0+/,'')||'0';const exp=Number(m[2]??0)-(pieces[1]??'').length+6;if(!Number.isSafeInteger(exp)||exp<0)throw Error(`more than six decimal places ${s}`);const val=BigInt(digits)*10n**BigInt(exp);return negative?-val:val;}
function assertUnique(rows,key,label){const keys=new Set();for(const row of rows){const k=key(row);if(keys.has(k)){fail(`${label} duplicate`,k);break;}keys.add(k);}}
console.log('MODULE 13 JOURNAL ENTRY FULL COVERAGE | READ ONLY | 2026-10-01..OPEN');
try{
 const a=await token();console.log('OAuth: SUCCESS');
 const headers=await pull(a,'ALL JOURNAL HEADERS',`SELECT t.id AS internal_id,t.type,t.tranid,TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,t.currency,t.exchangerate,t.subsidiary,t.posting,t.status,t.void,t.voided FROM Transaction t WHERE ${scope} ORDER BY t.id`);
 result.headers=headers.length;assertUnique(headers,r=>String(r.internal_id),'header');
 console.log('HEADER STATUS',JSON.stringify(headers.reduce((o,r)=>{const k=`posting=${r.posting??'NULL'}|void=${r.void??'NULL'}|voided=${r.voided??'NULL'}`;o[k]=(o[k]??0)+1;return o;},{})));
 console.log('CURRENCIES',JSON.stringify(headers.reduce((o,r)=>{const k=String(r.currency??'NULL');o[k]=(o[k]??0)+1;return o;},{})));
 if(!headers.length){console.log('MODULE 13 COVERAGE PASS: NO SOURCE');process.exit(0);}
 const lines=await pull(a,'ALL JOURNAL TRANSACTION LINES',`SELECT l.transaction AS transaction_id,l.id AS line_id,l.uniquekey AS line_unique_key,l.linesequencenumber,l.mainline,l.accountinglinetype,l.expenseaccount,l.foreignamount,l.netamount,l.subsidiary,l.department,l.class,l.location FROM TransactionLine l JOIN Transaction t ON t.id=l.transaction WHERE ${scope} ORDER BY l.transaction,l.id`);
 result.lines=lines.length;assertUnique(lines,r=>`${r.transaction_id}/${r.line_id}`,'transaction line');
 const gl=await pull(a,'ALL JOURNAL ACCOUNTING LINES',`SELECT g.transaction AS transaction_id,g.transactionline AS line_id,g.accountingbook,g.account,g.posting,g.debit,g.credit FROM TransactionAccountingLine g JOIN Transaction t ON t.id=g.transaction WHERE ${scope} ORDER BY g.transaction,g.accountingbook,g.transactionline,g.account`);
 result.glLines=gl.length;assertUnique(gl,r=>`${r.transaction_id}/${r.accountingbook}/${r.line_id}/${r.account}`,'GL composite (inspect if flagged)');
 const hset=new Set(headers.map(r=>String(r.internal_id)));const lset=new Set(lines.map(r=>`${r.transaction_id}/${r.line_id}`));
 for(const r of lines){if(!hset.has(String(r.transaction_id))){fail('line orphan',r.transaction_id);break;}}
 for(const r of gl){if(!hset.has(String(r.transaction_id))||!lset.has(`${r.transaction_id}/${r.line_id}`)){fail('GL unmatched line',r);break;}}
 const books=new Map();const totals=new Map();
 for(const r of gl){const b=String(r.accountingbook??'NULL');books.set(b,(books.get(b)??0)+1);const k=`${r.transaction_id}/${b}`;const v=totals.get(k)??{debit:0n,credit:0n};v.debit+=exact(r.debit);v.credit+=exact(r.credit);totals.set(k,v);}
 result.books=[...books].map(([book,count])=>({book,count}));console.log('ACCOUNTING BOOKS',JSON.stringify(result.books));
 const unbalanced=[...totals].filter(([,v])=>v.debit!==v.credit).slice(0,8).map(([k,v])=>({key:k,debitMicro:v.debit.toString(),creditMicro:v.credit.toString()}));if(unbalanced.length)fail('GL debit/credit unbalanced in full population',unbalanced);
 console.log('GL BALANCE',JSON.stringify({groups:totals.size,imbalanced:unbalanced.length}));
 // Query totals rather than full link materialization; optional link tables may be inaccessible.
 for(const [label,table,col] of [['previous','PreviousTransactionLineLink','nextdoc'],['next','NextTransactionLineLink','previousdoc']]){
  try{const rows=await count(a,`LINK ${label.toUpperCase()} COUNT`,`SELECT COUNT(*) AS n FROM ${table} k JOIN Transaction t ON t.id=k.${col} WHERE ${scope}`);result.links[label]=Number(rows[0]?.n??0);}catch(e){fail(`link ${label} query unavailable`,e.message);}
 }
 console.log('SOURCE COUNTS',JSON.stringify({headers:result.headers,lines:result.lines,glLines:result.glLines,books:result.books,links:result.links}));
 console.log(`MODULE 13 FULL COVERAGE ${result.issues.length?'BLOCKED':'PASS'} ${JSON.stringify(result)}`);
 if(result.issues.length)process.exitCode=1;
}catch(e){console.error('MODULE 13 FULL COVERAGE FAILED',e.stack??e.message);process.exitCode=1;}
