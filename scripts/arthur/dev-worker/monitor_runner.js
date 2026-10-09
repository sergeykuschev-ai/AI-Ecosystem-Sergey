'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {runChecks}=require('./worker');

const MAX_REPORTS=192;
const DEFAULT_REPORT_DIR = process.platform==='win32'
  ? 'C:\\AI-Ecosystem\\local-services\\arthur-dev-worker-reports'
  : path.join(__dirname,'../../../output/arthur/dev-worker');
function formatFileTimestamp(date){
  return date.toISOString().replace(/[:.]/g,'-');
}
async function runMonitor({
  directory=process.env.ARTHUR_DEV_WORKER_REPORT_DIR||DEFAULT_REPORT_DIR,
  now=()=>new Date(), check=runChecks,fsImpl=fs,
}={}){
  if(!path.isAbsolute(directory))throw new Error('Reports need an absolute directory');
  const report=await check({selection:'all',now});
  fsImpl.mkdirSync(directory,{recursive:true});
  const filename='health-'+formatFileTimestamp(now())+'.json';
  const fullpath=path.join(directory,filename);
  fsImpl.writeFileSync(fullpath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  const ownFiles=fsImpl.readdirSync(directory)
    .filter(x=>/^health-\d{4}-\d{2}-\d{2}T[0-9TZ-]+\.json$/.test(x))
    .sort();
  for(const old of ownFiles.slice(0,Math.max(0,ownFiles.length-MAX_REPORTS))){
    fsImpl.unlinkSync(path.join(directory,old));
  }
  return {status:report.status,checked:report.checkedProjects,
    unverified:report.notCheckedProjects,reportFile:fullpath};
}

if(require.main===module){
  runMonitor().then(r=>{
    // Never output credentials or arbitrary response bodies.
    console.log('DEV_WORKER_REPORT_STATUS='+r.status);
    console.log('DEV_WORKER_PROJECTS_CHECKED='+r.checked);
    console.log('DEV_WORKER_PROJECTS_UNVERIFIED='+r.unverified);
    if(r.status==='degraded')process.exitCode=2;
    else if(r.status==='partial')process.exitCode=3;
  }).catch(e=>{
    console.log('DEV_WORKER_REPORT_ERROR='+String(e?.code||e?.name||'unknown'));
    process.exitCode=4;
  });
}
module.exports={runMonitor,formatFileTimestamp,MAX_REPORTS};
