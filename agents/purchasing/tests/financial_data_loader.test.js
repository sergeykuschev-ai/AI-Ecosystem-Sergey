const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const {
  FinancialDataLoadError,
  STALE_DATA_WARNING,
  loadFinancialData,
} = require('../services/financial_data_loader');
const {
  adaptSmartZapasMatrix,
} = require('../adapters/smartzapas_adapter');
const {
  runOrderAgent,
  runOrderAgentFromAdapterResult,
} = require('../order_agent');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const CURRENT_CONFIG_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-financial-current.json'
);
const SANITIZED_FIXTURE_PATH = path.join(
  REPOSITORY_ROOT,
  'tests/fixtures/SmartZapas_sanitized.json'
);
const TEMP_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), 'miska-financial-loader-')
);

after(() => {
  fs.rmSync(TEMP_DIRECTORY, { recursive: true, force: true });
});

function validConfiguration(overrides = {}) {
  return {
    store: 'Миска',
    updated_at: '2026-07-19',
    currency: 'RUB',
    cash_balance: 118000,
    bank_balance: 300000,
    expected_revenue: 685899.16,
    fixed_expenses: 174750,
    acquiring_rate: 0.025,
    supplier_debt: 0,
    committed_supplier_payments: 0,
    minimum_reserve: 100000,
    comment: 'Synthetic test configuration.',
    ...overrides,
  };
}

