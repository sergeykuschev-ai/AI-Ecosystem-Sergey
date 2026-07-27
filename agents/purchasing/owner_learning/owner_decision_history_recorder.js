const {
  appendDecisionHistoryEntry,
  createDecisionHistoryEntry,
} = require('./owner_decision_history');

const RECORDER_STATUSES = Object.freeze([
  'RECORDED',
  'DUPLICATE',
  'UNAVAILABLE',
  'SKIPPED',
]);
const SAFE_UNAVAILABLE_CODES = new Set([
  'DECISION_HISTORY_CORRUPTED',
  'DECISION_HISTORY_SCHEMA_UNSUPPORTED',
  'DECISION_HISTORY_READ_FAILED',
  'DECISION_HISTORY_WRITE_FAILED',
  'DECISION_HISTORY_INVALID',
]);

function optionalString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function safeWarning(code, message) {
  return {
    code,
    message,
  };
}

function resultFor(status, {
  decisionId = null,
  added = false,
  warning = null,
} = {}) {
  return {
    status,
    decisionId,
    added,
    warning,
  };
}

function missingRequiredContext(input) {
  return !optionalString(input.historyFilePath) ||
    !optionalString(input.source) ||
    !optionalString(input.runContext?.recordedAt) ||
    !optionalString(input.itemContext?.stableItemKey) ||
    !optionalString(input.ownerDecision?.decision);
}

function recorderInput(input) {
  const run = input.runContext || {};
  const item = input.itemContext || {};
  const agent = input.agentDecision || {};
  const owner = input.ownerDecision || {};
  const rule = input.ruleContext || {};
  return {
    recordedAt: run.recordedAt,
    source: input.source,
    runId: run.runId ?? null,
    supplier: item.supplier ?? run.supplier ?? null,
    stableItemKey: item.stableItemKey,
    sku: item.sku ?? null,
    productName: item.productName ?? item.name ?? null,
    brand: item.brand ?? null,
    category: item.category ?? null,
    agentRecommendation: agent.recommendation ?? null,
    agentQuantity: agent.quantity ?? null,
    ownerDecision: owner.decision,
    ownerQuantity: owner.quantity ?? null,
    reasonCode: owner.reasonCode ?? 'NOT_SPECIFIED',
    ownerComment: owner.comment ?? null,
    ruleId: rule.ruleId ?? null,
    applicationMode:
      run.applicationMode ?? rule.applicationMode ?? null,
    financialContext: input.financialContext || {},
    inventoryContext: input.inventoryContext || {},
    salesContext: input.salesContext || {},
    metadata: input.metadata || {},
  };
}

function logUnavailable(logger, warning) {
  if (typeof logger?.warn === 'function') {
    logger.warn(
      `[${warning.code}] Owner Decision History недоступен.`
    );
  }
}

function recordOwnerDecisionHistory(input = {}, dependencies = {}) {
  if (missingRequiredContext(input)) {
    return resultFor('SKIPPED', {
      warning: safeWarning(
        'DECISION_HISTORY_CONTEXT_INCOMPLETE',
        'Недостаточно подтверждённого контекста для записи истории.'
      ),
    });
  }
  const createEntry = dependencies.createEntry ||
    createDecisionHistoryEntry;
  const appendEntry = dependencies.appendEntry ||
    appendDecisionHistoryEntry;
  try {
    const entry = createEntry(recorderInput(input));
    const appended = appendEntry({
      filePath: input.historyFilePath,
      entry,
      fsModule: dependencies.fsModule,
      logger: { error() {} },
      randomSuffix: dependencies.randomSuffix,
    });
    return resultFor(appended.added ? 'RECORDED' : 'DUPLICATE', {
      decisionId: appended.entry?.decisionId || entry.decisionId,
      added: appended.added === true,
    });
  } catch (error) {
    const validationFailure = [
      'DECISION_HISTORY_ENTRY_INVALID',
      'DECISION_HISTORY_UNSAFE_DATA',
    ].includes(error?.code);
    const warning = safeWarning(
      validationFailure
        ? 'DECISION_HISTORY_CONTEXT_INVALID'
        : SAFE_UNAVAILABLE_CODES.has(error?.code)
          ? error.code
          : 'DECISION_HISTORY_UNAVAILABLE',
      validationFailure
        ? 'Контекст решения не прошёл безопасную проверку истории.'
        : 'Историю решения временно не удалось сохранить.'
    );
    if (validationFailure) {
      return resultFor('SKIPPED', { warning });
    }
    logUnavailable(input.logger, warning);
    return resultFor('UNAVAILABLE', { warning });
  }
}

module.exports = {
  RECORDER_STATUSES,
  recordOwnerDecisionHistory,
  recorderInput,
};
