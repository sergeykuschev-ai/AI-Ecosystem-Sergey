#!/usr/bin/env node
/**
 * Optional, read-only A/B benchmark on isolated Amursk checkouts.
 * Runs the same code-investigation prompt with Codex through an existing
 * process-local SSH proxy. No production writes or global configuration.
 * Only run explicitly with --run. Store logs locally, never commit them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pilotRoot = path.dirname(repo);
const baseline = path.join(pilotRoot, 'AI-Ecosystem-Baseline');
const outputs = path.join(pilotRoot, 'comparison');
const proxy = 'http://127.0.0.1:8443';
const prompt = [
  'Read-only code investigation for the purchasing module:',
  'identify the function that builds supplier-order XLSX files,',
  'the related HTTP artifact/download paths, and relevant regression tests.',
  'Cite exact source file paths and functions; mention one Windows file-I/O risk.',
  'Do not edit files, run services, open customer data, or make network requests.',
  'Answer in Russian within 220 words.',
].join(' ');

function version() {
  const p = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 10000 });
  return (p.stdout || '').trim() || 'unknown';
}

function runOne(label, cwd) {
  return new Promise(resolve => {
    const env = {
      ...process.env,
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      ALL_PROXY: proxy,
    };
    const started = Date.now();
    const events = [];
    let out = '';
    let err = '';
    let timeout = false;
    const child = spawn('codex', [
      'exec', '-s', 'read-only', '--ephemeral', '--json', '-C', cwd, prompt,
    ], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdin.end();
    const timer = setTimeout(() => {
      timeout = true;
      child.kill();
    }, 120000);
    child.stdout.on('data', b => { if (out.length < 400000) out += b.toString('utf8'); });
    child.stderr.on('data', b => { if (err.length < 20000) err += b.toString('utf8'); });
    child.on('error', e => { err += '\n' + e.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let usage = null;
      let answer = '';
      let failure = '';
      for (const line of out.split(/\r?\n/)) {
        try {
          const evt = JSON.parse(line);
          events.push(evt.type);
          if (evt.type === 'turn.completed') usage = evt.usage || null;
          if (evt.type === 'turn.failed') failure = String(evt.error?.message || 'turn.failed');
          if (evt.type === 'item.completed' && evt.item?.type === 'agent_message') {
            answer += (evt.item.text || '') + '\n';
          }
        } catch {}
      }
      // Keep only summary counts, not raw model output or credentials, in the report.
      resolve({
        label,
        elapsedMs: Date.now() - started,
        exitCode: code,
        signal,
        timeout,
        completed: code === 0 && events.includes('turn.completed'),
        modelUsage: usage,
        answerChars: answer.length,
        citedOrderSource: answer.includes('supplier_order.js'),
        citedTests: /\.test\.js/.test(answer),
        failure: code === 0 ? null : (failure ? failure.slice(0, 180) : err.slice(-250)),
        nonfatalWarnings: code === 0 && err.trim().length ? err.trim().slice(-250) : null,
      });
    });
  });
}

async function main() {
  if (!process.argv.includes('--run')) {
    console.log('Read-only preflight only. Supply --run to benchmark Codex through the existing proxy.');
    console.log(JSON.stringify({ pilot: fs.existsSync(repo), baseline: fs.existsSync(baseline), modelClient: version() }));
    return;
  }
  if (!process.platform.startsWith('win') || !repo.toLowerCase().includes('agenttoolspilot')) {
    throw new Error('Only the isolated Amursk Windows pilot may run this benchmark.');
  }
  if (!fs.existsSync(baseline) || !fs.existsSync(path.join(repo, '.agents', 'skills'))) {
    throw new Error('Missing separated control / pilot checkouts.');
  }
  const first = await runOne('baseline', baseline);
  const results = [first];
  if (first.completed) results.push(await runOne('pilot', repo));
  fs.mkdirSync(outputs, { recursive: true });
  const report = { at: new Date().toISOString(), clientVersion: version(), readOnly: true, proxy: 'localhost:8443', results };
  fs.writeFileSync(path.join(outputs, 'agent-tools-ab-summary.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!results.every(r => r.completed)) process.exitCode = 1;
}
main().catch(error => { console.error('BENCHMARK_ERROR: ' + error.message); process.exitCode = 2; });
