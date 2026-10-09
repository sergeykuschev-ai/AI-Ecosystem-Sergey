'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {PROJECTS,loadProjectStatus}=require('./project_health_reader');

const REPORT_PATTERN=/^health-\d{4}-\d{2}-\d{2}T[0-9TZ-]+\.json$/;
const MIN_SAMPLE_GAP_MS=30*60*1000;
const MAX_LATEST_AGE_MS=2*60*60*1000;
const MAX_FIRST_AGE_MS=3*60*60*1000;

function readLastTwoSnapshots({directory,now=()=>new Date(),fsImpl=fs}={}){
  if(!directory||!path.isAbsolute(directory))return {ready:false,reason:'REPORT_DIR_NOT_CONFIGURED'};
  try{
    const filenames=fsImpl.readdirSync(directory)
      .filter(name=>REPORT_PATTERN.test(name)).sort().slice(-2);
    if(filenames.length!==2)return {ready:false,reason:'NOT_ENOUGH_SNAPSHOTS'};
    const snapshots=filenames.map(name=>loadProjectStatus({
      directory,now,
      fsImpl:{
        readdirSync:()=>[name],
        lstatSync:(p)=>fsImpl.lstatSync(p),
        readFileSync:(p,encoding)=>fsImpl.readFileSync(p,encoding),
      },
    }));
    if(snapshots.some(s=>!s.available))return {ready:false,reason:'INVALID_OR_STALE_SNAPSHOT'};
    const first=Date.parse(snapshots[0].checkedAt);
    const last=Date.parse(snapshots[1].checkedAt);
    const age=now().getTime()-last;
    const gap=last-first;
    if(gap<MIN_SAMPLE_GAP_MS||gap>MAX_LATEST_AGE_MS||
       age<0||age>MAX_LATEST_AGE_MS||
       now().getTime()-first>MAX_FIRST_AGE_MS){
      return {ready:false,reason:'INSUFFICIENT_VALID_INTERVAL'};
    }
    return {ready:true,snapshots};
  }catch{
    return {ready:false,reason:'REPORTS_UNAVAILABLE'};
  }
}

function buildIncidentMessage(id,snapshots){
  const title=PROJECTS[id];
  if(!title)throw new Error('Unregistered monitored project');
  const last=snapshots[1].checkedAt.replace('T',' ').slice(0,16);
  return '⚠️ Артур: подтверждён технический сбой\n'
    +title+' — проблема обнаружена в двух последовательных проверках.\n'
    +'Последняя проверка: '+last+' UTC.\n'
    +'Проверь сервис. Это контроль доступности, не проверка продаж или платежей.';
}

function validateArgs({directory,stateDirectory,chatId,telegram}){
  if(!directory||!path.isAbsolute(directory)||!stateDirectory||
    !path.isAbsolute(stateDirectory))
    throw Object.assign(new Error('Project alerts directory not configured'),{code:'PROJECT_ALERTS_NOT_CONFIGURED'});
  if(!chatId||typeof telegram?.sendMessage!=='function')
    throw Object.assign(new Error('Project alerts recipient unavailable'),{code:'PROJECT_ALERTS_RECIPIENT_UNAVAILABLE'});
}

async function checkAndNotify({
  directory,stateDirectory,chatId,telegram,now=()=>new Date(),fsImpl=fs,
}={}){
  validateArgs({directory,stateDirectory,chatId,telegram});
  const observed=readLastTwoSnapshots({directory,now,fsImpl});
  if(!observed.ready)return {status:'not_checked',reason:observed.reason,sent:[]};
  const {snapshots}=observed;
  const sent=[],recovered=[],suppressed=[];
  for(const id of Object.keys(PROJECTS)){
    const first=snapshots[0].statuses.get(id);
    const last=snapshots[1].statuses.get(id);
    const marker=path.join(stateDirectory,'incident-'+id+'.json');
    if(first==='healthy'&&last==='healthy'){
      try{
        // Clear only after *two* healthy samples; next future incident can alert again.
        fsImpl.unlinkSync(marker);
        recovered.push(id);
      }catch(e){if(e.code!=='ENOENT')throw Object.assign(new Error('Alert state unavailable'),{code:'PROJECT_ALERT_STATE_UNAVAILABLE'});}
      continue;
    }
    if(first!=='degraded'||last!=='degraded')continue;
    try {
      // Atomic claim BEFORE remote Telegram delivery prevents duplicate sends
      // after restarts and ambiguous network timeouts. A failed send requires
      // manual review of logs; never auto-retry an uncertain side effect.
      fsImpl.writeFileSync(marker,JSON.stringify({
        project:id,firstConfirmed:snapshots[0].checkedAt,
        lastConfirmed:snapshots[1].checkedAt,delivery:'claimed',
      })+'\n',{flag:'wx',mode:0o600});
    }catch(e){
      if(e.code==='EEXIST'){suppressed.push(id);continue;}
      throw Object.assign(new Error('Alert state not writable'),{code:'PROJECT_ALERT_STATE_UNAVAILABLE'});
    }
    try{
      await telegram.sendMessage(chatId,buildIncidentMessage(id,snapshots));
      sent.push(id);
    }catch{
      // Prevent both message duplication and exposure of credentials.
      return {status:'delivery_unknown',reason:'TELEGRAM_DELIVERY_UNKNOWN',sent,
        unknown:id,recovered,suppressed};
    }
  }
  return {status:'ok',sent,recovered,suppressed};
}

module.exports={
  readLastTwoSnapshots,buildIncidentMessage,checkAndNotify,
  MIN_SAMPLE_GAP_MS,MAX_LATEST_AGE_MS,
};
