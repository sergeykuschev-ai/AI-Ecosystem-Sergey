'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {PROBE_SOURCE}=require('../../scripts/arthur/dev-worker/functional_checks');

async function executePurchasingProbe(fsImpl){
  const logs=[],process={argv:['node','3210','/api/v1/health','purchasing-health'],exitCode:0};
  const result=vm.runInNewContext(PROBE_SOURCE,{
    process,
    console:{log:v=>logs.push(JSON.parse(v))},
    require(id){
      if(id==='node:fs')return fsImpl;
      if(id==='node:path')return require('node:path').posix;
      throw new Error('Unknown dependency '+id);
    },
    fetch:async()=>({status:200,json:async()=>({data:{status:'ok',service:'purchasing-web'}})}),
    AbortSignal,
    Buffer,
  },{timeout:1000});
  await result;
  assert.equal(logs.length,1);
  return {result:logs[0],exitCode:process.exitCode};
}
function fakeFS(error){
  return {
    readdirSync(root){assert.equal(root,'/app/data/purchasing');if(error)throw Object.assign(new Error('host secret path'),{code:error});return ['matrix.json','historical.xlsx']},
    lstatSync(){return {isFile:()=>true,isSymbolicLink:()=>false,size:100}},
    openSync(){return 12},
    closeSync(fd){assert.equal(fd,12)},
    readSync(fd,buffer){buffer[0]=0x50;buffer[1]=0x4b;return 4},
    readFileSync(){return '{"schemaVersion":1}'},
  };
}
test('purchasing 200 is healthy only if real bind mount can read JSON and Excel',async()=>{
  const x=await executePurchasingProbe(fakeFS());
  assert.equal(x.result.ok,true);
  assert.equal(x.exitCode,0);
});
test('Docker EIO prevents healthy status even when HTTP /health is 200',async()=>{
  const x=await executePurchasingProbe(fakeFS('EIO'));
  assert.equal(x.result.httpStatus,200);
  assert.equal(x.result.ok,false);
  assert.equal(x.exitCode,5);
  assert.doesNotMatch(JSON.stringify(x),/secret|path/);
});
test('invalid workbook signature prevents green storage status',async()=>{
  const f=fakeFS();
  f.readSync=()=>0;
  const x=await executePurchasingProbe(f);
  assert.equal(x.result.ok,false);
});
test('corrupt JSON prevents green storage status',async()=>{
  const f=fakeFS();
  f.readFileSync=()=>'{invalid json';
  const x=await executePurchasingProbe(f);
  assert.equal(x.result.ok,false);
});
test('symlink in data directory prevents misleading successful check',async()=>{
  const f=fakeFS();
  f.lstatSync=()=>({isFile:()=>true,isSymbolicLink:()=>true,size:100});
  const x=await executePurchasingProbe(f);
  assert.equal(x.result.ok,false);
});
