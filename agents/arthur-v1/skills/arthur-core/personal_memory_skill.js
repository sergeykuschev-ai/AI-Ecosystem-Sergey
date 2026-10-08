'use strict';

const { ArthurCoreClientError } = require('./core_client');

function result(responseText, data = {}) {
  return { status: 'success', data: { ...data, responseText }, metadata: { source: 'arthur-core.personal-memory' } };
}

function safeExcerpt(text, limit) {
  let out = '';
  for (const char of text) {
    const escaped = char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : char;
    if (out.length + escaped.length > limit) return out + '…';
    out += escaped;
  }
  return out;
}

function displayRecords(records, total = records.length) {
  const shown = records.slice(0, 10);
  const lines = shown.map((record, index) => `${index + 1}. ${safeExcerpt(record.value.text, total === 1 ? 2500 : 200)}\n   Сохранено: ${new Date(record.createdAt).toLocaleDateString('ru-RU', { timeZone: 'Asia/Vladivostok' })}`);
  if (total > shown.length) lines.push(`Ещё ${total - shown.length}. Уточни тему поиска.`);
  return lines.join('\n');
}

function createPersonalMemorySkill({ client, ownerProfileId }) {
  if (!ownerProfileId || !client?.listPersonalMemory || !client?.managePersonalMemory) {
    throw new TypeError('Personal memory requires a Core client and canonical owner profile');
  }
  return {
    id: 'personal-memory', name: 'Personal Memory', version: '1.0.0',
    capabilities: [{ id: 'list', readOnly: true }, { id: 'remember', readOnly: false },
      { id: 'edit', readOnly: false }, { id: 'forget', readOnly: false }],
    async execute(input) {
      const parameters = input.parameters || {};
      if (parameters.clarification) return result(parameters.clarification);
      const context = { correlationId: input.correlationId, actorId: ownerProfileId, actorType: 'user' };
      try {
        if (input.operation === 'list') {
          const data = await client.listPersonalMemory(ownerProfileId, parameters.query || '', context);
          return result(data.records.length ? `Из явно сохранённых записей:\n${displayRecords(data.records, data.total)}`
            : 'В явно сохранённой личной памяти таких записей нет.', { total: data.total });
        }
        if (!['remember', 'edit', 'forget'].includes(input.operation)) throw new TypeError('Unsupported personal memory action');
        const data = await client.managePersonalMemory(ownerProfileId, input.operation, parameters, context);
        const responses = {
          saved: 'Запомнил', updated: 'Исправил запись', forgotten: 'Убрал из активной памяти',
          duplicate: 'Эта запись уже есть', not_found: 'Не нашёл такую запись в личной памяти.',
          stale: 'Запись уже изменилась. Повтори команду.',
          replacement_exists: 'Новая запись уже есть. Ничего не изменил.',
          already_processed: 'Это поручение уже обработано. Проверь текущую личную память.',
        };
        if (data.status === 'ambiguous') {
          return result(`Нашёл несколько записей. Ничего не изменил:\n${displayRecords(data.candidates, data.total)}\nПовтори команду с полным текстом нужной записи.`);
        }
        const text = responses[data.status];
        if (!text) throw new TypeError('Unknown personal memory result');
        return result(data.record ? `${text}:\n${safeExcerpt(data.record.value.text, 2500)}` : text, { memoryStatus: data.status });
      } catch (error) {
        if (error instanceof ArthurCoreClientError) {
          return result('Личная память сейчас недоступна. Сохранение или изменение не подтверждено.', { memoryStatus: 'unavailable' });
        }
        throw error;
      }
    },
    async health() { return client.health(); },
  };
}

module.exports = { createPersonalMemorySkill };
