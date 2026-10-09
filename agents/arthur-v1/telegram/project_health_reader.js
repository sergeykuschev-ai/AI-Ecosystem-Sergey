'use strict';

const fs=require('node:fs');
const path=require('node:path');

const PROJECTS=Object.freeze({
  'amurskmarket':'amurskmarket.ru',
  vozdooh:'vozdooh27.ru',
  'business-kpi':'Бизнес-портал KPI',
  purchasing:'Закупщик «Миска»',
  arthur:'Артур',
});
const STATUSES=new Set(['healthy','degraded','not_checked']);
const MAX_AGE_MS=2*60*60*1000;
const MAX_BYTES=64*1024;
const FILENAME=/^health-\d{4}-\d{2}-\d{2}T[0-9TZ-]+\.json$/;

function loadProjectStatus({directory,fsImpl=fs,now=()=>new Date()}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))
    return {available:false,reason:'NOT_CONFIGURED'};
  try{
    const filenames=fsImpl.readdirSync(directory)
      .filter(name=>FILENAME.test(name)).sort();
    if(!filenames.length)return {available:false,reason:'NO_REPORTS'};
    const file=path.join(directory,filenames[filenames.length-1]);
    const stat=fsImpl.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size<10||stat.size>MAX_BYTES)
      return {available:false,reason:'INVALID_REPORT'};
    const report=JSON.parse(fsImpl.readFileSync(file,'utf8'));
    const checkedAt=Date.parse(report.timestamp);
    const nowMs=now().getTime();
    if(!Number.isFinite(checkedAt)||checkedAt>nowMs+5*60*1000
        ||nowMs-checkedAt>MAX_AGE_MS)
      return {available:false,reason:'STALE_REPORT'};
    if(!Array.isArray(report.results)||report.results.length!==5)
      return {available:false,reason:'INVALID_REPORT'};
    if(report.checkedProjects!==report.results.filter(x=>x.status!=='not_checked').length
        || report.notCheckedProjects!==report.results.filter(x=>x.status==='not_checked').length)
      return {available:false,reason:'INVALID_REPORT'};
    const statuses=new Map();
    for(const entry of report.results){
      if(!Object.hasOwn(PROJECTS,entry?.project)
          ||!STATUSES.has(entry.status)||statuses.has(entry.project))
        return {available:false,reason:'INVALID_REPORT'};
      statuses.set(entry.project,entry.status);
    }
    return {available:true,checkedAt:new Date(checkedAt).toISOString(),statuses};
  }catch{
    // Never reveal filesystem paths, stack traces, credentials or report payloads.
    return {available:false,reason:'UNAVAILABLE'};
  }
}

function formatProjectStatus(snapshot){
  if(!snapshot?.available)
    return 'Статус проектов: нет свежего подтверждённого отчёта.\n'
      +'Проверь мониторинг на сервере Амурска. Старые данные не считаю текущими.';
  const stamp=snapshot.checkedAt.replace('T',' ').slice(0,16);
  const lines=['Статус проектов (проверено '+stamp+' UTC):'];
  for(const [id,title] of Object.entries(PROJECTS)){
    const status=snapshot.statuses.get(id);
    const label=status==='healthy'?'доступен':
      status==='degraded'?'проблема':'не проверен';
    const icon=status==='healthy'?'✅':status==='degraded'?'❌':'⚪';
    lines.push(icon+' '+title+' — '+label);
  }
  lines.push('Проверяется доступность, не корректность продаж, оплат или данных 1С.');
  return lines.join('\n');
}

module.exports={PROJECTS,MAX_AGE_MS,loadProjectStatus,formatProjectStatus};
