'use strict';

const { matchesCreateTaskIntent } = require('./task_request_parser');
const {
  TASK_MANAGEMENT_ACTIONS,
  detectTaskManagementAction,
} = require('./task_management_parser');
const {
  matchesImportantMailIntent,
  matchesRecentMailIntent,
  matchesSearchMailIntent,
  matchesSenderMailIntent,
} = require('./mail_request_parser');
const { matchesWaitingTaskIntent } = require('./waiting_request_parser');

const INTENTS = Object.freeze({
  PURCHASING_STATUS: 'purchasing.status',
  PURCHASING_OWNER_REVIEW: 'purchasing.owner_review',
  PURCHASING_FINAL_ORDER: 'purchasing.final_order',
  PURCHASING_SUMMARY: 'purchasing.summary',
  CORE_PROFILE: 'arthur_core.profile',
  CORE_TASKS: 'arthur_core.tasks',
  CORE_TASK_BRIEF: 'arthur_core.task_brief',
  CORE_CREATE_TASK: 'arthur_core.create_task',
  CORE_WAITING_TASK: 'arthur_core.waiting_task',
  CORE_COMPLETE_TASK: 'arthur_core.complete_task',
  CORE_CANCEL_TASK: 'arthur_core.cancel_task',
  CORE_RESCHEDULE_TASK: 'arthur_core.reschedule_task',
  MAIL_UNREAD: 'mail.unread',
  MAIL_RECENT: 'mail.recent',
  MAIL_SEARCH: 'mail.search',
  MAIL_SENDER: 'mail.sender',
  MAIL_IMPORTANT: 'mail.important',
  KNOWLEDGE_SEARCH: 'knowledge.search',
  BUSINESS_KPI_STORE_SUMMARY: 'business_kpi.store_summary',
  BUSINESS_KPI_TODAY: 'business_kpi.today',
  BUSINESS_KPI_SELLERS: 'business_kpi.sellers',
  BUSINESS_KPI_SELLER: 'business_kpi.seller',
  BUSINESS_KPI_COMPARE_SELLERS: 'business_kpi.compare_sellers',
  BUSINESS_KPI_BONUSES: 'business_kpi.bonuses',
  BUSINESS_KPI_SHIFTS: 'business_kpi.shifts',
  BUSINESS_KPI_DATA_QUALITY: 'business_kpi.data_quality',
  BUSINESS_KPI_MANAGEMENT_SIGNALS: 'business_kpi.management_signals',
  BUSINESS_KPI_DAILY_REPORT: 'business_kpi.daily_report',
  BUSINESS_KPI_WEEKLY_REPORT: 'business_kpi.weekly_report',
  UNKNOWN: 'unknown',
});

const INTENT_KEYWORDS = Object.freeze({
  [INTENTS.PURCHASING_STATUS]: [
    'закупщик',
    'закупки',
    'что с закупщиком',
    'что с закупками',
    'статус закупок',
  ],
  [INTENTS.PURCHASING_OWNER_REVIEW]: [
    'спорные позиции',
    'owner review',
    'ручная проверка',
    'на проверке',
    'на решение',
  ],
  [INTENTS.PURCHASING_FINAL_ORDER]: [
    'последний заказ',
    'финальный заказ',
    'итоговый заказ',
    'final order',
  ],
  [INTENTS.CORE_PROFILE]: [
    'кто я',
    'мой профиль',
    'покажи мой профиль',
  ],
  [INTENTS.CORE_TASK_BRIEF]: [
    'что у меня сегодня',
    'задачи сегодня',
    'какие задачи просрочены',
    'просроченные задачи',
    'сводка по задачам',
    'сводку по задачам',
  ],
  [INTENTS.CORE_TASKS]: [
    'что у меня по задачам',
    'мои задачи',
    'покажи задачи',
  ],
  [INTENTS.BUSINESS_KPI_DAILY_REPORT]: [
    'итоги дня',
    'отчёт за день',
    'ежедневный отчёт',
    'сводка дня',
  ],
  [INTENTS.BUSINESS_KPI_WEEKLY_REPORT]: [
    'итоги недели',
    'отчёт за неделю',
    'еженедельный отчёт',
    'сводка недели',
  ],
  [INTENTS.PURCHASING_SUMMARY]: [
    'сводка',
    'summary',
    'итог',
    'подведи итог',
  ],
  [INTENTS.KNOWLEDGE_SEARCH]: [
    'матрица',
    'правило',
    'документация',
    'архитектура',
    'решение',
    'policy',
  ],
  [INTENTS.BUSINESS_KPI_STORE_SUMMARY]: [
    'как дела у миски',
    'как миска',
    'сводка по магазину',
    'выручка миски',
    'план миски',
    'сколько осталось до плана',
    'какой прогноз месяца',
    'средний чек миски',
    'товаров в чеке миска',
  ],
  [INTENTS.BUSINESS_KPI_TODAY]: [
    'как сегодня',
    'сегодня миска',
    'итоги дня',
    'смены сегодня',
  ],
  [INTENTS.BUSINESS_KPI_SELLERS]: [
    'продавцы',
    'кто сейчас лучше работает',
    'лучший продавец',
    'рейтинг продавцов',
    'kpi продавцов',
  ],
  [INTENTS.BUSINESS_KPI_SELLER]: [
    'как капитанова',
    'как чередниченко',
    'как кущев',
    'премия у капитановой',
    'премия у чередниченко',
    'какие смены у капитановой',
  ],
  [INTENTS.BUSINESS_KPI_COMPARE_SELLERS]: [
    'сравни капитанову',
    'сравни чередниченко',
    'сравни продавцов',
  ],
  [INTENTS.BUSINESS_KPI_BONUSES]: [
    'премии',
    'бонусы',
    'премия продавцов',
  ],
  [INTENTS.BUSINESS_KPI_SHIFTS]: [
    'смены',
    'последние смены',
  ],
  [INTENTS.BUSINESS_KPI_DATA_QUALITY]: [
    'какие данные не заполнены',
    'качество данных',
    'недостаточно данных',
    'не заполнено',
  ],
  [INTENTS.BUSINESS_KPI_MANAGEMENT_SIGNALS]: [
    'что требует внимания',
    'управленческий блок',
    'внимание',
    'проблемы',
  ],
});

