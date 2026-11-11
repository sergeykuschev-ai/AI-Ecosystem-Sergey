const assert = require('node:assert/strict');
const test = require('node:test');

const {
  adaptSmartZapasMatrix,
  assertUsableAdapterResult,
} = require('../../../agents/purchasing/adapters/smartzapas_adapter');
const {
  PurchasingWebApplicationError,
} = require('../application/application_error');
const {
  ABSOLUTE_PATH_PATTERN,
} = require('../dto/api_error_mapper');
const {
  orchestrationHttpError,
} = require('../http/run_handlers');
const {
  sendError,
} = require('../http/responses');

const UNDEFINED_ERROR = '#ERROR_undefined';

// Synthetic three-row SmartZapas layout (no real business data).
function createSyntheticSmartZapasMatrix() {
  return [
    [
      UNDEFINED_ERROR,
      'Артикул',
      'Наименование',
      'Доп. инфо',
      'Цена',
      'Текущие остатки',
      UNDEFINED_ERROR,
      'MIN',
      UNDEFINED_ERROR,
      'Потреб- ность 04.08.2026 - 18.08.2026',
      'Заказать у поставщика',
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
    ],
    [
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
      'Основной поставщик',
      UNDEFINED_ERROR,
      'Дней запаса',
      'Свободный остаток',
      'шт',
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
      'Кол-во',
      'Сумма',
      'Кратность заказа',
    ],
    [
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
      'Авто',
      'Ручной',
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
      UNDEFINED_ERROR,
    ],
    [
      UNDEFINED_ERROR,
      'SYNTH-ART-1',
      'Синтетический товар 1',
      'Синтетический поставщик',
      150.5,
      5,
      2,
      3,
      4,
      1,
      2,
      201,
      1,
    ],
  ];
}

function adapterErrorFor(matrix) {
  const result = adaptSmartZapasMatrix(matrix, {
    sheetName: 'SyntheticSheet',
  });
  try {
    assertUsableAdapterResult(result);
  } catch (error) {
    return error;
  }
  throw new Error('Expected the synthetic matrix to be rejected by the adapter.');
}

function wrapAsRunFailure(cause) {
  return new PurchasingWebApplicationError(
    'PURCHASING_RUN_FAILED',
    'Не удалось выполнить Purchasing Agent.',
    { cause }
  );
}

function detailByField(details, field) {
  return details.find(detail => detail.field === field);
}

function captureSendError(error, context = {}) {
  const sent = {};
  const response = {
    writeHead(statusCode, headers) {
      sent.statusCode = statusCode;
      sent.headers = headers;
    },
    end(body) {
      sent.body = JSON.parse(body.toString('utf8'));
    },
  };
  sendError(response, error, context);
  return sent;
}

test('INPUT_CONTRACT_ERROR exposes safe SmartZapas column diagnostics (regression)', () => {
  const matrix = createSyntheticSmartZapasMatrix();
  matrix[1][3] = UNDEFINED_ERROR;
  const mapped = orchestrationHttpError(
    wrapAsRunFailure(adapterErrorFor(matrix))
  );

  assert.equal(mapped.code, 'INPUT_CONTRACT_ERROR');
  assert.equal(mapped.statusCode, 422);
  assert.equal(
    mapped.message,
    'Excel-файл не соответствует входному контракту SmartZapas.'
  );

  const missing = detailByField(mapped.details, 'missing_required_columns');
  assert.ok(missing, 'missing_required_columns detail is present');
  assert.match(
    missing.reason,
    /supplier \(ожидался «доп\. инфо > основной поставщик»\)/
  );
  const headerRows = detailByField(mapped.details, 'header_rows_used');
  assert.ok(headerRows, 'header_rows_used detail is present');
  assert.match(headerRows.reason, /1, 2, 3/);
  const recognized = detailByField(mapped.details, 'recognized_columns');
  assert.ok(recognized, 'recognized_columns detail is present');
  assert.match(recognized.reason, /name=C \[C1\]/);

  const sent = captureSendError(mapped, { requestId: 'req-synthetic' });
  assert.equal(sent.statusCode, 422);
  assert.equal(sent.body.error.code, 'INPUT_CONTRACT_ERROR');
  assert.deepEqual(
    sent.body.error.details,
    mapped.details.map(({ field, reason }) => ({ field, reason }))
  );
  const wireText = JSON.stringify(sent.body);
  assert.equal(
    wireText.includes('Синтетический товар'),
    false,
    'row data must not leak into the public error payload'
  );
  assert.doesNotMatch(
    wireText,
    ABSOLUTE_PATH_PATTERN,
    'no absolute paths in the public error payload'
  );
});

