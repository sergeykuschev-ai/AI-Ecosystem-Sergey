const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT_PATH = path.join(
  REPOSITORY_ROOT,
  'scripts/diagnose-purchasing-workbook.js'
);
const XLSX_FIXTURE_PATH = path.join(
  REPOSITORY_ROOT,
  'tests/fixtures/SmartZapas_synthetic.xlsx'
);
const TEMP_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), 'purchasing-workbook-diagnostics-cli-')
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

function writeProfile(fileName, content) {
  const filePath = path.join(TEMP_DIRECTORY, fileName);
  fs.writeFileSync(
    filePath,
    typeof content === 'string' ? content : JSON.stringify(content),
    'utf8'
  );
  return filePath;
}

function compatibilityProfile(requiredColumns) {
  return {
    profileVersion: 1,
    requiredWorksheets: [
      {
        name: 'SmartZapas Synthetic',
        requiredColumns,
      },
    ],
  };
}

test('--help works without --input', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Compatibility Report v1/);
  assert.match(result.stdout, /--input <путь>/);
  assert.equal(result.stderr, '');
});

test('missing --input returns a clear error and non-zero exit code', () => {
  const result = runCli([]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Укажите входной Excel-файл через --input/);
});

test('argument errors are rejected with a non-zero exit code', () => {
  const cases = [
    { args: ['--input'], message: 'Для аргумента --input требуется значение' },
    { args: ['--unknown'], message: 'Неизвестный аргумент' },
    {
      args: ['--input', XLSX_FIXTURE_PATH, '--format', 'xml'],
      message: 'Неизвестный формат',
    },
    {
      args: ['--input', path.join(TEMP_DIRECTORY, 'missing.xlsx')],
      message: 'Входной Excel-файл не найден',
    },
    {
      args: [
        '--input',
        XLSX_FIXTURE_PATH,
        '--profile',
        path.join(TEMP_DIRECTORY, 'missing-profile.json'),
      ],
      message: 'файл не найден',
    },
  ];

  cases.forEach(({ args, message }) => {
    const result = runCli(args);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(message), result.stderr);
  });
});

test('rejects an unsupported input extension', () => {
  const result = runCli([
    '--input',
    path.join(TEMP_DIRECTORY, 'workbook.csv'),
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /расширение \.xlsx или \.xls/);
});

test('text output contains file, worksheets, rows, and original headers', () => {
  const result = runCli(['--input', XLSX_FIXTURE_PATH]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Файл: SmartZapas_synthetic\.xlsx/);
  assert.match(result.stdout, /Количество листов: 1/);
  assert.match(result.stdout, /Лист: SmartZapas Synthetic/);
  assert.match(result.stdout, /Количество строк: 11/);
  assert.match(result.stdout, /Количество заголовков:/);
  assert.match(result.stdout, /Наименование/);
  assert.equal(result.stderr, '');
});

test('without --profile preserves Compatibility Report v1 text mode', () => {
  const result = runCli(['--input', XLSX_FIXTURE_PATH]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^COMPATIBILITY REPORT V1\n/);
  assert.doesNotMatch(result.stdout, /Профиль:/);
  assert.doesNotMatch(result.stdout, /Статус:/);
});

test('json output is valid and follows the public result shape', () => {
  const result = runCli([
    '--input', XLSX_FIXTURE_PATH,
    '--format', 'json',
  ]);

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(parsed), [
    'fileName',
    'worksheetCount',
    'worksheetNames',
    'worksheets',
  ]);
  assert.equal(parsed.fileName, 'SmartZapas_synthetic.xlsx');
  assert.equal(parsed.worksheetCount, 1);
  assert.deepEqual(parsed.worksheetNames, ['SmartZapas Synthetic']);
  assert.equal(parsed.worksheets[0].name, 'SmartZapas Synthetic');
  assert.equal(parsed.worksheets[0].rows, 11);
  assert.ok(Array.isArray(parsed.worksheets[0].columns));
});

