'use strict';

// A conservative, restart-safe admission control for paid LLM calls.
// Each reservation is a small, exclusive file; it contains no API key or prompt.
// Holding an atomic directory lock serializes admissions across processes.
// Fail closed on inaccessible storage, corrupt records, or abandoned locks.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ArthurError } = require('../errors/arthur_errors');

const PRICING = Object.freeze({
  deepseek: { input: 0.30, output: 1.20, maxOutput: 1024 },
  zai: { input: 1.40, output: 4.40, maxOutput: 1536 },
});
const RISK_MULTIPLIER = 2; // buffer for rounding/pricing uncertainty
const MAX_INPUT_BYTES = 64000;
const DEFAULT_LIMITS_MICROUSD = Object.freeze({
  daily: 1250000,
  lifetime: 7000000,
  deepseekDaily: 750000,
  zaiDaily: 750000,
  deepseekLifetime: 5000000,
  zaiLifetime: 3000000,
});

function error(code, message) {
  return new ArthurError(code, message, { retryable: false });
}
function parsePositiveUsd(value, fallback) {
  if (value == null || value === '') return fallback;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 20) {
    throw error('AI_BUDGET_CONFIG_ERROR', 'Invalid paid AI spending ceiling');
  }
  return Math.floor(amount * 1e6);
}
function limitsFromEnv(env = {}) {
  return {
    daily: parsePositiveUsd(env.ARTHUR_AI_DAILY_USD, DEFAULT_LIMITS_MICROUSD.daily),
    lifetime: parsePositiveUsd(env.ARTHUR_AI_LIFETIME_USD, DEFAULT_LIMITS_MICROUSD.lifetime),
    deepseekDaily: parsePositiveUsd(env.ARTHUR_DEEPSEEK_DAILY_USD, DEFAULT_LIMITS_MICROUSD.deepseekDaily),
    zaiDaily: parsePositiveUsd(env.ARTHUR_ZAI_DAILY_USD, DEFAULT_LIMITS_MICROUSD.zaiDaily),
    deepseekLifetime: parsePositiveUsd(env.ARTHUR_DEEPSEEK_LIFETIME_USD, DEFAULT_LIMITS_MICROUSD.deepseekLifetime),
    zaiLifetime: parsePositiveUsd(env.ARTHUR_ZAI_LIFETIME_USD, DEFAULT_LIMITS_MICROUSD.zaiLifetime),
  };
}

class PaidAiBudget {
  constructor({ directory, limits = DEFAULT_LIMITS_MICROUSD, now = () => new Date(), fsImpl = fs } = {}) {
    if (!directory || !path.isAbsolute(directory)) {
      throw error('AI_BUDGET_CONFIG_ERROR', 'An absolute persistent paid AI budget directory is required');
    }
    this.directory = directory;
    this.limits = limits;
    this.now = now;
    this.fs = fsImpl;
  }

  // Estimate a *maximum reservation*, not an authoritative provider bill.
  estimate(provider, body) {
    const p = PRICING[provider];
    if (!p || body?.stream !== false || !Array.isArray(body?.messages)) {
      throw error('AI_BUDGET_CONFIG_ERROR', 'Unsupported billed request');
    }
    const inputBytes = Buffer.byteLength(JSON.stringify(body.messages), 'utf8');
    if (inputBytes > MAX_INPUT_BYTES) {
      throw error('AI_BUDGET_EXHAUSTED', 'Paid AI input size limit reached');
    }
    const rawMax = Number(body.max_tokens ?? p.maxOutput);
    if (!Number.isInteger(rawMax) || rawMax <= 0) {
      throw error('AI_BUDGET_CONFIG_ERROR', 'Invalid paid AI token limit');
    }
    body.max_tokens = Math.min(rawMax, p.maxOutput);
    const assumedInputTokens = inputBytes + 1024;
    const estimatedMicroUsd = Math.ceil(
      RISK_MULTIPLIER * (
        assumedInputTokens * p.input + body.max_tokens * p.output
      )
    );
    return estimatedMicroUsd;
  }

  reserve(provider, microUsd) {
    const day = this.now().toISOString().slice(0, 10);
    const base = this.directory;
    const lock = path.join(base, '.lock');
    try {
      this.fs.mkdirSync(base, { recursive: true });
      this.fs.mkdirSync(lock); // atomic across workers; never break a possibly live lock
    } catch {
      throw error('AI_BUDGET_UNAVAILABLE', 'Paid AI usage registry unavailable');
    }
    try {
      let globalDaily=0, globalLifetime=0, providerDaily=0, providerLifetime=0;
      for (const f of this.fs.readdirSync(base)) {
        if (!/^r-[0-9a-f-]+\.json$/.test(f)) continue;
        const item = JSON.parse(this.fs.readFileSync(path.join(base,f), 'utf8'));
        if (
          !item || !['deepseek','zai'].includes(item.provider) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(item.day) ||
          !Number.isSafeInteger(item.microUsd) || item.microUsd <= 0
        ) throw new Error('Bad ledger record');
        globalLifetime += item.microUsd;
        if (item.provider === provider) providerLifetime += item.microUsd;
        if (item.day === day) {
          globalDaily += item.microUsd;
          if (item.provider === provider) providerDaily += item.microUsd;
        }
      }
      const l = this.limits;
      if (
        globalDaily + microUsd > l.daily ||
        globalLifetime + microUsd > l.lifetime ||
        providerDaily + microUsd > l[provider+'Daily'] ||
        providerLifetime + microUsd > l[provider+'Lifetime']
      ) {
        throw error('AI_BUDGET_EXHAUSTED', 'Paid AI budget reservation exhausted; use local Ollama');
      }
      // Never persist prompt text, API credentials, headers or response data.
      const rec = { provider, day, microUsd };
      const name = 'r-'+crypto.randomUUID()+'.json';
      this.fs.writeFileSync(path.join(base, name), JSON.stringify(rec), { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if (e?.code === 'AI_BUDGET_EXHAUSTED') throw e;
      throw error('AI_BUDGET_UNAVAILABLE', 'Paid AI usage registry error; use local Ollama');
    } finally {
      try { this.fs.rmdirSync(lock); } catch { /* fail closed on future admission */ }
    }
  }
}

function guardedFetch({ directory, limits, now, fetchImpl=fetch }) {
  const guard = new PaidAiBudget({ directory, limits, now });
  return async (url, request={}) => {
    if (request.method !== 'POST') return fetchImpl(url,request);
    const endpoint = new URL(url);
    const provider = endpoint.origin === 'https://api.deepseek.com' &&
      endpoint.pathname === '/chat/completions' ? 'deepseek' :
      endpoint.origin === 'https://api.z.ai' &&
      endpoint.pathname === '/api/paas/v4/chat/completions' ? 'zai' : null;
    if (!provider) throw error('AI_BUDGET_CONFIG_ERROR','Unexpected paid AI API endpoint');
    let body;
    try { body = JSON.parse(request.body); }
    catch { throw error('AI_BUDGET_CONFIG_ERROR','Unparseable paid AI request'); }
    const cost = guard.estimate(provider, body);
    guard.reserve(provider, cost);
    return fetchImpl(url, { ...request, body: JSON.stringify(body) });
  };
}

module.exports = { PaidAiBudget, guardedFetch, limitsFromEnv, DEFAULT_LIMITS_MICROUSD };
