'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const WORKDIR='C:\\AI-Ecosystem\\candidates\\arthur-kpi-coverage-20261009';
const SOURCE=path.join(WORKDIR,'arthur-kpi-coverage-observer.cjs');
const DEST='C:\\AI-Ecosystem\\local-services\\arthur-kpi-coverage-reports';
const DOCKER='C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe';
const MAX_ARCHIVE=96;

function run(){
 const source=fs.readFileSync(SOURCE,'utf8');
 const r=spawnSync(DOCKER,['exec','-i','-w','/opt/arthur',
   'arthur-core-telegram-gateway-1','node','-'],{
    input:source,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:150000,
 });
 if(r.error||r.status!==0)throw new Error('KPI_COVERAGE_CONTAINER_UNAVAILABLE');
 const report=JSON.parse(r.stdout.trim());
 if(report.schemaVersion!==1||!['complete','attention','not_checked'].includes(report.state)||
    !Array.isArray(report.stores)||report.stores.length!==4||
    !report.stores.every(s=>typeof s.store==='string'&&typeof s.monthlyDataStatus==='string')||
    !report.checkedAt||!report.period||!report.totals)
  throw new Error('KPI_COVERAGE_REPORT_INVALID');
 fs.mkdirSync(DEST,{recursive:true});
 const label=report.checkedAt.replace(/[:.]/g,'-');
 const file=path.join(DEST,'kpi-'+label+'.json');
 const content=JSON.stringify(report,null,2)+'\n';
 fs.writeFileSync(file,content,{flag:'wx',mode:0o600});
 const tmp=path.join(DEST,'.status-'+process.pid+'.tmp');
 fs.writeFileSync(tmp,content,{flag:'wx',mode:0o600});
 fs.renameSync(tmp,path.join(DEST,'status.json'));
 const names=fs.readdirSync(DEST)
   .filter(n=>/^kpi-\d{4}-\d{2}-\d{2}T[0-9TZ-]+\.json$/.test(n)).sort();
 for(const old of names.slice(0,Math.max(0,names.length-MAX_ARCHIVE))){
  fs.unlinkSync(path.join(DEST,old));
 }
 console.log('KPI_COVERAGE='+report.state);
 console.log('KPI_CHECKED_STORES='+report.stores.length);
 console.log('KPI_COMPLETE='+report.totals.complete);
 console.log('KPI_PARTIAL='+report.totals.partial);
 console.log('KPI_NO_DATA='+report.totals.noData);
 console.log('KPI_UNAVAILABLE='+report.totals.unavailable);
}
try{run()}catch(e){
 console.log('KPI_COVERAGE_ERROR='+String(e.code||e.message||'UNKNOWN').replace(/[^A-Z0-9_]/g,'').slice(0,70));
 process.exitCode=2;
}
