'use strict';

const { PlanBuildError } = require('../errors/arthur_errors');
const { INTENTS, detectIntent } = require('./intents');
const { DEFAULT_OWNER_TIMEZONE, parseCreateTaskRequest } = require('./task_request_parser');
const {
  TASK_MANAGEMENT_ACTIONS,
  parseTaskManagementRequest,
} = require('./task_management_parser');
const {
  importantMailParameters,
  recentMailParameters,
  searchMailParameters,
  senderMailParameters,
} = require('./mail_request_parser');
const { parseWaitingRequest } = require('./waiting_request_parser');

const MAIL_SENDER_TIMEOUT_MS = 30000;
const MAIL_IMPORTANT_TIMEOUT_MS = 30000;

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

function unreadMailParameters(message = '', parameters = {}) {
  const normalized = message.toLocaleLowerCase('ru-RU');
  return {
    ...parameters,
    ...(normalized.includes('по миске') ? { businessContext: 'miska' } : {}),
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

  [INTENTS.CORE_WAITING_TASK]: (input) => {
    const parsed = parseWaitingRequest(input.message, {
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

  [INTENTS.CORE_COMPLETE_TASK]: (input) => taskManagementPlan(
    input,
    TASK_MANAGEMENT_ACTIONS.COMPLETE,
    'completeTask'
  ),

  [INTENTS.CORE_CANCEL_TASK]: (input) => taskManagementPlan(
    input,
    TASK_MANAGEMENT_ACTIONS.CANCEL,
    'cancelTask'
  ),

  [INTENTS.CORE_RESCHEDULE_TASK]: (input) => taskManagementPlan(
    input,
    TASK_MANAGEMENT_ACTIONS.RESCHEDULE,
    'rescheduleTask'
  ),

  [INTENTS.MAIL_UNREAD]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'mail',
      operation: 'listUnreadMail',
      parameters: unreadMailParameters(input.message, input.parameters || {}),
      timeoutMs: 10000,
    }),
  ]),

  [INTENTS.MAIL_RECENT]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'mail',
      operation: 'listRecentMail',
      parameters: {
        ...recentMailParameters(input.message, {
          now: input.now,
          timezone: input.ownerTimezone,
        }),
        ...(input.parameters || {}),
      },
      timeoutMs: 10000,
    }),
  ]),

  [INTENTS.MAIL_SEARCH]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'mail',
      operation: 'searchMail',
      parameters: {
        ...searchMailParameters(input.message, {
          now: input.now,
          timezone: input.ownerTimezone,
        }),
        ...(input.parameters || {}),
      },
      timeoutMs: 10000,
    }),
  ]),

  [INTENTS.MAIL_SENDER]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'mail',
      operation: 'findMessagesFromSender',
      parameters: {
        ...senderMailParameters(input.message, {
          now: input.now,
          timezone: input.ownerTimezone,
        }),
        ...(input.parameters || {}),
      },
      timeoutMs: MAIL_SENDER_TIMEOUT_MS,
    }),
  ]),

  [INTENTS.MAIL_IMPORTANT]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'mail',
      operation: 'summarizeImportantMail',
      parameters: {
        ...importantMailParameters(input.message, {
          now: input.now,
          timezone: input.ownerTimezone,
        }),
        ...(input.parameters || {}),
      },
      timeoutMs: MAIL_IMPORTANT_TIMEOUT_MS,
    }),
  ]),

  [INTENTS.KNOWLEDGE_SEARCH]: () => createExecutionPlan([]),

  [INTENTS.BUSINESS_KPI_STORE_SUMMARY]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'business_kpi',
      operation: 'getStoreSummary',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.BUSINESS_KPI_TODAY]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'business_kpi',
      operation: 'getTodaySummary',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.BUSINESS_KPI_SELLERS]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'business_kpi',
      operation: 'getSellers',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.BUSINESS_KPI_SELLER]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'business_kpi',
      operation: 'getSeller',
      parameters: {
        name: extractSellerName(input.message),
        ...(input.parameters || {}),
      },
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.BUSINESS_KPI_COMPARE_SELLERS]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'business_kpi',
      operation: 'compareSellers',
      parameters: {
        names: extractCompareSellerNames(input.message),
        ...(input.parameters || {}),
      },
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.BUSINESS_KPI_BONUSES]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'business_kpi',
      operation: 'getBonusSummary',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.BUSINESS_KPI_SHIFTS]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'business_kpi',
      operation: 'getShifts',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.BUSINESS_KPI_DATA_QUALITY]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'business_kpi',
      operation: 'getDataQuality',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.BUSINESS_KPI_MANAGEMENT_SIGNALS]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'business_kpi',
      operation: 'getManagementSignals',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.BUSINESS_KPI_DAILY_REPORT]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'business_kpi',
      operation: 'getDailyReport',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),

  [INTENTS.BUSINESS_KPI_WEEKLY_REPORT]: (input) => createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'business_kpi',
      operation: 'getWeeklyReport',
      parameters: input.parameters || {},
      timeoutMs: 15000,
    }),
  ]),
};

const KNOWN_SELLER_NAMES = Object.freeze([
  'Капитанова',
  'Чередниченко',
  'Кущев',
]);

function normalizeSellerName(name) {
  return name
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}]/gu, '');
}

function sellerNameStem(name) {
  return normalizeSellerName(name).replace(/[ауыеой]$/, '');
}

function messageMentionsSeller(normalizedMessage, name) {
  if (normalizedMessage.includes(normalizeSellerName(name))) return true;
  const stem = sellerNameStem(name);
  if (!stem) return false;
  // Match stem at a word boundary: either preceded by non-letter or start,
  // and followed by an optional trailing case ending.
  const pattern = new RegExp(`(?:^|[^\\p{L}])${stem}[ауыеой]?`, 'u');
  return pattern.test(normalizedMessage);
}

function extractSellerName(message) {
  const normalizedMessage = message.toLocaleLowerCase('ru-RU');
  for (const name of KNOWN_SELLER_NAMES) {
    if (messageMentionsSeller(normalizedMessage, name)) {
      return name;
    }
  }
  return null;
}

function extractCompareSellerNames(message) {
  const normalizedMessage = message.toLocaleLowerCase('ru-RU');
  return KNOWN_SELLER_NAMES.filter(name =>
    messageMentionsSeller(normalizedMessage, name)
  );
}

function taskManagementPlan(input, action, operation) {
  const parsed = parseTaskManagementRequest(input.message, {
    action,
    now: input.now,
    timezone: input.ownerTimezone,
  });
  const parameters = parsed.ok
    ? { ...parsed }
    : {
        clarification: parsed.clarification,
        ...(parsed.pendingTaskSelection ? { pendingTaskSelection: true } : {}),
      };
  delete parameters.ok;
  delete parameters.action;
  return createExecutionPlan([
    createStep({
      id: 'step_1',
      skill: 'arthur-core',
      operation,
      parameters,
      timeoutMs: 10000,
    }),
  ]);
}

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
  MAIL_IMPORTANT_TIMEOUT_MS,
  MAIL_SENDER_TIMEOUT_MS,
  detectIntent,
  taskBriefView,
  unreadMailParameters,
};
