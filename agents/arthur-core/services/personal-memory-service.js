'use strict';

const { createHash } = require('node:crypto');

function normalizeNote(text) {
  return text.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function noteText(value, name = 'text') {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000) {
    throw new TypeError(`${name} must contain 1 to 2000 characters`);
  }
  return value.trim();
}

function selectNotes(records, query = '') {
  if (!query) return records;
  const normalized = normalizeNote(query);
  const exact = records.filter(record => normalizeNote(record.value.text) === normalized);
  return exact.length ? exact : records.filter(record => normalizeNote(record.value.text).includes(normalized));
}

async function listPersonalMemory(service, ownerId, query = '') {
  noteText(ownerId, 'ownerId');
  if (query) noteText(query, 'query');
  const records = await service.store.listPersonalMemory(ownerId);
  return selectNotes(records, query);
}

async function mutatePersonalMemory({ service, store, ownerId, operation, text,
  replacement, input, sourceRef, sourceType, context }) {
  const records = await store.listPersonalMemory(ownerId);
  let before = null;
  if (operation === 'remember') {
    const duplicate = records.find(record => normalizeNote(record.value.text) === normalizeNote(text));
    if (duplicate) return { status: 'duplicate', record: duplicate };
  } else {
    const candidates = selectNotes(records, text);
    if (!candidates.length) return { status: 'not_found' };
    if (candidates.length !== 1) return { status: 'ambiguous', candidates: candidates.slice(0, 10), total: candidates.length };
    before = candidates[0];
    if (input.expectedId && input.expectedId !== before.id) return { status: 'stale' };
    if (operation === 'edit' && normalizeNote(before.value.text) === normalizeNote(replacement)) {
      return { status: 'duplicate', record: before };
    }
    if (operation === 'edit' && records.some(record => record.id !== before.id
      && normalizeNote(record.value.text) === normalizeNote(replacement))) {
      return { status: 'replacement_exists' };
    }
  }
  // Version boundaries must increase even for two commands in the same millisecond.
  const now = new Date(Math.max(Date.parse(service.now()),
    before ? Date.parse(before.validFrom || before.createdAt) + 1 : 0)).toISOString();
  if (before) await store.archiveActiveMemory(ownerId, 'personal', before.key, now);
  const id = service.idFactory();
  const after = operation === 'forget' ? null : {
    id, ownerId, domain: 'personal', type: 'fact',
    key: before?.key || `personal.note:${id}`,
    value: { text: replacement || text }, sourceType,
    ...(sourceRef ? { sourceRef } : {}),
    confidence: 1, sensitivity: 'sensitive', status: 'active',
    validFrom: now, createdAt: now, updatedAt: now,
  };
  if (after) await store.putMemory(after);
  await service.audit(store, { context, domain: 'personal', action: `personal_memory.${operation}`,
    entityType: 'memory', entityId: after?.id || before.id, before, after });
  return { status: operation === 'forget' ? 'forgotten' : operation === 'edit' ? 'updated' : 'saved', record: after || before };
}

async function managePersonalMemory(service, ownerId, operation, input = {}, actorContext) {
  noteText(ownerId, 'ownerId');
  if (!['remember', 'edit', 'forget'].includes(operation)) throw new RangeError('Unsupported personal memory operation');
  const text = operation === 'remember' ? noteText(input.text) : noteText(input.query, 'query');
  const replacement = operation === 'edit' ? noteText(input.replacement, 'replacement') : null;
  const sourceRef = input.sourceRef ? noteText(input.sourceRef, 'sourceRef') : null;
  const sourceType = actorContext?.actorType === 'user' ? 'user' : 'api';
  const context = service.context(actorContext);
  return service.store.transaction(async store => {
    await store.lockPersonalMemoryOwner(ownerId);
    const receiptKey = sourceRef ? `personal.command:${createHash('sha256').update(sourceRef).digest('hex')}` : null;
    if (receiptKey && await store.getActiveMemory(ownerId, 'personal', receiptKey)) {
      return { status: 'already_processed' };
    }
    const result = await mutatePersonalMemory({ service, store, ownerId, operation, text,
      replacement, input, sourceRef, sourceType, context });
    if (receiptKey) {
      const now = service.now();
      await store.putMemory({ id: service.idFactory(), ownerId, domain: 'personal', type: 'reference',
        key: receiptKey, value: { operation, status: result.status }, sourceType, sourceRef,
        confidence: 1, sensitivity: 'restricted', status: 'active',
        validFrom: now, createdAt: now, updatedAt: now });
    }
    return result;
  });
}

module.exports = { normalizeNote, selectNotes, listPersonalMemory, managePersonalMemory };
