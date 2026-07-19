#!/usr/bin/env node

const path = require('node:path');

const packageJson = require('../package.json');
const {
  DEFAULT_MATRIX_BUILDER_CONFIG_PATH,
  buildMatrixDraftFromSmartZapasXlsx,
} = require('../agents/purchasing/matrix_builder/matrix_builder');
const {
  localDateParts,
  optionalSha256File,
  safeWriteRunFiles,
  serializeJson,
  sha256File,
  validateInputFile,
} = require('./run-purchasing-agent');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  'output/purchasing-matrix'
);

class MatrixBuilderCliError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MatrixBuilderCliError';
    this.code = code;
  }
}

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new MatrixBuilderCliError(
      `Для аргумента ${flag} требуется значение.`,
      'MISSING_ARGUMENT_VALUE'
    );
  }
  return value;
}

function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new MatrixBuilderCliError(
      'Аргумент --report-date должен иметь формат YYYY-MM-DD.',
      'INVALID_REPORT_DATE'
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new MatrixBuilderCliError(
      'Аргумент --report-date содержит некорректную календарную дату.',
      'INVALID_REPORT_DATE'
    );
  }
  return value;
}

function parseArguments(argv) {
  const parsed = {
    inputPath: null,
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    existingMatrixPath: null,
    configPath: DEFAULT_MATRIX_BUILDER_CONFIG_PATH,
    reportDate: null,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') parsed.dryRun = true;
    else if (argument === '--help' || argument === '-h') parsed.help = true;
    else if ([
      '--input',
      '--output-dir',
      '--existing-matrix',
      '--config',
      '--report-date',
    ].includes(argument)) {
      const value = requiredValue(argv, index, argument);
      index += 1;
      if (argument === '--input') parsed.inputPath = path.resolve(value);
      else if (argument === '--output-dir') {
        parsed.outputDirectory = path.resolve(value);
      } else if (argument === '--existing-matrix') {
        parsed.existingMatrixPath = path.resolve(value);
      } else if (argument === '--config') {
        parsed.configPath = path.resolve(value);
      } else {
        parsed.reportDate = calendarDate(value);
      }
    } else {
      throw new MatrixBuilderCliError(
        `Неизвестный аргумент: ${argument}. Используйте --help.`,
        'UNKNOWN_ARGUMENT'
      );
    }
  }

  if (!parsed.help && !parsed.inputPath) {
    throw new MatrixBuilderCliError(
      'Укажите входной Excel-файл через --input <путь>.',
      'INPUT_REQUIRED'
    );
  }
  return parsed;
}

function helpText() {
  return [
    'Локальный Matrix Builder для Purchasing Agent',
    '',
    'Использование:',
    '  npm run purchasing:matrix:build -- --input <SmartZapas.xlsx> [параметры]',
    '',
    'Параметры:',
    '  --input <путь>             Входной SmartZapas .xlsx или .xls',
    '  --output-dir <путь>        Корневая папка результатов',
    '  --existing-matrix <путь>   Действующая матрица; её значения сохраняются',
    '  --config <путь>            Конфигурация правил Matrix Builder',
    '  --report-date <YYYY-MM-DD> Явная дата отчёта, если её нет в источнике',
    '  --dry-run                  Рассчитать черновик без записи файлов',
    '  --help, -h                 Показать справку',
    '',
    'Matrix Builder не изменяет действующую матрицу и не влияет на расчёт заказа.',
  ].join('\n');
}

