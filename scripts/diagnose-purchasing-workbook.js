#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  analyzeWorkbook,
} = require('../shared/diagnostics/workbook_diagnostics');
const {
  analyzeWorkbookCompatibility,
} = require('../shared/diagnostics/workbook_compatibility');
const {
  loadRequiredJson,
} = require('../shared/config/json_config_loader');
const { openWorkbook } = require('../shared/excel/excel_reader');
const { createLogger } = require('../shared/logging/logger');

const ALLOWED_FORMATS = Object.freeze(['text', 'json']);
const ALLOWED_EXTENSIONS = Object.freeze(['.xlsx', '.xls']);
const logger = createLogger('purchasing-workbook-diagnostics-cli');

class PurchasingWorkbookDiagnosticsCliError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PurchasingWorkbookDiagnosticsCliError';
    this.code = code;
  }
}

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (
    value === undefined ||
    value === '-h' ||
    value.startsWith('--')
  ) {
    throw new PurchasingWorkbookDiagnosticsCliError(
      `Для аргумента ${flag} требуется значение.`,
      'MISSING_ARGUMENT_VALUE'
    );
  }
  return value;
}

function parseArguments(argv) {
  const parsed = {
    inputPath: null,
    profilePath: null,
    format: 'text',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
    } else if (
      argument === '--input' ||
      argument === '--profile' ||
      argument === '--format'
    ) {
      const value = requiredValue(argv, index, argument);
      index += 1;
      if (argument === '--input') parsed.inputPath = path.resolve(value);
      else if (argument === '--profile') {
        parsed.profilePath = path.resolve(value);
      }
      else parsed.format = value;
    } else {
      throw new PurchasingWorkbookDiagnosticsCliError(
        `Неизвестный аргумент: ${argument}. Используйте --help.`,
        'UNKNOWN_ARGUMENT'
      );
    }
  }

  if (!parsed.help && !parsed.inputPath) {
    throw new PurchasingWorkbookDiagnosticsCliError(
      'Укажите входной Excel-файл через --input <путь>.',
      'INPUT_REQUIRED'
    );
  }
  if (!ALLOWED_FORMATS.includes(parsed.format)) {
    throw new PurchasingWorkbookDiagnosticsCliError(
      `Неизвестный формат «${parsed.format}». Допустимые значения: text, json.`,
      'UNKNOWN_FORMAT'
    );
  }
  return parsed;
}

function validateInputFile(inputPath) {
  const extension = path.extname(inputPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new PurchasingWorkbookDiagnosticsCliError(
      'Входной файл должен иметь расширение .xlsx или .xls.',
      'UNSUPPORTED_EXTENSION'
    );
  }

  let stat;
  try {
    stat = fs.statSync(inputPath);
    fs.accessSync(inputPath, fs.constants.R_OK);
  } catch (cause) {
    if (cause.code === 'ENOENT') {
      throw new PurchasingWorkbookDiagnosticsCliError(
        `Входной Excel-файл не найден: «${inputPath}».`,
        'INPUT_NOT_FOUND',
        cause
      );
    }
    throw new PurchasingWorkbookDiagnosticsCliError(
      `Не удалось прочитать входной Excel-файл «${inputPath}»: ${cause.message}.`,
      'INPUT_READ_ERROR',
      cause
    );
  }

  if (!stat.isFile()) {
    throw new PurchasingWorkbookDiagnosticsCliError(
      `Входной путь не является файлом: «${inputPath}».`,
      'INPUT_NOT_FILE'
    );
  }
}

function helpText() {
  return [
    'Compatibility Report v1 — диагностика Excel-файла закупщика',
    '',
    'Использование:',
    '  npm run purchasing:diagnostics -- --input <путь к xlsx> [параметры]',
    '',
    'Параметры:',
    '  --input <путь>        Входной .xlsx или .xls (обязательно)',
    '  --profile <путь>      JSON-профиль обязательных листов и колонок',
    '  --format <text|json>  Формат stdout (по умолчанию text)',
    '  --help, -h            Показать справку',
    '',
    'Утилита только диагностирует структуру workbook и не запускает закупщика.',
  ].join('\n');
}

