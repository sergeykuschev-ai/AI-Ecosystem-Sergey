'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskBriefingService, positiveLimit } = require('../services/task-briefing-service');
const { TaskListingPostgresStore } = require('../services/task-listing-postgres-store');

function serviceWith(tasks) {
  const store = {
    transaction: async work => work(store),
    async getProfile(ownerId) {
      return ownerId === 'sergey'
        ? { id: ownerId, name: 'Сергей', timezone: 'Asia/Vladivostok', locale: 'ru-RU' }
        : null;
    },
    async listTasks(ownerId, filter) {
      return tasks.filter(task => task.ownerId === ownerId).filter(task => {
        if (!filter.includeCompleted && ['done', 'cancelled'].includes(task.status)) return false;
        if (filter.status && task.status !== filter.status) return false;
        if (filter.domain && task.domain !== filter.domain) return false;
        if (filter.dueBefore && task.dueAt && task.dueAt > filter.dueBefore) return false;
        if (filter.dueAfter && task.dueAt && task.dueAt < filter.dueAfter) return false;
        return true;
      }).slice(0, filter.limit);
    }
  };
  return new TaskBriefingService({ store, clock: () => new Date('2026-07-30T08:00:00.000Z') });
}

test('listTasks validates filters and excludes completed by default', async () => {
  const service = serviceWith([
    { id: '1', ownerId: 'sergey', domain: 'business', status: 'new', dueAt: '2026-07-30T09:00:00.000Z' },
    { id: '2', ownerId: 'sergey', domain: 'business', status: 'done', dueAt: '2026-07-30T07:00:00.000Z' }
  ]);
  const tasks = await service.listTasks('sergey', { domain: 'business' });
  assert.deepEqual(tasks.map(task => task.id), ['1']);
  await assert.rejects(() => service.listTasks('sergey', { limit: 0 }), /limit/);
  assert.equal(positiveLimit('200'), 200);
});

test('listTasks keeps cancelled task history available when explicitly requested', async () => {
  const service = serviceWith([
    { id: 'real', ownerId: 'sergey', domain: 'business', status: 'new' },
    {
      id: 'c8de972c-28c3-472c-a8f5-0bd97c0405db', ownerId: 'sergey',
      domain: 'system', status: 'cancelled',
      title: 'TEST Codex Arthur n8n E2E 2026-07-30 16:24'
    },
    {
      id: 'a58f60b1-8f79-43c4-ad2a-710d9b7ec6c6', ownerId: 'sergey',
      domain: 'system', status: 'cancelled',
      title: 'TEST Codex Arthur n8n E2E post-import 2026-07-31 0032'
    },
    {
      id: 'ac253be5-e890-43fc-8b50-e88415b79694', ownerId: 'sergey',
      domain: 'system', status: 'cancelled',
      title: 'CONTROL Arthur n8n production active 2026-07-31 0054'
    }
  ]);

  assert.deepEqual((await service.listTasks('sergey')).map(task => task.id), ['real']);
  assert.deepEqual(
    (await service.listTasks('sergey', { includeCompleted: true })).map(task => task.id),
    [
      'real',
      'c8de972c-28c3-472c-a8f5-0bd97c0405db',
      'a58f60b1-8f79-43c4-ad2a-710d9b7ec6c6',
      'ac253be5-e890-43fc-8b50-e88415b79694'
    ]
  );
});

test('taskBrief separates today overdue upcoming and waiting tasks in owner timezone', async () => {
  const service = serviceWith([
    { id: 'overdue', ownerId: 'sergey', domain: 'personal', status: 'new', dueAt: '2026-07-30T07:00:00.000Z' },
    { id: 'upcoming', ownerId: 'sergey', domain: 'business', status: 'planned', dueAt: '2026-07-30T12:00:00.000Z' },
    { id: 'waiting', ownerId: 'sergey', domain: 'travel', status: 'waiting', dueAt: null },
    { id: 'later', ownerId: 'sergey', domain: 'business', status: 'planned', dueAt: '2026-08-03T12:00:00.000Z' }
  ]);
  const brief = await service.taskBrief('sergey', { horizonHours: 24 });
  assert.equal(brief.timezone, 'Asia/Vladivostok');
  assert.deepEqual(brief.today.map(task => task.id), ['overdue', 'upcoming']);
  assert.deepEqual(brief.overdue.map(task => task.id), ['overdue']);
  assert.deepEqual(brief.upcoming.map(task => task.id), ['upcoming']);
  assert.deepEqual(brief.waiting.map(task => task.id), ['waiting']);
  assert.equal(brief.total, 4);
});

test('PostgreSQL task listing remains parameterized', async () => {
  const calls = [];
  const client = { async query(text, values) { calls.push({ text, values }); return { rows: [] }; } };
  const store = new TaskListingPostgresStore({ client });
  await store.listTasks('sergey', { status: 'new', domain: 'business', dueBefore: '2026-08-01T00:00:00.000Z', limit: 25 });
  assert.match(calls[0].text, /p\.external_id=\$1/);
  assert.match(calls[0].text, /t\.status=\$2/);
  assert.deepEqual(calls[0].values, ['sergey', 'new', 'business', '2026-08-01T00:00:00.000Z', 25]);
});

test('PostgreSQL default listing excludes terminal tasks without deleting history', async () => {
  const calls = [];
  const client = { async query(text, values) { calls.push({ text, values }); return { rows: [] }; } };
  const store = new TaskListingPostgresStore({ client });

  await store.listTasks('sergey', { includeCompleted: false, limit: 50 });
  await store.listTasks('sergey', { includeCompleted: true, limit: 50 });

  assert.match(calls[0].text, /t\.status NOT IN \('done','cancelled'\)/);
  assert.doesNotMatch(calls[1].text, /t\.status NOT IN/);
});
