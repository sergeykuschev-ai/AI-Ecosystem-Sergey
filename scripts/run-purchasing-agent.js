#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require('../package.json');
const {
  runOrderAgentFromSmartZapasXlsxWithDemand,
} = require('../agents/purchasing/order_agent');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const DEFAULT_FINANCIAL_DATA_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-financial-current.json'
);
const DEFAULT_ASSORTMENT_MATRIX_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-assortment-matrix.json'
);
const DEFAULT_OUTPUT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  'output/purchasing'
);
const ALLOWED_FORMATS = Object.freeze(['all', 'json', 'text']);
const ALLOWED_EXCEL_EXTENSIONS = Object.freeze(['.xlsx', '.xls']);

class PurchasingRunError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PurchasingRunError';
    this.code = code;
  }
}

function requiredArgumentValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new PurchasingRunError(
      `Для аргумента ${flag} требуется значение.`,
      'MISSING_ARGUMENT_VALUE'
    );
  }
  return value;
}

function parseCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PurchasingRunError(
      'Аргумент --run-date должен иметь формат YYYY-MM-DD.',
      'INVALID_RUN_DATE'
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value) {
    throw new PurchasingRunError(
      'Аргумент --run-date содержит некорректную календарную дату.',
      'INVALID_RUN_DATE'
    );
  }
  return value;
}

function parseArguments(argv) {
  const parsed = {
    inputPath: null,
    financialDataPath: DEFAULT_FINANCIAL_DATA_PATH,
    assortmentMatrixPath: DEFAULT_ASSORTMENT_MATRIX_PATH,
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    store: 'Миска',
    runDate: null,
    reportDate: null,
    format: 'all',
    force: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') parsed.force = true;
    else if (argument === '--dry-run') parsed.dryRun = true;
    else if (argument === '--help' || argument === '-h') parsed.help = true;
    else if ([
      '--input',
      '--financial-data',
      '--assortment-matrix',
      '--output-dir',
      '--store',
      '--run-date',
      '--report-date',
      '--format',
    ].includes(argument)) {
      const value = requiredArgumentValue(argv, index, argument);
      index += 1;
      if (argument === '--input') parsed.inputPath = path.resolve(value);
      else if (argument === '--financial-data') {
        parsed.financialDataPath = path.resolve(value);
      } else if (argument === '--assortment-matrix') {
        parsed.assortmentMatrixPath = path.resolve(value);
      } else if (argument === '--output-dir') {
        parsed.outputDirectory = path.resolve(value);
      } else if (argument === '--store') {
        if (value.trim() === '') {
          throw new PurchasingRunError(
            'Аргумент --store должен быть непустой строкой.',
            'INVALID_STORE'
          );
        }
        parsed.store = value.trim();
      } else if (argument === '--run-date') {
        parsed.runDate = parseCalendarDate(value);
      } else if (argument === '--report-date') {
        parsed.reportDate = parseCalendarDate(value);
      } else {
        const format = value.toLowerCase();
        if (!ALLOWED_FORMATS.includes(format)) {
          throw new PurchasingRunError(
            'Аргумент --format должен быть одним из: all, json, text.',
            'INVALID_FORMAT'
          );
        }
        parsed.format = format;
      }
    } else {
      throw new PurchasingRunError(
        `Неизвестный аргумент: ${argument}. Используйте --help.`,
        'UNKNOWN_ARGUMENT'
      );
    }
  }

  if (!parsed.help && !parsed.inputPath) {
    throw new PurchasingRunError(
      'Укажите входной Excel-файл через --input <путь>.',
      'INPUT_REQUIRED'
    );
  }
  return parsed;
}

