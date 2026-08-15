'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createOrchestrator } = require('../orchestrator/orchestrator');
const { createSkillRegistry } = require('../registry/skill_registry');
const { createRuleBasedPlanBuilder } = require('../planner/plan_builder');
const { createLLMPlanBuilder } = require('../planner/llm_plan_builder');
const { createFakeAIProvider } = require('../ai/fake_provider');
const { createLogger } = require('../logging/logger');

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fakeSkill(id, data = {}) {
  return {
    id,
    name: id,
    version: '1.0.0',
    capabilities: [{ id: 'op', readOnly: true }],
    execute: async (input) => ({
      status: 'success',
      data,
      metadata: { durationMs: 1 },
    }),
    health: async () => ({ healthy: true }),
  };
}

function slowSkill(id, delayMs) {
  return {
    id,
    name: id,
    version: '1.0.0',
    capabilities: [{ id: 'op', readOnly: true }],
    execute: async () => {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return { status: 'success', data: { done: true }, metadata: {} };
    },
    health: async () => ({ healthy: true }),
  };
}

function failingSkill(id, error) {
  return {
    id,
    name: id,
    version: '1.0.0',
    capabilities: [{ id: 'op', readOnly: true }],
    execute: async () => { throw error; },
    health: async () => ({ healthy: true }),
  };
}

function createTestOrchestrator(skills, planBuilder) {
  const registry = createSkillRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }
  return createOrchestrator({
    registry,
    planBuilder,
    aiProvider: createFakeAIProvider(),
    logger: createLogger({ stdout: { write: () => {} }, stderr: { write: () => {} } }),
  });
}

