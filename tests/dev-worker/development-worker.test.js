'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 PROJECTS,chooseProjects,safePublicUrl,checkSite,checkDocker,parseDockerState,runChecks,supportedAction,
}=require('../../scripts/arthur/dev-worker/worker');

test('registered projects only, no arbitrary URL, command or deployment',()=>{
  assert.equal(chooseProjects('all').length,5);
  assert.equal(chooseProjects('vozdooh')[0].id,'vozdooh');
  assert.throws(()=>chooseProjects('https://attacker.invalid'),/Unknown registered project/);
  assert.throws(()=>supportedAction('deploy'),/Only read-only check/);
  assert.throws(()=>supportedAction('exec'),/Only read-only check/);
  assert.throws(()=>supportedAction('write'),/Only read-only check/);
});

test('public origins are fixed and do not admit forged hostnames or credentials',()=>{
  assert.equal(safePublicUrl(PROJECTS.amurskmarket,'/api/health').href,
    'https://amurskmarket.ru/api/health');
  assert.throws(()=>safePublicUrl(PROJECTS.vozdooh,'//evil.example/path'),/Disallowed/);
  assert.throws(()=>safePublicUrl(PROJECTS.vozdooh,'https://evil.example/'),/Disallowed/);
  assert.throws(()=>safePublicUrl(PROJECTS.purchasing,'/'),/Not a public-site/);
});

test('site health uses anonymous GET, no redirects, and rejects bad contract',async()=>{
  const calls=[];
  const fetchImpl=async (url,init)=>{
    calls.push({url,init});
    return {status:200,json:async()=>({status:'bad'})};
  };
  const result=await checkSite(PROJECTS.amurskmarket,{fetchImpl});
  assert.equal(result.status,'degraded');
  assert.equal(result.checks.find(x=>x.check==='/api/health').problem,'UNEXPECTED_HEALTH_PAYLOAD');
  assert.equal(calls.length,4);
  for(const call of calls){
    assert.equal(call.init.method,'GET');
    assert.equal(call.init.redirect,'manual');
    assert.equal(call.init.credentials,'omit');
    assert.ok(call.url.startsWith('https://amurskmarket.ru/'));
    assert.equal(Object.keys(call.init.headers).some(x=>/authorization|cookie/i.test(x)),false);
  }
});

test('network error does not emit request URL or sensitive payload',async()=>{
  const report=await checkSite(PROJECTS.vozdooh,{
    fetchImpl:async()=>{throw new Error('token=random_private_key_should_not_leak');}
  });
  assert.equal(report.status,'degraded');
  assert.equal(JSON.stringify(report).includes('random_private_key_should_not_leak'),false);
  assert.equal(report.checks[0].problem,'REQUEST_FAILED');
});

test('docker checks never target another host via local Docker socket',()=>{
  const r=checkDocker(PROJECTS.purchasing,{platform:'linux',
    execFile:()=>{throw new Error('should not invoke Docker');}});
  assert.equal(r.status,'not_checked');
});

test('docker inspection is constrained to registered container and does not use shell',()=>{
  let called;
  const result=checkDocker(PROJECTS['business-kpi'],{
    platform:'win32',
    execFile:(bin,args,opts)=>{
      called={bin,args,opts};
      return JSON.stringify({Running:true,Health:{Status:'healthy'}});
    },
  });
  assert.equal(result.status,'healthy');
  assert.equal(called.bin,'docker');
  assert.deepEqual(called.args,['inspect','business-kpi-local-web','--format','{{json .State}}']);
  assert.equal(called.opts.timeout,8000);
});

test('docker unhealthy and missing container report degraded, not imaginary success',()=>{
  const unhealthy=checkDocker(PROJECTS.arthur,{platform:'win32',
    execFile:()=>JSON.stringify({Running:true,Health:{Status:'unhealthy'}})});
  assert.equal(unhealthy.status,'degraded');
  const missing=checkDocker(PROJECTS.arthur,{platform:'win32',
    execFile:()=>{throw new Error('not found');}});
  assert.equal(missing.status,'degraded');
  assert.equal(missing.checks[0].problem,'DOCKER_INSPECT_UNAVAILABLE');
  assert.throws(()=>parseDockerState('{}'),/Unexpected Docker/);
});

test('cross-host report is partial, never marks skipped infrastructure healthy',async()=>{
  const report=await runChecks({selection:'all',platform:'linux',
    now:()=>new Date('2026-10-09T00:00:00.000Z'),
    fetchImpl:async()=>({status:200,json:async()=>({status:'ok'})})});
  assert.equal(report.status,'partial');
  assert.equal(report.checkedProjects,2);
  assert.equal(report.notCheckedProjects,3);
  assert.equal(report.timestamp,'2026-10-09T00:00:00.000Z');
  assert.deepEqual(report.results.slice(2).map(x=>x.status),['not_checked','not_checked','not_checked']);
});

test('a failing checked site makes overall report degraded',async()=>{
 const report=await runChecks({selection:'all',platform:'linux',
   fetchImpl:async()=>({status:404,json:async()=>({status:'bad'})})});
 assert.equal(report.status,'degraded');
});