function temporaryFile(name, contents) {
  const filePath = path.join(TEMP_DIRECTORY, name);
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

function temporaryJson(name, data) {
  return temporaryFile(name, JSON.stringify(data));
}

function legacyOrderItems({ price = 10, quantity = 2 } = {}) {
  return [{
    json: {
      Наименование: 'Synthetic file-finance product',
      Артикул: 'FILE-FIN-1',
      'Основной поставщик': 'Synthetic Supplier',
      Цена: price,
      'Заказать у поставщика': quantity,
      'Свободный остаток': 0,
    },
  }];
}

test('loads and normalizes the current Miska financial JSON', () => {
  const loaded = loadFinancialData(CURRENT_CONFIG_PATH, {
    referenceDate: '2026-07-19T12:00:00Z',
  });

  assert.deepEqual(loaded.financialData, {
    cash_balance: 118000,
    bank_balance: 300000,
    expected_revenue: 685899.16,
    fixed_expenses: 174750,
    acquiring_rate: 0.025,
    supplier_debt: 0,
    committed_supplier_payments: 0,
    minimum_reserve: 100000,
  });
  assert.deepEqual(loaded.metadata, {
    store: 'Миска',
    updated_at: '2026-07-19',
    currency: 'RUB',
    comment: 'Платежи поставщикам производятся месяц в месяц, долгов нет.',
  });
  assert.deepEqual(loaded.warnings, []);
});

test('rejects invalid JSON with a clear Russian error', () => {
  const filePath = temporaryFile('invalid.json', '{ "cash_balance": ');

  assert.throws(
    () => loadFinancialData(filePath),
    error => error instanceof FinancialDataLoadError &&
      error.code === 'INVALID_JSON' &&
      error.message.includes('Некорректный JSON')
  );

  const json = runOrderAgent(legacyOrderItems(), {
    financialDataPath: filePath,
  })[0].json;
  assert.equal(json.order_rows_count, 1);
  assert.equal(json.financial_assessment.status, 'PRELIMINARY');
  assert.ok(json.financial_assessment.financial_data_errors[0].includes(
    'Некорректный JSON'
  ));
});

test('reports a missing financial file in Russian', () => {
  const missingPath = path.join(TEMP_DIRECTORY, 'missing.json');

  assert.throws(
    () => loadFinancialData(missingPath),
    error => error instanceof FinancialDataLoadError &&
      error.code === 'FILE_READ_ERROR' &&
      error.message.includes('файл не найден')
  );
});

test('rejects a configuration with a missing required field', () => {
  const data = validConfiguration();
  delete data.bank_balance;
  const filePath = temporaryJson('missing-field.json', data);

  assert.throws(
    () => loadFinancialData(filePath),
    /отсутствует обязательное поле «bank_balance»/
  );
});

test('rejects a configuration field with the wrong type', () => {
  const filePath = temporaryJson('wrong-type.json', validConfiguration({
    cash_balance: '118000',
  }));

  assert.throws(
    () => loadFinancialData(filePath),
    /Поле «cash_balance».*неотрицательным числом/
  );
});

test('inline financialData takes priority and warns that the path was ignored', () => {
  const json = runOrderAgent(legacyOrderItems(), {
    financialData: {
      cash_balance: 40000,
      bank_balance: 0,
      expected_revenue: 0,
      fixed_expenses: 0,
      acquiring_rate: 0,
      supplier_debt: 0,
      committed_supplier_payments: 0,
      minimum_reserve: 100,
    },
    financialDataPath: path.join(TEMP_DIRECTORY, 'does-not-matter.json'),
  })[0].json;

  assert.equal(json.financial_assessment.status, 'APPROVED');
  assert.equal(json.financial_assessment.financial_data_source, 'inline');
  assert.deepEqual(json.financial_assessment.financial_data_warnings, [
    'Передан financialData; financialDataPath проигнорирован.',
  ]);
  assert.deepEqual(json.financial_assessment.financial_data_errors, []);
});

test('agent runs with financialDataPath only', () => {
  const json = runOrderAgent(legacyOrderItems({
    price: 103389.40,
    quantity: 1,
  }), {
    financialDataPath: CURRENT_CONFIG_PATH,
  })[0].json;
  const assessment = json.financial_assessment;

  assert.equal(assessment.status, 'APPROVED_WITH_WARNING');
  assert.equal(assessment.financial_data_source, 'file');
  assert.equal(assessment.financial_data_updated_at, '2026-07-19');
  assert.equal(assessment.financial_data_store, 'Миска');
  assert.equal(assessment.reserve_surplus, 22713.12);
});

test('agent without financial input remains PRELIMINARY with source none', () => {
  const assessment = runOrderAgent(legacyOrderItems())[0].json.financial_assessment;

  assert.equal(assessment.status, 'PRELIMINARY');
  assert.equal(assessment.financial_data_source, 'none');
  assert.equal(assessment.financial_data_updated_at, null);
  assert.deepEqual(assessment.financial_data_warnings, []);
  assert.deepEqual(assessment.financial_data_errors, []);
});

test('warns when updated_at is more than 31 days old without changing status', () => {
  const filePath = temporaryJson('stale.json', validConfiguration({
    updated_at: '2026-06-01',
  }));
  const loaded = loadFinancialData(filePath, {
    referenceDate: '2026-07-19T12:00:00Z',
  });
  const json = runOrderAgent(legacyOrderItems({
    price: 103389.40,
    quantity: 1,
  }), {
    financialDataPath: filePath,
  })[0].json;

  assert.deepEqual(loaded.warnings, [STALE_DATA_WARNING]);
  assert.equal(json.financial_assessment.status, 'APPROVED_WITH_WARNING');
  assert.deepEqual(json.financial_assessment.financial_data_warnings, [
    STALE_DATA_WARNING,
  ]);
});

test('file error leaves all adapter product quantities unchanged', () => {
  const fixture = JSON.parse(fs.readFileSync(SANITIZED_FIXTURE_PATH, 'utf8'));
  const adapterResult = adaptSmartZapasMatrix(fixture.matrix, {
    sheetName: fixture.sheetName,
  });
  const baseline = runOrderAgentFromAdapterResult(adapterResult)[0].json;
  const withFileError = runOrderAgentFromAdapterResult(adapterResult, {
    financialDataPath: path.join(TEMP_DIRECTORY, 'not-found.json'),
  })[0].json;

  assert.equal(withFileError.financial_assessment.status, 'PRELIMINARY');
  assert.equal(withFileError.financial_assessment.financial_data_source, 'file');
  assert.equal(withFileError.financial_assessment.financial_data_errors.length, 1);
  assert.deepEqual(withFileError.decisions, baseline.decisions);
  assert.equal(withFileError.order_rows_count, baseline.order_rows_count);
  assert.equal(withFileError.preliminary_order_sum, baseline.preliminary_order_sum);
});

test('financial report shows file source, update date, and loading errors', () => {
  const loadedJson = runOrderAgent(legacyOrderItems(), {
    financialDataPath: CURRENT_CONFIG_PATH,
  })[0].json;
  const failedJson = runOrderAgent(legacyOrderItems(), {
    financialDataPath: path.join(TEMP_DIRECTORY, 'not-found-report.json'),
  })[0].json;

  assert.ok(loadedJson.minmax_text.includes('### Источник финансовых данных'));
  assert.ok(loadedJson.minmax_text.includes('- Источник: file'));
  assert.ok(loadedJson.minmax_text.includes('- Магазин: Миска'));
  assert.ok(loadedJson.minmax_text.includes('- Дата обновления: 2026-07-19'));
  assert.ok(failedJson.minmax_text.includes(
    'Финансовая конфигурация не загружена.'
  ));
  assert.ok(failedJson.minmax_text.includes('файл не найден'));
});
