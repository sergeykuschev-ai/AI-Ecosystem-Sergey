'use strict';

/* Deterministic seller task planner.
   Arthur proposes; the owner decides. The planner only picks assignments from the
   library using KPI attention signals, targets, and assignment history.
   No LLM, no randomness: identical inputs produce identical proposals. */

const { TASK_TYPES } = require('../rules/seller_task_library');

const ROTATION_DAYS = 30;
const DEFAULT_TASKS_PER_SELLER = 2;
const MAX_TASKS_PER_SELLER = 3;

/* KPI signal key -> candidate library codes, best first.
   QR (qrShare) intentionally has NO auto-assigned task for MVP: a suitable
   assignment does not exist in the library yet, so low QR stays a Business KPI
   signal only. An overall KPI drop without a specific lagging metric (key
   'kpi') also falls back to the normal STORE/KNOWLEDGE rotation. */
const KPI_TASK_MAP = Object.freeze({
  itemsPerReceipt: Object.freeze(['SALE-08', 'SALE-10', 'SALE-01']),
  averageCheck: Object.freeze(['SALE-02', 'SALE-04', 'SALE-10']),
  revenuePerShift: Object.freeze(['SALE-03', 'SALE-10']),
});

const NO_TASK_SIGNAL_KEYS = Object.freeze(new Set(['qrShare', 'kpi']));

function parseDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysBetween(fromDateText, toDateText) {
  return Math.round((parseDate(toDateText) - parseDate(fromDateText)) / 86400000);
}

function isWithinRotationWindow(historyEntry, todayText) {
  return daysBetween(historyEntry.shiftDate, todayText) < ROTATION_DAYS;
}

/* A task may repeat earlier than ROTATION_DAYS only for objective reasons. */
function allowsEarlyRepeat(historyEntry) {
  return historyEntry.status === 'NOT_COMPLETED';
}

/* Codes the seller has already covered recently (rotation window applies). */
function recentCodes(historyEntries, todayText) {
  const codes = new Set();
  for (const entry of historyEntries) {
    if (!entry.libraryCode) continue;
    if (!isWithinRotationWindow(entry, todayText)) continue;
    if (allowsEarlyRepeat(entry)) continue;
    codes.add(entry.libraryCode);
  }
  return codes;
}

/* Absolute misses against current targets — a second, simpler KPI signal that
   works even when trend windows have insufficient history. */
function absoluteMissKeys(performanceItem, targets) {
  if (!performanceItem || !targets) return [];
  const misses = [];
  const checks = [
    ['itemsPerReceipt', performanceItem.itemsPerReceipt, targets.itemsPerReceipt],
    ['averageCheck', performanceItem.averageCheck, targets.averageCheck],
    ['revenuePerShift', performanceItem.revenuePerShift, targets.shiftRevenue],
  ];
  for (const [key, actual, target] of checks) {
    if (actual === null || actual === undefined || target === null || target === undefined) continue;
    if (target > 0 && actual < target) misses.push(key);
  }
  return misses;
}

function pickKpiTaskCodes(performanceItem, targets) {
  const keys = [];
  const attentionKey = performanceItem?.attentionMetric?.key;
  if (attentionKey && !NO_TASK_SIGNAL_KEYS.has(attentionKey) && KPI_TASK_MAP[attentionKey]) {
    keys.push(attentionKey);
  }
  for (const key of absoluteMissKeys(performanceItem, targets)) {
    if (!keys.includes(key)) keys.push(key);
  }
  const codes = [];
  for (const key of keys) {
    for (const code of KPI_TASK_MAP[key]) {
      if (!codes.includes(code)) codes.push(code);
    }
  }
  return codes;
}

function resolveFirstAvailable(codes, blockedCodes, libraryByCode) {
  for (const code of codes) {
    if (blockedCodes.has(code)) continue;
    if (!libraryByCode.has(code)) continue;
    return code;
  }
  return null;
}

function pickRotationCode(type, blockedCodes, historyEntries, todayText, libraryByCode) {
  const candidates = [...libraryByCode.values()]
    .filter(task => task.type === type)
    .sort((left, right) => left.code.localeCompare(right.code));
  const usedCodes = new Set(
    historyEntries
      .filter(entry => entry.status !== 'NOT_COMPLETED')
      .map(entry => entry.libraryCode)
      .filter(Boolean)
  );
  const fresh = candidates.filter(task => !usedCodes.has(task.code));
  const pool = fresh.length ? fresh : candidates;
  for (const task of pool) {
    if (blockedCodes.has(task.code)) continue;
    return task.code;
  }
  return null;
}

