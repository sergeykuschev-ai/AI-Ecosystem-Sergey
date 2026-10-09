'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createExecutionEngine, topologicalSort } = require('../orchestrator/execution_engine');

const context = {
  requestId: 'harness-test', correlationId: 'harness-test',
  userId: 'authorized-owner', channel: 'test',
};

function registry(...skills) {
  const byId = new Map(skills.map(s => [s.id,s]));
  return { get(id) {
    const skill = byId.get(id);
    if (!skill) throw new Error('Unregistered skill: '+id);
    return skill;
  }};
}

function skill(id, { readOnly=true, run } = {}) {
  return {
    id, capabilities:[{id:'act',readOnly}],
    async execute(input) { return run(input); },
  };
}

function step(id, skillId=id, dependsOn=[]) {
  return { id,skill:skillId,operation:'act',dependsOn,timeoutMs:5000 };
}

const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('harness really limits independent concurrent tool calls', async()=>{
  let active=0,peak=0;
  const shared=skill('work',{run:async()=>{
    active++; peak=Math.max(peak,active);
    await wait(18);
    active--;
    return {status:'success',data:{done:true}};
  }});
  const plan={steps:Array.from({length:7},(_,i)=>step('s'+i,'work'))};
  const report=await createExecutionEngine({maxConcurrency:2}).execute(plan,registry(shared),context);
  assert.equal(report.status,'success');
  assert.equal(Object.keys(report.stepResults).length,7);
  assert.equal(peak,2);
});

test('harness never executes a dependent operation after prerequisite failure',async()=>{
  const observed=[];
  const bad=skill('failed',{run:async()=>{
    observed.push('failed');
    throw Object.assign(new Error('Out of stock'),{code:'BUSINESS_DATA_UNAVAILABLE'});
  }});
  const mutation=skill('mutate',{readOnly:false,run:async()=>{observed.push('MUTATED');return {status:'success'};}});
  const good=skill('independent',{run:async()=>{observed.push('independent');return {status:'success'};}});
  const plan={steps:[
    step('initial','failed'),
    step('dangerous','mutate',['initial']),
    step('later','mutate',['dangerous']),
    step('safe','independent'),
  ]};
  const result=await createExecutionEngine().execute(plan,registry(bad,mutation,good),context);
  assert.equal(result.status,'partial');
  assert.deepEqual(observed.sort(),['failed','independent'].sort());
  assert.equal(result.stepResults.dangerous.status,'skipped');
  assert.equal(result.stepResults.later.status,'skipped');
  assert.equal(result.errors.length,3);
  assert.equal(result.stepResults.later.errors[0].code,'ARTHUR_DEPENDENCY_FAILED');
});

test('harness never automatically retries a write operation after uncertain timeout',async()=>{
  let writes=0;
  const write=skill('write',{readOnly:false,run:async()=>{
    writes++;
    const err=Object.assign(new Error('Timeout: status unknown'),{retryable:true,code:'ETIMEDOUT'});
    throw err;
  }});
  const p={steps:[{...step('w','write'),retries:2,retryable:true}]};
  const result=await createExecutionEngine().execute(p,registry(write),context);
  assert.equal(writes,1);
  assert.equal(result.status,'failed');
});

test('harness permits capped retries for explicitly read-only operations',async()=>{
  let reads=0;
  const read=skill('read',{readOnly:true,run:async()=>{
    reads++;
    if(reads<3) throw Object.assign(new Error('temporary'),{retryable:true});
    return {status:'success'};
  }});
  const p={steps:[{...step('r','read'),retries:20,retryable:true}]};
  const result=await createExecutionEngine().execute(p,registry(read),context);
  assert.equal(reads,3); // capped at two additional attempts
  assert.equal(result.status,'success');
});

test('validation rejects duplicate step ids, missing dependencies and cycles',()=>{
  assert.throws(()=>topologicalSort([step('x'),step('x')]),/Duplicate execution step/);
  assert.throws(()=>topologicalSort([step('a','a',['unknown'])]),/Step not found/);
  assert.throws(()=>topologicalSort([step('a','a',['b']),step('b','b',['a'])]),/Circular dependency/);
});

test('failed status reported by tool is never silently converted to success',async()=>{
  const no=skill('no',{run:async()=>({status:'rejected',data:{}})});
  const report=await createExecutionEngine().execute({steps:[step('s','no')]},registry(no),context);
  assert.equal(report.status,'failed');
  assert.equal(report.errors[0].errors[0].code,'ARTHUR_STEP_NOT_SUCCESSFUL');
});

test('harness clamps requested concurrency to allowed values',()=>{
  assert.equal(createExecutionEngine({maxConcurrency:0}).maxConcurrency,1);
  assert.equal(createExecutionEngine({maxConcurrency:100}).maxConcurrency,5);
  assert.equal(createExecutionEngine({maxConcurrency:2}).maxConcurrency,2);
});
