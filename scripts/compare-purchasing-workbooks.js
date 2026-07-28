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
const logger = createLogger('purchasing-workbook-compare-cli');

class PurchasingWorkbookCompareCliError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PurchasingWorkbookCompareCliError';
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
    throw new PurchasingWorkbookCompareCliError(
      `Для аргумента ${flag} требуется значение.`,
      'MISSING_ARGUMENT_VALUE'
    );
  }
  return value;
}

function parseArguments(argv) {
  const parsed = {
    beforePath: null,
    afterPath: null,
    format: 'text',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
    } else if (
      argument === '--before' ||
      argument === '--after' ||
      argument === '--format'
    ) {
      const value = requiredValue(argv, index, argument);
      index += 1;
      if (argument === '--before') parsed.beforePath = path.resolve(value);
      else if (argument === '--after') parsed.afterPath = path.resolve(value);
      else parsed.format = value;
    } else {
      throw new PurchasingWorkbookCompareCliError(
        `Неизвестный аргумент: ${argument}. Используйте --help.`,
        'UNKNOWN_ARGUMENT'
      );
    }
  }

  if (!parsed.help && !parsed.beforePath) {
    throw new PurchasingWorkbookCompareCliError(
      'Укажите старый Excel-файл через --before <путь>.',
      'BEFORE_REQUIRED'
    );
  }
  if (!parsed.help && !parsed.afterPath) {
    throw new PurchasingWorkbookCompareCliError(
      'Укажите новый Excel-файл через --after <путь>.',
      'AFTER_REQUIRED'
    );
  }
  if (!ALLOWED_FORMATS.includes(parsed.format)) {
    throw new PurchasingWorkbookCompareCliError(
      `Неизвестный формат «${parsed.format}». Допустимые значения: text, json.`,
      'UNKNOWN_FORMAT'
    );
  }
  return parsed;
}

function validateInputFile(inputPath, label) {
  const extension = path.extname(inputPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new PurchasingWorkbookCompareCliError(
      `${label} файл должен иметь расширение .xlsx или .xls.`,
      'UNSUPPORTED_EXTENSION'
    );
  }

  let stat;
  try {
    stat = fs.statSync(inputPath);
    fs.accessSync(inputPath, fs.constants.R_OK);
  } catch (cause) {
    if (cause.code === 'ENOENT') {
      throw new PurchasingWorkbookCompareCliError(
        `${label} Excel-файл не найден: «${inputPath}».`,
        'INPUT_NOT_FOUND',
        cause
      );
    }
    throw new PurchasingWorkbookCompareCliError(
      `Не удалось прочитать ${label.toLowerCase()} Excel-файл «${inputPath}»: ${cause.message}.`,
      'INPUT_READ_ERROR',
      cause
    );
  }

  if (!stat.isFile()) {
    throw new PurchasingWorkbookCompareCliError(
      `${label} путь не является файлом: «${inputPath}».`,
      'INPUT_NOT_FILE'
    );
  }
}

function arraysEqualExact(left, right) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function unmatchedValues(source, baseline) {
  const remaining = [...baseline];
  const unmatched = [];
  source.forEach(value => {
    const matchIndex = remaining.findIndex(candidate => candidate === value);
    if (matchIndex === -1) unmatched.push(value);
    else remaining.splice(matchIndex, 1);
  });
  return unmatched;
}

function matchedSequence(source, comparison) {
  const remaining = [...comparison];
  const matched = [];
  source.forEach(value => {
    const matchIndex = remaining.findIndex(candidate => candidate === value);
    if (matchIndex === -1) return;
    matched.push(value);
    remaining.splice(matchIndex, 1);
  });
  return matched;
}

function compareColumns(columnsBefore, columnsAfter) {
  const addedColumns = unmatchedValues(columnsAfter, columnsBefore);
  const removedColumns = unmatchedValues(columnsBefore, columnsAfter);
  const commonBefore = matchedSequence(columnsBefore, columnsAfter);
  const commonAfter = matchedSequence(columnsAfter, columnsBefore);
  return {
    addedColumns,
    removedColumns,
    columnOrderChanged: !arraysEqualExact(commonBefore, commonAfter),
  };
}

function compareWorkbookDiagnostics({
  beforeFilePath,
  afterFilePath,
  beforeDiagnostics,
  afterDiagnostics,
}) {
  const beforeNames = beforeDiagnostics.worksheetNames;
  const afterNames = afterDiagnostics.worksheetNames;
  const beforeNameSet = new Set(beforeNames);
  const afterNameSet = new Set(afterNames);
  const addedWorksheets = afterNames.filter(name => !beforeNameSet.has(name));
  const removedWorksheets = beforeNames.filter(name => !afterNameSet.has(name));
  const commonWorksheets = beforeNames.filter(name => afterNameSet.has(name));
  const beforeWorksheets = new Map(
    beforeDiagnostics.worksheets.map(worksheet => [worksheet.name, worksheet])
  );
  const afterWorksheets = new Map(
    afterDiagnostics.worksheets.map(worksheet => [worksheet.name, worksheet])
  );

  const worksheets = commonWorksheets.map(name => {
    const before = beforeWorksheets.get(name);
    const after = afterWorksheets.get(name);
    const columnComparison = compareColumns(
      before.columns,
      after.columns
    );
    return {
      name,
      rowsBefore: before.rows,
      rowsAfter: after.rows,
      rowDelta: after.rows - before.rows,
      columnsBefore: [...before.columns],
      columnsAfter: [...after.columns],
      addedColumns: columnComparison.addedColumns,
      removedColumns: columnComparison.removedColumns,
      columnOrderChanged: columnComparison.columnOrderChanged,
    };
  });

  return {
    beforeFileName: path.basename(beforeFilePath),
    afterFileName: path.basename(afterFilePath),
    worksheetCountBefore: beforeDiagnostics.worksheetCount,
    worksheetCountAfter: afterDiagnostics.worksheetCount,
    addedWorksheets,
    removedWorksheets,
    commonWorksheets,
    worksheets,
  };
}