test('valid profile enables Compatibility Report v2 text mode', () => {
  const profilePath = writeProfile(
    'compatible-text.json',
    compatibilityProfile(['Артикул', 'Наименование'])
  );

  const result = runCli([
    '--input', XLSX_FIXTURE_PATH,
    '--profile', profilePath,
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^COMPATIBILITY REPORT V2\n/);
  assert.match(result.stdout, /Профиль: compatible-text\.json/);
  assert.match(result.stdout, /Статус: COMPATIBLE/);
  assert.match(result.stdout, /Лист: SmartZapas Synthetic/);
  assert.match(result.stdout, /Найден: да/);
  assert.match(result.stdout, /Обязательные колонки:\n- Артикул/);
  assert.match(result.stdout, /Фактические колонки:/);
  assert.match(result.stdout, /Отсутствующие колонки:\n- нет/);
  assert.equal(result.stderr, '');
});

test('incompatible profile is reported successfully with exit code zero', () => {
  const profilePath = writeProfile(
    'incompatible-text.json',
    compatibilityProfile(['Несуществующая колонка'])
  );

  const result = runCli([
    '--input', XLSX_FIXTURE_PATH,
    '--profile', profilePath,
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Статус: INCOMPATIBLE/);
  assert.match(
    result.stdout,
    /Отсутствующие колонки:\n- Несуществующая колонка/
  );
  assert.equal(result.stderr, '');
});

test('json output with profile preserves diagnostics and adds compatibility', () => {
  const profilePath = writeProfile(
    'compatible-json.json',
    compatibilityProfile(['Артикул'])
  );

  const result = runCli([
    '--input', XLSX_FIXTURE_PATH,
    '--profile', profilePath,
    '--format', 'json',
  ]);

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(parsed), [
    'fileName',
    'worksheetCount',
    'worksheetNames',
    'worksheets',
    'profileFileName',
    'compatibility',
  ]);
  assert.equal(parsed.fileName, 'SmartZapas_synthetic.xlsx');
  assert.equal(parsed.worksheetCount, 1);
  assert.deepEqual(parsed.worksheetNames, ['SmartZapas Synthetic']);
  assert.equal(parsed.profileFileName, 'compatible-json.json');
  assert.equal(parsed.compatibility.status, 'COMPATIBLE');
  assert.equal(parsed.compatibility.profileVersion, 1);
  assert.deepEqual(parsed.compatibility.missingWorksheets, []);
  assert.equal(
    parsed.compatibility.worksheets[0].name,
    'SmartZapas Synthetic'
  );
});

test('invalid profile JSON returns a non-zero exit code', () => {
  const profilePath = writeProfile('invalid-json.json', '{"profileVersion":');

  const result = runCli([
    '--input', XLSX_FIXTURE_PATH,
    '--profile', profilePath,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Некорректный JSON/);
});

test('invalid profile structure returns a non-zero exit code', () => {
  const profilePath = writeProfile('invalid-profile.json', {
    profileVersion: 0,
    requiredWorksheets: [],
  });

  const result = runCli([
    '--input', XLSX_FIXTURE_PATH,
    '--profile', profilePath,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Некорректный профиль совместимости/);
  assert.match(result.stderr, /profileVersion/);
});

test('missing --profile value returns a non-zero exit code', () => {
  const result = runCli([
    '--input', XLSX_FIXTURE_PATH,
    '--profile',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Для аргумента --profile требуется значение/
  );
});

test('does not create files or directories in the working directory', () => {
  const workingDirectory = path.join(TEMP_DIRECTORY, 'no-output');
  fs.mkdirSync(workingDirectory);
  const profilePath = writeProfile(
    'no-output-profile.json',
    compatibilityProfile(['Артикул'])
  );
  const before = fs.readdirSync(workingDirectory);

  const result = runCli([
    '--input', XLSX_FIXTURE_PATH,
    '--profile', profilePath,
  ], { cwd: workingDirectory });

  assert.equal(result.status, 0);
  assert.deepEqual(fs.readdirSync(workingDirectory), before);
});

test('unreadable workbook returns a non-zero exit code', () => {
  const filePath = path.join(TEMP_DIRECTORY, 'corrupted.xlsx');
  fs.writeFileSync(filePath, 'not an xlsx archive', 'utf8');

  const result = runCli(['--input', filePath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Не удалось открыть workbook/);
});
