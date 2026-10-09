'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTaskManagementRequest, detectTaskManagementAction } = require('../planner/task_management_parser');
const { createArthurCoreSkill } = require('../skills/arthur-core/arthur_core_skill');
const { createMemoryInterface } = require('../memory/memory_interface');
const options = { now: '2026-10-09T00:00:00Z', timezone: 'Asia/Vladivostok' };

test('reminder controls take precedence over task reschedule and require future exact time', () => {
  const moved = parseTaskManagementRequest('Перенеси напоминание забрать заказ на сегодня в 17:00', options);
  assert.equal(moved.action, 'move_reminder');
  assert.equal(moved.remindAt, '2026-10-09T07:00:00.000Z');
  assert.equal(moved.dueAt, undefined);
  assert.equal(parseTaskManagementRequest('Отмени напоминание забрать заказ', options).remindAt, null);
  assert.equal(parseTaskManagementRequest('Перенеси напоминание забрать заказ на 18:00', options).remindAt, '2026-10-09T08:00:00.000Z');
  for (const when of ['сегодня', 'сегодня в 09:00', 'каждый день в 17:00']) {
    assert.equal(parseTaskManagementRequest(`Перенеси напоминание забрать заказ на ${when}`, options).ok, false);
  }
  assert.equal(detectTaskManagementAction('Как перенеси напоминание забрать заказ?'), null);
});

function harness(tasks, enabled = true) {
  const writes = [];
  const client = { health() {}, getProfile() {}, getTaskBrief() {}, createTask() {}, transitionTask() { throw Error('Task transition forbidden'); },
    async listTasks(owner, filter) { assert.equal(filter.domain, 'personal'); return tasks; },
    async setTaskReminder(owner, id, input) {
      writes.push({ owner, id, input });
      const task = tasks.find(t => t.id === id);
      return { status: 'updated', task: { ...task, remindAt: input.remindAt } };
    },
  };
  return { writes, skill: createArthurCoreSkill({ client, ownerProfileId: 'sergey', remindersEnabled: enabled }) };
}
const task = { id: 'task-1', title: 'Забрать заказ', domain: 'personal', status: 'new',
  dueAt: '2026-10-10T07:00:00Z', remindAt: '2026-10-09T07:00:00Z', updatedAt: '2026-10-09T00:00:00Z' };

test('only reminder changes, disabled controls cannot write', async () => {
  const { skill, writes } = harness([task]);
  const result = await skill.execute({ operation: 'cancelReminder', parameters: { title: task.title, sourceRef: 'telegram-update:1' } });
  assert.equal(result.data.task.dueAt, task.dueAt);
  assert.equal(result.data.task.status, task.status);
  assert.equal(result.data.task.remindAt, null);
  assert.equal(writes[0].input.expectedUpdatedAt, task.updatedAt);
  assert.equal(writes[0].input.sourceRef, 'telegram-update:1');
  const disabled = harness([task], false);
  await disabled.skill.execute({ operation: 'cancelReminder', parameters: { title: task.title } });
  assert.equal(disabled.writes.length, 0);
});

test('ambiguous reminder selection persists version and rejects concurrent changes', async () => {
  const tasks = [{ ...task }, { ...task, id: 'task-2' }];
  const { skill, writes } = harness(tasks);
  const parameters = { title: task.title, remindAt: '2026-10-09T08:00:00Z', sourceRef: 'telegram-update:2' };
  const result = await skill.execute({ operation: 'moveReminder', parameters });
  const memory = createMemoryInterface();
  await memory.storePendingTaskClarification('sergey', 'chat', result.data.pendingClarification);
  const pending = await memory.loadPendingTaskClarification('sergey', 'chat');
  assert.equal(pending.parameters.sourceRef, parameters.sourceRef);
  assert.equal(pending.candidates[0].updatedAt, task.updatedAt);
  tasks[0].updatedAt = '2026-10-09T00:01:00Z';
  const stale = await skill.execute({ operation: pending.operation,
    parameters: { ...pending.parameters, taskId: task.id, expectedTask: pending.candidates[0] } });
  assert.equal(stale.data.status, 'clarification_required');
  assert.equal(writes.length, 0);
});

test('Telegram reminder command executes deterministically with a transport receipt', async () => {
  const { createSkillRegistry } = require('../registry/skill_registry');
  const { createOrchestrator } = require('../orchestrator/orchestrator');
  const { createRuleBasedPlanBuilder } = require('../planner/plan_builder');
  const { skill, writes } = harness([task]);
  const registry = createSkillRegistry(); registry.register(skill);
  const arthur = createOrchestrator({ registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder({ clock: () => new Date(options.now) }),
    aiProvider: { async generate() { throw Error('Unexpected AI fallback'); }, async synthesize() { throw Error('Unexpected synthesis'); } },
  });
  const result = await arthur.handle({ userId: 'sergey', conversationId: 'chat', message: 'Отмени напоминание забрать заказ',
    transport: { metadata: { updateId: 99 } } });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].input.sourceRef, 'telegram-update:99');
  assert.notEqual(result.status, 'failed');
});
