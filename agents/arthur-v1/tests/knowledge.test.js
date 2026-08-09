'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { createKnowledgeService } = require('../knowledge/knowledge_service');
const { isExcluded } = require('../knowledge/indexer');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arthur-knowledge-'));
}

test('isExcluded rejects operational and transient files', () => {
  assert.equal(isExcluded('output/purchasing/run.json'), true);
  assert.equal(isExcluded('tmp/state.tmp'), true);
  assert.equal(isExcluded('data/purchasing/owner-decision-history.json'), true);
  assert.equal(isExcluded('data/purchasing/miska-owner-decisions.json'), true);
  assert.equal(isExcluded('docs/architecture.md'), false);
});

test('buildIndex indexes markdown files', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'rule.md'), '# Правило\nНе заказывать TEST автоматически.');
  fs.writeFileSync(path.join(dir, 'matrix.json'), '{"sku":"A","status":"CORE"}');

  const service = createKnowledgeService({ directories: [dir] });
  const result = await service.buildIndex();
  assert.equal(result.entryCount, 2);

  const docs = await service.search({ topic: 'Правило', limit: 10 });
  assert.equal(docs.entries.length, 1);
  assert.equal(docs.entries[0].title, 'rule.md');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('search filters by tags', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'matrix.md'), '# Matrix\nCore items.');
  fs.writeFileSync(path.join(dir, 'guide.md'), '# Guide\nHow to review.');

  const service = createKnowledgeService({ directories: [dir] });
  await service.buildIndex();
  const result = await service.search({ topic: 'Matrix', tags: ['matrix'], limit: 10 });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].title, 'matrix.md');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('getDocument returns document by id', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'adr.md'), '# ADR\nUse PostgreSQL.');

  const service = createKnowledgeService({ directories: [dir] });
  await service.buildIndex();
  const doc = await service.getDocument('adr.md');
  assert.ok(doc);
  assert.equal(doc.title, 'adr.md');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('operational JSON files are not indexed automatically', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'owner-decision-history.json'), '{"decisions":[]}');
  fs.writeFileSync(path.join(dir, 'miska-owner-decisions.json'), '{"decisions":[]}');

  const service = createKnowledgeService({ directories: [dir] });
  const result = await service.buildIndex();
  assert.equal(result.entryCount, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});
