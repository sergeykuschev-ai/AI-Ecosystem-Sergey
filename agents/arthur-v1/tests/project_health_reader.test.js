'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {loadProjectStatus,formatProjectStatus}=require('../telegram/project_health_reader');

const ids=['amurskmarket','vozdooh','business-kpi','purchasing','arthur'];
function sample(date='2026-10-09T08:30:00.000Z'){
  return {
    schemaVersion:1,timestamp:date,status:'healthy',
    checkedProjects:5,notCheckedProjects:0,
    results:ids.map(project=>({project,status:'healthy',checks:[]})),
  };
}
function temp(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arthur-project-status-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  return dir;
}
function write(dir,name,value){
  fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
}
const now=()=>new Date('2026-10-09T08:45:00.000Z');
const name='health-2026-10-09T08-30-00-000Z.json';

test('missing/misconfigured reports fail closed and never claim healthy',t=>{
  assert.equal(loadProjectStatus().available,false);
  const dir=temp(t);
  assert.equal(loadProjectStatus({directory:dir}).reason,'NO_REPORTS');
  assert.match(formatProjectStatus(loadProjectStatus({directory:dir})),/нет свежего/);
});
test('one recent complete report renders the five allowed projects only',t=>{
  const dir=temp(t);write(dir,name,sample());
  const report=loadProjectStatus({directory:dir,now});
  assert.equal(report.available,true);
  const text=formatProjectStatus(report);
  for(const title of ['amurskmarket.ru','vozdooh27.ru','Бизнес-портал','Закупщик','Артур'])assert.ok(text.includes(title));
  assert.equal((text.match(/✅/g)||[]).length,5);
  assert.match(text,/не корректность продаж/);
  assert.doesNotMatch(text,/C:\\|node_modules|telegram.*token/i);
});
test('stale and future-dated files are not accepted as current',t=>{
  const dir=temp(t);
  write(dir,name,sample('2026-10-08T05:00:00.000Z'));
  assert.equal(loadProjectStatus({directory:dir,now}).reason,'STALE_REPORT');
  fs.rmSync(path.join(dir,name));
  write(dir,name,sample('2026-10-09T09:10:00.000Z'));
  assert.equal(loadProjectStatus({directory:dir,now}).reason,'STALE_REPORT');
});
test('tampered statuses, duplicate IDs and fabricated successful counts are rejected',t=>{
  const dir=temp(t);const x=sample();x.results[3].status='definitely-good';
  write(dir,name,x);
  assert.equal(loadProjectStatus({directory:dir,now}).reason,'INVALID_REPORT');
  x.results[3].status='healthy';x.results[3].project='vozdooh';
  write(dir,name,x);
  assert.equal(loadProjectStatus({directory:dir,now}).reason,'INVALID_REPORT');
  x.results[3].project='purchasing';x.checkedProjects=4;
  write(dir,name,x);
  assert.equal(loadProjectStatus({directory:dir,now}).reason,'INVALID_REPORT');
});
test('not_checked is never shown as success and source cannot inject text',t=>{
  const dir=temp(t);const x=sample();
  x.results[4].status='not_checked';x.checkedProjects=4;x.notCheckedProjects=1;
  x.results[0].summary='<b>steal key</b>';
  write(dir,name,x);
  const text=formatProjectStatus(loadProjectStatus({directory:dir,now}));
  assert.match(text,/⚪ Артур — не проверен/);
  assert.doesNotMatch(text,/steal key|<b>/);
});
test('symbolic link, oversized and malformed report is never read as a success',t=>{
  const dir=temp(t),external=path.join(dir,'secret.txt');
  fs.writeFileSync(external,JSON.stringify(sample()));
  try{
    fs.symlinkSync(external,path.join(dir,name));
    assert.equal(loadProjectStatus({directory:dir,now}).reason,'INVALID_REPORT');
  }catch(e){if(e.code!=='EPERM')throw e;}
  fs.rmSync(path.join(dir,name),{force:true});
  fs.writeFileSync(path.join(dir,name),'not-json');
  assert.equal(loadProjectStatus({directory:dir,now}).reason,'INVALID_REPORT');
  fs.writeFileSync(path.join(dir,name),'x'.repeat(70000));
  assert.equal(loadProjectStatus({directory:dir,now}).reason,'INVALID_REPORT');
});
