'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PersonalScheduler, briefText } = require('../telegram/personal_scheduler');
const { loadConfig, validateConfig } = require('../telegram/config');
const { parseCreateTasksRequest } = require('../planner/task_request_parser');
const { createArthurCoreSkill } = require('../skills/arthur-core/arthur_core_skill');

const NOW = '2026-10-09T00:00:00.000Z'; // 10:00 Vladivostok
const config = {
  reminders: true, morning: { enabled: true, time: '09:00' },
  evening: { enabled: true, time: '21:00' }, quietStart: '22:00', quietEnd: '08:00',
};

function harness() {
  let now = new Date(NOW);
  const tasks = [{ id: 't1', title: 'Забрать <посылку>', domain: 'personal', status: 'new',
    dueAt: NOW, remindAt: NOW }];
  const ledger = new Map();
  const sent = [];
  let fail = false;
  const store = {
    async initialize(owner) { assert.equal(owner, 'sergey'); return { timezone: 'Asia/Vladivostok' }; },
    async listTasks(owner) {
      assert.equal(owner, 'sergey');
      return tasks.filter(task => task.domain === 'personal' && !['done', 'cancelled'].includes(task.status));
    },
    async claim(owner, key) {
      const entry = ledger.get(key);
      if (entry && (entry.state === 'sent' || entry.until > now.getTime())) return null;
      const claim = `${key}:${now.toISOString()}`;
      ledger.set(key, { state: 'sending', until: now.getTime() + 300000, claim });
      return claim;
    },
    async finish(owner, key, claim) {
      assert.equal(ledger.get(key).claim, claim);
      ledger.set(key, { state: 'sent' });
    },
    async retry(owner, key) { ledger.set(key, { state: 'retry', until: now.getTime() + 60000 }); },
  };
  const telegram = { async sendMessage(chat, text) {
    assert.equal(chat, '111');
    if (fail) throw new Error('Telegram offline');
    sent.push(text);
    return { ok: true, result: { message_id: sent.length } };
  } };
  const create = () => new PersonalScheduler({ store, telegram, ownerId: 'sergey', chatId: '111',
    config, clock: () => now });
  return { create, tasks, ledger, sent, setTime(value) { now = new Date(value); }, setFail(value) { fail = value; } };
}

test('explicit reminders require an exact future time; deadlines alone are not reminders', () => {
  const options = { now: new Date(NOW), timezone: 'Asia/Vladivostok' };
  const parsed = parseCreateTasksRequest('Напомни в 16:00 забрать заказ', options);
  assert.equal(parsed.tasks[0].remindAt, '2026-10-09T06:00:00.000Z');
  assert.equal(parsed.tasks[0].title, 'Забрать заказ');
  assert.equal(parseCreateTasksRequest('Запиши на сегодня забрать заказ', options).tasks[0].remindAt, undefined);
  for (const message of ['Напомни завтра забрать заказ', 'Напомни сегодня в 09:00 забрать заказ',
    'Напомни каждый день в 16:00 забрать заказ',
    'Напомни сегодня в 16:00\nЗабрать заказ\nСпортзал']) {
    assert.equal(parseCreateTasksRequest(message, options).ok, false);
  }
});

test('restart and concurrent schedulers share delivery keys and do not resend confirmed messages', async () => {
  const h = harness();
  const first = h.create();
  const second = h.create();
  await first.initialize();
  await second.initialize();
  await Promise.all([first.tick(), first.tick(), second.tick()]);
  assert.equal(h.sent.length, 2); // reminder and morning
  assert.match(h.sent[0], /&lt;посылку&gt;/);
  const restarted = h.create();
  await restarted.initialize();
  await restarted.tick();
  assert.equal(h.sent.length, 2);
  h.setTime('2026-10-09T11:05:00Z');
  await restarted.tick();
  assert.equal(h.sent.length, 3);
  assert.match(h.sent[2], /вечерний обзор/);
});

test('delivery failure retries after backoff without marking sent', async () => {
  const h = harness();
  const scheduler = h.create();
  await scheduler.initialize();
  h.setFail(true);
  await scheduler.tick();
  assert.equal(h.sent.length, 0);
  assert.equal(scheduler.lastError, 'Error');
  h.setFail(false);
  await scheduler.tick();
  assert.equal(h.sent.length, 0);
  h.setTime('2026-10-09T00:01:00Z');
  await scheduler.tick();
  assert.equal(h.sent.length, 2);
  assert.equal(scheduler.lastError, null);
});

