'use strict';

const { PlanBuildError, ArthurError } = require('../errors/arthur_errors');
const { createExecutionPlan, createStep } = require('./plan_builder');

const MAX_STEPS = 5;
const MAX_TIMEOUT_MS = 30000;
const DEFAULT_TIMEOUT_MS = 10000;

const FORBIDDEN_OPERATIONS = Object.freeze([
  'shell',
  'exec',
  'execute',
  'system',
  'sql',
  'query',
  'write',
  'delete',
  'update',
  'drop',
  'create',
]);

function createKnowledgeFallbackPlan(message) {
  return createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'knowledge',
      operation: 'search',
      parameters: { query: message, limit: 5 },
      timeoutMs: 5000,
    }),
  ]);
}

function buildPlanPrompt(input, availableSkills) {
  const { message, context } = input;
  const skillsDescription = availableSkills.map(skill =>
    `- ${skill.id}: ${skill.capabilities.map(c => c.id).join(', ')}`
  ).join('\n');

  return `Ты — Arthur Orchestrator. Пользователь задал неоднозначный запрос.
Построй ExecutionPlan в строгом JSON-формате, чтобы выполнить запрос, обратившись к доступным навыкам.

ДОСТУПНЫЕ НАВЫКИ (только эти skill и operation разрешены):
${skillsDescription}

ПРАВИЛА:
- Только read-only операции. НЕ используй операции записи, shell, sql, system, exec.
- Используй только skill и operation из списка выше.
- Максимум ${MAX_STEPS} шагов.
- timeoutMs не более ${MAX_TIMEOUT_MS}.
- dependsOn может быть пустым [] или содержать только id предыдущих шагов.
- НЕ придумывай данные. Если запрос не соответствует навыкам, верни пустой план или план с одним knowledge.search шагом.

ExecutionPlan schema:
{
  "version": 1,
  "steps": [
    {
      "id": "step_1",
      "skill": "purchasing",
      "operation": "getStatus",
      "parameters": {},
      "dependsOn": [],
      "timeoutMs": 10000,
      "retries": 0,
      "retryable": false
    }
  ]
}

Запрос пользователя: "${message || ''}"

Ответь ТОЛЬКО JSON объектом ExecutionPlan без markdown и без комментариев.`;
}

function parsePlanJson(text) {
  if (!text || typeof text !== 'string') {
    throw new PlanBuildError('llm', 'LLM returned empty plan');
  }

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new PlanBuildError('llm', `LLM plan is not valid JSON: ${error.message}`);
  }
}

function validatePlan(plan, availableSkills) {
  if (!plan || typeof plan !== 'object') {
    throw new PlanBuildError('llm', 'Plan must be an object');
  }
  if (plan.version !== 1) {
    throw new PlanBuildError('llm', `Unsupported plan version: ${plan.version}`);
  }
  if (!Array.isArray(plan.steps)) {
    throw new PlanBuildError('llm', 'Plan steps must be an array');
  }
  if (plan.steps.length > MAX_STEPS) {
    throw new PlanBuildError('llm', `Plan has too many steps: ${plan.steps.length}`);
  }

  const skillById = new Map(availableSkills.map(skill => [skill.id, skill]));
  const stepIds = new Set();

  for (const step of plan.steps) {
    if (!step.id || typeof step.id !== 'string') {
      throw new PlanBuildError('llm', 'Step missing id');
    }
    if (stepIds.has(step.id)) {
      throw new PlanBuildError('llm', `Duplicate step id: ${step.id}`);
    }
    stepIds.add(step.id);

    const skill = skillById.get(step.skill);
    if (!skill) {
      throw new PlanBuildError('llm', `Unknown skill: ${step.skill}`);
    }

    const capability = skill.capabilities.find(cap => cap.id === step.operation);
    if (!capability) {
      throw new PlanBuildError('llm', `Operation ${step.operation} not supported by skill ${step.skill}`);
    }
    if (capability.readOnly === false) {
      throw new PlanBuildError('llm', `Write operation not allowed: ${step.skill}.${step.operation}`);
    }

    if (FORBIDDEN_OPERATIONS.includes(step.operation?.toLowerCase())) {
      throw new PlanBuildError('llm', `Forbidden operation: ${step.operation}`);
    }

    const timeoutMs = step.timeoutMs || DEFAULT_TIMEOUT_MS;
    if (timeoutMs > MAX_TIMEOUT_MS) {
      throw new PlanBuildError('llm', `Step timeout too large: ${timeoutMs}`);
    }

    for (const dep of step.dependsOn || []) {
      if (!stepIds.has(dep)) {
        throw new PlanBuildError('llm', `Unknown dependency: ${dep}`);
      }
    }
  }

  return plan;
}

class LLMPlanBuilder {
  constructor(options = {}) {
    this.aiProvider = options.aiProvider;
    this.registry = options.registry || null;
    this.fallbackBuilder = options.fallbackBuilder || createKnowledgeFallbackPlan;
    this.maxRetries = options.maxRetries ?? 0;
  }

  async build(input = {}) {
    if (!this.aiProvider) {
      return this.fallbackBuilder(input.message);
    }

    const availableSkills = this.registry
      ? this.registry.list()
      : [];

    const prompt = buildPlanPrompt(input, availableSkills);

    try {
      const response = await this.aiProvider.generate(prompt);
      const parsed = parsePlanJson(response);
      const validated = validatePlan(parsed, availableSkills);
      return validated;
    } catch (error) {
      if (error instanceof PlanBuildError || error instanceof ArthurError) {
        throw error;
      }
      throw new PlanBuildError('llm', `LLM planning failed: ${error.message}`);
    }
  }
}

function createLLMPlanBuilder(options = {}) {
  return new LLMPlanBuilder(options);
}

module.exports = {
  LLMPlanBuilder,
  createLLMPlanBuilder,
  createKnowledgeFallbackPlan,
  buildPlanPrompt,
  parsePlanJson,
  validatePlan,
  FORBIDDEN_OPERATIONS,
  MAX_STEPS,
  MAX_TIMEOUT_MS,
};
