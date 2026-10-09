'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { PostgresArthurStore } = require('../../agents/arthur-core/services/postgres-store');
const { AsyncArthurCoreService } = require('../../agents/arthur-core/services/async-arthur-core-service');
const { createArthurHttpServer } = require('../../agents/arthur-core/http/create-server');
const { createArthurCoreClient } = require('../../agents/arthur-v1/skills/arthur-core/core_client');
const { runIsolatedDatabaseCheck } = require('./check-personal-notifications');

async function checkPersonalMemory(client) {
  const store = new PostgresArthurStore({ client });
  const fixedClock = () => new Date('2026-10-09T00:00:00Z');
  const service = new AsyncArthurCoreService({ store, clock: fixedClock });
  const ownerId = `memory-ci-${randomUUID()}`;
  const otherId = `memory-ci-${randomUUID()}`;
  for (const id of [ownerId, otherId]) {
    await service.createProfile({ id, name: 'Synthetic owner', timezone: 'Asia/Vladivostok', locale: 'ru-RU' });
  }
  const ctx = { actorId: ownerId, actorType: 'user' };
  const note = 'Английский по вторникам';
  const first = await service.managePersonalMemory(ownerId, 'remember', { text: note, sourceRef: 'telegram-update:1' }, ctx);
  assert.equal(first.status, 'saved');
  assert.equal((await service.listPersonalMemory(otherId)).length, 0);
  assert.equal((await service.listPersonalMemory(ownerId)).length, 1); // receipts are invisible
  assert.equal((await service.managePersonalMemory(ownerId, 'remember', { text: note }, ctx)).status, 'duplicate');
  const replacement = 'Английский по четвергам';
  const edit = await service.managePersonalMemory(ownerId, 'edit', { query: note, replacement, sourceRef: 'telegram-update:2' }, ctx);
  assert.equal(edit.status, 'updated');
  assert.equal(edit.record.key, first.record.key);
  assert.notEqual(edit.record.id, first.record.id);
  assert.equal((await service.listPersonalMemory(ownerId))[0].value.text, replacement);
  const restarted = new AsyncArthurCoreService({ store: new PostgresArthurStore({ client }), clock: fixedClock });
  assert.equal((await restarted.listPersonalMemory(ownerId))[0].value.text, replacement);
  assert.equal((await restarted.managePersonalMemory(ownerId, 'remember', { text: note, sourceRef: 'telegram-update:1' }, ctx)).status,
    'already_processed'); // an old delivery cannot resurrect an edited fact
  await restarted.managePersonalMemory(ownerId, 'remember', { text: 'Английский для путешествий' }, ctx);
  const ambiguous = await restarted.managePersonalMemory(ownerId, 'forget', { query: 'Английский' }, ctx);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal((await restarted.listPersonalMemory(ownerId)).length, 2);
  assert.equal((await restarted.managePersonalMemory(ownerId, 'forget', { query: replacement,
    expectedId: first.record.id }, ctx)).status, 'stale');
  const forgotten = await restarted.managePersonalMemory(ownerId, 'forget', { query: replacement, sourceRef: 'telegram-update:3' }, ctx);
  assert.equal(forgotten.status, 'forgotten');
  assert.equal((await restarted.listPersonalMemory(ownerId, 'четвергам')).length, 0);
  assert.equal((await restarted.managePersonalMemory(ownerId, 'forget', { query: 'Английский', sourceRef: 'telegram-update:3' }, ctx)).status,
    'already_processed');
  assert.equal((await restarted.listPersonalMemory(ownerId)).length, 1);
  await assert.rejects(restarted.managePersonalMemory('unknown', 'remember', { text: 'test' }, ctx), /not found/);
  const failing = new AsyncArthurCoreService({ store, clock: fixedClock });
  failing.audit = async () => { throw new Error('Synthetic audit failure'); };
  await assert.rejects(failing.managePersonalMemory(ownerId, 'remember', { text: 'Must roll back', sourceRef: 'telegram-update:4' }, ctx), /audit failure/);
  assert.equal((await service.listPersonalMemory(ownerId, 'Must roll back')).length, 0);
  assert.equal((await service.managePersonalMemory(ownerId, 'remember', { text: 'Retry after rollback', sourceRef: 'telegram-update:4' }, ctx)).status,
    'saved'); // failed transaction must not leave a processed receipt
  const server = createArthurHttpServer({ runtime: { service: restarted, async healthcheck() { return true; } }, apiToken: 'test-memory-token' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${url}/v1/personal-memory?ownerId=${ownerId}`)).status, 401);
    const api = createArthurCoreClient({ baseUrl: url, token: 'test-memory-token' });
    const data = await api.listPersonalMemory(ownerId, 'путешествий', ctx);
    assert.equal(data.records.length, 1);
    assert.equal((await api.listPersonalMemory(otherId, '', ctx)).total, 0);
    assert.equal((await api.managePersonalMemory(ownerId, 'remember', { text: 'API acceptance' }, ctx)).status, 'saved');
    assert.equal((await fetch(`${url}/v1/personal-memory`, { headers: { authorization: 'Bearer test-memory-token' } })).status, 400);
  } finally {
    server.close();
    await once(server, 'close');
  }
  return { status: 'PASS', restart: true, versioning: true, ownerIsolation: true, replayProtection: true, rollback: true, http: true };
}

if (require.main === module) runIsolatedDatabaseCheck(checkPersonalMemory).catch(error => {
  process.stderr.write(error.message + '\n'); process.exitCode = 1;
});
module.exports = { checkPersonalMemory };
