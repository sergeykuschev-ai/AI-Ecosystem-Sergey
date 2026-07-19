const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_METADATA_FIELDS = Object.freeze([
  'store',
  'updated_at',
  'currency',
]);

const REQUIRED_FINANCIAL_FIELDS = Object.freeze([
  'cash_balance',
  'bank_balance',
  'expected_revenue',
  'fixed_expenses',
  'acquiring_rate',
  'supplier_debt',
  'committed_supplier_payments',
  'minimum_reserve',
]);

const STALE_AFTER_DAYS = 31;
const STALE_DATA_WARNING = 'Финансовые данные не обновлялись более 31 дня';

class FinancialDataLoadError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'FinancialDataLoadError';
    this.code = code;
  }
}

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
}

function assertRequiredFields(data) {
  for (const field of [
    ...REQUIRED_METADATA_FIELDS,
    ...REQUIRED_FINANCIAL_FIELDS,
  ]) {
    if (!hasOwn(data, field)) {
      throw new FinancialDataLoadError(
        `В финансовой конфигурации отсутствует обязательное поле «${field}».`,
        'MISSING_REQUIRED_FIELD'
      );
    }
  }
}

function assertNonEmptyString(data, field) {
  if (typeof data[field] !== 'string' || data[field].trim() === '') {
    throw new FinancialDataLoadError(
      `Поле «${field}» в финансовой конфигурации должно быть непустой строкой.`,
      'INVALID_FIELD_TYPE'
    );
  }
}

function assertNonNegativeNumber(data, field) {
  if (!Number.isFinite(data[field]) || data[field] < 0) {
    throw new FinancialDataLoadError(
      `Поле «${field}» в финансовой конфигурации должно быть конечным неотрицательным числом.`,
      'INVALID_FIELD_TYPE'
    );
  }
}

function parseUpdatedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new FinancialDataLoadError(
      'Поле «updated_at» должно быть датой в формате YYYY-MM-DD.',
      'INVALID_UPDATED_AT'
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new FinancialDataLoadError(
      'Поле «updated_at» содержит некорректную календарную дату.',
      'INVALID_UPDATED_AT'
    );
  }
  return date;
}

function validateFinancialConfiguration(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new FinancialDataLoadError(
      'Финансовая конфигурация должна быть JSON-объектом.',
      'INVALID_ROOT_TYPE'
    );
  }

  assertRequiredFields(data);
  assertNonEmptyString(data, 'store');
  assertNonEmptyString(data, 'currency');
  const updatedAt = parseUpdatedAt(data.updated_at);

  if (data.currency !== 'RUB') {
    throw new FinancialDataLoadError(
      'Поле «currency» должно иметь значение «RUB» для профиля магазина «Миска».',
      'UNSUPPORTED_CURRENCY'
    );
  }

  for (const field of REQUIRED_FINANCIAL_FIELDS) {
    assertNonNegativeNumber(data, field);
  }
  if (data.acquiring_rate > 1) {
    throw new FinancialDataLoadError(
      'Поле «acquiring_rate» должно быть долей от 0 до 1.',
      'INVALID_ACQUIRING_RATE'
    );
  }
  if (hasOwn(data, 'comment') &&
      data.comment !== null && typeof data.comment !== 'string') {
    throw new FinancialDataLoadError(
      'Поле «comment» должно быть строкой или null.',
      'INVALID_FIELD_TYPE'
    );
  }

  return updatedAt;
}

function normalizeReferenceDate(referenceDate) {
  const date = referenceDate === undefined ? new Date() : new Date(referenceDate);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('referenceDate must be a valid date.');
  }
  return date;
}

function staleDataWarnings(updatedAt, referenceDate) {
  const reference = normalizeReferenceDate(referenceDate);
  const ageMilliseconds = reference.getTime() - updatedAt.getTime();
  const staleMilliseconds = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  return ageMilliseconds > staleMilliseconds ? [STALE_DATA_WARNING] : [];
}

function loadFinancialData(filePath, options = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new FinancialDataLoadError(
      'Путь к финансовой конфигурации должен быть непустой строкой.',
      'INVALID_FILE_PATH'
    );
  }

  const resolvedPath = path.resolve(filePath);
  let sourceText;
  try {
    sourceText = fs.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    const reason = error.code === 'ENOENT'
      ? 'файл не найден'
      : error.message;
    throw new FinancialDataLoadError(
      `Не удалось прочитать финансовую конфигурацию «${filePath}»: ${reason}.`,
      'FILE_READ_ERROR',
      error
    );
  }

  let data;
  try {
    data = JSON.parse(sourceText);
  } catch (error) {
    throw new FinancialDataLoadError(
      `Некорректный JSON в финансовой конфигурации «${filePath}»: ${error.message}.`,
      'INVALID_JSON',
      error
    );
  }

  const updatedAt = validateFinancialConfiguration(data);
  return {
    financialData: Object.fromEntries(
      REQUIRED_FINANCIAL_FIELDS.map(field => [field, data[field]])
    ),
    metadata: {
      store: data.store.trim(),
      updated_at: data.updated_at,
      currency: data.currency,
      comment: data.comment === undefined ? null : data.comment,
    },
    warnings: staleDataWarnings(updatedAt, options.referenceDate),
    resolvedPath,
  };
}

function resolveFinancialDataSource(options = {}, loaderOptions = {}) {
  const hasInlineData = hasOwn(options, 'financialData') &&
    options.financialData !== null && options.financialData !== undefined;
  const hasFilePath = hasOwn(options, 'financialDataPath') &&
    options.financialDataPath !== null && options.financialDataPath !== undefined;

  if (hasInlineData) {
    return {
      financialData: options.financialData,
      source: 'inline',
      metadata: {
        store: null,
        updated_at: null,
        currency: null,
        comment: null,
      },
      warnings: hasFilePath
        ? ['Передан financialData; financialDataPath проигнорирован.']
        : [],
      errors: [],
    };
  }

  if (hasFilePath) {
    try {
      const loaded = loadFinancialData(
        options.financialDataPath,
        loaderOptions
      );
      return {
        financialData: loaded.financialData,
        source: 'file',
        metadata: loaded.metadata,
        warnings: loaded.warnings,
        errors: [],
      };
    } catch (error) {
      if (!(error instanceof FinancialDataLoadError)) throw error;
      return {
        financialData: null,
        source: 'file',
        metadata: {
          store: null,
          updated_at: null,
          currency: null,
          comment: null,
        },
        warnings: [],
        errors: [error.message],
      };
    }
  }

  return {
    financialData: null,
    source: 'none',
    metadata: {
      store: null,
      updated_at: null,
      currency: null,
      comment: null,
    },
    warnings: [],
    errors: [],
  };
}

module.exports = {
  REQUIRED_METADATA_FIELDS,
  REQUIRED_FINANCIAL_FIELDS,
  STALE_AFTER_DAYS,
  STALE_DATA_WARNING,
  FinancialDataLoadError,
  validateFinancialConfiguration,
  staleDataWarnings,
  loadFinancialData,
  resolveFinancialDataSource,
};
