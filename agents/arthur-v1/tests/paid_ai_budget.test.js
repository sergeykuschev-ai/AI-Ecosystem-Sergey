'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PaidAiBudget, guardedFetch, limitsFromEnv } = require('../ai/paid_ai_budget');
const { createAIProviderFromEnv } = require('../ai/provider_factory');
const { AuthFallbackProvider } = require('../ai/local_fallback_provider');

const limit = {
  daily: 8000, lifetime: 15000,
  deepseekDaily: 4000, zaiDaily: 6000,
  deepseekLifetime: 9000, zaiLifetime: 9000,
};
const request = (provider, maxTokens=128) => ({
  url: provider === 'zai' ? 'https://api.z.ai/api/paas/v4/chat/completions' :
    'https://api.deepseek.com/chat/completions',
  opts: {
    method:'POST',
    body:JSON.stringify({
      messages:[{role:'user',content:'Hi'}],model:provider==='zai'?'glm-5.3':'deepseek-flash',
      max_tokens:maxTokens,stream:false,
    }),
  },
});
function directory(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arthur-paid-ai-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
function successFetch(calls) {
  return async (url, opts) => {
    calls.push({url,body:JSON.parse(opts.body)});
    return {ok:true,status:200,text:async()=>JSON.stringify({
      choices:[{message:{content:'OK'}}], usage:{prompt_tokens:3,completion_tokens:2}
    })};
  };
}

test('fail closed when persistent ledger path is missing',()=>{
  assert.throws(()=>createAIProviderFromEnv({
    ARTHUR_AI_PROVIDER:'deepseek-glm', DEEPSEEK_API_KEY:'key',ZAI_API_KEY:'key',
  }),/ARTHUR_AI_BUDGET_DIR/);
  assert.throws(()=>new PaidAiBudget({directory:'relative'}),e=>e.code==='AI_BUDGET_CONFIG_ERROR');
});

test('reserve a budget before every paid POST, limit output, and never write prompt/keys',async t=>{
  const root=directory(t),calls=[];
  const fetchImpl=guardedFetch({directory:root,limits:limit,fetchImpl:successFetch(calls)});
  const r=request('deepseek',99999);
  await fetchImpl(r.url,r.opts);
  assert.equal(calls[0].body.max_tokens,1024);
  const record=fs.readdirSync(root).filter(f=>f.endsWith('.json'));
  assert.equal(record.length,1);
  const text=fs.readFileSync(path.join(root,record[0]),'utf8');
  assert.equal(text.includes('Hi'),false);
  assert.equal(text.includes('Authorization'),false);
  assert.equal(text.includes('messages'),false);
  const rec=JSON.parse(text);
  assert.equal(rec.provider,'deepseek');
  assert.ok(rec.microUsd>0);
});

test('block over-limit request before any paid network fetch, persist limits across restart',async t=>{
  const root=directory(t),calls=[];
  const r=request('zai',128);
  const first=guardedFetch({directory:root,limits:{...limit,daily:6000,zaiDaily:6000},fetchImpl:successFetch(calls)});
  await first(r.url,r.opts);
  const second=guardedFetch({directory:root,limits:{...limit,daily:6000,zaiDaily:6000},fetchImpl:successFetch(calls)});
  await assert.rejects(second(r.url,r.opts),e=>e.code==='AI_BUDGET_EXHAUSTED');
  assert.equal(calls.length,1);
});

test('global lifetime quota applies after UTC day rolls over',t=>{
  const root=directory(t), cap={...limit,daily:999999,lifetime:5000,deepseekDaily:999999,deepseekLifetime:999999};
  const old=new PaidAiBudget({directory:root,limits:cap,now:()=>new Date('2026-10-09T23:59:00Z')});
  const amount=old.estimate('deepseek',JSON.parse(request('deepseek',128).opts.body));
  old.reserve('deepseek',amount);
  const next=new PaidAiBudget({directory:root,limits:cap,now:()=>new Date('2026-10-10T00:01:00Z')});
  if(amount*2>cap.lifetime){
    assert.throws(()=>next.reserve('deepseek',amount),e=>e.code==='AI_BUDGET_EXHAUSTED');
  } else {
    next.reserve('deepseek',amount);
    assert.throws(()=>next.reserve('deepseek',cap.lifetime),e=>e.code==='AI_BUDGET_EXHAUSTED');
  }
});

test('a corrupt ledger and a stuck lock both deny paid calls',t=>{
  const root=directory(t);
  const guard=new PaidAiBudget({directory:root});
  fs.writeFileSync(path.join(root,'r-bad.json'),'not-json');
  assert.throws(()=>guard.reserve('deepseek',100),e=>e.code==='AI_BUDGET_UNAVAILABLE');
  fs.unlinkSync(path.join(root,'r-bad.json'));
  fs.mkdirSync(path.join(root,'.lock'));
  assert.throws(()=>guard.reserve('deepseek',100),e=>e.code==='AI_BUDGET_UNAVAILABLE');
});

test('capped GLM requests and unexpected endpoint denied before network',async t=>{
  const root=directory(t),calls=[];
  const f=guardedFetch({directory:root,fetchImpl:successFetch(calls)});
  const r=request('zai',40000);
  await f(r.url,r.opts);
  assert.equal(calls[0].body.max_tokens,1536);
  await assert.rejects(f('https://example.net/chat/completions',r.opts),e=>e.code==='AI_BUDGET_CONFIG_ERROR');
  assert.equal(calls.length,1);
});

test('paid budget exhaustion routes through existing local Ollama fallback',async t=>{
  const root=directory(t),cloud=[];
  const env={
    ARTHUR_AI_PROVIDER:'deepseek-glm',
    DEEPSEEK_API_KEY:'test-only-key',
    ZAI_API_KEY:'test-only-key',
    ARTHUR_AI_BUDGET_DIR:root,
    ARTHUR_AI_DAILY_USD:'0.000001',
    ARTHUR_OLLAMA_FALLBACK_ENABLED:'true',
    ARTHUR_OLLAMA_URL:'http://host.docker.internal:11434',
  };
  const provider=createAIProviderFromEnv(env,{fetchImpl:successFetch(cloud)});
  assert.ok(provider instanceof AuthFallbackProvider);
  provider.fallback.fetchImpl=async()=>({ok:true,json:async()=>({message:{content:'Ollama доступна'}})});
  const response=await provider.generate('Hello');
  assert.equal(response,'Ollama доступна');
  assert.equal(cloud.length,0);
  assert.ok(provider.skipPrimaryUntil>0);
});

test('reject malformed limit and oversized messages without charging',async t=>{
  assert.throws(()=>limitsFromEnv({ARTHUR_ZAI_DAILY_USD:'-1'}),e=>e.code==='AI_BUDGET_CONFIG_ERROR');
  const root=directory(t),calls=[];
  const f=guardedFetch({directory:root,fetchImpl:successFetch(calls)});
  const r=request('deepseek',128);
  r.opts.body=JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'x'.repeat(65000)}],max_tokens:128,stream:false});
  await assert.rejects(f(r.url,r.opts),e=>e.code==='AI_BUDGET_EXHAUSTED');
  assert.equal(calls.length,0);
});


test('secrets are loaded from mounted read-only files, not copied to diagnostics',t=>{
  const root=directory(t);
  const ds=path.join(root,'deepseek.secret'),zai=path.join(root,'zai.secret');
  fs.writeFileSync(ds,'ds-canary-test-secret', {mode:0o600});
  fs.writeFileSync(zai,'zai-canary-test-secret', {mode:0o600});
  const env={
    ARTHUR_AI_PROVIDER:'deepseek-glm',
    ARTHUR_AI_BUDGET_DIR:path.join(root,'ledger'),
    DEEPSEEK_API_KEY_FILE:ds,
    ZAI_API_KEY_FILE:zai,
  };
  const p=createAIProviderFromEnv(env,{fetchImpl:async()=>({ok:true})});
  assert.equal(p.deepseekConfigured,true);
  assert.equal(p.glmConfigured,true);
  const d=require('../ai/provider_factory').getProviderDiagnostics(env);
  assert.equal(d.configured,true);
  assert.ok(!JSON.stringify(d).includes('canary-test-secret'));
  assert.throws(()=>createAIProviderFromEnv({...env,ZAI_API_KEY_FILE:path.join(root,'missing')}),/ENOENT/);
});
