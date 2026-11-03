// Module 15 only. Exact-decimal source mapping; no BigQuery writes.
import {token,fetchAll} from '../../common/netsuite-client.mjs';
export {token};
export const TYPE='InvAdjst', FROM='2026-10-01', TO=null;
const scope=`t.type='${TYPE}' AND t.trandate>=TO_DATE('${FROM}','YYYY-MM-DD')`;
const must=(v,m)=>{if(!v)throw Error(m);};
const string=x=>x==null?null:String(x);
const ident=(x,label)=>{const s=string(x);must(s&&/^[1-9]\d*$/.test(s),'invalid '+label+': '+s);return s;};
const flag=x=>x===true||String(x??'').toUpperCase()==='T';
export function decimalExact(raw,label='value'){
 if(raw==null||raw==='')return null;
 const s=String(raw).trim();
 const m=/^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(s);
 must(m,'invalid decimal '+label+': '+s);
 const exp=m[4]==null?0:Number(m[4]);
 must(Number.isSafeInteger(exp)&&Math.abs(exp)<=100,'invalid decimal exponent '+label);
 const all=m[2]+(m[3]??'');
 const dp=(m[2].length+exp);
 let whole,frac;
 if(dp<=0){whole='0';frac='0'.repeat(-dp)+all;}
 else if(dp>=all.length){whole=all+'0'.repeat(dp-all.length);frac='';}
 else {whole=all.slice(0,dp);frac=all.slice(dp);}
 whole=whole.replace(/^0+/,'')||'0';frac=frac.replace(/0+$/,'');
 // BIGNUMERIC: 38 fractional digits, at most 38 full integer digits (conservative).
 must(frac.length<=38&&whole.length<=38,'decimal outside conservative BIGNUMERIC range '+label+': '+s);
 const zero=whole==='0'&&!frac;
 return (m[1]==='-'&&!zero?'-':'')+whole+(frac?'.'+frac:'');
}
export function scaledDecimal(value,label='value'){
 const s=decimalExact(value,label);if(s==null)return null;
 const minus=s.startsWith('-');const v=minus?s.slice(1):s;
 const [w,f='']=v.split('.');const n=BigInt(w+f.padEnd(38,'0'));
 return minus?-n:n;
}
const byId=(a,b)=>{const x=BigInt(a),y=BigInt(b);return x<y?-1:x>y?1:0;};
async function batches(a,ids,sql){const out=[];for(let i=0;i<ids.length;i+=20)out.push(...await fetchAll(a,sql(ids.slice(i,i+20).join(','))));return out;}
export async function fetchHeaders(a){return fetchAll(a,`SELECT t.id AS internal_id,t.tranid,TO_CHAR(t.trandate,'YYYY-MM-DD') AS transaction_date,TO_CHAR(t.lastmodifieddate,'YYYY-MM-DD HH24:MI:SS') AS last_modified,t.memo,t.subsidiary,t.location,t.account,t.postingperiod,t.status FROM Transaction t WHERE ${scope} ORDER BY t.id`);}
export async function fetchLines(a,ids){return batches(a,ids.map(x=>ident(x,'header id')),p=>`SELECT l.transaction AS transaction_id,l.id AS line_id,l.uniquekey AS line_unique_key,l.linesequencenumber,l.mainline,l.item,l.location,l.quantity,l.units,l.rate,l.foreignamount,l.netamount,l.memo,l.iscogs,l.accountinglinetype FROM TransactionLine l WHERE l.transaction IN (${p}) ORDER BY l.transaction,l.id`);}
export async function fetchGL(a,ids){return batches(a,ids.map(x=>ident(x,'header id')),p=>`SELECT g.transaction AS transaction_id,g.transactionline AS line_id,g.accountingbook,g.account,g.posting,g.debit,g.credit FROM TransactionAccountingLine g WHERE g.transaction IN (${p}) ORDER BY g.transaction,g.transactionline`);}
export function mapSource(headers,lines,gl){
 const out={headers:[],lines:[],accountingLines:[]};
 const ids=new Set(),lineKeys=new Set(),glKeys=new Set(),main=new Map(),bookSum=new Map();
 for(const h of headers){const id=ident(h.internal_id,'header');must(!ids.has(id),'duplicate header '+id);ids.add(id);must(/^\d{4}-\d\d-\d\d$/.test(h.transaction_date??''),'invalid transaction date '+id);must(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(h.last_modified??''),'invalid watermark '+id);must(h.transaction_date>=FROM,'header outside scope '+id);
 out.headers.push({internal_id:id,tranid:string(h.tranid),transaction_date:h.transaction_date,last_modified:h.last_modified,memo:string(h.memo),subsidiary_id:string(h.subsidiary),location_id:string(h.location),adjustment_account_id:string(h.account),posting_period_id:string(h.postingperiod),status_id:string(h.status)});main.set(id,0);}
 for(const l of lines){const id=ident(l.transaction_id,'line transaction');must(ids.has(id),'orphan line '+id);const key=ident(l.line_unique_key,'line unique key');const k=id+':'+key;must(!lineKeys.has(k),'duplicate line '+k);lineKeys.add(k);const isMain=flag(l.mainline);if(isMain)main.set(id,main.get(id)+1);else{must(l.item!=null,'missing line item '+k);must(l.location!=null,'missing line location '+k);must(l.quantity!=null,'missing line quantity '+k);}
 out.lines.push({adjustment_internal_id:id,line_id:string(l.line_id),line_unique_key:key,line_sequence_number:string(l.linesequencenumber),is_mainline:isMain,item_id:string(l.item),location_id:string(l.location),quantity:decimalExact(l.quantity,'quantity '+k),units_id:string(l.units),rate:decimalExact(l.rate,'rate '+k),foreign_amount:decimalExact(l.foreignamount,'foreignamount '+k),net_amount:decimalExact(l.netamount,'netamount '+k),memo:string(l.memo),is_cogs:flag(l.iscogs),accounting_line_type:string(l.accountinglinetype)});}
 for(const [id,n] of main)must(n===1,'mainline count '+id+' = '+n);
 for(const g of gl){const id=ident(g.transaction_id,'GL transaction');must(ids.has(id),'orphan GL '+id);must(g.account!=null,'missing GL account '+id);const book=string(g.accountingbook),line=string(g.line_id);const key=[id,line,book,string(g.account)].join(':');must(!glKeys.has(key),'duplicate GL key '+key);glKeys.add(key);const dr=decimalExact(g.debit,'debit '+key),cr=decimalExact(g.credit,'credit '+key);const posting=flag(g.posting);
 out.accountingLines.push({adjustment_internal_id:id,line_id:line,accounting_book_id:book,account_id:string(g.account),is_posting:posting,debit:dr,credit:cr});if(posting){const b=id+':'+book;bookSum.set(b,(bookSum.get(b)??0n)+(scaledDecimal(dr)??0n)-(scaledDecimal(cr)??0n));}}
 for(const [k,v] of bookSum)must(v===0n,'unbalanced GL '+k+': '+v);
 must(out.headers.length>0,'NO_SOURCE');must(out.accountingLines.length>0,'missing accounting lines');
 out.headers.sort((a,b)=>byId(a.internal_id,b.internal_id));out.lines.sort((a,b)=>byId(a.adjustment_internal_id,b.adjustment_internal_id)||byId(a.line_unique_key,b.line_unique_key));
 return {data:out,stats:{headers:out.headers.length,lines:out.lines.length,accountingLines:out.accountingLines.length,glBooks:bookSum.size,sourceWatermark:out.headers.map(x=>x.last_modified).sort().at(-1),scope:`${FROM}..open-ended`}};
}
