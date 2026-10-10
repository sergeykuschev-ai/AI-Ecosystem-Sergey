#!/usr/bin/env node
/**
 * Read-only, opt-in development gate for the isolated Amursk agent-tools pilot.
 * No deployment, API calls, production data reads, or service management.
 * --run-tests is allowed only in CI or under a dedicated AgentToolsPilot checkout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PROJECTS = Object.freeze({
  purchasing: ['agents/purchasing', 'apps/purchasing-web-backend'],
  arthur: ['agents/arthur-core', 'agents/arthur-v1'],
  'business-kpi': ['agents/business-kpi', 'apps/business-kpi-web'],
  stores: ['apps/stores-web'],
  vozdooh: ['apps/vozdooh-web'],
});

export const REQUIRED_SKILLS = Object.freeze([
  '.agents/skills/ponytail/SKILL.md',
  '.agents/skills/test-driven-development/SKILL.md',
  '.agents/skills/code-review-and-quality/SKILL.md',
  '.agents/skills/security-and-hardening/SKILL.md',
  '.codex/skills/graphify/SKILL.md',
]);

export function summarizeGraph(file) {
  if (!fs.existsSync(file)) return { status: 'missing', nodes: 0, edges: 0 };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
  const edges = Array.isArray(parsed.edges) ? parsed.edges.length
    : Array.isArray(parsed.links) ? parsed.links.length : 0;
  return {
    status: nodes > 0 && edges > 0 ? 'ready' : 'empty',
    nodes,
    edges,
  };
}

export function inspectCandidate(root, project, { requireGraph = false, requireSkills = false } = {}) {
  if (!Object.hasOwn(PROJECTS, project)) {
    throw new Error('Unknown project: ' + project);
  }
  const checks = PROJECTS[project].map(directory => {
    const source = path.join(root, directory);
    return {
      directory,
      sourceExists: fs.existsSync(source) && fs.statSync(source).isDirectory(),
      graph: summarizeGraph(path.join(source, 'graphify-out', 'graph.json')),
    };
  });
  const skills = REQUIRED_SKILLS.map(file => ({
    file,
    found: fs.existsSync(path.join(root, file)),
  }));
  const problems = [];
  for (const c of checks) {
    if (!c.sourceExists) problems.push('Missing source directory: ' + c.directory);
    if (requireGraph && c.graph.status !== 'ready') {
      problems.push('Graph unavailable: ' + c.directory + ' (' + c.graph.status + ')');
    }
  }
  if (requireSkills) {
    for (const skill of skills) {
      if (!skill.found) problems.push('Skill not installed: ' + skill.file);
    }
  }
  return { project, ok: problems.length === 0, checks, skills, problems };
}

export function testFiles(root, project) {
  if (!Object.hasOwn(PROJECTS, project)) throw new Error('Unknown project: ' + project);
  const dirs = PROJECTS[project].map(dir => path.join(root, dir, 'tests'));
  return dirs.flatMap(dir => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(name => name.endsWith('.test.js'))
      .sort()
      .map(name => path.join(dir, name));
  });
}

function main(argv) {
  if (argv.includes('--help')) {
    console.log('Usage: node scripts/devtools/agent-quality-gate.mjs --project purchasing|arthur|business-kpi|stores|vozdooh [--require-graph] [--require-skills] [--run-tests]');
    return 0;
  }
  const index = argv.indexOf('--project');
  if (index < 0 || !argv[index + 1]) throw new Error('Missing --project');
  const known = ['--project', '--require-graph', '--require-skills', '--run-tests'];
  const extras = argv.filter((arg, i) => !(i === index + 1) && !known.includes(arg));
  if (extras.length) throw new Error('Unrecognized options: ' + extras.join(' '));
  const project = argv[index + 1];
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const report = inspectCandidate(root, project, {
    requireGraph: argv.includes('--require-graph'),
    requireSkills: argv.includes('--require-skills'),
  });
  if (argv.includes('--run-tests')) {
    // Never launch test suites implicitly against a live checkout.
    if (process.env.CI !== 'true' && !root.toLowerCase().includes('agenttoolspilot')) {
      throw new Error('--run-tests is restricted to CI or an isolated AgentToolsPilot checkout');
    }
    const files = testFiles(root, project);
    if (!files.length) {
      report.problems.push('No standalone Node test files found for ' + project);
    } else {
      const start = Date.now();
      const run = spawnSync(process.execPath, ['--test', ...files], {
        cwd: root,
        encoding: 'utf8',
        timeout: 180000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: 'test' },
      });
      report.tests = {
        executedFiles: files.length,
        elapsedMs: Date.now() - start,
        exitCode: run.status,
        passed: run.status === 0,
        outputTail: ((run.stdout || '') + '\n' + (run.stderr || '')).split(/\r?\n/).slice(-16),
      };
      if (run.status !== 0) report.problems.push('Regression tests failed');
    }
  }
  report.ok = report.problems.length === 0;
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error('GATE_ERROR: ' + error.message); process.exitCode = 2; }
}
