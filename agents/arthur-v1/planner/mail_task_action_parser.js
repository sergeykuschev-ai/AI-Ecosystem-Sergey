'use strict';

const { createSenderAliasRegistry, normalizeMatchText } = require('../skills/mail/sender_alias_registry');

const POSITIVE_REPLIES = Object.freeze(new Set([
  'да',
  'создай',
  'создать',
  'сделай',
  'ок',
  'хорошо',
  'давай',
]));

const NEGATIVE_REPLIES = Object.freeze(new Set([
  'нет',
  'не надо',
  'отмена',
  'не создавать',
]));

const ORDINALS = Object.freeze(new Map([
  ['первая', 1],
  ['первую', 1],
  ['вторая', 2],
  ['вторую', 2],
  ['третья', 3],
  ['третью', 3],
]));

function normalizeReply(message) {
  return normalizeMatchText(message).replace(/[._+-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function parseMailTaskActionReply(message, aliasRegistry = createSenderAliasRegistry()) {
  if (typeof message !== 'string') return null;
  const normalized = normalizeReply(message);
  if (!normalized) return null;
  if (POSITIVE_REPLIES.has(normalized)) return { type: 'confirm' };
  if (NEGATIVE_REPLIES.has(normalized)) return { type: 'reject' };
  if (/^[1-3]$/u.test(normalized)) {
    return { type: 'selection', selectionNumber: Number(normalized) };
  }
  if (ORDINALS.has(normalized)) {
    return { type: 'selection', selectionNumber: ORDINALS.get(normalized) };
  }

  const targeted = normalized.match(/^(?:создай|создать|сделай)\s+(?:по|для)\s+(.+)$/u);
  if (!targeted) return null;
  const query = targeted[1].trim();
  if (!query) return null;
  const resolved = aliasRegistry.resolve(query);
  return {
    type: 'target',
    query,
    aliasId: resolved.known ? resolved.aliasId : null,
  };
}

module.exports = {
  NEGATIVE_REPLIES,
  POSITIVE_REPLIES,
  parseMailTaskActionReply,
};
