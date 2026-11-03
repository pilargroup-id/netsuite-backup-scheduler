import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const state=path.join(root,'logs','scheduler');
const stateFile=path.join(state,'alerts.json');
const attemptsFile=path.join(state,'alerts-attempts.jsonl');
function writeAttempt(x){fs.mkdirSync(state,{recursive:true});fs.appendFileSync(attemptsFile,JSON.stringify({...x,at:new Date().toISOString()})+'\n');}
export function notify(kind, detail, identity=kind) {
  fs.mkdirSync(state,{recursive:true});
  let states={};try{states=JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{}
  const now=Date.now();
  // Throttle identical notifications to once per six hours. Failures are retried on next run.
  if(states[identity] && now-Date.parse(states[identity])<6*3600000)return 'DEDUPED';
  const message=`NetSuite Backup ${kind}\nHost: ${process.env.COMPUTERNAME||'Windows'}\n${detail}`;
  try {
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','monitor-notify.ps1'),'-Message',message],{cwd:root,timeout:35000,windowsHide:true,stdio:'pipe'});
    states[identity]=new Date().toISOString();
    const temp=stateFile+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(states,null,2));fs.renameSync(temp,stateFile);
    writeAttempt({kind,identity,result:'SENT'});
    return 'SENT';
  }catch(e){
    // Do not expose Telegram URLs/tokens; detailed failure stays local.
    const detail=(e.stderr?.toString()||e.message||'notification failed').slice(0,500).replace(/bot\d+:[A-Za-z0-9_-]+/g,'bot[REDACTED]');
    writeAttempt({kind,identity,result:'UNDELIVERED',detail});
    console.error('ALERT NOT DELIVERED; configure Telegram for scheduled-task account. See logs/scheduler/alerts-attempts.jsonl');
    return 'UNDELIVERED';
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [kind,...rest]=process.argv.slice(2);
  if(!['TEST','FAILED','NEEDS_REVIEW','MISSED','RECOVERED'].includes(kind))process.exit(2);
  const result=notify(kind,rest.join(' ')||'Manual notification test',kind==='TEST'?'MANUAL_TEST':kind);
  console.log('ALERT:',result);
  if(result==='UNDELIVERED')process.exitCode=1;
}
