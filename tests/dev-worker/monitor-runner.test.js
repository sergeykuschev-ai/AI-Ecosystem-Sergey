'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {runMonitor,formatFileTimestamp,MAX_REPORTS}=
  require('../../scripts/arthur/dev-worker/monitor_runner');

test('monitor writes only sanitized project status to an explicit local directory',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arthur-dev-monitor-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const now=()=>new Date('2026-10-09T08:15:30.000Z');
  const report={status:'healthy',checkedProjects:5,notCheckedProjects:0,results:[]};
  const result=await runMonitor({directory:dir,now,check:async()=>report});
  assert.equal(result.status,'healthy');
  assert.equal(result.checked,5);
  assert.ok(result.reportFile.startsWith(dir));
  const written=JSON.parse(fs.readFileSync(result.reportFile,'utf8'));
  assert.deepEqual(written,report);
  assert.match(path.basename(result.reportFile),/^health-2026-10-09T08-15-30-000Z\.json$/);
});

test('monitor never overwrites existing report for the same instant',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arthur-dev-monitor-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const opts={directory:dir,now:()=>new Date('2026-10-09T08:15:30.000Z'),
    check:async()=>({status:'healthy',checkedProjects:5,notCheckedProjects:0,results:[]})};
  await runMonitor(opts);
  await assert.rejects(()=>runMonitor(opts),e=>e.code==='EEXIST');
  assert.equal(fs.readdirSync(dir).length,1);
});

test('monitor report path must be absolute',async()=>{
  await assert.rejects(()=>runMonitor({directory:'./relative-path'}),/absolute directory/);
});

test('monitor retention protects other files',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arthur-dev-monitor-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  fs.writeFileSync(path.join(dir,'KEEP.txt'),'unrelated');
  for(let i=0;i<MAX_REPORTS+2;i++){
    const time=new Date(Date.UTC(2026,0,1,0,i,0));
    fs.writeFileSync(path.join(dir,'health-'+formatFileTimestamp(time)+'.json'),'{}');
  }
  await runMonitor({directory:dir,now:()=>new Date('2026-10-09T08:15:30Z'),
    check:async()=>({status:'healthy',checkedProjects:1,notCheckedProjects:0,results:[]})});
  const entries=fs.readdirSync(dir);
  assert.equal(entries.filter(n=>n.startsWith('health-')).length,MAX_REPORTS);
  assert.equal(fs.readFileSync(path.join(dir,'KEEP.txt'),'utf8'),'unrelated');
});
