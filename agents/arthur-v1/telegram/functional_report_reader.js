'use strict';

const fs=require('node:fs');
const path=require('node:path');

const IDS=new Set([
  'amursk-home-content','amursk-miska-content',
  'amursk-bonus-content','amursk-sitemap-content',
  'vozdooh-home-content','vozdooh-catalog-content',
  'vozdooh-cart-content','vozdooh-checkout-page','vozdooh-api-health',
  'business-kpi-storage','business-kpi-auth-enforced',
  'purchasing-http-contract','purchasing-owner-learning-read',
]);
const NAME=/^functional-\d{4}-\d{2}-\d{2}T[0-9TZ-]+\.json$/;
const MAX_SIZE=48*1024;
const MAX_AGE_MS=4*60*60*1000;

function readFunctionalStatus({directory,now=()=>new Date(),fsImpl=fs}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))
    return {available:false,reason:'NOT_CONFIGURED'};
  try{
    const names=fsImpl.readdirSync(directory).filter(name=>NAME.test(name)).sort();
    if(names.length===0)return {available:false,reason:'NO_REPORTS'};
    const file=path.join(directory,names[names.length-1]);
    const st=fsImpl.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_SIZE||st.size<25)
      return {available:false,reason:'INVALID_REPORT'};
    const report=JSON.parse(fsImpl.readFileSync(file,'utf8'));
    const stamp=Date.parse(report.timestamp);
    const diff=now().getTime()-stamp;
    if(!Number.isFinite(stamp)||diff>MAX_AGE_MS||diff<(-5*60*1000))
      return {available:false,reason:'STALE_REPORT'};
    if(report.schemaVersion!==1||!Array.isArray(report.checks)
       ||report.checks.length!==IDS.size)return {available:false,reason:'INVALID_REPORT'};
    const seen=new Set();
    let healthy=0,broken=0,notChecked=0;
    for(const check of report.checks){
      if(!check||!IDS.has(check.id)||seen.has(check.id)||
         !['healthy','degraded','not_checked'].includes(check.status))
        return {available:false,reason:'INVALID_REPORT'};
      seen.add(check.id);
      if(check.status==='healthy')healthy++;
      else if(check.status==='degraded')broken++;
      else notChecked++;
    }
    if(report.checked!==healthy+broken||report.notChecked!==notChecked||
      report.status!==(broken?'degraded':notChecked?'partial':'healthy'))
      return {available:false,reason:'INVALID_REPORT'};
    return {available:true,checkedAt:new Date(stamp).toISOString(),healthy,broken,notChecked,total:IDS.size};
  }catch{
    return {available:false,reason:'REPORT_UNAVAILABLE'};
  }
}

function formatFunctionalStatus(report){
  if(!report?.available)
    return 'Функциональная проверка: свежий отчёт недоступен. Не выдаю старый результат за текущий.';
  const date=report.checkedAt.replace('T',' ').slice(0,16);
  const icon=report.broken?'❌':report.notChecked?'⚪':'✅';
  const state=report.broken?'есть ошибки':report.notChecked?'часть проверок недоступна':'все пройдены';
  return icon+' Функциональная проверка ('+date+' UTC): '+report.healthy+'/'+report.total
    +' — '+state+'.\n'
    +'Не включает настоящие оплаты, заказы поставщику, синхронизацию 1С и сверку выручки.';
}

module.exports={IDS,MAX_AGE_MS,readFunctionalStatus,formatFunctionalStatus};
