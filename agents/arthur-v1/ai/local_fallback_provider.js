'use strict';

const { AIProvider } = require('./ai_provider');
const { OmniRouteProvider } = require('./omniroute_provider');

const FALLBACK_CODES = new Set([
  'OMNIROUTE_UNAUTHORIZED','OMNIROUTE_HTTP_403','OMNIROUTE_RATE_LIMITED',
  'OMNIROUTE_REQUEST_FAILED','OMNIROUTE_HTTP_500','OMNIROUTE_HTTP_502',
  'OMNIROUTE_HTTP_503','OMNIROUTE_HTTP_504',
  'AI_BUDGET_EXHAUSTED','AI_BUDGET_UNAVAILABLE'
]);

class LocalOllamaProvider extends AIProvider {
  constructor({baseUrl,model='qwen2.5:3b',fetchImpl=fetch,timeoutMs=80000,logger=null}={}) {
    super({name:'local-ollama',capabilities:['generate','synthesize','health']});
    this.baseUrl=String(baseUrl||'').replace(/\/+$/,'');
    if (!/^http:\/\/(?:host\.docker\.internal|127\.0\.0\.1|localhost)(?::\d+)?$/i.test(this.baseUrl)) {
      throw new TypeError('Local Ollama base URL must resolve to the host only');
    }
    this.model=model;
    this.fetchImpl=fetchImpl;
    this.timeoutMs=timeoutMs;
    this.logger=logger;
    this.models={fast:model,reasoning:model,code:model};
  }
  async generate(prompt,{system,temperature=0.3,maxTokens,max_tokens,timeoutMs}={}) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs||this.timeoutMs);
    try {
      const messages=[];
      if(system) messages.push({role:'system',content:String(system)});
      messages.push({role:'user',content:String(prompt)});
      const response=await this.fetchImpl(this.baseUrl+'/api/chat',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({
          model:this.model,messages,stream:false,keep_alive:'90s',
          options:{temperature,num_ctx:3072,num_predict:Math.min(500,Math.max(32,maxTokens||max_tokens||320))}
        }),
        signal:controller.signal,
      });
      if(!response.ok) throw new Error('Local Ollama HTTP '+response.status);
      const data=await response.json();
      const output=String(data?.message?.content||'').trim();
      if(!output) throw new Error('Local Ollama returned empty answer');
      return output;
    } catch(error) {
      const reason=error?.name==='AbortError'?'timeout':error?.message||'unknown';
      throw new Error('Local Ollama failed: '+reason);
    } finally {clearTimeout(timer);}
  }
  async synthesize(input) {
    const prompt=OmniRouteProvider.prototype._buildSynthesisPrompt.call({},input);
    const text=await this.generate(prompt,{
      system:'Ты — Артур, личный помощник. Отвечай по-русски кратко и по делу. Не придумывай факты, действия, результаты операций или показатели бизнеса. Если данные недоступны — сообщи об этом.',
      temperature:0.2,maxTokens:360,
    });
    return {text,markdown:text,confidence:'medium',followUps:[],sources:[],usage:null};
  }
  async health() {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),4000);
    try {
      const r=await this.fetchImpl(this.baseUrl+'/api/tags',{signal:controller.signal});
      return {healthy:r.ok,provider:this.name,models:this.models};
    } catch {
      return {healthy:false,provider:this.name,models:this.models};
    } finally{clearTimeout(timer)}
  }
}

class AuthFallbackProvider extends AIProvider {
  constructor({primary,fallback,clock=()=>Date.now(),cooldownMs=15*60000,logger=null}) {
    super({name:'omniroute-with-local-fallback',capabilities:['generate','synthesize','health']});
    if (!primary||!fallback) throw new TypeError('Both primary and fallback providers required');
    Object.assign(this,{primary,fallback,clock,cooldownMs,logger});
    this.models=primary.models;
    this.skipPrimaryUntil=0;
  }
  shouldFallback(error) {
    return FALLBACK_CODES.has(error?.code)||/^(fetch failed|This operation was aborted)$/i.test(error?.message||'');
  }
  async _call(method,args) {
    if(this.clock()<this.skipPrimaryUntil) return this.fallback[method](...args);
    try {
      return await this.primary[method](...args);
    } catch(error) {
      if(!this.shouldFallback(error)) throw error;
      this.skipPrimaryUntil=this.clock()+this.cooldownMs;
      this.logger?.warn?.('arthur_ai_local_fallback',null,{code:error.code||error.name,cooldownMs:this.cooldownMs});
      return this.fallback[method](...args);
    }
  }
  async generate(prompt,options={}) {return this._call('generate',[prompt,options]);}
  async synthesize(input,context) {return this._call('synthesize',[input,context]);}
  async health() {
    const local=await this.fallback.health();
    return {healthy:local.healthy,provider:this.name,models:this.models,
      fallback:local,primaryCircuitOpen:this.clock()<this.skipPrimaryUntil};
  }
}
module.exports={LocalOllamaProvider,AuthFallbackProvider,FALLBACK_CODES};
