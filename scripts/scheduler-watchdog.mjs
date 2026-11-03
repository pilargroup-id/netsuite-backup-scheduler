import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notify } from './monitor-alert.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'logs','scheduler');
const config=JSON.parse(fs.readFileSync(path.join(root,'config','scheduler.json'),'utf8').replace(/^\uFEFF/,''));
const window=config.modes[config.mode];
if(!window||config.timezone!=='Asia/Jakarta')throw Error('Unsupported configuration');
const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'});
function local(d){const p=Object.fromEntries(fmt.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return {key:`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`,min:+p.hour*60+(+p.minute),day:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday)};}
const start=window.start.split(':').map(Number).reduce((a,b)=>a*60+b),end=window.end.split(':').map(Number).reduce((a,b)=>a*60+b);
if(start>end)throw Error('Overnight windows unsupported');
// Find most recent scheduled slot at least grace minutes in the past. Uses timezone-aware local slots.
const grace=Number(process.env.NETSUITE_WATCHDOG_GRACE_MINUTES||45);
if(!Number.isFinite(grace)||grace<10)throw Error('Invalid grace');
let dueSlot=null;
const now=Date.now();
for(let t=now-grace*60000;t>now-72*3600000;t-=60000){const l=local(new Date(t));if(window.days.includes(l.day)&&l.min>=start&&l.min<=end&&l.min%window.intervalMinutes===0){dueSlot=l.key;break;}}
if(!dueSlot){console.log('WATCHDOG: no due slot in past 72 hours');process.exit(0);}
let latest=null;try{latest=JSON.parse(fs.readFileSync(path.join(dir,'latest.json'),'utf8'));}catch{}
const lastSlot=latest?.startedAt?local(new Date(latest.startedAt)).key:null;
const recoveryStatePath=path.join(dir,'watchdog-recovery.json');
let recoveryState={missed:false};
try{
  recoveryState=JSON.parse(fs.readFileSync(recoveryStatePath,'utf8'));
}catch{}
function saveRecoveryState(){
  fs.writeFileSync(recoveryStatePath,JSON.stringify(recoveryState,null,2));
}
const lockPath=path.join(dir,'.running.lock','owner.json');
let running=false;try{const owner=JSON.parse(fs.readFileSync(lockPath,'utf8'));if(owner.pid&&owner.host===process.env.COMPUTERNAME){try{process.kill(owner.pid,0);running=true;}catch(e){running=e.code==='EPERM';}}}catch{}
// Task might legitimately be processing a slower run. We do not assume missing until deadline expires.
if(!lastSlot||lastSlot<dueSlot){
 const text=`Expected slot: ${dueSlot} WIB\nLast start: ${lastSlot||'NONE'}\nMode: ${config.mode}\nActive lock: ${running}\nTask scheduler or machine may be offline.`;
 const r=notify('MISSED',text,`MISSED:${dueSlot}`);
 recoveryState.missed=true;
recoveryState.lastMissedSlot=dueSlot;
saveRecoveryState();
console.log('WATCHDOG: MISSED',dueSlot,'alert=',r);
 process.exitCode=2;
}else{
 console.log('WATCHDOG: OK expected=',dueSlot,'last=',lastSlot,'status=',latest.status);
if(recoveryState.missed && latest.status==='FINAL_PASS'){
  notify('RECOVERED',`Backup recovered at ${lastSlot} WIB\nPrevious missed slot: ${recoveryState.lastMissedSlot}`,'WATCHDOG_RECOVERED:'+lastSlot);
  recoveryState.missed=false;
  recoveryState.recoveredAt=lastSlot;
  saveRecoveryState();
}
 if(['FAILED','NEEDS_REVIEW'].includes(latest.status))notify(latest.status,`Last backup: ${lastSlot}\nStatus: ${latest.status}\nLog: ${latest.log||'n/a'}`,`STATUS:${latest.startedAt}:${latest.status}`);
}
