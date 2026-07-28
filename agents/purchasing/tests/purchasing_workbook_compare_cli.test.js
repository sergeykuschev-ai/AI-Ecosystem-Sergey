const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const {
  compareWorkbookDiagnostics,
  formatText,
} = require('../../../scripts/compare-purchasing-workbooks');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT_PATH = path.join(
  REPOSITORY_ROOT,
  'scripts/compare-purchasing-workbooks.js'
);
const XLSX_FIXTURE_PATH = path.join(
  REPOSITORY_ROOT,
  'tests/fixtures/SmartZapas_synthetic.xlsx'
);
const TEMP_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), 'purchasing-workbook-compare-cli-')
);

after(() => {
  fs.rmSync(TEMP_DIRECTORY, { recursive: true, force: true });
});

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: options.cwd || REPOSITORY_ROOT,
    encoding: 'utf8',
  });
}

function diagnostics(worksheets) {
  return {
    worksheetNames: worksheets.map(worksheet => worksheet.name),
    worksheetCount: worksheets.length,
    worksheets,
  };
}

function compare(beforeWorksheets, afterWorksheets) {
  return compareWorkbookDiagnostics({
    beforeFilePath: '/tmp/before.xlsx',
    afterFilePath: '/tmp/after.xlsx',
    beforeDiagnostics: diagnostics(beforeWorksheets),
    afterDiagnostics: diagnostics(afterWorksheets),
  });
}

test('--help works without workbook arguments', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Workbook Compare v1/);
  assert.match(result.stdout, /--before <старый\.xlsx>/);
  assert.equal(result.stderr, '');
});

test('missing --before returns a clear error', () => {
  const result = runCli(['--after', XLSX_FIXTURE_PATH]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--before/);
});

test('missing --after returns a clear error', () => {
  const result = runCli(['--before', XLSX_FIXTURE_PATH]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--after/);
});

test('detects an added worksheet', () => {
  const result = compare(
    [{ name: 'Общий', rows: 1, columns: ['A'] }],
    [
      { name: 'Общий', rows: 1, columns: ['A'] },
      { name: 'Новый лист', rows: 0, columns: [] },
    ]
  );

  assert.deepEqual(result.addedWorksheets, ['Новый лист']);
  assert.deepEqual(result.removedWorksheets, []);
});

test('detects a removed worksheet', () => {
  const result = compare(
    [
      { name: 'Общий', rows: 1, columns: ['A'] },
      { name: 'Удалённый лист', rows: 2, columns: ['B'] },
    ],
    [{ name: 'Общий', rows: 1, columns: ['A'] }]
  );

  assert.deepEqual(result.removedWorksheets, ['Удалённый лист']);
  assert.deepEqual(result.addedWorksheets, []);
});

test('detects an added column without normalizing its value', () => {
  const result = compare(
    [{ name: 'Лист', rows: 1, columns: ['Артикул'] }],
    [{ name: 'Лист', rows: 1, columns: ['Артикул', ' Артикул '] }]
  );

  assert.deepEqual(result.worksheets[0].addedColumns, [' Артикул ']);
  assert.deepEqual(result.worksheets[0].removedColumns, []);
});

test('detects a removed column with exact case', () => {
  const result = compare(
    [{ name: 'Лист', rows: 1, columns: ['Цена', 'цена'] }],
    [{ name: 'Лист', rows: 1, columns: ['Цена'] }]
  );

  assert.deepEqual(result.worksheets[0].removedColumns, ['цена']);
  assert.deepEqual(result.worksheets[0].addedColumns, []);
});

test('detects a changed column order', () => {
  const result = compare(
    [{ name: 'Лист', rows: 1, columns: ['A', 'B', 'C'] }],
    [{ name: 'Лист', rows: 1, columns: ['B', 'A', 'C'] }]
  );

  assert.equal(result.worksheets[0].columnOrderChanged, true);
  assert.deepEqual(result.worksheets[0].addedColumns, []);
  assert.deepEqual(result.worksheets[0].removedColumns, []);
});

