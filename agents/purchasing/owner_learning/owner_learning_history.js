const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeAgentRecommendation,
  normalizeOwnerDecision,
} = require('./owner_learning_report');

const HISTORY_SCHEMA_VERSION = 'owner-learning-history-v0.2';
const PATTERNS_REPORT_VERSION = 'owner-learning-patterns-v0.2';
const OWNER_DECISIONS = Object.freeze(['BUY', 'SKIP', 'DEFER']);
const OWNER_DECISION_LABELS = Object.freeze({
  BUY: 'Заказать',
  SKIP: 'Не заказывать',
  DEFER: 'Отложить',
});

class OwnerLearningHistoryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerLearningHistoryError';
    this.code = code;
  }
}

function optionalString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function normalizedIdentifier(value) {
  const normalized = optionalString(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizedText(value) {
  const normalized = optionalString(value);
  return normalized
    ? normalized.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
    : null;
}

function incrementCount(counts, value) {
  if (value !== null) counts.set(value, (counts.get(value) || 0) + 1);
}

function stableKeyContext(items) {
  const skuCounts = new Map();
  const barcodeCounts = new Map();
  const fallbackCounts = new Map();
  for (const item of items) {
    const sku = normalizedIdentifier(item?.sku);
    const barcode = normalizedIdentifier(item?.barcode);
    const name = normalizedText(item?.name);
    const brand = normalizedText(item?.brand) || 'unknown';
    incrementCount(skuCounts, sku);
    incrementCount(barcodeCounts, barcode);
    incrementCount(fallbackCounts, name ? `${brand}|${name}` : null);
  }
  return { skuCounts, barcodeCounts, fallbackCounts };
}

function buildStableItemKey(item, context = stableKeyContext([item])) {
  const sku = normalizedIdentifier(item?.sku);
  if (sku && context.skuCounts.get(sku) === 1) return `sku:${sku}`;

  const barcode = normalizedIdentifier(item?.barcode);
  if (barcode && context.barcodeCounts.get(barcode) === 1) {
    return `barcode:${barcode}`;
  }

  const rowId = optionalString(item?.rowId || item?.itemId);
  if (rowId) return `row:${rowId}`;

  const name = normalizedText(item?.name);
  const brand = normalizedText(item?.brand) || 'unknown';
  const fallback = name ? `${brand}|${name}` : null;
  if (fallback && context.fallbackCounts.get(fallback) === 1) {
    return `brand-name:${fallback}`;
  }

  throw new OwnerLearningHistoryError(
    'AMBIGUOUS_ITEM_IDENTITY',
    'Невозможно построить безопасный стабильный ключ товара.'
  );
}

function indexValues(values, valueField) {
  const result = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const id = optionalString(value?.itemId);
    if (!id) {
      throw new OwnerLearningHistoryError(
        'INVALID_RUN_ENTRY',
        'Товар Owner Learning не содержит itemId.'
      );
    }
    if (result.has(id)) {
      throw new OwnerLearningHistoryError(
        'INVALID_RUN_ENTRY',
        `Owner Learning содержит повторный itemId: ${id}.`
      );
    }
    result.set(id, value?.[valueField] ?? null);
  }
  return result;
}

function requiredRunId(value) {
  const runId = optionalString(value);
  if (!runId) {
    throw new OwnerLearningHistoryError(
      'INVALID_RUN_ENTRY',
      'Owner Learning History требует непустой runId.'
    );
  }
  return runId;
}

function buildHistoryRunEntry({
  runId,
  generatedAt,
  report,
  learningInput,
}) {
  const items = Array.isArray(learningInput?.items)
    ? learningInput.items
    : [];
  const recommendations = indexValues(
    learningInput?.recommendations,
    'status'
  );
  const ownerDecisions = indexValues(
    learningInput?.ownerDecisions,
    'decision'
  );
  const keyContext = stableKeyContext(items);
  const itemRecords = [];

  for (const item of items) {
    const id = optionalString(item?.itemId);
    if (!id) {
      throw new OwnerLearningHistoryError(
        'INVALID_RUN_ENTRY',
        'Owner Learning item не содержит itemId.'
      );
    }
    const ownerDecision = normalizeOwnerDecision(ownerDecisions.get(id));
    if (!ownerDecision) continue;
    const normalizedAgentRecommendation = normalizeAgentRecommendation(
      recommendations.get(id)
    );
    itemRecords.push({
      stableItemKey: buildStableItemKey(item, keyContext),
      sku: optionalString(item.sku),
      barcode: optionalString(item.barcode),
      rowId: optionalString(item.rowId || item.itemId),
      name: optionalString(item.name),
      brand: optionalString(item.brand),
      ownerDecision,
      normalizedAgentRecommendation,
      isAgreement: normalizedAgentRecommendation === null
        ? null
        : normalizedAgentRecommendation === ownerDecision,
      ownerReviewRequired: item.owner_review_required === true,
    });
  }

  itemRecords.sort((left, right) =>
    left.stableItemKey.localeCompare(right.stableItemKey, 'ru')
  );
  return {
    runId: requiredRunId(runId),
    generatedAt: optionalString(generatedAt) || null,
    totalItems: report.totalItems,
    reviewRequiredItems: report.reviewRequiredItems,
    ownerDecisionsTotal: report.ownerDecisionsTotal,
    buyCount: report.buyCount,
    skipCount: report.skipCount,
    deferCount: report.deferCount,
    unresolvedCount: report.unresolvedCount,
    matchesAgentRecommendation: report.matchesAgentRecommendation,
    overridesAgentRecommendation: report.overridesAgentRecommendation,
    agreementRate: report.agreementRate,
    items: itemRecords,
  };
}

function emptyHistory() {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: null,
    runs: [],
  };
}

