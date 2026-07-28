'use strict';

const fs = require('node:fs');

const DEFAULT_LABEL = 'JSON-конфигурация';

function errorWithCause(message, code, cause) {
  const error = new Error(message, { cause });
  error.code = code;
  return error;
}

function configLabel(options) {
  return typeof options.label === 'string' && options.label.trim() !== ''
    ? options.label.trim()
    : DEFAULT_LABEL;
}

function loadRequiredJson(filePath, options = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new TypeError('filePath должен быть непустой строкой.');
  }

  const label = configLabel(options);
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch (cause) {
    const missing = cause.code === 'ENOENT';
    const reason = missing ? 'файл не найден' : cause.message;
    throw errorWithCause(
      `Не удалось прочитать JSON-файл «${filePath}» (${label}): ${reason}.`,
      missing ? 'JSON_CONFIG_NOT_FOUND' : 'JSON_CONFIG_READ_ERROR',
      cause
    );
  }

  try {
    return JSON.parse(source);
  } catch (cause) {
    throw errorWithCause(
      `Некорректный JSON в файле «${filePath}» (${label}): ${cause.message}.`,
      'JSON_CONFIG_INVALID_JSON',
      cause
    );
  }
}

function loadOptionalJson(filePath, options = {}) {
  try {
    return loadRequiredJson(filePath, options);
  } catch (error) {
    if (error.code !== 'JSON_CONFIG_NOT_FOUND') throw error;
    return Object.prototype.hasOwnProperty.call(options, 'fallback')
      ? options.fallback
      : null;
  }
}

module.exports = {
  loadRequiredJson,
  loadOptionalJson,
};
