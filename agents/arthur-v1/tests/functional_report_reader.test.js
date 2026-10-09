'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {IDS,readFunctionalStatus,formatFunctionalStatus}=require('../telegram/functional_report_reader');
function sample(){
 return {schemaVersion:1,timestamp:'2026-10-09T10:00:00.000Z',status:'healthy',checked:13,notChecked:0,
 checks:[...IDS].map(id=>({id,status:'healthy'}))};
}
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'functional-check-reader-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return {dir,file:path.join(dir,'functional-2026-10-09T10-00-00-000Z.json')};
}
const now=()=>new Date('2026-10-09T10:15:00.000Z');
test('13 recent checks and disclaimer are shown',t=>{
 const f=setup(t);fs.writeFileSync(f.file,JSON.stringify(sample()));
 const r=readFunctionalStatus({directory:f.dir,now});
 assert.equal(r.healthy,13);
 assert.match(formatFunctionalStatus(r),/13\/13/);
 assert.match(formatFunctionalStatus(r),/1С/);
});
test('stale reports do not become green status',t=>{
 const f=setup(t);const r=sample();r.timestamp='2026-10-08T10:00:00.000Z';
 fs.writeFileSync(f.file,JSON.stringify(r));
 assert.equal(readFunctionalStatus({directory:f.dir,now}).available,false);
});
test('invalid counts and unrecognized check names are rejected',t=>{
 const f=setup(t);
 let r=sample();r.checked=12;fs.writeFileSync(f.file,JSON.stringify(r));
 assert.equal(readFunctionalStatus({directory:f.dir,now}).available,false);
 r=sample();r.checks[0].id='unexpected-check';fs.writeFileSync(f.file,JSON.stringify(r));
 assert.equal(readFunctionalStatus({directory:f.dir,now}).available,false);
});
test('degraded and partial reports are distinguishable',t=>{
 const f=setup(t);let r=sample();
 r.status='partial';r.checked=12;r.notChecked=1;r.checks[0].status='not_checked';
 fs.writeFileSync(f.file,JSON.stringify(r));
 assert.match(formatFunctionalStatus(readFunctionalStatus({directory:f.dir,now})),/12\/13/);
 r=sample();r.status='degraded';r.checks[0].status='degraded';
 fs.writeFileSync(f.file,JSON.stringify(r));
 assert.match(formatFunctionalStatus(readFunctionalStatus({directory:f.dir,now})),/ошибки/);
});
test('malformed and oversized reports are not accepted',t=>{
 const f=setup(t);
 fs.writeFileSync(f.file,'bad-json');
 assert.equal(readFunctionalStatus({directory:f.dir,now}).available,false);
 fs.writeFileSync(f.file,'x'.repeat(65000));
 assert.equal(readFunctionalStatus({directory:f.dir,now}).available,false);
});