function diagnosticsResult(inputPath, diagnostics) {
  return {
    fileName: path.basename(inputPath),
    worksheetCount: diagnostics.worksheetCount,
    worksheetNames: diagnostics.worksheetNames,
    worksheets: diagnostics.worksheets,
  };
}

function formatText(result) {
  const lines = [
    'COMPATIBILITY REPORT V1',
    `Файл: ${result.fileName}`,
    `Количество листов: ${result.worksheetCount}`,
  ];

  result.worksheets.forEach(worksheet => {
    lines.push(
      '',
      `Лист: ${worksheet.name}`,
      `Количество строк: ${worksheet.rows}`,
      `Количество заголовков: ${worksheet.columns.length}`,
      'Заголовки:'
    );
    if (worksheet.columns.length === 0) {
      lines.push('- нет');
    } else {
      worksheet.columns.forEach(column => {
        lines.push(`- ${column === null ? '' : String(column)}`);
      });
    }
  });

  return `${lines.join('\n')}\n`;
}

function appendTextList(lines, values) {
  if (values.length === 0) {
    lines.push('- нет');
    return;
  }
  values.forEach(value => {
    lines.push(`- ${value === null ? '' : String(value)}`);
  });
}

function formatCompatibilityText(result) {
  const lines = [
    'COMPATIBILITY REPORT V2',
    `Файл: ${result.fileName}`,
    `Профиль: ${result.profileFileName}`,
    `Статус: ${result.compatibility.status}`,
    '',
    'Отсутствующие листы:',
  ];
  appendTextList(lines, result.compatibility.missingWorksheets);

  result.compatibility.worksheets.forEach(worksheet => {
    lines.push(
      '',
      `Лист: ${worksheet.name}`,
      `Найден: ${worksheet.found ? 'да' : 'нет'}`,
      '',
      'Обязательные колонки:'
    );
    appendTextList(lines, worksheet.requiredColumns);
    lines.push('', 'Фактические колонки:');
    if (!worksheet.found) {
      lines.push('- лист отсутствует');
    } else {
      appendTextList(lines, worksheet.actualColumns);
    }
    lines.push('', 'Отсутствующие колонки:');
    appendTextList(lines, worksheet.missingColumns);
  });

  return `${lines.join('\n')}\n`;
}

async function runDiagnosticsCli(argv, dependencies = {}) {
  const output = dependencies.output ||
    (content => process.stdout.write(content));
  const args = parseArguments(argv);

  if (args.help) {
    output(`${helpText()}\n`);
    return { mode: 'help', status: 'success' };
  }

  validateInputFile(args.inputPath);
  const profile = args.profilePath
    ? (dependencies.loadRequiredJson || loadRequiredJson)(
      args.profilePath,
      { label: 'профиль совместимости workbook' }
    )
    : null;
  let workbook;
  try {
    workbook = await (dependencies.openWorkbook || openWorkbook)(args.inputPath);
  } catch (cause) {
    throw new PurchasingWorkbookDiagnosticsCliError(
      `Не удалось открыть workbook «${args.inputPath}»: ${cause.message}.`,
      'WORKBOOK_OPEN_ERROR',
      cause
    );
  }

  const diagnostics = (dependencies.analyzeWorkbook || analyzeWorkbook)(
    workbook
  );
  let result = diagnosticsResult(args.inputPath, diagnostics);
  if (args.profilePath) {
    const compatibility = (
      dependencies.analyzeWorkbookCompatibility ||
      analyzeWorkbookCompatibility
    )(diagnostics, profile);
    result = {
      ...result,
      profileFileName: path.basename(args.profilePath),
      compatibility,
    };
  }
  output(args.format === 'json'
    ? `${JSON.stringify(result, null, 2)}\n`
    : args.profilePath
      ? formatCompatibilityText(result)
      : formatText(result));
  return { mode: 'diagnostics', status: 'success', result };
}

async function main() {
  try {
    await runDiagnosticsCli(process.argv.slice(2));
  } catch (error) {
    logger.error(`Ошибка диагностики workbook: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_FORMATS,
  ALLOWED_EXTENSIONS,
  PurchasingWorkbookDiagnosticsCliError,
  parseArguments,
  validateInputFile,
  helpText,
  diagnosticsResult,
  formatText,
  formatCompatibilityText,
  runDiagnosticsCli,
  main,
};

if (require.main === module) {
  main();
}
