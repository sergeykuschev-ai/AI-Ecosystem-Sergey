'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createOrchestrator } = require('../orchestrator/orchestrator');
const { createSkillRegistry } = require('../registry/skill_registry');
const { createRuleBasedPlanBuilder } = require('../planner/plan_builder');
const { createLLMPlanBuilder } = require('../planner/llm_plan_builder');
const { createLogger } = require('../logging/logger');
const { PurchasingSkill } = require('../skills/purchasing/purchasing_skill');

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
  assert.ok(ai.captured.generateSystem.includes('подключённых skills'));
  assert.ok(ai.captured.generateSystem.includes('Отвечай естественно'));
});

function createCapturingLogger() {
  const records = [];
  return {
    records,
    info: (event, request, meta = {}) => records.push({ level: 'info', event, request, meta }),
    warn: (event, request, meta = {}) => records.push({ level: 'warn', event, request, meta }),
    error: (event, request, meta = {}) => records.push({ level: 'error', event, request, meta }),
  };
}

test('greeting returns direct AI response with identity context', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const ai = createCapturingAIProvider('Привет! Я Артур, готов помочь.');
  const logger = createCapturingLogger();
  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    aiProvider: ai,
    logger,
  });

  const response = await orchestrator.handle({
    message: 'Привет, Артур',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.ok(response.diagnostics.directResponse);
  assert.equal(response.answer.text, 'Привет! Я Артур, готов помочь.');
  assert.ok(ai.captured.generateSystem.includes('Артур'));
  assert.ok(ai.captured.generateSystem.includes('подключённых skills'));
  assert.ok(logger.records.some(r => r.event === 'conversation_fallback_used' && r.meta.reason === 'empty_plan'));
});

test('generic business question returns direct AI response', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const ai = createCapturingAIProvider('Страховой запас защищает от непредсказуемых колебаний спроса.');
  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    aiProvider: ai,
    logger: createSilentLogger(),
  });

  const response = await orchestrator.handle({
    message: 'Объясни простыми словами, зачем магазину нужен страховой запас товара',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.ok(response.diagnostics.directResponse);
  assert.equal(response.answer.text, 'Страховой запас защищает от непредсказуемых колебаний спроса.');
});

test('UNKNOWN intent returns direct AI response', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const ai = createCapturingAIProvider('Это обычный вопрос, отвечаю напрямую.');
  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder({
      intentDetector: () => 'unknown',
    }),
    aiProvider: ai,
    logger: createSilentLogger(),
  });

  const response = await orchestrator.handle({
    message: 'какая сегодня погода?',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.ok(response.diagnostics.directResponse);
  assert.equal(response.answer.text, 'Это обычный вопрос, отвечаю напрямую.');
});

test('empty plan from LLM returns direct AI response', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const ai = {
    async generate(prompt, options = {}) {
      this.captured.generateSystem = options.system || null;
      return 'Простой ответ без навыков.';
    },
    async synthesize() {
      return { text: 'unused', confidence: 'low' };
    },
    async health() {
      return { healthy: true };
    },
    captured: { generateSystem: null },
  };

  const llmPlanner = createLLMPlanBuilder({ aiProvider: ai, registry });
  llmPlanner.build = async () => ({ version: 1, steps: [] });

  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    llmPlanBuilder: llmPlanner,
    aiProvider: ai,
    logger: createSilentLogger(),
  });

  const response = await orchestrator.handle({
    message: 'расскажи анекдот',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.ok(response.diagnostics.directResponse);
  assert.equal(response.answer.text, 'Простой ответ без навыков.');
  assert.ok(ai.captured.generateSystem.includes('подключённых skills'));
});