test('calculates worksheet row delta', () => {
  const result = compare(
    [{ name: 'Лист', rows: 8, columns: ['A'] }],
    [{ name: 'Лист', rows: 13, columns: ['A'] }]
  );

  assert.equal(result.worksheets[0].rowsBefore, 8);
  assert.equal(result.worksheets[0].rowsAfter, 13);
  assert.equal(result.worksheets[0].rowDelta, 5);
});

test('json output is valid and follows the public result shape', () => {
  const result = runCli([
    '--before', XLSX_FIXTURE_PATH,
    '--after', XLSX_FIXTURE_PATH,
    '--format', 'json',
  ]);

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(parsed), [
    'beforeFileName',
    'afterFileName',
    'worksheetCountBefore',
    'worksheetCountAfter',
    'addedWorksheets',
    'removedWorksheets',
    'commonWorksheets',
    'worksheets',
  ]);
  assert.equal(parsed.beforeFileName, 'SmartZapas_synthetic.xlsx');
  assert.equal(parsed.afterFileName, 'SmartZapas_synthetic.xlsx');
  assert.deepEqual(parsed.addedWorksheets, []);
  assert.deepEqual(parsed.removedWorksheets, []);
  assert.deepEqual(parsed.commonWorksheets, ['SmartZapas Synthetic']);
  assert.equal(parsed.worksheets[0].rowDelta, 0);
});

test('text output explicitly reports no structural changes', () => {
  const result = compare(
    [{ name: 'Лист', rows: 2, columns: ['A', 'B'] }],
    [{ name: 'Лист', rows: 2, columns: ['A', 'B'] }]
  );
  const text = formatText(result);

  assert.match(text, /^WORKBOOK COMPARE V1/m);
  assert.match(text, /Листы добавлены:\n- нет/);
  assert.match(text, /Листы удалены:\n- нет/);
  assert.match(text, /Добавленные заголовки:\n- нет/);
  assert.match(text, /Удалённые заголовки:\n- нет/);
  assert.match(text, /Порядок заголовков изменён: нет/);
});

test('does not create files or directories in the working directory', () => {
  const workingDirectory = path.join(TEMP_DIRECTORY, 'no-output');
  fs.mkdirSync(workingDirectory);
  const before = fs.readdirSync(workingDirectory);

  const result = runCli([
    '--before', XLSX_FIXTURE_PATH,
    '--after', XLSX_FIXTURE_PATH,
  ], { cwd: workingDirectory });

  assert.equal(result.status, 0);
  assert.deepEqual(fs.readdirSync(workingDirectory), before);
});

test('argument, file, and workbook errors return non-zero exit codes', () => {
  const corruptedPath = path.join(TEMP_DIRECTORY, 'corrupted.xlsx');
  fs.writeFileSync(corruptedPath, 'not an xlsx archive', 'utf8');
  const missingPath = path.join(TEMP_DIRECTORY, 'missing.xlsx');
  const cases = [
    {
      args: ['--before'],
      message: 'Для аргумента --before требуется значение',
    },
    {
      args: ['--unknown'],
      message: 'Неизвестный аргумент',
    },
    {
      args: [
        '--before', XLSX_FIXTURE_PATH,
        '--after', XLSX_FIXTURE_PATH,
        '--format', 'xml',
      ],
      message: 'Неизвестный формат',
    },
    {
      args: [
        '--before', `${XLSX_FIXTURE_PATH}.csv`,
        '--after', XLSX_FIXTURE_PATH,
      ],
      message: 'расширение .xlsx или .xls',
    },
    {
      args: [
        '--before', missingPath,
        '--after', XLSX_FIXTURE_PATH,
      ],
      message: 'Excel-файл не найден',
    },
    {
      args: [
        '--before', corruptedPath,
        '--after', XLSX_FIXTURE_PATH,
      ],
      message: 'Не удалось открыть старый workbook',
    },
  ];

  cases.forEach(({ args, message }) => {
    const result = runCli(args);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(message), result.stderr);
  });
});
