'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { detectIntent, INTENTS } = require('../planner/intents');
const { parseCreateTasksRequest } = require('../planner/task_request_parser');
const { createRuleBasedPlanBuilder } = require('../planner/plan_builder');
const { createSkillRegistry } = require('../registry/skill_registry');
const { createArthurCoreSkill } = require('../skills/arthur-core/arthur_core_skill');
const { createOrchestrator } = require('../orchestrator/orchestrator');

const NOW = new Date('2026-10-08T23:02:48Z');
const OPTIONS = { now: NOW, timezone: 'Asia/Vladivostok' };
const MESSAGE = 'Запиши на сегодня\nЗабрать посылку\nЗаехать в магазин\nСпорт зал';

test('dated explicit list becomes three tasks on the owner local date', () => {
  assert.equal(detectIntent(MESSAGE), INTENTS.CORE_CREATE_TASK);
  const parsed = parseCreateTasksRequest(MESSAGE, OPTIONS);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.tasks.map(task => task.title), ['Забрать посылку', 'Заехать в магазин', 'Спорт зал']);
  for (const task of parsed.tasks) assert.equal(task.dueAt, '2026-10-09T13:59:59.999Z');
  assert.equal(parseCreateTasksRequest('Запиши на завтра спортзал', OPTIONS).tasks[0].dueAt,
    '2026-10-10T13:59:59.999Z');
});

test('bullets and item-specific dates work; ambiguous items block every write', () => {
  const parsed = parseCreateTasksRequest('Артур, запиши задачи на сегодня:\n1. Купить корм\n• Позвонить завтра', OPTIONS);
  assert.deepEqual(parsed.tasks.map(task => task.title), ['Купить корм', 'Позвонить']);
  assert.equal(parsed.tasks[1].dueAt, '2026-10-10T13:59:59.999Z');
  for (const message of [
    'Запиши на сегодня\nКупить корм\nПозвонить завтра и послезавтра',
    'Запиши на сегодня\n- Купить корм\n- ',
    `Запиши задачи\n${Array.from({ length: 21 }, () => 'Купить корм').join('\n')}`,
  ]) {
    assert.equal(parseCreateTasksRequest(message, OPTIONS).ok, false);
    const plan = createRuleBasedPlanBuilder({ clock: () => NOW }).build({ message });
    assert.equal(plan.steps.length, 1);
    assert.ok(plan.steps[0].parameters.clarification);
    assert.equal(plan.steps[0].parameters.title, undefined);
  }
  for (const message of ['Запиши мой телефон', 'Как записать дела на сегодня?', 'Спорт зал']) {
    assert.notEqual(detectIntent(message), INTENTS.CORE_CREATE_TASK);
  }
});

test('list plans keep unique stable source refs and serialize duplicate checks', () => {
  const builder = createRuleBasedPlanBuilder({ clock: () => NOW });
  const plan = builder.build({ message: MESSAGE, transport: { metadata: { updateId: 42 } } });
  assert.deepEqual(plan.steps.map(step => step.parameters.sourceRef), [
    'telegram-update:42:task:1', 'telegram-update:42:task:2', 'telegram-update:42:task:3',
  ]);
  assert.deepEqual(plan.steps.map(step => step.dependsOn), [[], ['step_1'], ['step_2']]);
});

function harness(failTitle) {
  const tasks = [];
  const client = {
    async getProfile() { return {}; },
    async getTaskBrief() { return {}; },
    async transitionTask() { return {}; },
    async health() { return { healthy: true }; },
    async listTasks(owner) { assert.equal(owner, 'sergey'); return [...tasks]; },
    async createTask(owner, task) {
      assert.equal(owner, 'sergey');
      if (task.title === failTitle) throw new Error('Test storage unavailable');
      const record = { id: `task-${tasks.length + 1}`, ...task };
      tasks.push(record);
      return record;
    },
  };
  const registry = createSkillRegistry();
  registry.register(createArthurCoreSkill({ client, ownerProfileId: 'sergey' }));
  const arthur = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder({ clock: () => NOW }),
    aiProvider: {
      async generate() { throw new Error('Task requests must not enter chat fallback'); },
      async synthesize() { throw new Error('Task results must not use LLM synthesis'); },
    },
  });
  return { tasks, arthur };
}

test('orchestrator saves individual personal tasks and repeated delivery creates no duplicates', async () => {
  const { tasks, arthur } = harness();
  const request = { userId: 'owner', channel: 'telegram', message: MESSAGE };
  const first = await arthur.handle(request);
  assert.equal(first.status, 'success');
  assert.equal(tasks.length, 3);
  assert.ok(tasks.every(task => task.domain === 'personal' && task.sourceType === 'telegram'));
  for (const task of tasks) assert.ok(first.answer.text.includes(task.title));
  const repeat = await arthur.handle(request);
  assert.equal(tasks.length, 3);
  assert.match(repeat.answer.text, /Такая задача уже есть/);
});

test('partial failure confirms only successful tasks and exposes missing confirmations', async () => {
  const { tasks, arthur } = harness('Заехать в магазин');
  const response = await arthur.handle({ userId: 'owner', channel: 'telegram', message: MESSAGE });
  assert.equal(response.status, 'partial');
  assert.equal(tasks.length, 2);
  assert.ok(!response.answer.text.includes('Заехать в магазин'));
  assert.match(response.answer.text, /Не удалось подтвердить сохранение всех задач/);
});
