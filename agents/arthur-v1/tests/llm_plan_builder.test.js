'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  createLLMPlanBuilder,
  createEmptyFallbackPlan,
  parsePlanJson,
  validatePlan,
} = require('../planner/llm_plan_builder');
const { PlanBuildError } = require('../errors/arthur_errors');

function createFakeAIProvider(responseText) {
  return {
    generate: async () => responseText,
  };
}

function createFakeRegistry(skills) {
  return {
    list: () => skills,
  };
}

test('LLMPlanBuilder returns empty fallback when no AI provider', async () => {
  const builder = createLLMPlanBuilder();
  const plan = await builder.build({ message: 'что-то непонятное' });
  assert.equal(plan.steps.length, 0);
  assert.deepEqual(plan.steps, []);
});

test('LLMPlanBuilder parses and validates valid plan', async () => {
  const aiProvider = createFakeAIProvider(JSON.stringify({
    version: 1,
    steps: [
      { id: 'step_1', skill: 'purchasing', operation: 'getStatus', dependsOn: [], timeoutMs: 10000 },
    ],
  }));
  const registry = createFakeRegistry([
    { id: 'purchasing', capabilities: [{ id: 'getStatus', readOnly: true }] },
  ]);
  const builder = createLLMPlanBuilder({ aiProvider, registry });
  const plan = await builder.build({ message: 'что с закупками?' });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].skill, 'purchasing');
  assert.equal(plan.steps[0].operation, 'getStatus');
});

test('LLMPlanBuilder validates unknown skill', async () => {
  const aiProvider = createFakeAIProvider(JSON.stringify({
    version: 1,
    steps: [
      { id: 'step_1', skill: 'unknown_skill', operation: 'do', dependsOn: [] },
    ],
  }));
  const registry = createFakeRegistry([
    { id: 'purchasing', capabilities: [{ id: 'getStatus', readOnly: true }] },
  ]);
  const builder = createLLMPlanBuilder({ aiProvider, registry });
  await assert.rejects(builder.build({ message: 'x' }), PlanBuildError);
});

test('LLMPlanBuilder validates unsupported operation', async () => {
  const aiProvider = createFakeAIProvider(JSON.stringify({
    version: 1,
    steps: [
      { id: 'step_1', skill: 'purchasing', operation: 'sendOrder', dependsOn: [] },
    ],
  }));
  const registry = createFakeRegistry([
    { id: 'purchasing', capabilities: [{ id: 'getStatus', readOnly: true }] },
  ]);
  const builder = createLLMPlanBuilder({ aiProvider, registry });
  await assert.rejects(builder.build({ message: 'x' }), PlanBuildError);
});

test('LLMPlanBuilder rejects write operation', async () => {
  const aiProvider = createFakeAIProvider(JSON.stringify({
    version: 1,
    steps: [
      { id: 'step_1', skill: 'purchasing', operation: 'approve', dependsOn: [] },
    ],
  }));
  const registry = createFakeRegistry([
    { id: 'purchasing', capabilities: [{ id: 'approve', readOnly: false }] },
  ]);
  const builder = createLLMPlanBuilder({ aiProvider, registry });
  await assert.rejects(builder.build({ message: 'x' }), (error) => {
    assert.ok(error.message.includes('Write operation not allowed'));
    return true;
  });
});

test('LLMPlanBuilder rejects forbidden operation', async () => {
  const aiProvider = createFakeAIProvider(JSON.stringify({
    version: 1,
    steps: [
      { id: 'step_1', skill: 'system', operation: 'shell', dependsOn: [] },
    ],
  }));
  const registry = createFakeRegistry([
    { id: 'system', capabilities: [{ id: 'shell', readOnly: true }] },
  ]);
  const builder = createLLMPlanBuilder({ aiProvider, registry });
  await assert.rejects(builder.build({ message: 'x' }), (error) => {
    assert.ok(error.message.includes('Forbidden'));
    return true;
  });
});

test('LLMPlanBuilder rejects too many steps', async () => {
  const steps = Array.from({ length: 10 }, (_, i) => ({
    id: `step_${i}`,
    skill: 'purchasing',
    operation: 'getStatus',
    dependsOn: [],
  }));
  const aiProvider = createFakeAIProvider(JSON.stringify({ version: 1, steps }));
  const registry = createFakeRegistry([
    { id: 'purchasing', capabilities: [{ id: 'getStatus', readOnly: true }] },
  ]);
  const builder = createLLMPlanBuilder({ aiProvider, registry });
  await assert.rejects(builder.build({ message: 'x' }), PlanBuildError);
});

test('LLMPlanBuilder rejects invalid JSON', async () => {
  const aiProvider = createFakeAIProvider('not json');
  const builder = createLLMPlanBuilder({ aiProvider, registry: createFakeRegistry([]) });
  await assert.rejects(builder.build({ message: 'x' }), PlanBuildError);
});

test('LLMPlanBuilder handles markdown-wrapped JSON', async () => {
  const aiProvider = createFakeAIProvider('```json\n{"version":1,"steps":[{"id":"step_1","skill":"purchasing","operation":"getStatus","dependsOn":[],"timeoutMs":5000}]}\n```');
  const registry = createFakeRegistry([
    { id: 'purchasing', capabilities: [{ id: 'getStatus', readOnly: true }] },
  ]);
  const builder = createLLMPlanBuilder({ aiProvider, registry });
  const plan = await builder.build({ message: 'x' });
  assert.equal(plan.steps[0].operation, 'getStatus');
});

test('parsePlanJson throws on empty response', () => {
  assert.throws(() => parsePlanJson(''), PlanBuildError);
});

test('validatePlan rejects duplicate step ids', () => {
  const plan = {
    version: 1,
    steps: [
      { id: 'step_1', skill: 'purchasing', operation: 'getStatus', dependsOn: [] },
      { id: 'step_1', skill: 'purchasing', operation: 'getSummary', dependsOn: [] },
    ],
  };
  const registry = createFakeRegistry([
    { id: 'purchasing', capabilities: [{ id: 'getStatus', readOnly: true }, { id: 'getSummary', readOnly: true }] },
  ]);
  assert.throws(() => validatePlan(plan, registry.list()), PlanBuildError);
});

test('validatePlan rejects unknown dependency', () => {
  const plan = {
    version: 1,
    steps: [
      { id: 'step_1', skill: 'purchasing', operation: 'getStatus', dependsOn: ['missing'] },
    ],
  };
  const registry = createFakeRegistry([
    { id: 'purchasing', capabilities: [{ id: 'getStatus', readOnly: true }] },
  ]);
  assert.throws(() => validatePlan(plan, registry.list()), PlanBuildError);
});

test('createEmptyFallbackPlan returns empty plan', () => {
  const plan = createEmptyFallbackPlan();
  assert.equal(plan.version, 1);
  assert.deepEqual(plan.steps, []);
});
