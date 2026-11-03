import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { notify } from './monitor-alert.mjs';
import { createSharedLock } from '../common/shared-lock.mjs';
import { classifyV3Recovery } from '../common/v3-status-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'config', 'scheduler.json');
const stateDir = path.join(root, 'logs', 'scheduler');
const shared = createSharedLock({stateDir,worker:'scheduler'});
const statusPath = path.join(stateDir, 'latest.json');
const historyPath = path.join(stateDir, 'history.jsonl');
const skipsPath = path.join(stateDir, 'skips.jsonl');
const args = new Set(process.argv.slice(2));
const showConfig = args.has('--show-config');

function readConfig() {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/,''));
  if (!['test', 'production'].includes(cfg.mode)) throw Error('Invalid mode');
  const settings = cfg.modes?.[cfg.mode];
  if (!settings || !Number.isInteger(settings.intervalMinutes) || settings.intervalMinutes < 10 || settings.intervalMinutes % 10 !== 0 || 60 % settings.intervalMinutes !== 0) throw Error('Interval must be 10, 20, 30 or 60 minutes');
  for (const t of [settings.start, settings.end]) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw Error('Invalid HH:mm: ' + t);
  if (!Array.isArray(settings.days) || settings.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw Error('Invalid days');
  if (cfg.timezone !== 'Asia/Jakarta') throw Error('Only Asia/Jakarta is supported for now');
  if (!Number.isInteger(cfg.maxRunMinutes) || cfg.maxRunMinutes < 1) throw Error('Invalid maxRunMinutes');
  if (!Number.isInteger(cfg.maxLogDays) || cfg.maxLogDays < 1) throw Error('Invalid maxLogDays');
  const workflow = path.resolve(root, cfg.workflow);
  if (!workflow.startsWith(root + path.sep) || !workflow.endsWith('.mjs')) throw Error('Workflow path blocked');
  if (!fs.existsSync(workflow)) throw Error('Workflow not found: ' + workflow);
  return { cfg, settings, workflow };
}
function localTime(date, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { hhmm: `${parts.hour}:${parts.minute}`, minute: Number(parts.hour) * 60 + Number(parts.minute), day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday), key: `${parts.year}-${parts.month}-${parts.day}` };
}
function due(now, cfg, settings) {
  const loc = localTime(now, cfg.timezone);
  const start = settings.start.split(':').map(Number), end = settings.end.split(':').map(Number);
  const s = start[0]*60+start[1], e = end[0]*60+end[1];
  if (s > e) throw Error('Overnight windows not supported');
  // Derive the most recent canonical 10-minute Windows task slot. Some Windows
  // firings arrive at :05/:15/:25/etc. They must not be rejected solely for
  // being more than two minutes late. Never advance to a future slot.
  const delay = loc.minute % 10;
  const nominalMinute = loc.minute - delay;
  const hh = String(Math.floor(nominalMinute / 60)).padStart(2,'0');
  const mm = String(nominalMinute % 60).padStart(2,'0');
  const slotLocal = {...loc, hhmm: `${hh}:${mm}`, minute: nominalMinute};
  if (!settings.days.includes(loc.day) || nominalMinute < s || nominalMinute > e) return {run:false,reason:'OUTSIDE_WINDOW',local:slotLocal,delay};
  if (nominalMinute % settings.intervalMinutes !== 0) return {run:false,reason:'NOT_INTERVAL_SLOT',local:slotLocal,delay};
  return {run:true,reason:'DUE',local:slotLocal,delay};
}
function ensureStateDir() { fs.mkdirSync(stateDir, {recursive:true}); }
function record(entry) {
  ensureStateDir();
  fs.appendFileSync(historyPath, JSON.stringify(entry) + '\n');
  const tmp = statusPath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entry,null,2)+'\n');
  fs.renameSync(tmp,statusPath);
}
function skip(reason, local, detail = {}) {
  ensureStateDir();
  const entry={at:new Date().toISOString(),localDate:local.key,slot:local.hhmm,reason,...detail};
  try { fs.appendFileSync(skipsPath,JSON.stringify(entry)+'\n'); }
  catch (error) { console.error('SKIP AUDIT ERROR:',error.message); }
  console.log('SKIP:',reason,local.hhmm,'WIB');
}
function alreadyCompleted(local,cfg) {
  if (!fs.existsSync(historyPath)) return false;
  const lines=fs.readFileSync(historyPath,'utf8').split(/\r?\n/).filter(Boolean);
  for(const line of lines) {
    let entry;
    try {entry=JSON.parse(line);}catch{continue;}
    if(entry.mode!==cfg.mode || entry.slot!==local.hhmm || !entry.startedAt)continue;
    const date=localTime(new Date(entry.startedAt),cfg.timezone).key;
    if(date===local.key)return true;
  }
  return false;
}
async function acquireLockWithRetry(local) {
  const started=Date.now();
  // Fast Delta typically owns the shared lock for several minutes. A 2-minute
  // wait caused V3 slots to be missed. Wait boundedly; never break another owner.
  const timeoutMs=6*60*1000;
  const retryMs=5000;
  let attempts=0;
  while(true) {
    attempts++;
    const result=shared.acquire();
    if(result.acquired) {
      if(attempts>1) console.log('LOCK ACQUIRED AFTER RETRY','attempts='+attempts,'waitMs='+(Date.now()-started));
      return true;
    }
    if(Date.now()-started>=timeoutMs) {
      skip('LOCK_TIMEOUT',local,{attempts,waitMs:Date.now()-started,lockReason:result.reason});
      return false;
    }
    await new Promise(resolve=>setTimeout(resolve,retryMs));
  }
}
function cleanup(days) {
  if(!fs.existsSync(stateDir))return;
  const cutoff=Date.now()-days*86400000;
  for(const name of fs.readdirSync(stateDir)) {
    if(!/^run-\d{4}-\d{2}-\d{2}T.*\.log$/.test(name))continue;
    try {const p=path.join(stateDir,name);if(fs.statSync(p).mtimeMs<cutoff)fs.unlinkSync(p);}catch{}
  }
}
async function main() {
  const {cfg,settings,workflow}=readConfig();
  if(showConfig){console.log(JSON.stringify({mode:cfg.mode,timezone:cfg.timezone,settings,workflow},null,2));return;}
  const when=due(new Date(),cfg,settings);
  if(!when.run){skip(when.reason,when.local,{delayMinutes:when.delay});return;}
  if(alreadyCompleted(when.local,cfg)){skip('ALREADY_COMPLETED',when.local,{delayMinutes:when.delay});return;}
  console.log('V3 SLOT ELIGIBLE:',when.local.key,when.local.hhmm,'delayMinutes='+when.delay);
  if(!(await acquireLockWithRetry(when.local)))return;
  let logFd;
  try {
    // Recheck after lock acquisition to guard against another runner having
    // finished this same slot while we were waiting.
    if(alreadyCompleted(when.local,cfg)){skip('ALREADY_COMPLETED_AFTER_LOCK',when.local);return;}
    cleanup(cfg.maxLogDays);
    const startedAt=new Date();
    const filename='run-'+startedAt.toISOString().replaceAll(':','-')+'.log';
    const logfile=path.join(stateDir,filename);
    logFd=fs.openSync(logfile,'a');
    fs.writeSync(logFd,`Started ${startedAt.toISOString()} mode=${cfg.mode} workflow=${workflow} args=--all --sync slot=${when.local.hhmm}\n`);
    console.log('RUN:',cfg.mode,when.local.hhmm,'WIB',filename);
    const child=spawn(process.execPath,[workflow,'--all','--sync'],{cwd:root,env:{...process.env,NETSUITE_PO_ENABLED:'1',NETSUITE_PI_ENABLED:'1',NETSUITE_VERIFIED_DELETE_CONFIRM:'I_CONFIRM_VERIFIED_SOFT_DELETE'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let captured='';const maxCapture=2_000_000;
    const onData=chunk=>{const s=chunk.toString('utf8');fs.writeSync(logFd,s);captured=(captured+s).slice(-maxCapture);};
    child.stdout.on('data',onData);child.stderr.on('data',onData);
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},cfg.maxRunMinutes*60000);
    const completion=await new Promise(resolve=>{child.on('error',e=>resolve({code:1,error:e.message}));child.on('close',(code,signal)=>resolve({code:code??1,signal}));});
    clearTimeout(timer);
    const status=classifyV3Recovery(completion.code,captured,timedOut);
    const entry={startedAt:startedAt.toISOString(),finishedAt:new Date().toISOString(),mode:cfg.mode,slot:when.local.hhmm,status,exitCode:completion.code,timedOut,log:filename};
    fs.writeSync(logFd,`\nScheduler status=${status} exitCode=${completion.code} timedOut=${timedOut}\n`);
    record(entry);
    if(status==='FAILED'||status==='NEEDS_REVIEW')notify(status,`Mode: ${cfg.mode}\nSlot: ${when.local.key} ${when.local.hhmm} WIB\nExit code: ${completion.code}\nLog: ${filename}`,`STATUS:${entry.startedAt}:${status}`);
    console.log('RESULT:',status,'exitCode='+completion.code,'log='+filename);
    if(status==='NEEDS_REVIEW')process.exitCode=3;
    else if(status!=='FINAL_PASS')process.exitCode=1;
  }finally {
    if(logFd!==undefined)fs.closeSync(logFd);
    const result=shared.release();
    if(!result.released)console.error('SCHEDULER LOCK RELEASE:',result.reason);
  }
}
main().catch(e=>{console.error('SCHEDULER FAILED:',e.stack??e);try{record({startedAt:new Date().toISOString(),status:'FAILED',error:e.message});notify('FAILED',`Runner error: ${e.message}`,'RUNNER_ERROR');}catch{}process.exitCode=1;});
