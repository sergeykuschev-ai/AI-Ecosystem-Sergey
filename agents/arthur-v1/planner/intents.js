'use strict';

const INTENTS = Object.freeze({
  PURCHASING_STATUS: 'purchasing.status',
  PURCHASING_OWNER_REVIEW: 'purchasing.owner_review',
  PURCHASING_FINAL_ORDER: 'purchasing.final_order',
  PURCHASING_SUMMARY: 'purchasing.summary',
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
  INTENTS.KNOWLEDGE_SEARCH,
]));

function detectIntent(message) {
  if (!message || typeof message !== 'string') {
    return INTENTS.UNKNOWN;
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