test('INPUT_CONTRACT_ERROR reports ambiguous columns with coordinates only', () => {
  const matrix = createSyntheticSmartZapasMatrix();
  matrix[1][12] = 'Кол-во';
  const mapped = orchestrationHttpError(
    wrapAsRunFailure(adapterErrorFor(matrix))
  );

  assert.equal(mapped.code, 'INPUT_CONTRACT_ERROR');
  const ambiguous = detailByField(mapped.details, 'ambiguous_columns');
  assert.ok(ambiguous, 'ambiguous_columns detail is present');
  assert.match(
    ambiguous.reason,
    /supplierOrderQty: K \[K1, K2\], M \[K1, M2\]/
  );
  assert.equal(
    ambiguous.reason.includes('Кол-во'),
    false,
    'raw workbook header text must not be exposed'
  );
});

test('input-contract failures without adapter diagnostics keep empty details', () => {
  const mapped = orchestrationHttpError(wrapAsRunFailure(
    new TypeError('required column check failed without structured diagnostics')
  ));

  assert.equal(mapped.code, 'INPUT_CONTRACT_ERROR');
  assert.deepEqual(mapped.details, []);
});

test('unreadable workbook stays INVALID_WORKBOOK without details', () => {
  const mapped = orchestrationHttpError(wrapAsRunFailure(
    new Error('Invalid or unsupported zip format. TIPS: If you have a 8-char password, use `zip -P password` or `7z -p password`')
  ));

  assert.equal(mapped.code, 'INVALID_WORKBOOK');
  assert.equal(mapped.statusCode, 422);
  assert.equal(
    mapped.message,
    'Excel-файл не удалось прочитать как отчёт SmartZapas.'
  );
  assert.deepEqual(mapped.details, []);
});

test('unrelated errors pass through unchanged', () => {
  const unrelated = new Error('storage offline');
  assert.strictEqual(orchestrationHttpError(unrelated), unrelated);
});

test('absolute paths in diagnostics are stripped before exposure', () => {
  const cause = new TypeError(
    'SmartZapas export has missing or ambiguous required columns.'
  );
  cause.diagnostics = {
    missingRequiredColumns: [
      { field: 'name', expectedHeader: 'C:\\secrets\\internal\\header.xlsx' },
    ],
    ambiguousColumns: [],
    headerRowsUsed: [1, 2, 3],
    recognizedColumns: [],
  };
  const mapped = orchestrationHttpError(wrapAsRunFailure(cause));

  const sent = captureSendError(mapped, { requestId: 'req-synthetic' });
  assert.equal(
    sent.body.error.details[0].reason,
    'invalid',
    'unsafe reason text is replaced by the sanitizer fallback'
  );
  assert.equal(
    JSON.stringify(sent.body).includes('secrets'),
    false,
    'secret path fragments must not reach the client'
  );
});

test('diagnostic lists are capped with an overflow marker', () => {
  const cause = new TypeError(
    'SmartZapas export has missing or ambiguous required columns.'
  );
  cause.diagnostics = {
    missingRequiredColumns: Array.from({ length: 30 }, (_, index) => ({
      field: `field_${index}`,
      expectedHeader: `header_${index}`,
    })),
    ambiguousColumns: [],
    headerRowsUsed: [1, 2, 3],
    recognizedColumns: [],
  };
  const mapped = orchestrationHttpError(wrapAsRunFailure(cause));

  const missing = detailByField(mapped.details, 'missing_required_columns');
  assert.match(missing.reason, /header_24/);
  assert.doesNotMatch(missing.reason, /header_25/);
  assert.match(missing.reason, /ещё 5/);
});
