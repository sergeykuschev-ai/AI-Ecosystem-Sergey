#!/usr/bin/env node
'use strict';
const path=require('node:path');
const {functionalSnapshot,storeSnapshot}=require('./functional_checks');

const REPORT_DIR=process.platform==='win32'
  ? 'C:\\AI-Ecosystem\\local-services\\arthur-functional-reports'
  :path.resolve(__dirname,'../../../output/arthur/functional');

async function main(){
  const snapshot=await functionalSnapshot();
  const dir=process.env.ARTHUR_FUNCTIONAL_REPORT_DIR||REPORT_DIR;
  storeSnapshot(snapshot,{directory:dir});
  console.log('FUNCTIONAL_STATUS='+snapshot.status);
  console.log('FUNCTIONAL_CHECKED='+snapshot.checked);
  console.log('FUNCTIONAL_UNVERIFIED='+snapshot.notChecked);
  for(const check of snapshot.checks){
    console.log('CHECK_'+check.id+'='+check.status+(check.reason?' ('+check.reason+')':''));
  }
  if(snapshot.status==='degraded')process.exitCode=2;
  if(snapshot.status==='partial')process.exitCode=3;
}
if(require.main===module){
  main().catch(e=>{
    console.log('FUNCTIONAL_MONITOR_ERROR='+String(e?.code||e?.name||'unknown'));
    process.exitCode=4;
  });
}
module.exports={main};
