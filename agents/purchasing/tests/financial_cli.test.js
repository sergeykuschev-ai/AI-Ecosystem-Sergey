const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const {
  EDITABLE_FIELDS,
  FinancialCliError,
  atomicSaveFinancialData,
  loadCurrentConfiguration,
  parseAcquiringRate,
  parseLocalizedNumber,
  promptForUpdates,
  runCli,
} = require('../../../scripts/update-miska-financial-data');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const CURRENT_CONFIG_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-financial-current.json'
);
const TEMP_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), 'miska-financial-cli-')
);
const CURRENT_DATE = '2026-07-20T12:00:00';

after(() => {
  fs.rmSync(TEMP_DIRECTORY, { recursive: true, force: true });
});

function configCopy(name) {
  const target = path.join(TEMP_DIRECTORY, name);
  fs.copyFileSync(CURRENT_CONFIG_PATH, target);
  return target;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function outputCollector() {
  const lines = [];
  return {
    lines,
    output: line => lines.push(String(line)),
  };
}

function answers(values) {
  const queue = [...values];
  return async () => {
    assert.ok(queue.length > 0, 'Unexpected additional CLI question.');
    return queue.shift();
  };
}

test('loads the current working financial file', () => {
  const loaded = loadCurrentConfiguration(CURRENT_CONFIG_PATH, {
    referenceDate: '2026-07-19T12:00:00Z',
  });

  assert.equal(loaded.configuration.store, 'Миска');
  assert.equal(loaded.configuration.currency, 'RUB');
  assert.equal(loaded.configuration.cash_balance, 118000);
  assert.equal(loaded.configuration.updated_at, '2026-07-19');
  assert.deepEqual(loaded.warnings, []);
});

test('empty interactive input preserves every editable value', async () => {
  const filePath = configCopy('interactive-empty.json');
  const before = readJson(filePath);
  const cliAnswers = Array(EDITABLE_FIELDS.length).fill('');
  cliAnswers.push('y');

  const result = await runCli(['--file', filePath], {
    ask: answers(cliAnswers),
    output: () => {},
    currentDate: CURRENT_DATE,
  });
  const afterSave = readJson(filePath);

  assert.equal(result.changed, true);
  for (const { field } of EDITABLE_FIELDS) {
    assert.deepEqual(afterSave[field], before[field]);
  }
  assert.equal(afterSave.store, before.store);
  assert.equal(afterSave.currency, before.currency);
});

test('parses monetary numbers containing spaces', () => {
  assert.equal(parseLocalizedNumber('118 000'), 118000);
  assert.equal(parseLocalizedNumber('1\u00a0234\u00a0567'), 1234567);
});

test('parses a decimal comma in monetary values', () => {
  assert.equal(parseLocalizedNumber('685 899,16'), 685899.16);
});

test('parses acquiring percentages and stores a decimal fraction', () => {
  assert.equal(parseAcquiringRate('2.5%'), 0.025);
  assert.equal(parseAcquiringRate('2,5%'), 0.025);
  assert.equal(parseAcquiringRate('0.025'), 0.025);
});

test('interactive input repeats a question after an invalid value', async () => {
  const loaded = loadCurrentConfiguration(CURRENT_CONFIG_PATH, {
    referenceDate: CURRENT_DATE,
  });
  const collector = outputCollector();
  const remainingEmptyAnswers = Array(EDITABLE_FIELDS.length - 1).fill('');
  const updated = await promptForUpdates(
    loaded.configuration,
    answers(['not-a-number', '125 000', ...remainingEmptyAnswers]),
    collector.output
  );

  assert.equal(updated.cash_balance, 125000);
  assert.ok(collector.lines.some(line => line.startsWith('Ошибка:')));
});

test('non-interactive mode updates one field and preserves all others', async () => {
  const filePath = configCopy('one-field.json');
  const before = readJson(filePath);

  await runCli([
    '--file', filePath,
    '--cash-balance', '125000',
    '--yes',
  ], {
    output: () => {},
    currentDate: CURRENT_DATE,
  });
  const afterSave = readJson(filePath);

  assert.equal(afterSave.cash_balance, 125000);
  assert.equal(afterSave.bank_balance, before.bank_balance);
  assert.equal(afterSave.comment, before.comment);
  assert.equal(afterSave.store, before.store);
  assert.equal(afterSave.currency, before.currency);
});

test('--dry-run previews changes without changing the file', async () => {
  const filePath = configCopy('dry-run.json');
  const before = readText(filePath);
  const collector = outputCollector();

  const result = await runCli([
    '--file', filePath,
    '--bank-balance', '280000',
    '--dry-run',
  ], {
    output: collector.output,
    currentDate: CURRENT_DATE,
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.changed, false);
  assert.equal(readText(filePath), before);
  assert.ok(collector.lines.includes('Dry-run завершён. Файл не изменён.'));
});

test('--yes saves without asking for confirmation', async () => {
  const filePath = configCopy('yes.json');
  const result = await runCli([
    '--file', filePath,
    '--comment', 'Обновлено после сверки кассы',
    '--yes',
  ], {
    ask: async () => assert.fail('CLI must not ask when --yes is present.'),
    output: () => {},
    currentDate: CURRENT_DATE,
  });
  const sourceText = readText(filePath);

  assert.equal(result.mode, 'saved');
  assert.equal(readJson(filePath).comment, 'Обновлено после сверки кассы');
  assert.ok(sourceText.includes('\n  "comment":'));
  assert.ok(sourceText.endsWith('\n'));
});

test('user refusal leaves the source file unchanged', async () => {
  const filePath = configCopy('refused.json');
  const before = readText(filePath);

  const result = await runCli([
    '--file', filePath,
    '--minimum-reserve', '120000',
  ], {
    ask: answers(['n']),
    output: () => {},
    currentDate: CURRENT_DATE,
  });

  assert.equal(result.mode, 'cancelled');
  assert.equal(result.changed, false);
  assert.equal(readText(filePath), before);
});

test('argument validation error occurs before any file change', async () => {
  const filePath = configCopy('invalid-argument.json');
  const before = readText(filePath);

  await assert.rejects(
    () => runCli([
      '--file', filePath,
      '--cash-balance', '-1',
      '--yes',
    ], { output: () => {}, currentDate: CURRENT_DATE }),
    error => error instanceof FinancialCliError &&
      error.code === 'INVALID_NUMBER'
  );
  assert.equal(readText(filePath), before);
});

test('updated_at changes only after a confirmed save', async () => {
  const filePath = configCopy('updated-at.json');

  await runCli([
    '--file', filePath,
    '--cash-balance', '125000',
    '--dry-run',
  ], { output: () => {}, currentDate: CURRENT_DATE });
  assert.equal(readJson(filePath).updated_at, '2026-07-19');

  await runCli([
    '--file', filePath,
    '--cash-balance', '125000',
    '--yes',
  ], { output: () => {}, currentDate: CURRENT_DATE });
  assert.equal(readJson(filePath).updated_at, '2026-07-20');
});

test('--check validates and reports without modifying the file', async () => {
  const filePath = configCopy('check.json');
  const before = readText(filePath);
  const collector = outputCollector();

  const result = await runCli(['--file', filePath, '--check'], {
    output: collector.output,
    currentDate: CURRENT_DATE,
  });

  assert.equal(result.mode, 'check');
  assert.equal(result.changed, false);
  assert.equal(readText(filePath), before);
  assert.ok(collector.lines.includes('Проверка завершена. Файл не изменён.'));
  assert.ok(collector.lines.some(line =>
    line.startsWith('Максимальный безопасный месячный объём новых заказов:')
  ));
});

test('--check shows a stale-data warning', async () => {
  const filePath = configCopy('stale.json');
  const stale = readJson(filePath);
  stale.updated_at = '2026-06-01';
  fs.writeFileSync(filePath, `${JSON.stringify(stale, null, 2)}\n`, 'utf8');
  const collector = outputCollector();

  await runCli(['--file', filePath, '--check'], {
    output: collector.output,
    currentDate: CURRENT_DATE,
  });

  assert.ok(collector.lines.includes(
    'Предупреждение: Финансовые данные не обновлялись более 31 дня'
  ));
});

test('temporary file is removed when post-write validation fails', () => {
  const filePath = configCopy('validation-failure.json');
  const before = readText(filePath);
  const temporaryPath = path.join(TEMP_DIRECTORY, '.validation-failure.tmp');
  const configuration = readJson(filePath);

  assert.throws(
    () => atomicSaveFinancialData(filePath, configuration, {
      currentDate: CURRENT_DATE,
      temporaryPath,
      validateFile: () => {
        throw new Error('synthetic validation failure');
      },
    }),
    /Не удалось безопасно сохранить финансовую конфигурацию/
  );
  assert.equal(fs.existsSync(temporaryPath), false);
  assert.equal(readText(filePath), before);
});

test('source file remains intact and temporary file is cleaned on rename error', () => {
  const filePath = configCopy('rename-failure.json');
  const before = readText(filePath);
  const temporaryPath = path.join(TEMP_DIRECTORY, '.rename-failure.tmp');
  const configuration = readJson(filePath);
  configuration.cash_balance = 999999;

  assert.throws(
    () => atomicSaveFinancialData(filePath, configuration, {
      currentDate: CURRENT_DATE,
      temporaryPath,
      renameFile: () => {
        throw new Error('synthetic rename failure');
      },
    }),
    /Не удалось безопасно сохранить финансовую конфигурацию/
  );
  assert.equal(fs.existsSync(temporaryPath), false);
  assert.equal(readText(filePath), before);
  assert.equal(readJson(filePath).cash_balance, 118000);
});