function buildRunMetadata({
  args,
  result,
  generatedAt,
  runDirectory,
  generatedFiles,
}) {
  return {
    version: 1,
    tool: 'purchasing_matrix_builder',
    application_version: packageJson.version,
    generated_at: generatedAt,
    dry_run: args.dryRun,
    status: 'draft',
    input: {
      path: args.inputPath,
      sha256: sha256File(args.inputPath),
      worksheet: result.draft.source.worksheet,
      report_timestamp: result.draft.source.report_timestamp,
      report_timestamp_source: result.draft.source.report_timestamp_source,
      sku_count: result.draft.source.sku_count,
      structural_row_count: result.draft.source.structural_row_count,
    },
    existing_matrix: args.existingMatrixPath
      ? {
        path: args.existingMatrixPath,
        sha256: optionalSha256File(args.existingMatrixPath),
      }
      : null,
    configuration: {
      path: result.configPath,
      sha256: sha256File(result.configPath),
      version: result.config.version,
    },
    output_directory: args.dryRun ? null : runDirectory,
    files: args.dryRun ? [] : generatedFiles,
    summary: result.draft.summary,
    validation: result.draft.validation_summary,
  };
}

function terminalSummary(output, result, runDirectory, dryRun) {
  const summary = result.draft.summary;
  output(`Matrix Builder: черновик${dryRun ? ' (dry-run)' : ''}`);
  output(`SKU: ${summary.total_sku}`);
  output(`CORE / NEW / EXIT: ${summary.roles.CORE} / ${summary.roles.NEW} / ${summary.roles.EXIT}`);
  output(`Ручная проверка: ${summary.manual_review}`);
  output(`Конфликты с действующей матрицей: ${summary.policy_conflicts}`);
  output(`Папка результатов: ${dryRun ? 'не создавалась' : runDirectory}`);
}

async function runMatrixBuilderCli(argv, dependencies = {}) {
  const output = dependencies.output || console.log;
  const args = parseArguments(argv);
  if (args.help) {
    output(helpText());
    return { mode: 'help', status: 'success' };
  }

  validateInputFile(args.inputPath);
  const generatedDate = new Date(dependencies.currentDate || new Date());
  if (!Number.isFinite(generatedDate.getTime())) {
    throw new MatrixBuilderCliError(
      'Не удалось определить дату запуска Matrix Builder.',
      'INVALID_CURRENT_DATE'
    );
  }
  const generatedAt = generatedDate.toISOString();
  const dateParts = localDateParts(generatedDate);
  const runDirectory = path.join(
    args.outputDirectory,
    `${dateParts.date}_${dateParts.time}`
  );
  const builder = dependencies.builder || buildMatrixDraftFromSmartZapasXlsx;
  const result = await builder(args.inputPath, {
    configPath: args.configPath,
    existingMatrixPath: args.existingMatrixPath,
    reportDate: args.reportDate,
    generatedAt,
  });
  const generatedFiles = [
    'matrix-draft.json',
    'matrix-report.txt',
    'manual-review.json',
    'run-metadata.json',
  ];
  const metadata = buildRunMetadata({
    args,
    result,
    generatedAt,
    runDirectory,
    generatedFiles,
  });

  if (!args.dryRun) {
    safeWriteRunFiles(runDirectory, [
      { name: 'matrix-draft.json', content: serializeJson(result.draft) },
      { name: 'matrix-report.txt', content: `${result.reportText.trimEnd()}\n` },
      { name: 'manual-review.json', content: serializeJson(result.manualReview) },
      { name: 'run-metadata.json', content: serializeJson(metadata) },
    ], dependencies.writeOptions || {});
  }
  terminalSummary(output, result, runDirectory, args.dryRun);
  return {
    mode: args.dryRun ? 'dry-run' : 'written',
    status: 'draft',
    runDirectory,
    generatedFiles: args.dryRun ? [] : generatedFiles,
    result,
    metadata,
  };
}

async function main() {
  try {
    await runMatrixBuilderCli(process.argv.slice(2));
  } catch (error) {
    console.error(`Ошибка Matrix Builder: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_OUTPUT_DIRECTORY,
  MatrixBuilderCliError,
  calendarDate,
  parseArguments,
  helpText,
  buildRunMetadata,
  runMatrixBuilderCli,
  main,
};

if (require.main === module) {
  main();
}
