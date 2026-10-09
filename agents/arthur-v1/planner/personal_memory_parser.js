'use strict';

function commandText(message) {
  return typeof message === 'string' ? message.trim().replace(/^артур\s*[,!:.-]?\s*/iu, '') : '';
}

function personalMemoryAction(message) {
  const text = commandText(message);
  if (/^запомни(?![\p{L}\p{N}])/iu.test(text)) return 'remember';
  if (/^забудь(?![\p{L}\p{N}])/iu.test(text)) return 'forget';
  if (/^исправь\s+(?:память|запись)(?![\p{L}\p{N}])/iu.test(text)) return 'edit';
  if (/^(?:что\s+ты\s+помнишь\s+обо\s+мне|что\s+ты\s+(?:обо\s+мне\s+)?помнишь|покажи\s+(?:мою|личную)\s+память)(?![\p{L}\p{N}])/iu.test(text)) return 'list';
  return null;
}

function parsePersonalMemoryRequest(message) {
  const action = personalMemoryAction(message);
  const text = commandText(message);
  const patterns = {
    remember: /^запомни\s*[:,—-]?\s*/iu,
    forget: /^забудь\s*(?:про\s+)?[:,—-]?\s*/iu,
    edit: /^исправь\s+(?:память|запись)\s*[:,—-]?\s*/iu,
    list: /^(?:что\s+ты\s+помнишь\s+обо\s+мне|что\s+ты\s+(?:обо\s+мне\s+)?помнишь|покажи\s+(?:мою|личную)\s+память)\s*(?:(?:про|о)\s+)?[:,—-]?\s*/iu,
  };
  if (!action) return { clarification: 'Укажи явную команду для личной памяти.' };
  const body = text.replace(patterns[action], '');
  const remainder = (action === 'list' ? body.replace(/[?？]+$/u, '') : body).trim();
  if (remainder.length > 2000) return { clarification: 'Пришли запись не длиннее 2000 символов.' };
  if (action === 'list') return { action, query: remainder };
  if (!remainder) return { clarification: 'Укажи, что нужно запомнить, исправить или забыть.' };
  if (action === 'edit') {
    const parts = remainder.split(/\s*(?:=>|→)\s*/u);
    if (parts.length !== 2 || !parts.every(part => part.trim())) {
      return { clarification: 'Напиши: «Исправь память: старая запись → новая запись».' };
    }
    return { action, query: parts[0].trim(), replacement: parts[1].trim() };
  }
  return action === 'remember' ? { action, text: remainder } : { action, query: remainder };
}

module.exports = { personalMemoryAction, parsePersonalMemoryRequest };