function localDateParts(dateInput = new Date()) {
  const date = new Date(dateInput);
  if (!Number.isFinite(date.getTime())) {
    throw new PurchasingRunError(
      'Не удалось определить дату и время запуска.',
      'INVALID_CURRENT_DATE'
    );
  }
  return {
    date: [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-'),
    time: [
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
      String(date.getSeconds()).padStart(2, '0'),
    ].join('-'),
    compactTime: [
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
      String(date.getSeconds()).padStart(2, '0'),
    ].join(''),
  };
}

function validateInputFile(inputPath) {
  const extension = path.extname(inputPath).toLowerCase();
  if (!ALLOWED_EXCEL_EXTENSIONS.includes(extension)) {
    throw new PurchasingRunError(
      'Входной файл должен иметь расширение .xlsx или .xls.',
      'INVALID_INPUT_EXTENSION'
    );
  }

  let stat;
  try {
    stat = fs.statSync(inputPath);
    fs.accessSync(inputPath, fs.constants.R_OK);
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'файл не найден' : error.message;
    throw new PurchasingRunError(
      `Не удалось прочитать входной Excel «${inputPath}»: ${reason}.`,
      'INPUT_FILE_ERROR',
      error
    );
  }
  if (!stat.isFile()) {
    throw new PurchasingRunError(
      `Входной путь не является файлом: ${inputPath}.`,
      'INPUT_NOT_FILE'
    );
  }
  return stat;
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function optionalSha256File(filePath) {
  try {
    return sha256File(filePath);
  } catch {
    return null;
  }
}

function randomSuffix() {
  return crypto.randomBytes(3).toString('hex');
}

function generatedFileNames(format) {
  const names = [];
  if (format === 'all' || format === 'json') names.push('result.json');
  if (format === 'all' || format === 'text') names.push('report.txt');
  names.push('run-metadata.json');
  return names;
}

function decisionSummaryLines(title, summary) {
  if (!summary) return [];
  return [
    title,
    `- must_buy: ${summary.mustBuyCount ?? 0}`,
    `- recommended: ${summary.recommendedCount ?? 0}`,
    `- manual_review: ${summary.manualReviewCount ?? 0}`,
    `- postpone: ${summary.postponeCount ?? 0}`,
    `- do_not_buy: ${summary.doNotBuyCount ?? 0}`,
  ];
}

function extractDecisionDistributions(agentJson) {
  if (agentJson.phase1DecisionSummary) {
    return {
      phase1: agentJson.phase1DecisionSummary,
      phase2: {
        mustBuyCount: agentJson.mustBuyCount,
        recommendedCount: agentJson.recommendedCount,
        manualReviewCount: agentJson.manualReviewCount,
        postponeCount: agentJson.postponeCount,
        doNotBuyCount: agentJson.doNotBuyCount,
      },
    };
  }
  return {
    phase1: {
      mustBuyCount: agentJson.mustBuyCount,
      recommendedCount: agentJson.recommendedCount,
      manualReviewCount: agentJson.manualReviewCount,
      postponeCount: agentJson.postponeCount,
      doNotBuyCount: agentJson.doNotBuyCount,
    },
    phase2: null,
  };
}

function collectRunWarnings(agentJson) {
  const warnings = [];
  const assessment = agentJson.financial_assessment || {};
  warnings.push(...(assessment.financial_data_warnings || []));
  warnings.push(...(assessment.financial_data_errors || []).map(
    error => `Финансовые данные: ${error}`
  ));
  warnings.push(...(agentJson.reportWarnings || []));

  const diagnostics = agentJson.adapter_diagnostics || {};
  if ((diagnostics.ambiguousColumns || []).length > 0) {
    warnings.push(
      `Неоднозначные столбцы SmartZapas: ${diagnostics.ambiguousColumns.length}`
    );
  }
  if ((diagnostics.ambiguousRowClassifications || []).length > 0) {
    warnings.push(
      `Неоднозначные классификации строк: ${diagnostics.ambiguousRowClassifications.length}`
    );
  }
  if ((diagnostics.duplicateIdentifiers || []).length > 0) {
    warnings.push(
      `Диагностики повторяющихся идентификаторов: ${diagnostics.duplicateIdentifiers.length}`
    );
  }
  warnings.push(...(diagnostics.reportDateWarnings || []).map(item => {
    if (item.warning === 'weekly_history_report_date_unavailable') {
      return 'Не удалось определить дату отчёта для проверки завершённости недель.';
    }
    if (item.warning === 'explicit_report_timestamp_conflicts_with_workbook_period') {
      return 'Переданная дата отчёта не совпадает с периодом внутри SmartZapas; использована дата из workbook.';
    }
    return `Дата отчёта SmartZapas: ${item.warning}`;
  }));
  return Array.from(new Set(warnings.filter(Boolean)));
}

function collectCriticalProblems(agentJson) {
  const problems = [];
  const assessment = agentJson.financial_assessment || {};
  problems.push(...(assessment.financial_data_errors || []));
  if (assessment.status === 'PRELIMINARY' &&
      (assessment.missing_fields || []).length > 0) {
    problems.push(
      `Финансовое решение не подтверждено; отсутствуют поля: ${assessment.missing_fields.join(', ')}`
    );
  }
  const missingColumns = agentJson.adapter_diagnostics?.missingRequiredColumns || [];
  if (missingColumns.length > 0) {
    problems.push(`Отсутствуют обязательные столбцы: ${missingColumns.length}`);
  }
  return Array.from(new Set(problems));
}

function formatMoney(value) {
  if (value === null || value === undefined) return 'нет данных';
  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} RUB`;
}

function buildOwnerReport({
  agentJson,
  store,
  runDate,
  inputPath,
  warnings,
}) {
  const assessment = agentJson.financial_assessment || {};
  const distributions = extractDecisionDistributions(agentJson);
  const criticalProblems = collectCriticalProblems(agentJson);
  const lines = [
    `ОТЧЁТ ВЛАДЕЛЬЦУ — МАГАЗИН «${store}»`,
    '',
    `Дата запуска: ${runDate}`,
    `Входной файл: ${path.basename(inputPath)}`,
    `Итоговая сумма заказа: ${formatMoney(
      assessment.proposed_order_amount ?? agentJson.preliminary_order_sum
    )}`,
    `Товарных строк: ${agentJson.product_rows_count}`,
    `Статус финансовой оценки: ${assessment.status || 'нет данных'}`,
    `Итоговое решение для владельца: ${assessment.recommendation || 'нет данных'}`,
    '',
    ...decisionSummaryLines('Распределение решений Phase 1:', distributions.phase1),
  ];
  if (distributions.phase2) {
    lines.push(
      '',
      ...decisionSummaryLines(
        'Распределение решений Phase 2:',
        distributions.phase2
      )
    );
  }

  lines.push('', 'Предупреждения:');
  if (warnings.length === 0) lines.push('- нет');
  else warnings.forEach(warning => lines.push(`- ${warning}`));

  lines.push('', 'Критические проблемы:');
  if (criticalProblems.length === 0) lines.push('- нет');
  else criticalProblems.forEach(problem => lines.push(`- ${problem}`));

  lines.push('', agentJson.minmax_text.trimEnd(), '');
  return lines.join('\n');
}

function validateGeneratedContent(name, content) {
  if (typeof content !== 'string' || content.length === 0) {
    throw new PurchasingRunError(
      `Содержимое выходного файла ${name} пустое или некорректное.`,
      'INVALID_GENERATED_CONTENT'
    );
  }
  if (name.endsWith('.json')) JSON.parse(content);
}

function removeIfExists(filePath, removeFile, exists) {
  if (!exists(filePath)) return;
  removeFile(filePath);
}

function safeWriteRunFiles(runDirectory, files, options = {}) {
  const force = options.force === true;
  const exists = options.exists || fs.existsSync;
  const makeDirectory = options.makeDirectory || fs.mkdirSync;
  const stat = options.stat || fs.statSync;
  const writeFile = options.writeFile || fs.writeFileSync;
  const readFile = options.readFile || fs.readFileSync;
  const renameFile = options.renameFile || fs.renameSync;
  const removeFile = options.removeFile || fs.unlinkSync;
  const removeDirectory = options.removeDirectory || fs.rmdirSync;

  for (const file of files) {
    if (path.basename(file.name) !== file.name) {
      throw new PurchasingRunError(
        `Недопустимое имя выходного файла: ${file.name}.`,
        'INVALID_OUTPUT_NAME'
      );
    }
    validateGeneratedContent(file.name, file.content);
  }

  const directoryExisted = exists(runDirectory);
  if (directoryExisted && !force) {
    throw new PurchasingRunError(
      `Папка запуска уже существует: ${runDirectory}. Используйте --force для явной перезаписи файлов этой папки.`,
      'OUTPUT_EXISTS'
    );
  }
  if (directoryExisted && !stat(runDirectory).isDirectory()) {
    throw new PurchasingRunError(
      `Целевой путь не является папкой: ${runDirectory}.`,
      'OUTPUT_NOT_DIRECTORY'
    );
  }

  makeDirectory(path.dirname(runDirectory), { recursive: true });
  if (!directoryExisted) makeDirectory(runDirectory);

  const suffix = `${process.pid}-${Date.now()}-${randomSuffix()}`;
  const prepared = files.map(file => ({
    ...file,
    finalPath: path.join(runDirectory, file.name),
    temporaryPath: path.join(runDirectory, `.${file.name}.${suffix}.tmp`),
    backupPath: path.join(runDirectory, `.${file.name}.${suffix}.bak`),
  }));
  const backups = [];
  const renamedFinals = [];

  try {
    for (const file of prepared) {
      writeFile(file.temporaryPath, file.content, {
        encoding: 'utf8',
        flag: 'wx',
      });
      validateGeneratedContent(
        file.name,
        readFile(file.temporaryPath, 'utf8')
      );
    }

    if (force) {
      for (const file of prepared) {
        if (exists(file.finalPath)) {
          renameFile(file.finalPath, file.backupPath);
          backups.push(file);
        }
      }
    }

    for (const file of prepared) {
      renameFile(file.temporaryPath, file.finalPath);
      renamedFinals.push(file);
    }
  } catch (error) {
    for (const file of renamedFinals.reverse()) {
      try {
        removeIfExists(file.finalPath, removeFile, exists);
      } catch {
        // Continue restoring other files and surface the original write error.
      }
    }
    for (const file of backups.reverse()) {
      try {
        if (exists(file.backupPath)) {
          renameFile(file.backupPath, file.finalPath);
        }
      } catch {
        // Continue cleanup and surface the original write error.
      }
    }
    for (const file of prepared) {
      try {
        removeIfExists(file.temporaryPath, removeFile, exists);
        removeIfExists(file.backupPath, removeFile, exists);
      } catch {
        // Continue cleanup and surface the original write error.
      }
    }
    if (!directoryExisted) {
      try {
        removeDirectory(runDirectory);
      } catch {
        // A non-empty directory is safer than deleting anything unexpected.
      }
    }
    throw new PurchasingRunError(
      `Не удалось безопасно сохранить файлы запуска: ${error.message}`,
      'OUTPUT_WRITE_ERROR',
      error
    );
  }

  for (const file of backups) {
    try {
      removeIfExists(file.backupPath, removeFile, exists);
    } catch {
      // Final files are already complete; an orphaned backup is safer than rollback.
    }
  }

  return prepared.map(file => file.finalPath);
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function helpText() {
  return [
    'Полный локальный запуск Purchasing Agent',
    '',
    'Использование:',
    '  npm run purchasing:run -- --input <путь к Excel> [параметры]',
    '',
    'Параметры:',
    '  --input <путь>            Входной .xlsx или .xls (обязательно)',
    '  --financial-data <путь>   Финансовый JSON магазина',
    '  --assortment-matrix <путь> JSON обязательной ассортиментной матрицы',
    '  --output-dir <путь>       Корневая папка результатов',
    '  --store <название>        Название магазина (по умолчанию Миска)',
    '  --run-date <YYYY-MM-DD>   Дата запуска для папки и run_id',
    '  --report-date <YYYY-MM-DD> Дата самого отчёта, если её нет в имени и workbook',
    '  --format <all|json|text>  Формат результатов (по умолчанию all)',
    '  --force                   Перезаписать файлы только текущей папки запуска',
    '  --dry-run                 Выполнить расчёт без создания файлов и папок',
    '  --help, -h                Показать справку',
  ].join('\n');
}

function terminalSummary({
  output,
  status,
  runDirectory,
  agentJson,
  generatedFiles,
  dryRun,
}) {
  const assessment = agentJson.financial_assessment || {};
  output(`Статус запуска: ${status}${dryRun ? ' (dry-run)' : ''}`);
  output(`Папка результатов: ${dryRun ? 'не создавалась' : runDirectory}`);
  output(`Сумма заказа: ${formatMoney(
    assessment.proposed_order_amount ?? agentJson.preliminary_order_sum
  )}`);
  output(`Товарных строк: ${agentJson.product_rows_count}`);
  output(`Финансовый статус: ${assessment.status || 'нет данных'}`);
  output(`Запас сверх резерва: ${formatMoney(assessment.reserve_surplus)}`);
  output(
    `Созданные файлы: ${dryRun ? 'нет' : generatedFiles.join(', ')}`
  );
}

async function defaultAgentRunner(
  inputPath,
  financialDataPath,
  assortmentMatrixPath,
  reportMetadata = {}
) {
  return runOrderAgentFromSmartZapasXlsxWithDemand(
    inputPath,
    { purchasingProfile: 'miska' },
    {
      financialDataPath,
      assortmentMatrixPath,
      reportDate: reportMetadata.reportDate,
    }
  );
}

async function runPurchasingCli(argv, dependencies = {}) {
  const output = dependencies.output || console.log;
  const args = parseArguments(argv);
  if (args.help) {
    output(helpText());
    return { mode: 'help', status: 'success' };
  }

  const startedDate = new Date(dependencies.currentDate || new Date());
  const startedTimestamp = startedDate.toISOString();
  const startedMilliseconds = startedDate.getTime();
  const dateParts = localDateParts(startedDate);
  const runDate = args.runDate || dateParts.date;
  const folderName = `${runDate}_${dateParts.time}`;
  const runDirectory = path.resolve(args.outputDirectory, folderName);
  const suffix = dependencies.randomSuffix || randomSuffix();
  const runId = `purchasing-${runDate.replaceAll('-', '')}-${dateParts.compactTime}-${suffix}`;

  const inputStat = validateInputFile(args.inputPath);
  const inputHash = sha256File(args.inputPath);
  const financialHash = optionalSha256File(args.financialDataPath);
  const assortmentMatrixHash = optionalSha256File(args.assortmentMatrixPath);
  const agentRunner = dependencies.agentRunner || defaultAgentRunner;

  let agentResult;
  try {
    agentResult = await agentRunner(
      args.inputPath,
      args.financialDataPath,
      args.assortmentMatrixPath,
      { reportDate: args.reportDate }
    );
  } catch (error) {
    throw new PurchasingRunError(
      `Не удалось обработать входной Excel: ${error.message}`,
      'AGENT_RUN_ERROR',
      error
    );
  }
  if (!Array.isArray(agentResult) || !agentResult[0]?.json) {
    throw new PurchasingRunError(
      'Purchasing Agent вернул некорректный результат.',
      'INVALID_AGENT_RESULT'
    );
  }

  const agentJson = agentResult[0].json;
  const warnings = collectRunWarnings(agentJson);
  const status = warnings.length > 0 ? 'success_with_warnings' : 'success';
  const reportText = buildOwnerReport({
    agentJson,
    store: args.store,
    runDate,
    inputPath: args.inputPath,
    warnings,
  });
  const completedDate = new Date(dependencies.completedDate || new Date());
  const generatedFiles = generatedFileNames(args.format);
  const metadata = {
    run_id: runId,
    started_at: startedTimestamp,
    completed_at: completedDate.toISOString(),
    duration_ms: Math.max(0, completedDate.getTime() - startedMilliseconds),
    store: args.store,
    input_file: path.normalize(args.inputPath),
    input_file_size: inputStat.size,
    input_file_sha256: inputHash,
    report_date_override: args.reportDate,
    resolved_report_date: agentJson.adapter_source?.reportDate || null,
    resolved_report_date_source: agentJson.adapter_source?.reportDateSource || null,
    resolved_report_timestamp: agentJson.adapter_source?.reportTimestamp || null,
    resolved_report_timestamp_source:
      agentJson.adapter_source?.reportTimestampSource || null,
    financial_data_file: path.normalize(args.financialDataPath),
    financial_data_sha256: financialHash,
    assortment_matrix_file: path.normalize(args.assortmentMatrixPath),
    assortment_matrix_sha256: assortmentMatrixHash,
    output_directory: path.normalize(runDirectory),
    agent_version: packageJson.version,
    node_version: process.version,
    status,
    generated_files: generatedFiles,
    warnings,
    errors: [],
  };

  if (!args.dryRun) {
    const files = [];
    if (args.format === 'all' || args.format === 'json') {
      files.push({ name: 'result.json', content: serializeJson(agentResult) });
    }
    if (args.format === 'all' || args.format === 'text') {
      files.push({ name: 'report.txt', content: reportText });
    }
    files.push({
      name: 'run-metadata.json',
      content: serializeJson(metadata),
    });
    safeWriteRunFiles(runDirectory, files, {
      force: args.force,
      ...(dependencies.writeOptions || {}),
    });
  }

  terminalSummary({
    output,
    status,
    runDirectory,
    agentJson,
    generatedFiles,
    dryRun: args.dryRun,
  });
  return {
    mode: args.dryRun ? 'dry-run' : 'written',
    status,
    runDirectory,
    generatedFiles: args.dryRun ? [] : generatedFiles,
    metadata,
    reportText,
    agentResult,
  };
}

async function main() {
  try {
    await runPurchasingCli(process.argv.slice(2));
  } catch (error) {
    console.error(`Ошибка: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_FINANCIAL_DATA_PATH,
  DEFAULT_ASSORTMENT_MATRIX_PATH,
  DEFAULT_OUTPUT_DIRECTORY,
  ALLOWED_FORMATS,
  ALLOWED_EXCEL_EXTENSIONS,
  PurchasingRunError,
  parseCalendarDate,
  parseArguments,
  localDateParts,
  validateInputFile,
  sha256File,
  optionalSha256File,
  generatedFileNames,
  extractDecisionDistributions,
  collectRunWarnings,
  collectCriticalProblems,
  buildOwnerReport,
  safeWriteRunFiles,
  serializeJson,
  helpText,
  terminalSummary,
  defaultAgentRunner,
  runPurchasingCli,
  main,
};

if (require.main === module) {
  main();
}
