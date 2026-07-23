const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const {
  PurchasingRunError,
  parseArguments,
  runPurchasingCli,
  sha256File,
} = require('../../../scripts/run-purchasing-agent');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const XLSX_FIXTURE_PATH = path.join(
  REPOSITORY_ROOT,
  'tests/fixtures/SmartZapas_synthetic.xlsx'
);
const FINANCIAL_DATA_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-financial-current.json'
);
const TEMP_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), 'purchasing-run-cli-')
);
const START_DATE = new Date(2026, 6, 19, 12, 34, 56);
const COMPLETE_DATE = new Date(2026, 6, 19, 12, 34, 57);

after(() => {
  fs.rmSync(TEMP_DIRECTORY, { recursive: true, force: true });
});

function outputDirectory(name) {
  return path.join(TEMP_DIRECTORY, name);
}

function baseArguments(name, extra = []) {
  return [
    '--input', XLSX_FIXTURE_PATH,
    '--financial-data', FINANCIAL_DATA_PATH,
    '--output-dir', outputDirectory(name),
    ...extra,
  ];
}

function dependencies(overrides = {}) {
  return {
    output: () => {},
    currentDate: START_DATE,
    completedDate: COMPLETE_DATE,
    randomSuffix: 'abc123',
    ...overrides,
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function filesIn(directory) {
  return fs.readdirSync(directory).sort();
}

test('successfully runs the agent with a valid XLSX', async () => {
  const inputHashBefore = sha256File(XLSX_FIXTURE_PATH);
  const financeHashBefore = sha256File(FINANCIAL_DATA_PATH);
  const result = await runPurchasingCli(
    baseArguments('successful-run'),
    dependencies()
  );

  assert.equal(result.mode, 'written');
  assert.equal(result.agentResult[0].json.product_rows_count, 6);
  assert.equal(result.agentResult[0].json.decisions.length, 6);
  assert.equal(result.explanations.explained_sku_count, 6);
  assert.equal(sha256File(XLSX_FIXTURE_PATH), inputHashBefore);
  assert.equal(sha256File(FINANCIAL_DATA_PATH), financeHashBefore);
});

test('accepts an explicit report date without changing the run date', () => {
  const parsed = parseArguments([
    '--input', XLSX_FIXTURE_PATH,
    '--report-date', '2026-07-19',
  ]);

  assert.equal(parsed.reportDate, '2026-07-19');
  assert.equal(parsed.runDate, null);
});

test('creates a separate timestamp folder for each distinct run time', async () => {
  const root = outputDirectory('unique-folders');
  const first = await runPurchasingCli([
    '--input', XLSX_FIXTURE_PATH,
    '--output-dir', root,
  ], dependencies());
  const second = await runPurchasingCli([
    '--input', XLSX_FIXTURE_PATH,
    '--output-dir', root,
  ], dependencies({
    currentDate: new Date(2026, 6, 19, 12, 34, 57),
    completedDate: new Date(2026, 6, 19, 12, 34, 58),
    randomSuffix: 'def456',
  }));

  assert.notEqual(first.runDirectory, second.runDirectory);
  assert.deepEqual(filesIn(root), [
    '2026-07-19_12-34-56',
    '2026-07-19_12-34-57',
    'owner-learning-history.json',
  ]);
});

test('creates a complete result.json with two-space formatting and newline', async () => {
  const result = await runPurchasingCli(
    baseArguments('result-json'),
    dependencies()
  );
  const filePath = path.join(result.runDirectory, 'result.json');
  const source = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(source);

  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].json.product_rows_count, 6);
  assert.ok(source.includes('\n  {'));
  assert.ok(source.endsWith('\n'));
});

test('creates report.txt with the owner summary and existing agent report', async () => {
  const result = await runPurchasingCli(
    baseArguments('report-text'),
    dependencies()
  );
  const report = fs.readFileSync(
    path.join(result.runDirectory, 'report.txt'),
    'utf8'
  );

  assert.ok(report.includes('ОТЧЁТ ВЛАДЕЛЬЦУ — МАГАЗИН «Миска»'));
  assert.ok(report.includes('Распределение решений Phase 1:'));
  assert.ok(report.includes('Распределение решений Phase 2:'));
  assert.ok(report.includes('# ДАННЫЕ ИЗ ОТЧЁТА MIN-MAX ВАЛТЫ'));
});