test('hallucinated skill returns direct AI response without SKILL_NOT_FOUND error', async () => {
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

  const logger = createCapturingLogger();
  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    llmPlanBuilder: createLLMPlanBuilder({ aiProvider: ai, registry }),
    aiProvider: ai,
    logger,
  });

  const response = await orchestrator.handle({
    message: 'анализ продаж',
    channel: 'test',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, []);
  assert.ok(response.diagnostics.directResponse);
  assert.ok(!response.answer.text.includes('SKILL_NOT_FOUND'));
  assert.ok(!response.answer.text.includes('не смог определить'));
  assert.ok(logger.records.some(r => r.event === 'conversation_fallback_used'));
});

test('direct response system message does not claim unavailable fake skills', async () => {
  const registry = createSkillRegistry();
  registry.register(fakeSkill('purchasing', { status: 'ok' }));

  const ai = createCapturingAIProvider('ok');
  const orchestrator = createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder(),
    aiProvider: ai,
    logger: createSilentLogger(),
  });

  await orchestrator.handle({
    message: 'что ты умеешь?',
    channel: 'test',
  });

  assert.ok(ai.captured.generateSystem.includes('purchasing'));
  assert.ok(!ai.captured.generateSystem.includes('calendar'));
  assert.ok(!ai.captured.generateSystem.includes('documents'));
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

function createPurchasingRunDir(root, runId, overrides = {}) {
  const dir = path.join(root, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({
    run_id: runId,
    status: 'completed',
    completed_at: overrides.completedAt || '2026-08-04T00:31:58.041Z',
    created_at: '2026-08-01T00:00:00.000Z',
    source: overrides.source || { original_name: 'real-export.xlsx' },
  }));
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    run_id: runId,
    sku_count: overrides.skuCount ?? 602,
    source_rows_count: overrides.sourceRowsCount ?? 700,
    amounts: overrides.amounts || {},
    phase2: overrides.phase2 || {},
    warnings: overrides.warnings || [],
  }));
  fs.writeFileSync(path.join(dir, 'owner-review-compact.json'), JSON.stringify({
    run_id: runId,
    status: { code: 'orange', label: 'требуется проверка' },
    summary: { owner_action_required_total: overrides.actionRequired ?? 63 },
    owner_decisions: {
      unmatched_active_skus: overrides.unmatched || [],
    },
  }));
  return dir;
}

test('orchestrator returns real purchasing data from run registry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arthur-purchasing-integration-'));
  const originalEnv = process.env.PURCHASING_RUNS_ROOT;
  try {
    process.env.PURCHASING_RUNS_ROOT = root;
    createPurchasingRunDir(root, 'eb68a662-0fd4-43c0-b7c4-8aaf2e95f790', {
      completedAt: '2026-08-04T00:31:58.041Z',
      source: { original_name: 'Оникиенко Зооград 04.08.2026.xlsx' },
      skuCount: 602,
      sourceRowsCount: 700,
      amounts: { analyzer_order_sum: 121841.6, auto_approved_sum: 0 },
      phase2: { must_buy: 0, recommended: 0, manual_review: 602, postpone: 0, do_not_buy: 0 },
    });

    const registry = createSkillRegistry();
    registry.register(PurchasingSkill);

    const fakeAI = {
      generate: async () => 'plan',
      synthesize: async (input) => {
        const outputs = input.skillOutputs || [];
        const text = outputs.map(o => JSON.stringify(o.data)).join('\n');
        return { text, markdown: text, confidence: 'high', followUps: [] };
      },
      health: async () => ({ healthy: true }),
    };

    const orchestrator = createOrchestrator({
      registry,
      deterministicPlanBuilder: createRuleBasedPlanBuilder(),
      aiProvider: fakeAI,
      logger: createSilentLogger(),
    });

    const response = await orchestrator.handle({
      message: 'что с закупщиком?',
      channel: 'test',
    });

    assert.equal(response.status, 'success');
    assert.equal(response.modulesUsed.includes('purchasing'), true);
    assert.ok(response.answer.text.includes('602'));
    assert.ok(response.answer.text.includes('700'));
  } finally {
    if (originalEnv === undefined) {
      delete process.env.PURCHASING_RUNS_ROOT;
    } else {
      process.env.PURCHASING_RUNS_ROOT = originalEnv;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
