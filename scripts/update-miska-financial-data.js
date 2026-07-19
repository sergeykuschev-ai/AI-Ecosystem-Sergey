#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

const {
  loadFinancialData,
  validateFinancialConfiguration,
} = require('../agents/purchasing/services/financial_data_loader');
const {
  evaluateFinancialPurchase,
} = require('../agents/purchasing/services/financial_controller');

const DEFAULT_CONFIG_PATH = path.resolve(
  __dirname,
  '../data/purchasing/miska-financial-current.json'
);

const EDITABLE_FIELDS = Object.freeze([
  Object.freeze({
    field: 'cash_balance',
    flag: '--cash-balance',
    label: 'Наличные',
    type: 'money',
  }),
  Object.freeze({
    field: 'bank_balance',
    flag: '--bank-balance',
    label: 'Деньги на банковском счёте',
    type: 'money',
  }),
  Object.freeze({
    field: 'expected_revenue',
    flag: '--expected-revenue',
    label: 'Ожидаемая выручка',
    type: 'money',
  }),
  Object.freeze({
    field: 'fixed_expenses',
    flag: '--fixed-expenses',
    label: 'Постоянные расходы',
    type: 'money',
  }),
  Object.freeze({
    field: 'acquiring_rate',
    flag: '--acquiring-rate',
    label: 'Ставка эквайринга',
    type: 'rate',
  }),
  Object.freeze({
    field: 'supplier_debt',
    flag: '--supplier-debt',
    label: 'Долг поставщикам',
    type: 'money',
  }),
  Object.freeze({
    field: 'committed_supplier_payments',
    flag: '--committed-supplier-payments',
    label: 'Согласованные платежи поставщикам',
    type: 'money',
  }),
  Object.freeze({
    field: 'minimum_reserve',
    flag: '--minimum-reserve',
    label: 'Минимальный резерв',
    type: 'money',
  }),
  Object.freeze({
    field: 'comment',
    flag: '--comment',
    label: 'Комментарий',
    type: 'text',
  }),
]);

const FIELD_BY_FLAG = new Map(
  EDITABLE_FIELDS.map(definition => [definition.flag, definition])
);

class FinancialCliError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'FinancialCliError';
    this.code = code;
  }
}

class FinancialCliAbortError extends Error {
  constructor() {
    super('Обновление отменено пользователем. Файл не изменён.');
    this.name = 'FinancialCliAbortError';
    this.code = 'USER_ABORT';
  }
}

function parseLocalizedNumber(rawValue, label = 'Значение') {
  if (typeof rawValue !== 'string') {
    throw new FinancialCliError(
      `${label}: требуется число не меньше нуля.`,
      'INVALID_NUMBER'
    );
  }

  const normalized = rawValue.trim().replace(/\s+/gu, '').replace(',', '.');
  if (!/^\+?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new FinancialCliError(
      `${label}: требуется число не меньше нуля.`,
      'INVALID_NUMBER'
    );
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) {
    throw new FinancialCliError(
      `${label}: требуется конечное число не меньше нуля.`,
      'INVALID_NUMBER'
    );
  }
  return value;
}

function parseAcquiringRate(rawValue) {
  if (typeof rawValue !== 'string') {
    throw new FinancialCliError(
      'Ставка эквайринга должна быть долей от 0 до 1 или процентом со знаком %.',
      'INVALID_RATE'
    );
  }

  const trimmed = rawValue.trim();
  const percentInput = trimmed.endsWith('%');
  const numericToken = percentInput ? trimmed.slice(0, -1) : trimmed;
  const numericValue = parseLocalizedNumber(
    numericToken,
    'Ставка эквайринга'
  );
  const rate = percentInput ? numericValue / 100 : numericValue;
  if (rate > 1) {
    throw new FinancialCliError(
      'Ставка эквайринга должна быть долей от 0 до 1 или процентом со знаком %.',
      'INVALID_RATE'
    );
  }
  return rate;
}

function parseFieldValue(definition, rawValue) {
  if (definition.type === 'money') {
    return parseLocalizedNumber(rawValue, definition.label);
  }
  if (definition.type === 'rate') return parseAcquiringRate(rawValue);
  return String(rawValue).trim();
}

function argumentValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new FinancialCliError(
      `Для аргумента ${flag} требуется значение.`,
      'MISSING_ARGUMENT_VALUE'
    );
  }
  return value;
}

function parseArguments(argv) {
  const parsed = {
    filePath: DEFAULT_CONFIG_PATH,
    updates: {},
    yes: false,
    dryRun: false,
    check: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (FIELD_BY_FLAG.has(argument)) {
      const definition = FIELD_BY_FLAG.get(argument);
      const value = argumentValue(argv, index, argument);
      parsed.updates[definition.field] = parseFieldValue(definition, value);
      index += 1;
      continue;
    }
    if (argument === '--file') {
      parsed.filePath = path.resolve(argumentValue(argv, index, argument));
      index += 1;
      continue;
    }
    if (argument === '--yes') parsed.yes = true;
    else if (argument === '--dry-run') parsed.dryRun = true;
    else if (argument === '--check') parsed.check = true;
    else if (argument === '--help' || argument === '-h') parsed.help = true;
    else {
      throw new FinancialCliError(
        `Неизвестный аргумент: ${argument}. Используйте --help.`,
        'UNKNOWN_ARGUMENT'
      );
    }
  }

  if (parsed.check && (
    Object.keys(parsed.updates).length > 0 || parsed.yes || parsed.dryRun
  )) {
    throw new FinancialCliError(
      'Режим --check нельзя совмещать с изменениями, --yes или --dry-run.',
      'INCOMPATIBLE_ARGUMENTS'
    );
  }
  if (parsed.yes && parsed.dryRun) {
    throw new FinancialCliError(
      'Аргументы --yes и --dry-run нельзя использовать одновременно.',
      'INCOMPATIBLE_ARGUMENTS'
    );
  }

  return parsed;
}

function configurationFromLoaded(loaded) {
  return {
    store: loaded.metadata.store,
    updated_at: loaded.metadata.updated_at,
    currency: loaded.metadata.currency,
    ...loaded.financialData,
    comment: loaded.metadata.comment,
  };
}

function loadCurrentConfiguration(filePath, options = {}) {
  const loaded = loadFinancialData(filePath, {
    referenceDate: options.referenceDate,
  });
  return {
    configuration: configurationFromLoaded(loaded),
    warnings: loaded.warnings,
    resolvedPath: loaded.resolvedPath,
  };
}

function calculateFinancialSummary(configuration) {
  const result = evaluateFinancialPurchase({
    cash_balance: configuration.cash_balance,
    bank_balance: configuration.bank_balance,
    expected_revenue: configuration.expected_revenue,
    fixed_expenses: configuration.fixed_expenses,
    acquiring_rate: configuration.acquiring_rate,
    supplier_debt: configuration.supplier_debt,
    committed_supplier_payments: configuration.committed_supplier_payments,
    minimum_reserve: configuration.minimum_reserve,
    proposed_order_amount: 0,
  });

  return {
    total_available_cash: result.total_available_cash,
    fixed_expenses: result.fixed_expenses_total,
    estimated_acquiring: result.estimated_acquiring,
    total_mandatory_expenses: result.total_mandatory_expenses,
    available_after_expenses: result.available_after_expenses,
    minimum_reserve: result.inputs.minimum_reserve,
    maximum_safe_order_amount: result.maximum_safe_order_amount,
  };
}

