'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createOrchestrator } = require('../orchestrator/orchestrator');
const { createSkillRegistry } = require('../registry/skill_registry');
const { createRuleBasedPlanBuilder } = require('../planner/plan_builder');
const { createFakeAIProvider } = require('../ai/fake_provider');
const { createKnowledgeService } = require('../knowledge/knowledge_service');
const { createMemoryInterface } = require('../memory/memory_interface');
const { createLogger } = require('../logging/logger');
const { PurchasingSkill } = require('../skills/purchasing/purchasing_skill');

function createSilentLogger() {
  return createLogger({ stdout: { write: () => {} }, stderr: { write: () => {} } });
}

function createKnowledgeSkill() {
  return {
    id: 'knowledge',
    name: 'Arthur Knowledge',
    version: '1.0.0',
    capabilities: [{ id: 'search', readOnly: true }],
    execute: async (input) => ({
      status: 'success',
      data: {
        summary: `Knowledge search for: ${input.parameters.query}`,
        results: [],
      },
      metadata: {},
    }),
    health: async () => ({ healthy: true }),
  };
}

function createTestEnvironment() {
  const registry = createSkillRegistry();
  registry.register(PurchasingSkill);
  registry.register(createKnowledgeSkill());

  const knowledge = createKnowledgeService({ directories: [], files: [] });

  return createOrchestrator({
    registry,
    planBuilder: createRuleBasedPlanBuilder(),
    knowledge,
    memory: createMemoryInterface(),
    aiProvider: createFakeAIProvider(),
    logger: createSilentLogger(),
  });
}

test('full flow: Что сейчас с закупщиком?', async () => {
  const orchestrator = createTestEnvironment();
  const response = await orchestrator.handle({
    message: 'Что сейчас с закупщиком?',
    userId: 'sergey',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.equal(response.modulesUsed.includes('purchasing'), true);
  assert.ok(response.correlationId.startsWith('arthur-test-'));
  assert.ok(response.answer.text.length > 0);
  assert.equal(response.answer.confidence, 'high');
  assert.ok(response.executionTimeMs > 0);
});

test('full flow: Покажи спорные позиции', async () => {
  const orchestrator = createTestEnvironment();
  const response = await orchestrator.handle({
    message: 'Покажи спорные позиции',
    userId: 'sergey',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.equal(response.modulesUsed.includes('purchasing'), true);
  assert.ok(response.answer.text.includes('проверку') || response.answer.text.includes('purchasing'));
});

test('full flow: unknown intent returns direct AI response without calling missing knowledge skill', async () => {
  const orchestrator = createTestEnvironment();
  const response = await orchestrator.handle({
    message: 'абракадабра',
    userId: 'sergey',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.ok(response.answer.text.length > 0);
  assert.ok(response.diagnostics.directResponse);
});

test('memory stores conversation entry after request', async () => {
  const registry = createSkillRegistry();
  registry.register(PurchasingSkill);
  const memory = createMemoryInterface();
  const orchestrator = createOrchestrator({
    registry,
    planBuilder: createRuleBasedPlanBuilder(),
    memory,
    aiProvider: createFakeAIProvider(),
    logger: createSilentLogger(),
  });

  const response = await orchestrator.handle({
    message: 'Что с закупками?',
    userId: 'sergey',
    channel: 'test',
    correlationId: 'corr-int-1',
  });

  const history = await memory.load('sergey', 'corr-int-1');
  assert.equal(history.length, 1);
  assert.equal(history[0].request, 'Что с закупками?');
  assert.equal(history[0].answer, response.answer.text);
});
