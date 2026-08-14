'use strict';

const { matchesCreateTaskIntent } = require('./task_request_parser');

const INTENTS = Object.freeze({
  PURCHASING_STATUS: 'purchasing.status',
  PURCHASING_OWNER_REVIEW: 'purchasing.owner_review',
  PURCHASING_FINAL_ORDER: 'purchasing.final_order',
  PURCHASING_SUMMARY: 'purchasing.summary',
  CORE_PROFILE: 'arthur_core.profile',
  CORE_TASKS: 'arthur_core.tasks',
  CORE_TASK_BRIEF: 'arthur_core.task_brief',
  CORE_CREATE_TASK: 'arthur_core.create_task',
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

const DETERMINISTIC_INTENTS = Object.freeze(new Set([
  INTENTS.PURCHASING_STATUS,
  INTENTS.PURCHASING_OWNER_REVIEW,
  INTENTS.PURCHASING_FINAL_ORDER,
  INTENTS.PURCHASING_SUMMARY,
  INTENTS.CORE_PROFILE,
  INTENTS.CORE_TASKS,
  INTENTS.CORE_TASK_BRIEF,
  INTENTS.CORE_CREATE_TASK,
]));

function detectIntent(message) {
  if (!message || typeof message !== 'string') {
    return INTENTS.UNKNOWN;
  }
  if (matchesCreateTaskIntent(message)) {
    return INTENTS.CORE_CREATE_TASK;
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
  detectIntent,
  isDeterministicIntent,
};