function appendList(lines, title, values) {
  lines.push(title);
  if (values.length === 0) {
    lines.push('- нет');
    return;
  }
  values.forEach(value => lines.push(`- ${String(value)}`));
}

function formatText(result) {
  const lines = [
    'WORKBOOK COMPARE V1',
    '',
    `Старый файл: ${result.beforeFileName}`,
    `Новый файл: ${result.afterFileName}`,
    `Листов было: ${result.worksheetCountBefore}`,
    `Листов стало: ${result.worksheetCountAfter}`,
    '',
  ];
  appendList(lines, 'Листы добавлены:', result.addedWorksheets);
  lines.push('');
  appendList(lines, 'Листы удалены:', result.removedWorksheets);
  lines.push('');
  appendList(lines, 'Общие листы:', result.commonWorksheets);

  result.worksheets.forEach(worksheet => {
    lines.push(
      '',
      `Лист: ${worksheet.name}`,
      `Строк было: ${worksheet.rowsBefore}`,
      `Строк стало: ${worksheet.rowsAfter}`,
      `Разница: ${worksheet.rowDelta}`,
      ''
    );
    appendList(lines, 'Заголовки до:', worksheet.columnsBefore);
    lines.push('');
    appendList(lines, 'Заголовки после:', worksheet.columnsAfter);
    lines.push('');
    appendList(lines, 'Добавленные заголовки:', worksheet.addedColumns);
    lines.push('');
    appendList(lines, 'Удалённые заголовки:', worksheet.removedColumns);
    lines.push(
      `Порядок заголовков изменён: ${
        worksheet.columnOrderChanged ? 'да' : 'нет'
      }`
    );
  });

  return `${lines.join('\n')}\n`;
}

function helpText() {
  return [
    'Workbook Compare v1 — сравнение структуры двух Excel-файлов',
    '',
    'Использование:',
    '  npm run purchasing:compare -- --before <старый.xlsx> --after <новый.xlsx>',
    '',
    'Параметры:',
    '  --before <путь>       Старый .xlsx или .xls (обязательно)',
    '  --after <путь>        Новый .xlsx или .xls (обязательно)',
    '  --format <text|json>  Формат stdout (по умолчанию text)',
    '  --help, -h            Показать справку',
    '',
    'Утилита сравнивает только структуру workbook и не запускает закупщика.',
  ].join('\n');
}

async function openForComparison(filePath, label, opener) {
  try {
    return await opener(filePath);
  } catch (cause) {
    throw new PurchasingWorkbookCompareCliError(
      `Не удалось открыть ${label.toLowerCase()} workbook «${filePath}»: ${cause.message}.`,
      'WORKBOOK_OPEN_ERROR',
      cause
    );
  }
}

async function runCompareCli(argv, dependencies = {}) {
  const output = dependencies.output ||
    (content => process.stdout.write(content));
  const args = parseArguments(argv);

  if (args.help) {
    output(`${helpText()}\n`);
    return { mode: 'help', status: 'success' };
  }

  validateInputFile(args.beforePath, 'Старый');
  validateInputFile(args.afterPath, 'Новый');
  const opener = dependencies.openWorkbook || openWorkbook;
  const analyzer = dependencies.analyzeWorkbook || analyzeWorkbook;
  const beforeWorkbook = await openForComparison(
    args.beforePath,
    'старый',
    opener
  );
  const afterWorkbook = await openForComparison(
    args.afterPath,
    'новый',
    opener
  );
  const result = compareWorkbookDiagnostics({
    beforeFilePath: args.beforePath,
    afterFilePath: args.afterPath,
    beforeDiagnostics: analyzer(beforeWorkbook),
    afterDiagnostics: analyzer(afterWorkbook),
  });

  output(args.format === 'json'
    ? `${JSON.stringify(result, null, 2)}\n`
    : formatText(result));
  return { mode: 'comparison', status: 'success', result };
}

async function main() {
  try {
    await runCompareCli(process.argv.slice(2));
  } catch (error) {
    logger.error(`Ошибка сравнения workbook: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_FORMATS,
  ALLOWED_EXTENSIONS,
  PurchasingWorkbookCompareCliError,
  parseArguments,
  validateInputFile,
  compareColumns,
  compareWorkbookDiagnostics,
  formatText,
  helpText,
  runCompareCli,
  main,
};

if (require.main === module) {
  main();
}
