// Module 11 standalone read-only NetSuite/BigQuery reconciliation helpers.
import {query,T} from '../../common/bigquery-client.mjs';
import {token,fetchHeaders,fetchLines,fetchGL,fetchPreviousLinks,fetchNextLinks,mapSource} from './mapping.mjs';
import {GROUPS} from './schema-contract.mjs';

export {GROUPS};
const numericTypes=new Set(['NUMERIC','BIGNUMERIC']);
const canonicalDecimal=value=>{
  if(value===null||value===undefined)return null;
  let s=String(value).trim();
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))throw Error('Invalid exact decimal: '+s);
  let sign='';if(s[0]==='-'||s[0]==='+'){sign=s[0]==='-'?'-':'';s=s.slice(1);}
  let [whole,fraction='']=s.split('.');whole=(whole||'0').replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
  if(whole==='0'&&!fraction)return '0';
  return sign+whole+(fraction?'.'+fraction:'');
};
function stringify(value,type){
 if(value==null)return null;
 if(numericTypes.has(type))return canonicalDecimal(value?.value??value);
 if(type==='BOOL')return value===true?'true':value===false?'false':String(value);
 if(type==='DATE')return String(value?.value??value).slice(0,10);
 if(type==='DATETIME')return String(value?.value??value).replace('T',' ').replace(/(?:\.0+)?Z?$/,'');
 return String(value);
}
export function rowKey(row,g){return JSON.stringify(g.key.map(k=>row[k]==null?null:String(row[k])));}
export function indexed(rows,g,side){const result=new Map();for(const row of rows){const key=rowKey(row,g);if(result.has(key))throw Error(`DUPLICATE ${side} ${g.table} key=${key}`);result.set(key,row);}return result;}
export async function liveSource(){
 const access=await token();console.log('OAuth: SUCCESS');
 const headers=await fetchHeaders(access);const ids=headers.map(h=>String(h.internal_id));
 const [lines,gl,previous,next]=await Promise.all([fetchLines(access,ids),fetchGL(access,ids),fetchPreviousLinks(access,ids),fetchNextLinks(access,ids)]);
 const mapped=mapSource(headers,lines,gl,previous,next);
 return mapped;
}
export function sourceRows(mapped,g){return mapped[g.source];}
export async function storedRows(g){
 const expr=g.fields.map(([name,type])=>type==='NUMERIC'||type==='BIGNUMERIC'?`CAST(${name} AS STRING) AS ${name}`:type==='DATE'?`FORMAT_DATE('%Y-%m-%d',${name}) AS ${name}`:type==='DATETIME'?`FORMAT_DATETIME('%Y-%m-%d %H:%M:%S',${name}) AS ${name}`:name).join(', ');
 return query(`SELECT ${expr} FROM ${T(g.table)}`);
}
export function compareKeys(source,stored,g,{maxExamples=5}={}){
 const a=indexed(source,g,'NetSuite'),b=indexed(stored,g,'BigQuery');
 const onlyNS=[...a.keys()].filter(x=>!b.has(x));const onlyBQ=[...b.keys()].filter(x=>!a.has(x));
 return {source:source.length,bigquery:stored.length,onlyNetSuite:onlyNS.length,onlyBigQuery:onlyBQ.length,onlyNetSuiteSample:onlyNS.slice(0,maxExamples),onlyBigQuerySample:onlyBQ.slice(0,maxExamples),a,b};
}
export function compareFields(a,b,g,{maxExamples=5}={}){
 let mismatches=0;const samples=[];
 for(const [key,source] of a){const target=b.get(key);if(!target)continue;
  for(const [field,type] of g.fields){const x=stringify(source[field],type),y=stringify(target[field],type);if(x!==y){mismatches++;if(samples.length<maxExamples)samples.push({key,field,source:x,bigquery:y});}}
 }
 return {mismatches,samples};
}
