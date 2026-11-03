// Phase C gate: full-source mapping, exact GL, BQ empty schema/read-only verification.
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {dataset,query,T} from '../../common/bigquery-client.mjs';
import {GROUPS,columnDefinitions} from './schema-contract.mjs';
const must=(x,m)=>{if(!x)throw Error('MODULE13 GATE BLOCKED: '+m);};
function units(v){if(v==null)return 0n;must(/^-?\d+(?:\.\d{1,9})?$/.test(v),'invalid decimal '+v);const neg=v.startsWith('-');const [i,f='']=v.replace('-','').split('.');const n=BigInt(i)*1000000000n+BigInt(f.padEnd(9,'0'));return neg?-n:n;}
async function main(){
 console.log('MODULE 13 JOURNAL ENTRY | PHASE C MAPPING GATE | READ ONLY');
 for(const g of GROUPS){const table=dataset.table(g.table);const [exists]=await table.exists();must(exists,'missing table '+g.table);const [meta]=await table.getMetadata();for(const [name,type] of columnDefinitions(g)){const actual=(meta.schema?.fields??[]).find(f=>f.name.toLowerCase()===name.toLowerCase());must(actual,'missing column '+g.table+'.'+name);must((actual.type.toUpperCase()==='BOOLEAN'?'BOOL':actual.type.toUpperCase())===type,'type mismatch '+g.table+'.'+name);}const r=await query(`SELECT COUNT(*) n FROM ${T(g.table)}`);must(Number(r[0]?.n?.value??r[0]?.n)===0,'nonempty table '+g.table);}
 const cp=await query(`SELECT record_type FROM ${T('sync_checkpoints')} WHERE record_type IN (${GROUPS.map(g=>`'${g.table}'`).join(',')},'journal-entry','journal_entry')`);must(cp.length===0,'existing Journal checkpoint');
 const a=await token();console.log('OAuth: SUCCESS');const h=await fetchHeaders(a);must(h.length>0,'source empty');const ids=h.map(x=>x.internal_id);
 const [l,g,p,n]=await Promise.all([fetchLines(a,ids),fetchGL(a,ids),fetchPreviousLinks(a,ids),fetchNextLinks(a,ids)]);const mapped=mapSource(h,l,g,p,n);
 for(const group of GROUPS)console.log('MAPPING CONTRACT PASS',JSON.stringify({table:group.table,rows:mapped[group.source].length}));
 const totals=new Map();for(const x of mapped.accountingLines){must(x.posting,'nonposting accounting line '+x.journal_entry_id);const key=x.journal_entry_id+'|'+x.accounting_book_id;const cur=totals.get(key)??0n;totals.set(key,cur+units(x.debit)-units(x.credit));}for(const [k,v] of totals)must(v===0n,'unbalanced GL '+k);
 const glIds=new Set(mapped.accountingLines.map(x=>x.journal_entry_id));for(const x of mapped.headers){must(x.posting&&!x.is_void,'nonposting/void header '+x.journal_entry_id);must(glIds.has(x.journal_entry_id),'missing GL '+x.journal_entry_id);}
 const watermark=mapped.headers.map(x=>x.last_modified).sort().at(-1);must(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(watermark),'invalid watermark');
 console.log('SOURCE WATERMARK',watermark);console.log('GL EXACT BALANCE PASS',totals.size);
 console.log('MODULE 13 PHASE C MAPPING GATE PASS',JSON.stringify({counts:mapped.counts,glGroups:totals.size,watermark,bqWrites:0,checkpointChanges:0,deletionOperations:0,schedulerChanges:0}));
}
main().catch(e=>{console.error('MODULE 13 PHASE C MAPPING GATE BLOCKED:',e.stack??e.message);process.exitCode=1;});
