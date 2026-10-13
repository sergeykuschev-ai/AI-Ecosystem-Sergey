#!/usr/bin/env node
// Unified READ-ONLY job inventory for Arthur Codex shared queue + AgentControl.
// No queue submission, mutation, Telegram posting, or shell/CLI execution.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATES_CODEX = Object.freeze(['queued','running','needs_review','failed']);
const STATES_CONTROL = Object.freeze(['pending','running','approval','blocked','done','failed','quarantine']);
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const defaults = {
  controlRoot: 'C:\\AI\\AgentControl',
  codexRoot: 'C:\\AI-Ecosystem\\local-services\\arthur-codex-queue',
};

function safeJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}
function ageMinutes(value, at) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? Math.max(0, Math.round((at - time) / 60000)) : null;
}
function counts(allowed) {
  return Object.fromEntries(allowed.map(s => [s,0]));
}

export function inspectBridge({ controlRoot = defaults.controlRoot, codexRoot = defaults.codexRoot, now = Date.now() } = {}) {
  const problems=[];
  const control = { ...counts(STATES_CONTROL), codexEnabled:null, kimiEnabled:null };
  const configPath=path.join(controlRoot,'config','config.json');
  const cfg=safeJson(configPath);
  if (!cfg) problems.push('AgentControl config not readable');
  else {
    control.codexEnabled=cfg.codex?.enabled===true;
    control.kimiEnabled=cfg.kimi?.enabled===true;
    if (control.kimiEnabled) problems.push('Kimi still enabled in AgentControl routing');
    if (!control.codexEnabled) problems.push('Codex disabled in AgentControl routing');
  }
  for (const state of STATES_CONTROL) {
    const dir=path.join(controlRoot,'queue',state);
    if (!fs.existsSync(dir)) { problems.push('AgentControl directory unavailable: '+state); continue; }
    control[state]=fs.readdirSync(dir,{withFileTypes:true})
      .filter(f=>f.isFile()&&f.name.endsWith('.json')).length;
  }
  const codex={ ...counts(STATES_CODEX), total:0, oldestQueuedMinutes:null,
    oldestRunningMinutes:null, lastUpdated:null, projects:[], unknownState:0, malformed:0 };
  const tasksDir=path.join(codexRoot,'tasks');
  if (!fs.existsSync(path.join(codexRoot,'.arthur-codex-queue-ready'))) {
    problems.push('Arthur Codex shared queue marker missing');
  }
  if (!fs.existsSync(tasksDir)) {
    problems.push('Arthur Codex tasks directory unavailable');
  } else {
    const projects=new Set();
    for (const item of fs.readdirSync(tasksDir,{withFileTypes:true})) {
      if (!item.isFile() || !item.name.endsWith('.json') || !UUID_RE.test(item.name.slice(0,-5))) continue;
      const task=safeJson(path.join(tasksDir,item.name));
      if (!task || task.id!==item.name.slice(0,-5)) { codex.malformed++; continue; }
      codex.total++;
      if (!STATES_CODEX.includes(task.state)) { codex.unknownState++; continue; }
      codex[task.state]++;
      if (typeof task.project==='string' && /^[a-z][a-z0-9-]{0,32}$/.test(task.project)) projects.add(task.project);
      const age=ageMinutes(task.updatedAt,now);
      if (task.state==='queued' && age!==null) {
        codex.oldestQueuedMinutes=Math.max(codex.oldestQueuedMinutes ?? 0,age);
      }
      if (task.state==='running' && age!==null) {
        codex.oldestRunningMinutes=Math.max(codex.oldestRunningMinutes ?? 0,age);
      }
      if (Number.isFinite(Date.parse(task.updatedAt||'')) &&
          (!codex.lastUpdated || task.updatedAt>codex.lastUpdated)) codex.lastUpdated=task.updatedAt;
    }
    codex.projects=[...projects].sort();
    if (codex.malformed>0) problems.push('Arthur Codex queue has malformed records');
    if (codex.unknownState>0) problems.push('Arthur Codex queue has unknown job states');
    if ((codex.oldestRunningMinutes||0)>240) problems.push('Arthur Codex job running over four hours');
  }
  return {
    checkedAt:new Date(now).toISOString(),
    ok:problems.length===0,
    problems,
    control,
    codex,
    attention:{
      needsReview:codex.needs_review,
      codexFailed:codex.failed,
      controlApprovals:control.approval,
      controlFailed:control.failed,
      controlBlocked:control.blocked,
    },
    note:'Read-only inventory. Counts and scheduler exit codes are not proof of deployment.',
  };
}

function cli(argv) {
  const allowed=['--json','--strict'];
  if (argv.includes('--help')) {
    console.log('Usage: node scripts/devtools/arthur-agent-bridge-status.mjs [--json] [--strict]');
    return 0;
  }
  const unexpected=argv.filter(x=>!allowed.includes(x));
  if (unexpected.length) throw new Error('Unexpected arguments: '+unexpected.join(' '));
  const result=inspectBridge();
  console.log(JSON.stringify(result,null,2));
  return argv.includes('--strict')&&!result.ok?1:0;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { process.exitCode=cli(process.argv.slice(2)); }
  catch (error) { console.error('BRIDGE_STATUS_ERROR '+error.message);process.exitCode=2; }
}
