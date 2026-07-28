#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  analyzeWorkbook,
} = require('../shared/diagnostics/workbook_diagnostics');
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
    format: 'text',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
    } else if (argument === '--input' || argument === '--format') {
      const value = requiredValue(argv, index, argument);
      index += 1;
      if (argument === '--input') parsed.inputPath = path.resolve(value);
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

async function runDiagnosticsCli(argv, dependencies = {}) {
  const output = dependencies.output ||
    (content => process.stdout.write(content));
  const args = parseArguments(argv);

  if (args.help) {
    output(`${helpText()}\n`);
    return { mode: 'help', status: 'success' };
  }

  validateInputFile(args.inputPath);
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
  const result = diagnosticsResult(args.inputPath, diagnostics);
  output(args.format === 'json'
    ? `${JSON.stringify(result, null, 2)}\n`
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
  runDiagnosticsCli,
  main,
};

if (require.main === module) {
  main();
}