function validateHistory(value) {
  if (
    !value ||
    value.schemaVersion !== HISTORY_SCHEMA_VERSION ||
    !Array.isArray(value.runs)
  ) {
    throw new OwnerLearningHistoryError(
      'HISTORY_INVALID',
      'Owner Learning History имеет неподдерживаемый формат.'
    );
  }
  const runIds = new Set();
  for (const run of value.runs) {
    const runId = requiredRunId(run?.runId);
    if (runIds.has(runId)) {
      throw new OwnerLearningHistoryError(
        'HISTORY_INVALID',
        'Owner Learning History содержит повторный runId.'
      );
    }
    runIds.add(runId);
    if (!Array.isArray(run.items)) {
      throw new OwnerLearningHistoryError(
        'HISTORY_INVALID',
        'Owner Learning History содержит некорректные товарные записи.'
      );
    }
    const stableItemKeys = new Set();
    for (const item of run.items) {
      if (
        !optionalString(item?.stableItemKey) ||
        !OWNER_DECISIONS.includes(item?.ownerDecision)
      ) {
        throw new OwnerLearningHistoryError(
          'HISTORY_INVALID',
          'Owner Learning History содержит некорректное решение товара.'
        );
      }
      if (stableItemKeys.has(item.stableItemKey)) {
        throw new OwnerLearningHistoryError(
          'HISTORY_INVALID',
          'Owner Learning History повторяет товар внутри одного run.'
        );
      }
      stableItemKeys.add(item.stableItemKey);
    }
  }
  return value;
}

function readHistory(historyPath, options = {}) {
  const fsModule = options.fsModule || fs;
  try {
    return validateHistory(JSON.parse(fsModule.readFileSync(
      historyPath,
      'utf8'
    )));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyHistory();
    if (error instanceof OwnerLearningHistoryError) throw error;
    throw new OwnerLearningHistoryError(
      'HISTORY_INVALID',
      'Owner Learning History повреждён и не был перезаписан.',
      { cause: error }
    );
  }
}

function fsyncDirectory(directoryPath, fsModule) {
  let descriptor;
  try {
    descriptor = fsModule.openSync(directoryPath, 'r');
    fsModule.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fsModule.closeSync(descriptor);
  }
}

