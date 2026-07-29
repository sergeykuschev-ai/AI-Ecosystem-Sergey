'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PostgresArthurStore, mapProfile, mapCommon } = require('../services/postgres-store');

class FakeClient {
  constructor() {
    this.calls = [];
    this.rows = [];
    this.released = false;
  }

  async query(text, values = []) {
    this.calls.push({ text, values });
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    return { rows: this.rows.length ? [this.rows.shift()] : [] };
  }

  async connect() {
    return this;
  }

  release() {
    this.released = true;
  }
}

test('maps PostgreSQL rows to service records', () => {
  assert.deepEqual(mapProfile({
    external_id: 'sergey', name: 'Сергей', timezone: 'Europe/Paris', locale: 'ru-RU',
    preferred_channel: 'telegram', active: true, created_at: 'c', updated_at: 'u'
  }), {
    id: 'sergey', name: 'Сергей', timezone: 'Europe/Paris', locale: 'ru-RU',
    preferredChannel: 'telegram', active: true, createdAt: 'c', updatedAt: 'u'
  });
  assert.deepEqual(mapCommon({ value_json: { a: 1 }, owner_id: 'sergey' }), {
    value: { a: 1 }, ownerId: 'sergey'
  });
});

test('profile upsert uses external id and parameterized SQL', async () => {
  const client = new FakeClient();
  client.rows.push({
    external_id: 'sergey', name: 'Сергей', timezone: 'Europe/Paris', locale: 'ru-RU',
    preferred_channel: null, active: true, created_at: 'c', updated_at: 'u'
  });
  const store = new PostgresArthurStore({ client });
  const profile = await store.putProfile({
    id: 'sergey', name: 'Сергей', timezone: 'Europe/Paris', locale: 'ru-RU',
    active: true, createdAt: 'c', updatedAt: 'u'
  });
  assert.equal(profile.id, 'sergey');
  assert.match(client.calls[0].text, /ON CONFLICT \(external_id\)/);
  assert.equal(client.calls[0].values[0], 'sergey');
});

test('memory queries resolve owner by profile external id', async () => {
  const client = new FakeClient();
  client.rows.push({ id: 'm1', owner_id: 'sergey', value_json: { hours: '09-19' } });
  const store = new PostgresArthurStore({ client });
  const record = await store.putMemory({
    id: 'm1', ownerId: 'sergey', domain: 'business', type: 'fact', key: 'hours',
    value: { hours: '09-19' }, sourceType: 'user', confidence: 1,
    createdAt: '2026-07-30T00:00:00Z', updatedAt: '2026-07-30T00:00:00Z'
  });
  assert.equal(record.ownerId, 'sergey');
  assert.match(client.calls[0].text, /SELECT id FROM arthur_profiles WHERE external_id=\$2/);
  assert.deepEqual(record.value, { hours: '09-19' });
});

test('task and confirmation writes use upsert without changing payload fingerprint', async () => {
  const client = new FakeClient();
  client.rows.push({ id: 't1', status: 'new', source_type: 'n8n', source_ref: 'webhook-1' });
  client.rows.push({ id: 'c1', status: 'pending', payload_json: { amount: 13500 }, payload_fingerprint: 'x'.repeat(64) });
  const store = new PostgresArthurStore({ client });
  const task = await store.putTask({
    id: 't1', ownerId: 'sergey', domain: 'business', title: 'Проверить Min/Max',
    status: 'new', priority: 'normal', sourceType: 'n8n', sourceRef: 'webhook-1',
    createdAt: 'c', updatedAt: 'u'
  });
  const confirmation = await store.putConfirmation({
    id: 'c1', ownerId: 'sergey', domain: 'finance', skillId: 'purchasing',
    actionType: 'payment.prepare', risk: 'high', status: 'pending',
    payload: { amount: 13500 }, payloadFingerprint: 'x'.repeat(64), createdAt: 'c', updatedAt: 'u'
  });
  assert.match(client.calls[0].text, /INSERT INTO arthur_tasks/);
  assert.match(client.calls[0].text, /source_type/);
  assert.equal(client.calls[0].values[11], 'n8n');
  assert.equal(client.calls[0].values[12], 'webhook-1');
  assert.equal(task.sourceType, 'n8n');
  assert.match(client.calls[1].text, /payload_fingerprint/);
  assert.equal(confirmation.payloadFingerprint, 'x'.repeat(64));
});

test('transaction commits success and rolls back failure', async () => {
  const successClient = new FakeClient();
  const successStore = new PostgresArthurStore({ client: successClient });
  const value = await successStore.transaction(async () => 42);
  assert.equal(value, 42);
  assert.deepEqual(successClient.calls.map(call => call.text), ['BEGIN', 'COMMIT']);

  const failureClient = new FakeClient();
  const failureStore = new PostgresArthurStore({ client: failureClient });
  await assert.rejects(
    failureStore.transaction(async () => { throw new Error('boom'); }),
    /boom/
  );
  assert.deepEqual(failureClient.calls.map(call => call.text), ['BEGIN', 'ROLLBACK']);
});

test('audit writes and filters remain parameterized', async () => {
  const client = new FakeClient();
  client.rows.push({ id: 'a1', entity_id: 't1', correlation_id: '00000000-0000-0000-0000-000000000001' });
  client.rows.push({ id: 'a1', entity_id: 't1' });
  const store = new PostgresArthurStore({ client });
  await store.appendAudit({
    id: 'a1', actorId: 'sergey', actorType: 'user', domain: 'business', action: 'task.create',
    entityType: 'task', entityId: 't1', correlationId: '00000000-0000-0000-0000-000000000001',
    result: 'success', createdAt: 'c'
  });
  await store.listAudit({ entityId: 't1' });
  assert.match(client.calls[0].text, /INSERT INTO arthur_audit_events/);
  assert.match(client.calls[1].text, /entity_id=\$1/);
  assert.deepEqual(client.calls[1].values, ['t1']);
});
