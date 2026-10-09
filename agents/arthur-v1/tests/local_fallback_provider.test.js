'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {AuthFallbackProvider,LocalOllamaProvider}=require('../ai/local_fallback_provider');
const {createAIProviderFromEnv}=require('../ai/provider_factory');
test('factory wraps OmniRoute only when explicitly enabled',()=>{
 const env={ARTHUR_AI_PROVIDER:'omniroute',OMNIROUTE_BASE_URL:'http://omniroute:20128/v1',OMNIROUTE_API_KEY:'test',ARTHUR_OLLAMA_URL:'http://host.docker.internal:11434',ARTHUR_OLLAMA_FALLBACK_ENABLED:'true'};
 const p=createAIProviderFromEnv(env);
 assert.ok(p instanceof AuthFallbackProvider);
 assert.equal(p.fallback.model,'qwen2.5:3b');
 const notEnabled=createAIProviderFromEnv({...env,ARTHUR_OLLAMA_FALLBACK_ENABLED:'false'});
 assert.notEqual(notEnabled.name,'omniroute-with-local-fallback');
});
test('401 switches to local with 15 minute circuit breaker and recovers after cooldown',async()=>{
 let current=100000, primaryCount=0, fallbackCount=0;
 const primary={models:{fast:'arthur-fast'},async generate(){primaryCount++;if(primaryCount===1){const e=new Error('Unauthorized');e.code='OMNIROUTE_UNAUTHORIZED';throw e;}return 'Cloud online';},async synthesize(){return {text:'online'}}};
 const fallback={async generate(){fallbackCount++;return 'Привет от локального Артура';},async synthesize(){return {text:'local'}},async health(){return {healthy:true}}};
 const p=new AuthFallbackProvider({primary,fallback,clock:()=>current});
 assert.equal(await p.generate('Привет'),'Привет от локального Артура');
 assert.equal(await p.generate('Привет'),'Привет от локального Артура');
 assert.equal(primaryCount,1);assert.equal(fallbackCount,2);
 current+=900001;
 assert.equal(await p.generate('Привет'),'Cloud online');
 assert.equal(primaryCount,2);
});
test('non-provider errors are not masked by local fallback',async()=>{
 const primary={models:{},async generate(){const e=new Error('Invalid plan');e.code='PLAN_BUILD_ERROR';throw e;}};
 const p=new AuthFallbackProvider({primary,fallback:{async generate(){throw Error('Must not call')}}});
 await assert.rejects(p.generate('test'),/Invalid plan/);
});
test('local Ollama chat payload and Russian reply',async()=>{
 const request=[];
 const provider=new LocalOllamaProvider({baseUrl:'http://host.docker.internal:11434',fetchImpl:async(url,options)=>{
 request.push({url,body:JSON.parse(options.body)});
 return {ok:true,json:async()=>({message:{content:'Здравствуйте, чем помочь?'}})};
 }});
 assert.equal(await provider.generate('Как дела?',{system:'Отвечай на русском'}),'Здравствуйте, чем помочь?');
 assert.equal(request[0].url,'http://host.docker.internal:11434/api/chat');
 assert.equal(request[0].body.model,'qwen2.5:3b');
 assert.equal(request[0].body.messages[0].role,'system');
 assert.equal(request[0].body.stream,false);
 assert.equal(request[0].body.options.num_ctx,3072);
});
test('local fallback synthesis does not invent successful business operations',async()=>{
 let prompt='';
 const p=new LocalOllamaProvider({baseUrl:'http://host.docker.internal:11434',fetchImpl:async(_url,opts)=>{
 prompt=JSON.parse(opts.body).messages.at(-1).content;
 return {ok:true,json:async()=>({message:{content:'Данные недоступны.'}})};
 }});
 const output=await p.synthesize({userMessage:'Покажи продажи',executionStatus:'failed',skillOutputs:[],failures:[{error:'unavailable'}]});
 assert.match(prompt,/НЕ ПРИДУМЫВАЙ/);
 assert.equal(output.text,'Данные недоступны.');
});
test('external LLM endpoint rejected to keep local fallback private',()=>{
 assert.throws(()=>new LocalOllamaProvider({baseUrl:'https://random.example.com'}),/host only/);
});