function atomicWriteHistory(historyPath, history, options = {}) {
  const fsModule = options.fsModule || fs;
  const directoryPath = path.dirname(historyPath);
  const randomSuffix = options.randomSuffix ||
    crypto.randomBytes(6).toString('hex');
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(historyPath)}.${process.pid}-${randomSuffix}.tmp`
  );
  let descriptor;
  try {
    fsModule.mkdirSync(directoryPath, { recursive: true });
    descriptor = fsModule.openSync(temporaryPath, 'wx', 0o600);
    fsModule.writeFileSync(
      descriptor,
      `${JSON.stringify(history, null, 2)}\n`,
      'utf8'
    );
    fsModule.fsyncSync(descriptor);
    fsModule.closeSync(descriptor);
    descriptor = undefined;
    fsModule.renameSync(temporaryPath, historyPath);
    fsyncDirectory(directoryPath, fsModule);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fsModule.closeSync(descriptor);
      } catch {}
    }
    try {
      if (fsModule.existsSync(temporaryPath)) {
        fsModule.unlinkSync(temporaryPath);
      }
    } catch {}
    throw new OwnerLearningHistoryError(
      'HISTORY_WRITE_FAILED',
      'Не удалось атомарно сохранить Owner Learning History.',
      { cause: error }
    );
  }
}

function appendHistoryRun(history, runEntry, updatedAt = runEntry.generatedAt) {
  validateHistory(history);
  if (history.runs.some(run => run.runId === runEntry.runId)) {
    return { history, added: false };
  }
  return {
    history: {
      schemaVersion: HISTORY_SCHEMA_VERSION,
      updatedAt: optionalString(updatedAt) || null,
      runs: [...history.runs, runEntry],
    },
    added: true,
  };
}

function updateOwnerLearningHistory(historyPath, runEntry, options = {}) {
  const current = readHistory(historyPath, options);
  const result = appendHistoryRun(
    current,
    runEntry,
    options.updatedAt || runEntry.generatedAt
  );
  if (result.added) {
    atomicWriteHistory(historyPath, result.history, options);
  }
  return result;
}

function percentage(value, total) {
  if (total === 0) return null;
  return Math.round((value / total) * 10000) / 100;
}

function dominantDecision(counts, total) {
  const ranked = OWNER_DECISIONS
    .map(decision => [decision, counts[decision]])
    .sort((left, right) => right[1] - left[1]);
  if (ranked[0][1] === ranked[1][1]) {
    return { decision: null, rate: percentage(ranked[0][1], total) };
  }
  return {
    decision: ranked[0][0],
    rate: percentage(ranked[0][1], total),
  };
}

function itemPattern(events) {
  const latest = events.at(-1);
  const counts = { BUY: 0, SKIP: 0, DEFER: 0 };
  let agreementCount = 0;
  let overrideCount = 0;
  for (const event of events) {
    counts[event.ownerDecision] += 1;
    if (event.isAgreement === true) agreementCount += 1;
    if (event.isAgreement === false) overrideCount += 1;
  }
  let consecutiveSameDecisionCount = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].ownerDecision !== latest.ownerDecision) break;
    consecutiveSameDecisionCount += 1;
  }
  const dominant = dominantDecision(counts, events.length);
  return {
    stableItemKey: latest.stableItemKey,
    name: latest.name,
    brand: latest.brand,
    totalOwnerDecisions: events.length,
    buyCount: counts.BUY,
    skipCount: counts.SKIP,
    deferCount: counts.DEFER,
    agreementCount,
    overrideCount,
    dominantOwnerDecision: dominant.decision,
    dominantDecisionRate: dominant.rate,
    consecutiveSameDecisionCount,
    latestOwnerDecision: latest.ownerDecision,
  };
}

function buildOwnerLearningPatterns(history, generatedAt = history.updatedAt) {
  validateHistory(history);
  const byItem = new Map();
  const orderedRuns = [...history.runs].sort((left, right) => {
    const dateResult = String(left.generatedAt || '')
      .localeCompare(String(right.generatedAt || ''));
    return dateResult || left.runId.localeCompare(right.runId);
  });
  for (const run of orderedRuns) {
    for (const item of run.items) {
      if (!byItem.has(item.stableItemKey)) {
        byItem.set(item.stableItemKey, []);
      }
      byItem.get(item.stableItemKey).push(item);
    }
  }

  const patterns = Array.from(byItem.values(), itemPattern)
    .sort((left, right) =>
      left.stableItemKey.localeCompare(right.stableItemKey, 'ru')
    );
  const repeatedDecisions = patterns.filter(pattern =>
    pattern.totalOwnerDecisions >= 2 &&
    pattern.dominantDecisionRate >= 75
  );
  const ruleCandidates = repeatedDecisions.filter(pattern =>
    pattern.dominantOwnerDecision === pattern.latestOwnerDecision &&
    pattern.consecutiveSameDecisionCount >= 3 &&
    pattern.dominantDecisionRate >= 80
  );
  return {
    reportVersion: PATTERNS_REPORT_VERSION,
    generatedAt: optionalString(generatedAt) || null,
    historyRunsCount: history.runs.length,
    accumulatedOwnerDecisions: history.runs.reduce(
      (sum, run) => sum + run.items.length,
      0
    ),
    repeatedItemsCount: repeatedDecisions.length,
    ruleCandidatesCount: ruleCandidates.length,
    repeatedDecisions,
    ruleCandidates,
  };
}

function agreementText(pattern) {
  const comparable = pattern.agreementCount + pattern.overrideCount;
  const rate = percentage(pattern.agreementCount, comparable);
  if (rate === null) return 'Недостаточно данных для расчёта';
  return `${rate >= 50 ? 'да' : 'нет'} (${rate.toFixed(2)}%)`;
}

function buildOwnerLearningPatternsMarkdown(patterns) {
  const lines = [
    '# Повторяющиеся решения владельца',
    '',
    `- Запусков в истории: ${patterns.historyRunsCount}`,
    `- Решений накоплено: ${patterns.accumulatedOwnerDecisions}`,
    `- Товаров с повторяющимися решениями: ${patterns.repeatedItemsCount}`,
    `- Кандидатов на правило: ${patterns.ruleCandidatesCount}`,
    '',
    '## Кандидаты на правило',
    '',
  ];
  if (patterns.ruleCandidates.length === 0) {
    lines.push(
      'Пока недостаточно повторяющихся решений для предложения правил.',
      ''
    );
    return lines.join('\n');
  }
  for (const pattern of patterns.ruleCandidates) {
    lines.push(
      `### ${pattern.name || 'Товар без названия'}`,
      '',
      `- Бренд: ${pattern.brand || 'не указан'}`,
      `- Решение: ${
        OWNER_DECISION_LABELS[pattern.dominantOwnerDecision]
      }`,
      `- Одинаковых решений подряд: ${pattern.consecutiveSameDecisionCount}`,
      `- Всего решений: ${pattern.totalOwnerDecisions}`,
      `- Доля одинаковых решений: ${pattern.dominantDecisionRate.toFixed(2)}%`,
      `- Обычно совпадало с агентом: ${agreementText(pattern)}`,
      ''
    );
  }
  return lines.join('\n');
}