test('single skill execution returns success response', async () => {
  const planBuilder = createRuleBasedPlanBuilder({
    intentDetector: () => 'purchasing.status',
  });
  const orchestrator = createTestOrchestrator([fakeSkill('purchasing', { status: 'ok' })], planBuilder);

  const response = await orchestrator.handle({
    message: 'status',
    userId: 'sergey',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.equal(response.modulesUsed.includes('purchasing'), true);
  assert.equal(typeof response.answer.text, 'string');
  assert.match(response.correlationId, UUID_V4_PATTERN);
});

test('sequential execution waits for dependency', async () => {
  const planBuilder = {
    build: () => ({
      version: 1,
      steps: [
        { id: 'step_1', skill: 'a', operation: 'op', dependsOn: [] },
        { id: 'step_2', skill: 'b', operation: 'op', dependsOn: ['step_1'] },
      ],
    }),
  };
  const order = [];
  const skillA = {
    ...fakeSkill('a'),
    execute: async () => { order.push('a'); return { status: 'success', data: {}, metadata: {} }; },
  };
  const skillB = {
    ...fakeSkill('b'),
    execute: async (input) => {
      order.push('b');
      assert.ok(input.context.step_1);
      return { status: 'success', data: {}, metadata: {} };
    },
  };
  const orchestrator = createTestOrchestrator([skillA, skillB], planBuilder);
  await orchestrator.handle({ message: 'x', channel: 'test' });
  assert.deepEqual(order, ['a', 'b']);
});

test('parallel execution runs independent skills concurrently', async () => {
  const planBuilder = {
    build: () => ({
      version: 1,
      steps: [
        { id: 'step_1', skill: 'a', operation: 'op', dependsOn: [] },
        { id: 'step_2', skill: 'b', operation: 'op', dependsOn: [] },
      ],
    }),
  };
  const delays = [];
  const skillA = slowSkill('a', 50);
  const skillB = slowSkill('b', 50);
  const orchestrator = createTestOrchestrator([skillA, skillB], planBuilder);
  const start = Date.now();
  await orchestrator.handle({ message: 'x', channel: 'test' });
  const duration = Date.now() - start;
  assert.ok(duration < 120, `parallel execution took ${duration}ms`);
});

test('timeout returns partial result', async () => {
  const planBuilder = {
    build: () => ({
      version: 1,
      steps: [
        { id: 'step_1', skill: 'fast', operation: 'op', dependsOn: [], timeoutMs: 100 },
        { id: 'step_2', skill: 'slow', operation: 'op', dependsOn: [], timeoutMs: 50 },
      ],
    }),
  };
  const orchestrator = createTestOrchestrator([
    fakeSkill('fast', { ok: true }),
    slowSkill('slow', 200),
  ], planBuilder);

  const response = await orchestrator.handle({ message: 'x', channel: 'test' });
  assert.equal(response.status, 'partial');
  assert.equal(response.modulesUsed.includes('fast'), true);
  assert.equal(response.modulesUsed.includes('slow'), false);
});

test('deterministic mail sender and important-summary timeouts bypass AI synthesis', async () => {
  let aiCalled = false;
  for (const operation of ['findMessagesFromSender', 'summarizeImportantMail']) {
    const registry = createSkillRegistry();
    registry.register({
      id: 'mail',
      name: 'mail',
      version: '1.2.0',
      capabilities: [
        { id: 'findMessagesFromSender', readOnly: true },
        { id: 'summarizeImportantMail', readOnly: true },
      ],
      execute: async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return { status: 'success', data: {}, metadata: {} };
      },
      health: async () => ({ healthy: true }),
    });
    const orchestrator = createOrchestrator({
      registry,
      planBuilder: {
        build: () => ({
          version: 1,
          steps: [{ id: 'step_1', skill: 'mail', operation, timeoutMs: 5 }],
        }),
      },
      aiProvider: {
        async generate() {
          aiCalled = true;
          return 'unexpected';
        },
        async synthesize() {
          aiCalled = true;
          return { text: 'unexpected', confidence: 'low' };
        },
        async health() {
          return { healthy: true, provider: 'test' };
        },
      },
      logger: createLogger({ stdout: { write: () => {} }, stderr: { write: () => {} } }),
    });
    const response = await orchestrator.handle({
      message: operation === 'findMessagesFromSender'
        ? 'Пришёл ответ от Валты?'
        : 'Что важного в почте Миски?',
      userId: 'sergey',
      channel: 'telegram',
    });

    assert.equal(response.status, 'failed');
    assert.equal(response.answer.safeUserFacingError, true);
    assert.equal(
      response.answer.text,
      'Почта отвечает медленнее обычного. Не успел завершить поиск. Попробуй ещё раз.'
    );
    assert.equal(response.diagnostics.errors[0].errors[0].causeCode, 'SKILL_TIMEOUT');
  }
  assert.equal(aiCalled, false);
});

test('retryable error is retried', async () => {
  let attempts = 0;
  const skill = {
    id: 'flaky',
    name: 'flaky',
    version: '1.0.0',
    capabilities: [{ id: 'op', readOnly: true }],
    execute: async () => {
      attempts += 1;
      if (attempts < 2) {
        const error = new Error('transient');
        error.retryable = true;
        throw error;
      }
      return { status: 'success', data: { ok: true }, metadata: {} };
    },
    health: async () => ({ healthy: true }),
  };
  const planBuilder = {
    build: () => ({
      version: 1,
      steps: [{ id: 'step_1', skill: 'flaky', operation: 'op', retryable: true, retries: 2 }],
    }),
  };
  const orchestrator = createTestOrchestrator([skill], planBuilder);
  const response = await orchestrator.handle({ message: 'x', channel: 'test' });
  assert.equal(response.status, 'success');
  assert.equal(attempts, 2);
});

test('partial failure includes diagnostics', async () => {
  const planBuilder = {
    build: () => ({
      version: 1,
      steps: [
        { id: 'step_1', skill: 'ok', operation: 'op' },
        { id: 'step_2', skill: 'bad', operation: 'op' },
      ],
    }),
  };
  const error = new Error('boom');
  error.retryable = false;
  const orchestrator = createTestOrchestrator([
    fakeSkill('ok', { ok: true }),
    failingSkill('bad', error),
  ], planBuilder);

  const response = await orchestrator.handle({ message: 'x', channel: 'test' });
  assert.equal(response.status, 'partial');
  assert.equal(response.diagnostics.errors.length, 1);
  assert.equal(response.diagnostics.errors[0].skill, 'bad');
});

test('correlationId propagates through response', async () => {
  const planBuilder = createRuleBasedPlanBuilder({
    intentDetector: () => 'purchasing.status',
  });
  const orchestrator = createTestOrchestrator([fakeSkill('purchasing')], planBuilder);
  const response = await orchestrator.handle({
    message: 'status',
    channel: 'test',
    correlationId: 'corr-123',
  });
  assert.equal(response.correlationId, 'corr-123');
});

test('deterministic intent bypasses LLM planner', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  let llmCalled = false;
  const fakeAI = {
    generate: async () => { llmCalled = true; return 'llm'; },
    synthesize: async (input) => ({ text: 'ok', confidence: 'high' }),
    health: async () => ({ healthy: true }),
  };

  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    llmPlanBuilder: {
      build: async () => {
        llmCalled = true;
        return { version: 1, steps: [] };
      },
    },
    aiProvider: fakeAI,
    logger: createLogger({ stdout: { write: () => {} }, stderr: { write: () => {} } }),
  });

  const response = await orchestrator.handle({
    message: 'Что с закупками?',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.equal(response.modulesUsed.includes('purchasing'), true);
  assert.equal(llmCalled, false);
});

