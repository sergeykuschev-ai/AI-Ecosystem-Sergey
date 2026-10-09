#!/usr/bin/env node
'use strict';

// Safe, opt-in, read-only diagnostics. No raw shell or deploy action.
const { supportedAction,runChecks } = require('./dev-worker/worker');

async function main(argv=process.argv.slice(2)){
  if(argv.length>2)throw new Error('Usage: node development-worker.js check [project-id|all]');
  supportedAction(argv[0]||'check');
  const report=await runChecks({selection:argv[1]||'all'});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.status==='degraded')process.exitCode=2;
  else if(report.status==='partial')process.exitCode=3;
}

if(require.main===module){
  main().catch(e=>{
    process.stderr.write(JSON.stringify({status:'error',code:'INVALID_WORKER_REQUEST',
      message:e?.message||'Unknown error'})+'\n');
    process.exitCode=64;
  });
}
module.exports={main};