function formatMoney(value) {
  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} RUB`;
}

function formatFieldValue(definition, value) {
  if (definition.type === 'money') return formatMoney(value);
  if (definition.type === 'rate') {
    return `${value} (${new Intl.NumberFormat('ru-RU', {
      maximumFractionDigits: 4,
    }).format(value * 100)}%)`;
  }
  return value === null ? '' : value;
}

function showConfiguration(configuration, output, title) {
  output(title);
  output(`Магазин: ${configuration.store}`);
  output(`Валюта: ${configuration.currency}`);
  output(`Дата обновления: ${configuration.updated_at}`);
  for (const definition of EDITABLE_FIELDS) {
    output(
      `${definition.label}: ${formatFieldValue(
        definition,
        configuration[definition.field]
      )}`
    );
  }
}

function showSummary(configuration, output) {
  const summary = calculateFinancialSummary(configuration);
  output('Расчётная сводка:');
  output(`Общая ликвидность: ${formatMoney(summary.total_available_cash)}`);
  output(`Постоянные расходы: ${formatMoney(summary.fixed_expenses)}`);
  output(`Ожидаемый эквайринг: ${formatMoney(summary.estimated_acquiring)}`);
  output(
    `Общие обязательные расходы: ${formatMoney(summary.total_mandatory_expenses)}`
  );
  output(`Сумма после расходов: ${formatMoney(summary.available_after_expenses)}`);
  output(`Минимальный резерв: ${formatMoney(summary.minimum_reserve)}`);
  output(
    `Максимальный безопасный месячный объём новых заказов: ${formatMoney(
      summary.maximum_safe_order_amount
    )}`
  );
  return summary;
}

async function promptForUpdates(configuration, ask, output) {
  const updated = { ...configuration };
  for (const definition of EDITABLE_FIELDS) {
    while (true) {
      const current = formatFieldValue(
        definition,
        updated[definition.field]
      );
      const answer = await ask(`${definition.label} [${current}]: `);
      if (answer.trim() === '') break;
      try {
        updated[definition.field] = parseFieldValue(definition, answer);
        break;
      } catch (error) {
        if (!(error instanceof FinancialCliError)) throw error;
        output(`Ошибка: ${error.message}`);
      }
    }
  }
  return updated;
}

function localDateString(dateInput = new Date()) {
  const date = new Date(dateInput);
  if (!Number.isFinite(date.getTime())) {
    throw new FinancialCliError(
      'Не удалось определить текущую дату для updated_at.',
      'INVALID_CURRENT_DATE'
    );
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function serializeConfiguration(configuration) {
  return `${JSON.stringify(configuration, null, 2)}\n`;
}

function temporaryPathFor(filePath) {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const nonce = `${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
  return path.join(directory, `.${basename}.${nonce}.tmp`);
}

function atomicSaveFinancialData(filePath, configuration, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const savedConfiguration = {
    ...configuration,
    updated_at: localDateString(options.currentDate),
  };
  validateFinancialConfiguration(savedConfiguration);

  const temporaryPath = options.temporaryPath || temporaryPathFor(resolvedPath);
  const writeFile = options.writeFile || fs.writeFileSync;
  const validateFile = options.validateFile || (candidatePath =>
    loadFinancialData(candidatePath, { referenceDate: options.currentDate })
  );
  const renameFile = options.renameFile || fs.renameSync;
  const removeFile = options.removeFile || fs.unlinkSync;

  try {
    writeFile(temporaryPath, serializeConfiguration(savedConfiguration), {
      encoding: 'utf8',
      flag: 'wx',
    });
    validateFile(temporaryPath);
    renameFile(temporaryPath, resolvedPath);
  } catch (error) {
    try {
      removeFile(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        throw new FinancialCliError(
          `Не удалось очистить временный файл «${temporaryPath}»: ${cleanupError.message}`,
          'TEMP_FILE_CLEANUP_ERROR',
          cleanupError
        );
      }
    }
    throw new FinancialCliError(
      `Не удалось безопасно сохранить финансовую конфигурацию: ${error.message}`,
      'SAFE_WRITE_ERROR',
      error
    );
  }

  return savedConfiguration;
}

function confirmationAccepted(answer) {
  return ['y', 'yes', 'д', 'да'].includes(answer.trim().toLocaleLowerCase('ru-RU'));
}

function helpText() {
  return [
    'Обновление финансовых данных магазина «Миска»',
    '',
    'Использование:',
    '  npm run finance:update:miska',
    '  npm run finance:check:miska',
    '  node scripts/update-miska-financial-data.js [параметры]',
    '',
    'Параметры:',
    ...EDITABLE_FIELDS.map(item => `  ${item.flag} <значение>`),
    '  --file <путь>       Использовать другой JSON-файл',
    '  --yes               Сохранить без вопроса подтверждения',
    '  --dry-run           Показать результат без записи',
    '  --check             Только проверить текущий файл',
    '  --help, -h          Показать эту справку',
    '',
    'Числа принимают пробелы и десятичную запятую. Ставка эквайринга:',
    '0.025, 2.5% или 2,5%.',
  ].join('\n');
}