test('ambiguous intent invokes LLM planner', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const fakeAI = {
    generate: async () => JSON.stringify({
      version: 1,
      steps: [{ id: 'step_1', skill: 'purchasing', operation: 'getStatus', dependsOn: [], timeoutMs: 1000 }],
    }),
    synthesize: async (input) => ({ text: 'LLM answer', confidence: 'high' }),
    health: async () => ({ healthy: true }),
  };

  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    llmPlanBuilder: {
      build: async () => ({
        version: 1,
        steps: [{ id: 'step_1', skill: 'purchasing', operation: 'getStatus', dependsOn: [], timeoutMs: 1000 }],
      }),
    },
    aiProvider: fakeAI,
    logger: createLogger({ stdout: { write: () => {} }, stderr: { write: () => {} } }),
  });

  const response = await orchestrator.handle({
    message: 'абракадабра',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.equal(response.answer.text, 'LLM answer');
});

test('LLM planner failure returns safe direct response without unregistered skill', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const fakeAI = {
    generate: async () => { throw new Error('LLM unavailable'); },
    synthesize: async (input) => ({ text: 'fallback', confidence: 'low' }),
    health: async () => ({ healthy: false }),
  };

  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    llmPlanBuilder: {
      build: async () => { throw new Error('LLM unavailable'); },
    },
    knowledge: {
      search: async () => ({ entries: [] }),
    },
    aiProvider: fakeAI,
    logger: createLogger({ stdout: { write: () => {} }, stderr: { write: () => {} } }),
  });

  const response = await orchestrator.handle({
    message: 'абракадабра',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.ok(response.answer.text.length > 0);
  assert.ok(response.diagnostics.directResponse);
});

test('AI provider unavailable still returns deterministic response', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const brokenAI = {
    generate: async () => { throw new Error('unavailable'); },
    synthesize: async () => { throw new Error('unavailable'); },
    health: async () => ({ healthy: false }),
  };

  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    aiProvider: brokenAI,
    logger: createLogger({ stdout: { write: () => {} }, stderr: { write: () => {} } }),
  });

  const response = await orchestrator.handle({
    message: 'Что с закупками?',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.equal(response.modulesUsed.includes('purchasing'), true);
});

test('multi-skill LLM plan executes sequentially by dependency', async () => {
  const registry = createSkillRegistry();
  const order = [];
  registry.register({
    ...fakeSkill('a'),
    execute: async () => { order.push('a'); return { status: 'success', data: {}, metadata: {} }; },
  });
  registry.register({
    ...fakeSkill('b'),
    execute: async (input) => {
      order.push('b');
      assert.ok(input.context.step_1);
      return { status: 'success', data: {}, metadata: {} };
    },
  });

  const fakeAI = {
    generate: async () => JSON.stringify({
      version: 1,
      steps: [
        { id: 'step_1', skill: 'a', operation: 'op', dependsOn: [], timeoutMs: 1000 },
        { id: 'step_2', skill: 'b', operation: 'op', dependsOn: ['step_1'], timeoutMs: 1000 },
      ],
    }),
    synthesize: async () => ({ text: 'ok', confidence: 'high' }),
    health: async () => ({ healthy: true }),
  };

  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    llmPlanBuilder: {
      build: async () => ({
        version: 1,
        steps: [
          { id: 'step_1', skill: 'a', operation: 'op', dependsOn: [], timeoutMs: 1000 },
          { id: 'step_2', skill: 'b', operation: 'op', dependsOn: ['step_1'], timeoutMs: 1000 },
        ],
      }),
    },
    aiProvider: fakeAI,
    logger: createLogger({ stdout: { write: () => {} }, stderr: { write: () => {} } }),
  });

  await orchestrator.handle({ message: 'x', channel: 'test' });
  assert.deepEqual(order, ['a', 'b']);
});
test('natural-language greeting returns direct AI response without skill call', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const fakeAI = {
    generate: async (prompt) => 'Привет! Чем могу помочь?',
    synthesize: async () => ({ text: 'should not be called', confidence: 'high' }),
    health: async () => ({ healthy: true }),
  };

  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    llmPlanBuilder: createLLMPlanBuilder({ aiProvider: fakeAI, registry }),
    aiProvider: fakeAI,
    logger: createLogger({ stdout: { write: () => {} }, stderr: { write: () => {} } }),
  });

  const response = await orchestrator.handle({
    message: 'Привет',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.equal(response.answer.text, 'Привет! Чем могу помочь?');
  assert.ok(response.diagnostics.directResponse);
});

test('unknown intent never references missing knowledge skill', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const fakeAI = {
    generate: async () => { throw new Error('LLM unavailable'); },
    synthesize: async () => ({ text: 'fallback', confidence: 'low' }),
    health: async () => ({ healthy: false }),
  };

  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    llmPlanBuilder: createLLMPlanBuilder({ aiProvider: fakeAI, registry }),
    aiProvider: fakeAI,
    logger: createLogger({ stdout: { write: () => {} }, stderr: { write: () => {} } }),
  });

  const response = await orchestrator.handle({
    message: 'что ты умеешь?',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.ok(!response.diagnostics.errors.some(e => e.message && e.message.includes('knowledge')));
});
