'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
 SITE_CHECKS,DOCKER_CHECKS,checkWebsite,checkDockerFunction,
 functionalSnapshot,storeSnapshot,MAX_REPORTS,
}=require('../../scripts/arthur/dev-worker/functional_checks');

test('public content checks use anonymous GET on only fixed origins, no redirects',async()=>{
 const observed=[];
 const res=await checkWebsite(SITE_CHECKS[0],{
  fetchImpl:async(url,init)=>{
    observed.push({url,init});
    return {status:200,headers:{get:()=>null},text:async()=>'Ампер, Вентиль, Метиз Маркет и Миска — Бонусная'};
  },
 });
 assert.equal(res.status,'healthy');
 assert.equal(observed.length,1);
 assert.equal(observed[0].init.method,'GET');
 assert.equal(observed[0].init.redirect,'manual');
 assert.equal(observed[0].init.credentials,'omit');
 assert.ok(observed[0].url.startsWith('https://amurskmarket.ru/'));
 assert.equal('authorization' in observed[0].init.headers,false);
});

test('missing required page text yields degraded even when server returns 200',async()=>{
 const res=await checkWebsite(SITE_CHECKS[7],{
  fetchImpl:async()=>({status:200,headers:{get:()=>null},text:async()=>'<html>up</html>'}),
 });
 assert.equal(res.status,'degraded');
 assert.equal(res.reason,'CONTENT_CONTRACT_FAILED');
});

test('valid API health contract checked as JSON, not status alone',async()=>{
 const fake=j=>async()=>({status:200,headers:{get:()=>null},
   text:async()=>JSON.stringify(j)});
 assert.equal((await checkWebsite(SITE_CHECKS[8],{fetchImpl:fake({status:'ok'})})).status,'healthy');
 assert.equal((await checkWebsite(SITE_CHECKS[8],{fetchImpl:fake({status:'not-ok'})})).status,'degraded');
});

test('reject non-allowlisted destination and oversized body',async()=>{
 await assert.rejects(()=>checkWebsite({...SITE_CHECKS[0],origin:'https://evil.example'}),
   /registered/);
 await assert.rejects(()=>checkWebsite({...SITE_CHECKS[0],route:'//evil.example'}),
   /registered/);
 const res=await checkWebsite(SITE_CHECKS[1],{
   fetchImpl:async()=>({status:200,headers:{get:()=>String(700000)},text:async()=>{throw Error('should not read')}}),
 });
 assert.equal(res.status,'not_checked');
});

test('no shell or input-selected container: only registered static docker checks',()=>{
 let called;
 const res=checkDockerFunction(DOCKER_CHECKS[0],{
  platform:'win32',
  execFile:(bin,args,opts)=>{
    called={bin,args,opts};
    return '{"ok":true,"httpStatus":200}';
  },
 });
 assert.equal(res.status,'healthy');
 assert.equal(called.bin,'docker');
 assert.deepEqual(called.args.slice(0,4),['exec','business-kpi-local-web','node','-e']);
 assert.equal(called.args[5],'3220');
 assert.equal(called.args[6],'/health');
 assert.equal(called.opts.timeout,11000);
 assert.throws(()=>checkDockerFunction({...DOCKER_CHECKS[0],container:'fake'},{
   platform:'win32',execFile:()=>{throw Error('must not call')}}),/Non-allowlisted/);
});

test('docker function check emits only status and category on errors',()=>{
 const result=checkDockerFunction(DOCKER_CHECKS[2],{
  platform:'win32',
  execFile:()=>{throw new Error('token=secret-never-print')},
 });
 assert.equal(result.status,'degraded');
 assert.equal(JSON.stringify(result).includes('secret-never-print'),false);
});

test('cross-host results are partial rather than implying Windows was tested',async()=>{
 const report=await functionalSnapshot({
  platform:'linux',now:()=>new Date('2026-10-09T08:10:00.000Z'),
  fetchImpl:async(url)=>({
    status:200,headers:{get:()=>null},
    text:async()=>url.endsWith('/api/health')?'{"status":"ok"}':
      'VOZDOOH Каталог Корзина Оформление заказа Ампер, Вентиль, Метиз Маркет и Миска Бонусная программа Миска зоомагазин urlset amurskmarket.ru',
  }),
 });
 assert.equal(report.status,'partial');
 assert.equal(report.checked,9);
 assert.equal(report.notChecked,4);
 assert.equal(report.checks.length,13);
 assert.ok(report.notTested.includes('live-checkout-and-payment'));
});

test('snapshots are append-only; old own files expire and unrelated files remain',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arthur-functional-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'KEEP-OTHER-REPORT.txt'),'preserve');
 for(let i=0;i<MAX_REPORTS+1;i++){
  const date=new Date(Date.UTC(2026,0,1,0,i,0)).toISOString();
  fs.writeFileSync(path.join(dir,'functional-'+date.replace(/[:.]/g,'-')+'.json'),'{}');
 }
 const report={schemaVersion:1,timestamp:'2026-10-09T08:00:00.000Z',status:'healthy',checks:[]};
 storeSnapshot(report,{directory:dir});
 assert.equal(fs.readdirSync(dir).filter(x=>x.startsWith('functional-')).length,MAX_REPORTS);
 assert.equal(fs.readFileSync(path.join(dir,'KEEP-OTHER-REPORT.txt'),'utf8'),'preserve');
 assert.throws(()=>storeSnapshot(report,{directory:dir}),e=>e.code==='EEXIST');
});