function matchesUnreadMailIntent(message) {
  if (typeof message !== 'string') return false;
  const normalized = message.toLocaleLowerCase('ru-RU');
  return normalized.includes('непрочитан') && normalized.includes('письм');
}

const DETERMINISTIC_INTENTS = Object.freeze(new Set([
  INTENTS.PURCHASING_STATUS,
  INTENTS.PURCHASING_OWNER_REVIEW,
  INTENTS.PURCHASING_FINAL_ORDER,
  INTENTS.PURCHASING_SUMMARY,
  INTENTS.CORE_PROFILE,
  INTENTS.CORE_TASKS,
  INTENTS.CORE_TASK_BRIEF,
  INTENTS.CORE_CREATE_TASK,
  INTENTS.CORE_WAITING_TASK,
  INTENTS.CORE_COMPLETE_TASK,
  INTENTS.CORE_CANCEL_TASK,
  INTENTS.CORE_RESCHEDULE_TASK,
  INTENTS.MAIL_UNREAD,
  INTENTS.MAIL_RECENT,
  INTENTS.MAIL_SEARCH,
  INTENTS.MAIL_SENDER,
  INTENTS.MAIL_IMPORTANT,
  INTENTS.BUSINESS_KPI_STORE_SUMMARY,
  INTENTS.BUSINESS_KPI_TODAY,
  INTENTS.BUSINESS_KPI_SELLERS,
  INTENTS.BUSINESS_KPI_SELLER,
  INTENTS.BUSINESS_KPI_COMPARE_SELLERS,
  INTENTS.BUSINESS_KPI_BONUSES,
  INTENTS.BUSINESS_KPI_SHIFTS,
  INTENTS.BUSINESS_KPI_DATA_QUALITY,
  INTENTS.BUSINESS_KPI_MANAGEMENT_SIGNALS,
  INTENTS.BUSINESS_KPI_DAILY_REPORT,
  INTENTS.BUSINESS_KPI_WEEKLY_REPORT,
]));

const TASK_MANAGEMENT_INTENTS = Object.freeze({
  [TASK_MANAGEMENT_ACTIONS.COMPLETE]: INTENTS.CORE_COMPLETE_TASK,
  [TASK_MANAGEMENT_ACTIONS.CANCEL]: INTENTS.CORE_CANCEL_TASK,
  [TASK_MANAGEMENT_ACTIONS.RESCHEDULE]: INTENTS.CORE_RESCHEDULE_TASK,
});

function matchesCompareSellersIntent(message) {
  if (typeof message !== 'string') return false;
  const normalized = message.toLocaleLowerCase('ru-RU');
  return /сравни/.test(normalized) &&
    (normalized.includes('капитанов') || normalized.includes('чередниченко') || normalized.includes('продавц'));
}

function detectIntent(message) {
  if (!message || typeof message !== 'string') {
    return INTENTS.UNKNOWN;
  }
  const taskAction = detectTaskManagementAction(message);
  if (taskAction) return TASK_MANAGEMENT_INTENTS[taskAction];
  if (matchesCreateTaskIntent(message)) {
    return INTENTS.CORE_CREATE_TASK;
  }
  if (matchesWaitingTaskIntent(message)) {
    return INTENTS.CORE_WAITING_TASK;
  }
  if (matchesImportantMailIntent(message)) {
    return INTENTS.MAIL_IMPORTANT;
  }
  if (matchesSenderMailIntent(message)) {
    return INTENTS.MAIL_SENDER;
  }
  if (matchesSearchMailIntent(message)) {
    return INTENTS.MAIL_SEARCH;
  }
  if (matchesRecentMailIntent(message)) {
    return INTENTS.MAIL_RECENT;
  }
  if (matchesUnreadMailIntent(message)) {
    return INTENTS.MAIL_UNREAD;
  }
  if (matchesCompareSellersIntent(message)) {
    return INTENTS.BUSINESS_KPI_COMPARE_SELLERS;
  }
  const normalized = message.toLocaleLowerCase('ru-RU');

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword.toLocaleLowerCase('ru-RU'))) {
        return intent;
      }
    }
  }

  return INTENTS.UNKNOWN;
}

function isDeterministicIntent(intent) {
  return Boolean(intent && DETERMINISTIC_INTENTS.has(intent));
}

module.exports = {
  INTENTS,
  INTENT_KEYWORDS,
  DETERMINISTIC_INTENTS,
  TASK_MANAGEMENT_INTENTS,
  detectIntent,
  isDeterministicIntent,
  matchesUnreadMailIntent,
  matchesImportantMailIntent,
  matchesRecentMailIntent,
  matchesSearchMailIntent,
  matchesSenderMailIntent,
  matchesCompareSellersIntent,
};
