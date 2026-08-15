'use strict';

const { businessTopics, senderLabel } = require('./mail_analysis');

const MAX_MAIL_TASK_PROPOSALS = 3;
const MAX_PROPOSAL_SUBJECT_LENGTH = 160;

const TOPIC_ACTIONS = Object.freeze(new Map([
  ['прайс', 'Проверить прайс'],
  ['цены', 'Проверить цены'],
  ['заказ', 'Проверить заказ'],
  ['поставка', 'Проверить поставку'],
  ['наличие', 'Проверить наличие'],
  ['договор', 'Проверить договор'],
  ['документы', 'Проверить документы'],
  ['счёт', 'Проверить счёт'],
  ['оплата', 'Проверить оплату'],
  ['возврат/претензия', 'Проверить возврат или претензию'],
  ['акция', 'Проверить акцию'],
  ['PROMO', 'Проверить PROMO'],
]));

function boundedSubject(value) {
  const subject = String(value || '(без темы)').replace(/\s+/gu, ' ').trim();
  if (subject.length <= MAX_PROPOSAL_SUBJECT_LENGTH) return subject;
  return `${subject.slice(0, MAX_PROPOSAL_SUBJECT_LENGTH - 1).trimEnd()}…`;
}

function mailTaskSourceRef(message) {
  const existing = String(message?.sourceRef || '').trim();
  if (!existing) throw new TypeError('mail sourceRef is required for a task proposal');
  if (existing.startsWith('mail:')) return existing;
  const provider = String(message?.provider || 'unknown').trim().toLowerCase();
  if (existing.startsWith(`${provider}:`)) return `mail:${existing}`;
  return `mail:${provider}:${existing}`;
}

function proposalAction(message) {
  const subjectOnly = { ...message, snippet: '' };
  const topics = businessTopics(subjectOnly);
  const topic = topics.find(candidate => TOPIC_ACTIONS.has(candidate));
  return topic ? TOPIC_ACTIONS.get(topic) : null;
}

function createMailTaskProposal(message, aliasRegistry) {
  if (!message || typeof message !== 'object') {
    throw new TypeError('normalized mail message is required for a task proposal');
  }
  if (!aliasRegistry || typeof aliasRegistry.findKnownCompany !== 'function') {
    throw new TypeError('sender alias registry is required for a task proposal');
  }

  const company = aliasRegistry.findKnownCompany(message);
  const action = proposalAction(message);
  const sender = senderLabel(message);
  const title = company
    ? `${action || 'Проверить письмо'} ${company.taskName}`
    : `${action || 'Проверить письмо от'}${action ? ` от ${sender}` : ` ${sender}`}`;

  return Object.freeze({
    mailboxId: message.mailboxId,
    sourceRef: mailTaskSourceRef(message),
    title,
    subject: boundedSubject(message.subject),
    sender,
    companyAliasId: company?.aliasId || null,
    companyDisplayName: company?.displayName || null,
  });
}

function createMailTaskProposals(messages, aliasRegistry, limit = MAX_MAIL_TASK_PROPOSALS) {
  const proposals = [];
  const seenSourceRefs = new Set();
  for (const message of messages || []) {
    const proposal = createMailTaskProposal(message, aliasRegistry);
    if (seenSourceRefs.has(proposal.sourceRef)) continue;
    proposals.push(proposal);
    seenSourceRefs.add(proposal.sourceRef);
    if (proposals.length >= limit) break;
  }
  return Object.freeze(proposals);
}

function appendTaskProposal(responseText, proposals) {
  if (!Array.isArray(proposals) || proposals.length === 0) return responseText;
  if (proposals.length === 1) {
    return `${responseText}\n\nСоздать задачу «${proposals[0].title}»?`;
  }
  return [
    responseText,
    '',
    'Могу создать задачу по одному из этих писем.',
    'Уточни номер или компанию.',
  ].join('\n');
}

function pendingMailAction(proposals) {
  if (!Array.isArray(proposals) || proposals.length === 0) return null;
  return Object.freeze({
    action: 'createTaskFromMail',
    candidates: proposals.map(proposal => ({ ...proposal })),
  });
}

module.exports = {
  MAX_MAIL_TASK_PROPOSALS,
  TOPIC_ACTIONS,
  appendTaskProposal,
  createMailTaskProposal,
  createMailTaskProposals,
  mailTaskSourceRef,
  pendingMailAction,
};
