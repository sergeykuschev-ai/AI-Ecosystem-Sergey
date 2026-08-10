'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createOrchestrator } = require('../orchestrator/orchestrator');
const { createSkillRegistry } = require('../registry/skill_registry');
const { createRuleBasedPlanBuilder } = require('../planner/plan_builder');
const { createLLMPlanBuilder } = require('../planner/llm_plan_builder');
const { createLogger } = require('../logging/logger');

function createSilentLogger() {
  return createLogger({
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  });
}

function fakeSkill(id, data = {}) {
  return {
    id,
    name: id,
    version: '1.0.0',
    capabilities: [{ id: 'getStatus', readOnly: true }],
    execute: async () => ({
      status: 'success',
      data,
      metadata: { durationMs: 1 },
    }),
    health: async () => ({ healthy: true }),
  };
}

function createCapturingAIProvider(responseText) {
  return {
    captured: {
      generateSystem: null,
      synthesizeSystem: null,
    },
    async generate(prompt, options = {}) {
      this.captured.generateSystem = options.system || null;
      return responseText;
    },
    async synthesize(input) {
      this.captured.synthesizeSystem = input.systemMessage || null;
      return {
        text: 'synthesized',
        markdown: 'synthesized',
        confidence: 'high',
        followUps: [],
      };
    },
    async health() {
      return { healthy: true, provider: 'fake' };
    },
  };
}

test('direct AI response receives system message with capabilities', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const ai = createCapturingAIProvider('Я могу рассказать про закупщика Миски.');
  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    aiProvider: ai,
    logger: createSilentLogger(),
  });

  const response = await orchestrator.handle({
    message: 'что ты умеешь?',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.ok(response.diagnostics.directResponse);
  assert.equal(response.answer.text, 'Я могу рассказать про закупщика Миски.');
  assert.ok(ai.captured.generateSystem);
  assert.ok(ai.captured.generateSystem.includes('purchasing'));
  assert.ok(ai.captured.generateSystem.includes('только на основе подключённых skills'));
});

test('synthesizer receives system message with capabilities after skill execution', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const ai = createCapturingAIProvider('ok');
  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder({
      intentDetector: () => 'purchasing.status',
    }),
    aiProvider: ai,
    logger: createSilentLogger(),
  });

  const response = await orchestrator.handle({
    message: 'что с закупками?',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.equal(response.modulesUsed.includes('purchasing'), true);
  assert.ok(ai.captured.synthesizeSystem);
  assert.ok(ai.captured.synthesizeSystem.includes('purchasing'));
  assert.ok(ai.captured.synthesizeSystem.includes('Артур'));
  assert.ok(ai.captured.synthesizeSystem.includes('прямого доступа к базам данных'));
});

test('capability answer mentions purchasing but does not claim direct DB access', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const ai = createCapturingAIProvider(
    'У меня подключён модуль закупщика Миски. Прямого доступа к базе 1С у меня нет.'
  );
  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    aiProvider: ai,
    logger: createSilentLogger(),
  });

  const response = await orchestrator.handle({
    message: 'к каким данным Миски у тебя есть доступ?',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.ok(response.answer.text.includes('Миски') || response.answer.text.includes('закупщика'));
  assert.ok(!response.answer.text.includes('прямой доступ к базе'));
  assert.ok(ai.captured.generateSystem.includes('purchasing'));
  assert.ok(ai.captured.generateSystem.includes('прямого доступа к базам данных'));
});

test('unknown intent never produces step for unregistered skill', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const ai = {
    async generate() {
      return JSON.stringify({
        version: 1,
        steps: [{ id: 'step_1', skill: 'analytics', operation: 'search', dependsOn: [] }],
      });
    },
    async synthesize() {
      return { text: 'fallback', confidence: 'low' };
    },
    async health() {
      return { healthy: true };
    },
  };

  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    llmPlanBuilder: createLLMPlanBuilder({ aiProvider: ai, registry }),
    aiProvider: ai,
    logger: createSilentLogger(),
  });

  const response = await orchestrator.handle({
    message: 'анализ продаж',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.ok(!response.diagnostics.errors.some(e => e.message && e.message.includes('knowledge')));
  assert.ok(response.answer.text.length > 0);
});

test('deterministic purchasing command still routes to purchasing skill', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder({
      intentDetector: () => 'purchasing.status',
    }),
    aiProvider: createCapturingAIProvider('ok'),
    logger: createSilentLogger(),
  });

  const response = await orchestrator.handle({
    message: 'что с закупщиком?',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.equal(response.modulesUsed.includes('purchasing'), true);
});