test('quiet hours defer reminders; cancelled tasks and business tasks are excluded', async () => {
  const h = harness();
  h.setTime('2026-10-08T23:00:00Z'); // 09:00
  h.tasks[0].remindAt = '2026-10-08T15:00:00Z'; // 01:00 local, overdue
  h.tasks.push({ id: 'biz', title: 'Private business item', domain: 'business', status: 'new', remindAt: NOW });
  const scheduler = h.create();
  await scheduler.initialize();
  h.setTime('2026-10-08T15:00:00Z');
  await scheduler.tick();
  assert.equal(h.sent.length, 0);
  h.setTime(NOW);
  await scheduler.tick();
  assert.equal(h.sent.length, 2);
  assert.ok(h.sent.every(text => !text.includes('Private business item')));
  h.tasks[0].status = 'cancelled';
  h.tasks[0].remindAt = '2026-10-09T00:01:00Z';
  h.setTime('2026-10-09T00:02:00Z');
  await scheduler.tick();
  assert.equal(h.sent.length, 2);
});

test('rescheduling uses a new reminder occurrence key; old occurrence is not resent', async () => {
  const h = harness();
  const scheduler = h.create();
  await scheduler.initialize();
  await scheduler.tick();
  h.tasks[0].remindAt = '2026-10-09T01:00:00Z';
  await scheduler.tick();
  assert.equal(h.sent.length, 2);
  h.setTime('2026-10-09T01:00:00Z');
  await scheduler.tick();
  assert.equal(h.sent.length, 3);
});

test('briefing includes due tasks, waiting checks and unscheduled tasks with a bounded length', () => {
  const tasks = Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, title: '<'.repeat(500), dueAt: NOW }));
  tasks.push({ id: 'wait', title: 'Жду ответ', status: 'waiting', nextCheckAt: NOW });
  tasks.push({ id: 'undated', title: 'Без даты' });
  const text = briefText(tasks, new Date(NOW), 'Asia/Vladivostok', false);
  // Escaping can expand titles, so account for the Telegram transport limit.
  assert.match(text, /Ещё 32/);
  assert.ok(text.includes('&lt;'));
  assert.ok(text.length < 4096);
});

test('personal scheduler config is opt-in and validates times and owner access', () => {
  const env = { TELEGRAM_BOT_TOKEN: '123:test', TELEGRAM_ALLOWED_USER_IDS: '111',
    ARTHUR_OWNER_PROFILE_ID: 'sergey', ARTHUR_CORE_BASE_URL: 'http://core.test', ARTHUR_CORE_TOKEN: 'test' };
  assert.equal(loadConfig(env).personalAutomation.enabled, false);
  const valid = loadConfig({ ...env, ARTHUR_PERSONAL_ENABLED: 'true' });
  assert.equal(validateConfig(valid).valid, true);
  assert.equal(validateConfig(loadConfig({ ...env, ARTHUR_PERSONAL_ENABLED: 'true',
    ARTHUR_PERSONAL_MORNING_TIME: '25:00' })).valid, false);
  assert.equal(validateConfig(loadConfig({ ...env, ARTHUR_PERSONAL_ENABLED: 'true',
    TELEGRAM_ALLOWED_USER_IDS: '111,222' })).valid, false);
});

test('disabled reminders never write; adding a reminder to an existing task updates it', async () => {
  const task = { id: 't1', title: 'Забрать заказ', status: 'new', dueAt: NOW };
  const writes = [];
  const client = {
    async getProfile() {}, async getTaskBrief() {}, async health() {},
    async listTasks() { return [task]; },
    async createTask() { throw new Error('Must not create duplicate task'); },
    async transitionTask(owner, id, status, patch) { writes.push(patch); return { ...task, ...patch }; },
  };
  const input = { operation: 'createTask', parameters: { title: task.title, dueAt: NOW, remindAt: NOW } };
  const disabled = createArthurCoreSkill({ client, ownerProfileId: 'sergey' });
  assert.match((await disabled.execute(input)).data.responseText, /ещё не включены/);
  assert.equal(writes.length, 0);
  const enabled = createArthurCoreSkill({ client, ownerProfileId: 'sergey', remindersEnabled: true });
  const result = await enabled.execute(input);
  assert.equal(result.data.status, 'reminder_scheduled');
  assert.deepEqual(writes, [{ remindAt: NOW }]);
});
