import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectCandidate, summarizeGraph, testFiles, REQUIRED_SKILLS, PROJECTS } from './agent-quality-gate.mjs';

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('missing graph is reported without throwing, and strict mode blocks it', t => {
  const root = tempRoot(t);
  for (const directory of PROJECTS.arthur) fs.mkdirSync(path.join(root, directory), { recursive: true });
  const basic = inspectCandidate(root, 'arthur');
  assert.equal(basic.ok, true);
  assert.equal(basic.checks[0].graph.status, 'missing');
  const strict = inspectCandidate(root, 'arthur', { requireGraph: true });
  assert.equal(strict.ok, false);
  assert.equal(strict.problems.length, 2);
});

test('graph readiness depends on nonempty nodes and edges', t => {
  const root = tempRoot(t);
  const graph = path.join(root, 'graph.json');
  assert.equal(summarizeGraph(graph).status, 'missing');
  fs.writeFileSync(graph, JSON.stringify({ nodes: [{ id: 'a' }], links: [] }));
  assert.equal(summarizeGraph(graph).status, 'empty');
  fs.writeFileSync(graph, JSON.stringify({ nodes: [{ id: 'a' }], edges: [{ source: 'a', target: 'b' }] }));
  assert.deepEqual(summarizeGraph(graph), { status: 'ready', nodes: 1, edges: 1 });
});

test('required skills and source paths are explicit', t => {
  const root = tempRoot(t);
  for (const directory of PROJECTS.purchasing) {
    const source = path.join(root, directory);
    fs.mkdirSync(path.join(source, 'graphify-out'), { recursive: true });
    fs.writeFileSync(path.join(source, 'graphify-out', 'graph.json'), JSON.stringify({
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }],
    }));
  }
  for (const file of REQUIRED_SKILLS) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '# Skill\n');
  }
  const status = inspectCandidate(root, 'purchasing', { requireGraph: true, requireSkills: true });
  assert.equal(status.ok, true);
  assert.equal(status.checks.length, 2);
  assert.equal(status.skills.length, 5);
});

test('test discovery reads only a project test directory', t => {
  const root = tempRoot(t);
  const dir = path.join(root, 'agents', 'purchasing', 'tests');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'safe.test.js'), '');
  fs.writeFileSync(path.join(dir, 'notes.txt'), '');
  assert.deepEqual(testFiles(root, 'purchasing'), [path.join(dir, 'safe.test.js')]);
  assert.throws(() => inspectCandidate(root, '../other'), /Unknown project/);
});
