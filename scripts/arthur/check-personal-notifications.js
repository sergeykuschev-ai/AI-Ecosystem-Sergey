'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PostgresArthurStore } = require('../../agents/arthur-core/services/postgres-store');
const { AsyncArthurCoreService } = require('../../agents/arthur-core/services/async-arthur-core-service');
const { createPersonalNotificationStore } = require('../../agents/arthur-core/services/personal-notification-store');
const { PersonalScheduler } = require('../../agents/arthur-v1/telegram/personal_scheduler');

async function checkPersonalNotifications(client) {
  const store = new PostgresArthurStore({ client });
  const service = new AsyncArthurCoreService({ store });
  const ownerId = `personal-ci-${randomUUID()}`;
  const otherId = `personal-ci-${randomUUID()}`;
  await service.createProfile({ id: ownerId, name: 'Synthetic owner', timezone: 'Asia/Vladivostok', locale: 'ru-RU' });
  await service.createProfile({ id: otherId, name: 'Synthetic other owner', timezone: 'Asia/Vladivostok', locale: 'ru-RU' });
  let now = new Date('2026-10-09T00:00:00Z');
  const base = { domain: 'personal', title: 'Synthetic reminder', dueAt: now.toISOString(), remindAt: now.toISOString() };
  const task = await service.createTask({ ...base, ownerId });
  await service.createTask({ ...base, ownerId: otherId });
  await service.createTask({ ...base, ownerId, domain: 'business' });
  const deliveries = createPersonalNotificationStore(client);
  const active = await deliveries.listTasks(ownerId);
  assert.equal(active.length, 1);
  assert.equal(active[0].remindAt, base.remindAt);
  await assert.rejects(deliveries.initialize('unknown-owner'), /owner profile/);
  const key = 'lease-test';
  const claim = await deliveries.claim(ownerId, key, now.toISOString());
  assert.ok(claim);
  assert.equal(await deliveries.claim(ownerId, key, now.toISOString()), null);
  await deliveries.retry(ownerId, key, claim, now.toISOString());
  assert.equal(await deliveries.claim(ownerId, key, now.toISOString()), null);
  now = new Date('2026-10-09T00:01:00Z');
  const nextClaim = await deliveries.claim(ownerId, key, now.toISOString());
  assert.ok(nextClaim);
  await assert.rejects(deliveries.finish(ownerId, key, claim, now.toISOString(), 1), /lease was lost/);
  await deliveries.finish(ownerId, key, nextClaim, now.toISOString(), 2);
  assert.equal(await deliveries.claim(ownerId, key, '2026-10-10T00:00:00Z'), null);
  const sent = [];
  const schedulerOptions = {
    config: { reminders: true, morning: { enabled: true, time: '09:00' },
      evening: { enabled: true, time: '21:00' }, quietStart: '22:00', quietEnd: '08:00' },
    store: deliveries, ownerId, chatId: 'synthetic', clock: () => now,
    telegram: { async sendMessage(chatId, text) { sent.push(text); return { ok: true, result: { message_id: sent.length } }; } },
  };
  const scheduler = new PersonalScheduler(schedulerOptions);
  await scheduler.initialize();
  await scheduler.tick();
  assert.equal(scheduler.lastError, null);
  assert.equal(sent.length, 2);
  const restarted = new PersonalScheduler(schedulerOptions);
  await restarted.initialize();
  await restarted.tick();
  assert.equal(sent.length, 2);
  const moved = await service.transitionTask(ownerId, task.id, 'new', { dueAt: '2026-10-09T01:00:00Z' });
  assert.equal(moved.remindAt, '2026-10-09T01:00:00Z');
  now = new Date('2026-10-09T01:00:00Z');
  await restarted.tick();
  assert.equal(sent.length, 3);
  await service.transitionTask(ownerId, task.id, 'done');
  assert.equal((await deliveries.listTasks(ownerId)).length, 0);
  const lease = await deliveries.claim(ownerId, 'expired-worker', now.toISOString());
  assert.ok(lease);
  const recovered = await deliveries.claim(ownerId, 'expired-worker', '2026-10-09T01:06:00Z');
  assert.ok(recovered);
  assert.notEqual(recovered, lease);
  return { status: 'PASS', deliveries: sent.length, ownerIsolation: true, restart: true, leaseRecovery: true };
}

async function main() {
  const url = process.env.ARTHUR_DATABASE_URL || '';
  if (!/test|ci/.test(new URL(url).pathname)) throw new Error('A dedicated test/ci database is required');
  const { Client } = require('pg');
  const db = new Client({ connectionString: url });
  await db.connect();
  const schema = `personal_ci_${randomUUID().replace(/-/g, '')}`;
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}, public`);
    const dir = path.join(__dirname, '../../data/arthur/migrations');
    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.up.sql')).sort()) {
      await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
    // Hide Client.connect from the transactional adapter: this connection is already open.
    const adapter = { query: (sql, values) => db.query(sql, values) };
    process.stdout.write(JSON.stringify(await checkPersonalNotifications(adapter)) + '\n');
    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.down.sql')).sort().reverse()) {
      await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  }
}

if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { checkPersonalNotifications };