async function runCli(argv, dependencies = {}) {
  const output = dependencies.output || console.log;
  const ask = dependencies.ask;
  const currentDate = dependencies.currentDate || new Date();
  const args = parseArguments(argv);

  if (args.help) {
    output(helpText());
    return { mode: 'help', changed: false };
  }

  const loaded = loadCurrentConfiguration(args.filePath, {
    referenceDate: currentDate,
  });
  const current = loaded.configuration;
  showConfiguration(current, output, 'Текущие финансовые данные:');

  if (args.check) {
    showSummary(current, output);
    for (const warning of loaded.warnings) output(`Предупреждение: ${warning}`);
    output('Проверка завершена. Файл не изменён.');
    return {
      mode: 'check',
      changed: false,
      configuration: current,
      warnings: loaded.warnings,
    };
  }

  const nonInteractive = Object.keys(args.updates).length > 0 ||
    args.yes || args.dryRun;
  if (!nonInteractive && typeof ask !== 'function') {
    throw new FinancialCliError(
      'Для интерактивного режима недоступен ввод.',
      'INTERACTIVE_INPUT_UNAVAILABLE'
    );
  }

  const candidate = nonInteractive
    ? { ...current, ...args.updates }
    : await promptForUpdates(current, ask, output);
  validateFinancialConfiguration(candidate);
  showConfiguration(candidate, output, 'Предпросмотр новых значений:');
  showSummary(candidate, output);
  output(`После сохранения updated_at будет: ${localDateString(currentDate)}`);

  if (args.dryRun) {
    output('Dry-run завершён. Файл не изменён.');
    return { mode: 'dry-run', changed: false, configuration: candidate };
  }

  let confirmed = args.yes;
  if (!confirmed) {
    if (typeof ask !== 'function') {
      throw new FinancialCliError(
        'Для подтверждения сохранения недоступен ввод. Используйте --yes.',
        'CONFIRMATION_INPUT_UNAVAILABLE'
      );
    }
    confirmed = confirmationAccepted(await ask('Сохранить изменения? [y/N]: '));
  }
  if (!confirmed) {
    output('Сохранение отменено. Файл не изменён.');
    return { mode: 'cancelled', changed: false, configuration: current };
  }

  const saved = atomicSaveFinancialData(args.filePath, candidate, {
    currentDate,
    ...(dependencies.saveOptions || {}),
  });
  output(`Финансовые данные сохранены: ${loaded.resolvedPath}`);
  output(`updated_at: ${saved.updated_at}`);
  return { mode: 'saved', changed: true, configuration: saved };
}

async function main() {
  let input;
  const abortController = new AbortController();
  const handleInterrupt = () => abortController.abort();
  process.once('SIGINT', handleInterrupt);

  const ask = async prompt => {
    if (!input) {
      input = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      input.on('SIGINT', handleInterrupt);
    }
    try {
      return await input.question(prompt, { signal: abortController.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw new FinancialCliAbortError();
      throw error;
    }
  };

  try {
    await runCli(process.argv.slice(2), { ask });
  } catch (error) {
    if (error instanceof FinancialCliAbortError) {
      console.error(`\n${error.message}`);
      process.exitCode = 130;
    } else {
      console.error(`Ошибка: ${error.message}`);
      process.exitCode = 1;
    }
  } finally {
    process.removeListener('SIGINT', handleInterrupt);
    if (input) input.close();
  }
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  EDITABLE_FIELDS,
  FinancialCliError,
  FinancialCliAbortError,
  parseLocalizedNumber,
  parseAcquiringRate,
  parseArguments,
  configurationFromLoaded,
  loadCurrentConfiguration,
  calculateFinancialSummary,
  formatMoney,
  promptForUpdates,
  localDateString,
  serializeConfiguration,
  atomicSaveFinancialData,
  confirmationAccepted,
  helpText,
  runCli,
  main,
};

if (require.main === module) {
  main();
}
