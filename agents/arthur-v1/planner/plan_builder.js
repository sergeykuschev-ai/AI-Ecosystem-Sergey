'use strict';

const { PlanBuildError } = require('../errors/arthur_errors');
const { INTENTS, detectIntent } = require('./intents');
const { DEFAULT_OWNER_TIMEZONE, parseCreateTaskRequest } = require('./task_request_parser');

function createStep({
  id,
  skill,
  operation,
  parameters = {},
  dependsOn = [],
  timeoutMs = 10000,
  retries = 0,
  retryable = false,
}) {
  return {
    id,
    skill,
    operation,
    parameters,
    dependsOn,
    timeoutMs,
    retries,
    retryable,
  };
}

function createExecutionPlan(steps) {
  return {
    version: 1,
    steps,
  };
}

function taskBriefView(message = '') {
  const normalized = message.toLowerCase();
  if (normalized.includes('просроч')) return 'overdue';
  if (normalized.includes('сегодня')) return 'today';
  return 'summary';
}

const PLAN_BUILDERS = {
  [INTENTS.PURCHASING_STATUS]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'purchasing',
      operation: 'getStatus',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.PURCHASING_OWNER_REVIEW]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'purchasing',
      operation: 'getOwnerReview',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.PURCHASING_FINAL_ORDER]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'purchasing',
      operation: 'getFinalOrder',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.PURCHASING_SUMMARY]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'purchasing',
      operation: 'getSummary',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.CORE_PROFILE]: () => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'arthur-core',
      operation: 'getProfile',
      timeoutMs: 10000,
    }),
  ]),

  [INTENTS.CORE_TASKS]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'arthur-core',
      operation: 'listTasks',
      parameters: input.parameters || {},
      timeoutMs: 10000,
    }),
  ]),

  [INTENTS.CORE_TASK_BRIEF]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'arthur-core',
      operation: 'getTaskBrief',
      parameters: {
        ...(input.parameters || {}),
        view: input.parameters?.view || taskBriefView(input.message),
      },
      timeoutMs: 10000,
    }),
  ]),

  [INTENTS.CORE_CREATE_TASK]: (input) => {
    const parsed = parseCreateTaskRequest(input.message, {
      now: input.now,
      timezone: input.ownerTimezone,
    });
    const updateId = input.transport?.metadata?.updateId;
    return createExecutionPlan([
      createStep({
        id: 'step_1',
        skill: 'arthur-core',
        operation: 'createTask',
        parameters: parsed.ok
          ? {
              ...parsed.task,
              ...(updateId != null ? { sourceRef: `telegram-update:${updateId}` } : {}),
            }
          : { clarification: parsed.clarification },
        timeoutMs: 10000,
      }),
    ]);
  },

  [INTENTS.KNOWLEDGE_SEARCH]: () => createExecutionPlan([]),
};

class RuleBasedPlanBuilder {
  constructor(options = {}) {
    this.intentDetector = options.intentDetector || detectIntent;
    this.builders = { ...PLAN_BUILDERS, ...(options.customBuilders || {}) };
    this.availableSkills = options.availableSkills
      ? new Set(options.availableSkills)
      : null;
    this.clock = options.clock || (() => new Date());
    this.ownerTimezone = options.ownerTimezone || DEFAULT_OWNER_TIMEZONE;
  }

  build(input = {}) {
    const message = input.message || '';
    const intent = input.intent || this.intentDetector(message);
    const builder = this.builders[intent];

    if (!builder) {
      if (intent === INTENTS.UNKNOWN) {
        // Empty plan: Orchestrator will decide whether to call AI directly
        // or return a safe fallback. Do not reference unregistered skills.
        return createExecutionPlan([]);
      }
      throw new PlanBuildError(intent, 'no plan builder registered');
    }

    const plan = builder({
      ...input,
      intent,
      now: input.now || this.clock(),
      ownerTimezone: input.ownerTimezone || this.ownerTimezone,
    });
    if (this.availableSkills && plan.steps.some(step => !this.availableSkills.has(step.skill))) {
      return createExecutionPlan([]);
    }
    return plan;
  }
}

function createRuleBasedPlanBuilder(options = {}) {
  return new RuleBasedPlanBuilder(options);
}

module.exports = {
  RuleBasedPlanBuilder,
  createRuleBasedPlanBuilder,
  createExecutionPlan,
  createStep,
  INTENTS,
  detectIntent,
  taskBriefView,
};
