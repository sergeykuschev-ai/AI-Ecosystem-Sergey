'use strict';

const { PlanBuildError } = require('../errors/arthur_errors');
const { INTENTS, detectIntent } = require('./intents');

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

  [INTENTS.KNOWLEDGE_SEARCH]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'knowledge',
      operation: 'search',
      parameters: { query: input.message, limit: 10 },
      timeoutMs: 5000,
    }),
  ]),
};

class RuleBasedPlanBuilder {
  constructor(options = {}) {
    this.intentDetector = options.intentDetector || detectIntent;
    this.builders = { ...PLAN_BUILDERS, ...(options.customBuilders || {}) };
  }

  build(input = {}) {
    const message = input.message || '';
    const intent = input.intent || this.intentDetector(message);
    const builder = this.builders[intent];

    if (!builder) {
      if (intent === INTENTS.UNKNOWN) {
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
      throw new PlanBuildError(intent, 'no plan builder registered');
    }

    return builder({ ...input, intent });
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
};