function buildReason(task, performanceItem, signal) {
  if (signal.kind === 'kpi') {
    const metricLabel = performanceItem?.attentionMetric?.label
      || signal.key
      || 'KPI';
    return `КПИ-проблема: показатель «${metricLabel}» отстаёт от целевого уровня. Задание направлено на отработку этого навыка.`;
  }
  if (signal.kind === 'store') {
    return 'Плановый контроль магазина и товара. Критичных проблем KPI нет — смена используется для поддержания порядка.';
  }
  return 'Критичных проблем нет — назначена очередная учебная тема для развития знаний о товаре.';
}

function proposeForSeller({ employeeId, employeeName, performanceItem, targets, historyEntries, shiftDate, todayText, libraryByCode }) {
  const blocked = recentCodes(historyEntries, todayText);
  const proposals = [];
  const signals = [];

  const kpiCodes = pickKpiTaskCodes(performanceItem, targets);
  const kpiCode = resolveFirstAvailable(kpiCodes, blocked, libraryByCode);
  if (kpiCode) {
    const task = libraryByCode.get(kpiCode);
    proposals.push({
      employeeId,
      employeeName,
      libraryCode: kpiCode,
      taskType: task.type,
      reason: buildReason(task, performanceItem, { kind: 'kpi', key: performanceItem?.attentionMetric?.key }),
    });
    signals.push('kpi');
  }

  const storeCode = pickRotationCode(TASK_TYPES.STORE, blocked, historyEntries, todayText, libraryByCode);
  if (storeCode) {
    const task = libraryByCode.get(storeCode);
    proposals.push({
      employeeId,
      employeeName,
      libraryCode: storeCode,
      taskType: task.type,
      reason: buildReason(task, performanceItem, { kind: 'store' }),
    });
  }

  const knowledgeCode = pickRotationCode(TASK_TYPES.KNOWLEDGE, blocked, historyEntries, todayText, libraryByCode);
  if (knowledgeCode) {
    const task = libraryByCode.get(knowledgeCode);
    proposals.push({
      employeeId,
      employeeName,
      libraryCode: knowledgeCode,
      taskType: task.type,
      reason: buildReason(task, performanceItem, { kind: 'knowledge' }),
    });
  }

  const limit = signals.includes('kpi') ? MAX_TASKS_PER_SELLER : DEFAULT_TASKS_PER_SELLER;
  return proposals.slice(0, limit).map(proposal => ({
    ...proposal,
    shiftDate,
  }));
}

/* Build proposals for every active seller.
   sellers: active employees participating in seller KPI.
   performanceItems: buildSellerPerformance().items (may be missing for some sellers).
   historyEntries: prior proposals for the store, mapped to {employeeId, shiftDate, libraryCode, status, source}. */
function buildTaskProposals(options) {
  const {
    sellers,
    targets = null,
    performanceItems = [],
    historyEntries = [],
    shiftDate,
    today,
    library,
  } = options;

  const todayText = typeof today === 'string' ? today : today.toISOString().slice(0, 10);
  const normalizedLibrary = (library || []).map(task => ({
    ...task,
    type: task.type || task.taskType,
  }));
  const libraryByCode = new Map(normalizedLibrary.map(task => [task.code, task]));
  const historyByEmployee = new Map();
  for (const entry of historyEntries) {
    const list = historyByEmployee.get(entry.employeeId) || [];
    list.push(entry);
    historyByEmployee.set(entry.employeeId, list);
  }
  const performanceByEmployee = new Map(performanceItems.map(item => [item.employeeId, item]));

  const proposals = [];
  const orderedSellers = [...sellers].sort((left, right) => left.displayName.localeCompare(right.displayName, 'ru'));
  for (const seller of orderedSellers) {
    proposals.push(...proposeForSeller({
      employeeId: seller.id,
      employeeName: seller.displayName,
      performanceItem: performanceByEmployee.get(seller.id) || null,
      targets,
      historyEntries: historyByEmployee.get(seller.id) || [],
      shiftDate,
      todayText,
      libraryByCode,
    }));
  }
  return proposals;
}

module.exports = {
  DEFAULT_TASKS_PER_SELLER,
  MAX_TASKS_PER_SELLER,
  ROTATION_DAYS,
  buildTaskProposals,
};
