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
]));

const TASK_MANAGEMENT_INTENTS = Object.freeze({
  [TASK_MANAGEMENT_ACTIONS.COMPLETE]: INTENTS.CORE_COMPLETE_TASK,
  [TASK_MANAGEMENT_ACTIONS.CANCEL]: INTENTS.CORE_CANCEL_TASK,
  [TASK_MANAGEMENT_ACTIONS.RESCHEDULE]: INTENTS.CORE_RESCHEDULE_TASK,
});

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
  const normalized = message.toLowerCase();

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
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
};