function unavailablePatterns(generatedAt, errorCode) {
  return {
    reportVersion: PATTERNS_REPORT_VERSION,
    generatedAt: optionalString(generatedAt) || null,
    status: 'unavailable',
    errorCode: optionalString(errorCode) || 'HISTORY_UNAVAILABLE',
    historyRunsCount: null,
    accumulatedOwnerDecisions: null,
    repeatedItemsCount: null,
    ruleCandidatesCount: null,
    repeatedDecisions: [],
    ruleCandidates: [],
  };
}

function unavailablePatternsMarkdown() {
  return [
    '# Повторяющиеся решения владельца',
    '',
    'История решений временно недоступна. Основной расчёт заказа завершён.',
    '',
  ].join('\n');
}

module.exports = {
  HISTORY_SCHEMA_VERSION,
  PATTERNS_REPORT_VERSION,
  OwnerLearningHistoryError,
  appendHistoryRun,
  atomicWriteHistory,
  buildHistoryRunEntry,
  buildOwnerLearningPatterns,
  buildOwnerLearningPatternsMarkdown,
  buildStableItemKey,
  emptyHistory,
  readHistory,
  stableKeyContext,
  unavailablePatterns,
  unavailablePatternsMarkdown,
  updateOwnerLearningHistory,
  validateHistory,
};