test('creates deterministic Recommendation Explanation artifacts', async () => {
  const result = await runPurchasingCli(
    baseArguments('recommendation-explanations'),
    dependencies()
  );
  const explanations = readJson(path.join(
    result.runDirectory,
    'recommendation-explanations.json'
  ));
  const report = fs.readFileSync(path.join(
    result.runDirectory,
    'recommendation-explanations-report.md'
  ), 'utf8');
  assert.equal(explanations.explained_sku_count, 6);
  assert.equal(explanations.items.length, 6);
  assert.ok(explanations.items.every(item =>
    typeof item.explanation_summary === 'string' &&
    Array.isArray(item.explanation_reasons) &&
    ['high', 'medium', 'low'].includes(item.confidence_level)
  ));
  assert.ok(report.includes('Recommendation Explanations'));
  assert.ok(report.includes('Manual Review Required'));
});

test('creates Owner Learning JSON and Markdown artifacts', async () => {
  const result = await runPurchasingCli(
    baseArguments('owner-learning'),
    dependencies()
  );
  const learning = readJson(path.join(
    result.runDirectory,
    'owner-learning-report.json'
  ));
  const report = fs.readFileSync(path.join(
    result.runDirectory,
    'owner-learning-report.md'
  ), 'utf8');

  assert.equal(learning.reportVersion, 'owner-learning-v0.1');
  assert.equal(learning.totalItems, 6);
  assert.equal(
    learning.automaticItems + learning.reviewRequiredItems,
    learning.totalItems
  );
  assert.match(report, /^# Отчёт обучения закупщика/m);
  assert.match(report, /## Решения владельца/);
  assert.match(report, /## Сравнение с агентом/);
});

test('persists Owner Learning history and current-run pattern artifacts', async () => {
  const root = outputDirectory('owner-learning-history');
  const result = await runPurchasingCli([
    '--input', XLSX_FIXTURE_PATH,
    '--financial-data', FINANCIAL_DATA_PATH,
    '--output-dir', root,
  ], dependencies());
  const history = readJson(path.join(
    root,
    'owner-learning-history.json'
  ));
  const patterns = readJson(path.join(
    result.runDirectory,
    'owner-learning-patterns.json'
  ));
  const report = fs.readFileSync(path.join(
    result.runDirectory,
    'owner-learning-patterns.md'
  ), 'utf8');

  assert.equal(history.schemaVersion, 'owner-learning-history-v0.2');
  assert.equal(history.runs.length, 1);
  assert.equal(history.runs[0].runId, result.metadata.run_id);
  assert.equal(patterns.reportVersion, 'owner-learning-patterns-v0.2');
  assert.equal(patterns.historyRunsCount, 1);
  assert.match(report, /^# Повторяющиеся решения владельца/m);
});

test('history failure is logged without failing the purchasing run', async () => {
  const root = outputDirectory('damaged-owner-learning-history');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'owner-learning-history.json'),
    '{ damaged',
    'utf8'
  );
  const messages = [];
  const result = await runPurchasingCli([
    '--input', XLSX_FIXTURE_PATH,
    '--financial-data', FINANCIAL_DATA_PATH,
    '--output-dir', root,
  ], dependencies({ output: message => messages.push(message) }));

  assert.equal(result.status, 'success_with_warnings');
  assert.equal(result.ownerLearningHistoryError, 'HISTORY_INVALID');
  assert.equal(result.ownerLearningPatterns.status, 'unavailable');
  assert.ok(messages.some(message =>
    message.includes('Owner Learning History: HISTORY_INVALID')
  ));
  assert.equal(
    fs.readFileSync(
      path.join(root, 'owner-learning-history.json'),
      'utf8'
    ),
    '{ damaged'
  );
});

test('creates run-metadata.json for every normal run', async () => {
  const result = await runPurchasingCli(
    baseArguments('metadata-file'),
    dependencies()
  );
  const metadataPath = path.join(result.runDirectory, 'run-metadata.json');
  const metadata = readJson(metadataPath);

  assert.ok(metadata.run_id.startsWith('purchasing-20260719-123456-'));
  assert.equal(metadata.store, 'Миска');
  assert.equal(metadata.node_version, process.version);
  assert.equal(metadata.agent_version, '1.0.0');
  assert.equal(metadata.duration_ms, 1000);
  assert.equal(metadata.recommendation_explanations.explained_sku_count, 6);
  assert.equal(
    metadata.recommendation_explanations.json_file,
    'recommendation-explanations.json'
  );
  assert.equal(
    metadata.recommendation_explanations.markdown_file,
    'recommendation-explanations-report.md'
  );
});

test('metadata contains the exact SHA-256 of the input file', async () => {
  const result = await runPurchasingCli(
    baseArguments('input-hash'),
    dependencies()
  );
  const metadata = readJson(
    path.join(result.runDirectory, 'run-metadata.json')
  );

  assert.equal(metadata.input_file_sha256, sha256File(XLSX_FIXTURE_PATH));
  assert.equal(metadata.input_file_size, fs.statSync(XLSX_FIXTURE_PATH).size);
});

test('--format json creates JSON result, explanations, and metadata', async () => {
  const result = await runPurchasingCli(
    baseArguments('json-only', ['--format', 'json']),
    dependencies()
  );

  assert.deepEqual(filesIn(result.runDirectory), [
    'owner-learning-patterns.json',
    'owner-learning-patterns.md',
    'owner-learning-report.json',
    'owner-learning-report.md',
    'recommendation-explanations.json',
    'result.json',
    'run-metadata.json',
  ]);
  assert.deepEqual(result.metadata.generated_files, [
    'result.json',
    'recommendation-explanations.json',
    'owner-learning-report.json',
    'owner-learning-report.md',
    'owner-learning-patterns.json',
    'owner-learning-patterns.md',
    'run-metadata.json',
  ]);
});

test('--format text creates text report, explanations, and metadata', async () => {
  const result = await runPurchasingCli(
    baseArguments('text-only', ['--format', 'text']),
    dependencies()
  );

  assert.deepEqual(filesIn(result.runDirectory), [
    'owner-learning-patterns.json',
    'owner-learning-patterns.md',
    'owner-learning-report.json',
    'owner-learning-report.md',
    'recommendation-explanations-report.md',
    'report.txt',
    'run-metadata.json',
  ]);
  assert.deepEqual(result.metadata.generated_files, [
    'report.txt',
    'recommendation-explanations-report.md',
    'owner-learning-report.json',
    'owner-learning-report.md',
    'owner-learning-patterns.json',
    'owner-learning-patterns.md',
    'run-metadata.json',
  ]);
});

test('--dry-run creates no output directory or files', async () => {
  const root = outputDirectory('dry-run');
  const result = await runPurchasingCli([
    '--input', XLSX_FIXTURE_PATH,
    '--output-dir', root,
    '--dry-run',
  ], dependencies());

  assert.equal(result.mode, 'dry-run');
  assert.deepEqual(result.generatedFiles, []);
  assert.equal(fs.existsSync(root), false);
});

test('missing input Excel exits with an error before output creation', async () => {
  const root = outputDirectory('missing-input');

  await assert.rejects(
    () => runPurchasingCli([
      '--input', path.join(TEMP_DIRECTORY, 'missing.xlsx'),
      '--output-dir', root,
    ], dependencies()),
    error => error instanceof PurchasingRunError &&
      error.code === 'INPUT_FILE_ERROR'
  );
  assert.equal(fs.existsSync(root), false);
});

test('rejects an unsupported input extension', async () => {
  const inputPath = path.join(TEMP_DIRECTORY, 'input.csv');
  fs.writeFileSync(inputPath, 'not excel', 'utf8');

  await assert.rejects(
    () => runPurchasingCli([
      '--input', inputPath,
      '--output-dir', outputDirectory('wrong-extension'),
    ], dependencies()),
    error => error instanceof PurchasingRunError &&
      error.code === 'INVALID_INPUT_EXTENSION'
  );
});

test('corrupted Excel fails without creating partial results', async () => {
  const inputPath = path.join(TEMP_DIRECTORY, 'corrupted.xlsx');
  const root = outputDirectory('corrupt-excel');
  fs.writeFileSync(inputPath, 'not an xlsx archive', 'utf8');

  await assert.rejects(
    () => runPurchasingCli([
      '--input', inputPath,
      '--output-dir', root,
    ], dependencies()),
    error => error instanceof PurchasingRunError &&
      error.code === 'AGENT_RUN_ERROR'
  );
  assert.equal(fs.existsSync(root), false);
});

test('missing financial JSON keeps the product run successful and preliminary', async () => {
  const missingFinancialPath = path.join(TEMP_DIRECTORY, 'missing-finance.json');
  const result = await runPurchasingCli([
    '--input', XLSX_FIXTURE_PATH,
    '--financial-data', missingFinancialPath,
    '--output-dir', outputDirectory('missing-finance'),
  ], dependencies());
  const json = result.agentResult[0].json;

  assert.equal(result.status, 'success_with_warnings');
  assert.equal(json.product_rows_count, 6);
  assert.equal(json.financial_assessment.status, 'PRELIMINARY');
  assert.equal(result.metadata.financial_data_sha256, null);
  assert.ok(result.reportText.includes('файл не найден'));
});

test('corrupted financial JSON keeps the product run successful and preliminary', async () => {
  const financialPath = path.join(TEMP_DIRECTORY, 'corrupt-finance.json');
  fs.writeFileSync(financialPath, '{ "cash_balance": ', 'utf8');
  const result = await runPurchasingCli([
    '--input', XLSX_FIXTURE_PATH,
    '--financial-data', financialPath,
    '--output-dir', outputDirectory('corrupt-finance'),
  ], dependencies());

  assert.equal(result.status, 'success_with_warnings');
  assert.equal(
    result.agentResult[0].json.financial_assessment.status,
    'PRELIMINARY'
  );
  assert.equal(
    result.metadata.financial_data_sha256,
    sha256File(financialPath)
  );
  assert.ok(result.reportText.includes('Некорректный JSON'));
});

test('financial file errors do not change product quantities or decisions', async () => {
  const valid = await runPurchasingCli(
    baseArguments('valid-finance-dry', ['--dry-run']),
    dependencies()
  );
  const missing = await runPurchasingCli([
    '--input', XLSX_FIXTURE_PATH,
    '--financial-data', path.join(TEMP_DIRECTORY, 'absent-finance.json'),
    '--output-dir', outputDirectory('missing-finance-dry'),
    '--dry-run',
  ], dependencies());
  const validJson = valid.agentResult[0].json;
  const missingJson = missing.agentResult[0].json;

  assert.equal(missingJson.order_rows_count, validJson.order_rows_count);
  assert.equal(missingJson.preliminary_order_sum, validJson.preliminary_order_sum);
  assert.deepEqual(missingJson.phase1Decisions, validJson.phase1Decisions);
  assert.deepEqual(missingJson.decisions, validJson.decisions);
  assert.deepEqual(
    missingJson.workingOrderProducts,
    validJson.workingOrderProducts
  );
});

test('existing target folder is protected without --force', async () => {
  const args = baseArguments('overwrite-protection');
  await runPurchasingCli(args, dependencies());

  await assert.rejects(
    () => runPurchasingCli(args, dependencies()),
    error => error instanceof PurchasingRunError &&
      error.code === 'OUTPUT_EXISTS'
  );
});

test('--force overwrites only generated files in the current run folder', async () => {
  const args = baseArguments('force');
  const first = await runPurchasingCli(args, dependencies());
  const neighborPath = path.join(first.runDirectory, 'owner-note.txt');
  fs.writeFileSync(neighborPath, 'preserve me', 'utf8');

  const second = await runPurchasingCli(
    [...args, '--force'],
    dependencies({ randomSuffix: 'def456' })
  );

  assert.equal(second.mode, 'written');
  assert.equal(fs.readFileSync(neighborPath, 'utf8'), 'preserve me');
  assert.ok(fs.existsSync(path.join(second.runDirectory, 'result.json')));
  assert.ok(fs.existsSync(path.join(second.runDirectory, 'report.txt')));
});

test('write failure cleans temporary files and leaves no damaged finals', async () => {
  const root = outputDirectory('write-failure');
  let renameCalls = 0;

  await assert.rejects(
    () => runPurchasingCli([
      '--input', XLSX_FIXTURE_PATH,
      '--output-dir', root,
    ], dependencies({
      writeOptions: {
        renameFile: () => {
          renameCalls += 1;
          throw new Error('synthetic rename failure');
        },
      },
    })),
    error => error instanceof PurchasingRunError &&
      error.code === 'OUTPUT_WRITE_ERROR'
  );
  assert.ok(renameCalls > 0);
  const runDirectory = path.join(root, '2026-07-19_12-34-56');
  assert.equal(fs.existsSync(runDirectory), false);
});

test('report.txt contains the existing financial assessment section', async () => {
  const result = await runPurchasingCli(
    baseArguments('financial-report'),
    dependencies()
  );
  const report = fs.readFileSync(
    path.join(result.runDirectory, 'report.txt'),
    'utf8'
  );

  assert.ok(report.includes('## ФИНАНСОВАЯ ПРОВЕРКА ЗАКАЗА'));
  assert.ok(report.includes('### Источник финансовых данных'));
  assert.ok(report.includes('Итоговое решение для владельца:'));
});

test('metadata records status, normalized paths, warnings, and generated files', async () => {
  const result = await runPurchasingCli(
    baseArguments('metadata-contract'),
    dependencies()
  );
  const metadata = readJson(
    path.join(result.runDirectory, 'run-metadata.json')
  );

  assert.equal(metadata.status, result.status);
  assert.equal(metadata.input_file, path.normalize(XLSX_FIXTURE_PATH));
  assert.equal(metadata.financial_data_file, path.normalize(FINANCIAL_DATA_PATH));
  assert.equal(metadata.output_directory, path.normalize(result.runDirectory));
  assert.deepEqual(metadata.generated_files, [
    'result.json',
    'recommendation-explanations.json',
    'report.txt',
    'recommendation-explanations-report.md',
    'owner-learning-report.json',
    'owner-learning-report.md',
    'owner-learning-patterns.json',
    'owner-learning-patterns.md',
    'run-metadata.json',
  ]);
  assert.ok(Array.isArray(metadata.warnings));
  assert.deepEqual(metadata.errors, []);
});
