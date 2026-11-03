import { dataset, query, T, DATASET, LOCATION } from '../../common/bigquery-client.mjs';
import { token, fetchHeaders, fetchLines, fetchGL, fetchPreviousLinks, fetchNextLinks, mapSource, FROM, TO } from './mapping.mjs';

export const defs = [
 {table:'purchase_return_headers', group:'headers', keys:['internal_id']},
 {table:'purchase_return_lines', group:'transactionLines', keys:['authorization_internal_id','line_unique_key']},
 {table:'purchase_return_accounting_lines', group:'accountingLines', keys:['authorization_internal_id','accounting_book_id','line_id','account_id']},
 {table:'purchase_return_source_links', group:'sourceLinks', keys:['authorization_internal_id','source_internal_id','link_type']},
 {table:'purchase_return_downstream_links', group:'downstreamLinks', keys:['authorization_internal_id','related_internal_id','link_type']}
];
export const source = async () => {
 const access = await token();
 const h = await fetchHeaders(access);
 const ids = h.map(x=>x.internal_id);
 const [l,g,p,n] = ids.length ? await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchPreviousLinks(access,ids),fetchNextLinks(access,ids)]) : [[],[],[],[]];
 return mapSource(h,l,g,p,n);
};
export async function state() {
 const existence = await Promise.all(defs.map(async d => ({table:d.table, exists:(await dataset.table(d.table).exists())[0]})));
 const total=existence.filter(x=>x.exists).length;
 const cp=(await query(`SELECT record_type, FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',last_successful_modified_at) AS watermark FROM ${T('sync_checkpoints')} WHERE record_type IN (${defs.map(d=>`'${d.table}'`).join(',')})`));
 if ((total!==0 && total!==defs.length) || (cp.length!==0 && cp.length!==defs.length) || (total===0 && cp.length!==0) || (total===defs.length && cp.length!==0 && cp.length!==defs.length)) {
  throw Error(`PARTIAL INITIALIZATION: ${total}/${defs.length} tables, ${cp.length}/${defs.length} checkpoints`);
 }
 if(cp.length && new Set(cp.map(x=>x.watermark)).size!==1) throw Error('DIVERGENT CHECKPOINTS');
 return {mode:total===0?'NOT_INITIALIZED':cp.length===0?'SCHEMA_ONLY':'INITIALIZED',existence,checkpointRows:cp.length,watermark:cp[0]?.watermark??null};
}
export const key = (row,keys) => keys.map(k=>String(row[k]??'<NULL>')).join('\u001f');
export async function stored(def) {
 const isHeader=def.group==='headers';
 const join=isHeader?'':` JOIN ${T('purchase_return_headers')} h ON h.internal_id=d.authorization_internal_id`;
 const where=isHeader?`transaction_date >= DATE '${FROM}' AND transaction_date < DATE '${TO}' AND COALESCE(is_deleted,FALSE)=FALSE`:`h.transaction_date >= DATE '${FROM}' AND h.transaction_date < DATE '${TO}' AND COALESCE(h.is_deleted,FALSE)=FALSE`;
 return query(`SELECT ${isHeader?'*':'d.*'} FROM ${T(def.table)}${isHeader?'':' d'}${join} WHERE ${where}`);
}
export function compareIds(a,b,keys){
 const as=new Set(a.map(x=>key(x,keys))), bs=new Set(b.map(x=>key(x,keys)));
 return {source:a.length,target:b.length,sourceDuplicates:a.length-as.size,targetDuplicates:b.length-bs.size,onlySource:[...as].filter(x=>!bs.has(x)).slice(0,10),onlyTarget:[...bs].filter(x=>!as.has(x)).slice(0,10)};
}
export function status(r){return !r.sourceDuplicates&&!r.targetDuplicates&&!r.onlySource.length&&!r.onlyTarget.length?'PASS':'FAIL';}
export function intro(name,s){console.log(`PURCHASE RETURN ${name} | READ ONLY | ${DATASET} | ${LOCATION} | ${FROM} to ${TO}`);console.log('STATE:',JSON.stringify(s));}
export function finish(name,s){if(s.mode==='SCHEMA_ONLY'){console.log(`${name} SCHEMA_ONLY: five empty tables, zero checkpoints; NOT FINAL_PASS`);return;}if(s.mode==='NOT_INITIALIZED'){console.log(`${name} NOT_INITIALIZED: zero source and no tables/checkpoint; NOT FINAL_PASS`);return;}console.log(`${name} PASS: initialized target reconciled`);}
