const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  analyzeWorkbookCompatibility,
} = require('../../../shared/diagnostics/workbook_compatibility');

function diagnostics(worksheets = []) {
  return {
    worksheetNames: worksheets.map(worksheet => worksheet.name),
    worksheetCount: worksheets.length,
    worksheets,
  };
}

function profile(requiredWorksheets = []) {
  return {
    profileVersion: 1,
    requiredWorksheets,
  };
}

function requiredWorksheet(name, requiredColumns) {
  return { name, requiredColumns };
}

function assertInvalidProfile(value, messagePattern) {
  assert.throws(
    () => analyzeWorkbookCompatibility(diagnostics(), value),
    error => {
      assert.equal(error.code, 'INVALID_COMPATIBILITY_PROFILE');
      assert.match(error.message, messagePattern);
      return true;
    }
  );
}

test('returns COMPATIBLE when all required worksheets and columns exist', () => {
  const result = analyzeWorkbookCompatibility(
    diagnostics([
      { name: 'Товары', rows: 2, columns: ['Артикул', 'Наименование'] },
    ]),
    profile([
      requiredWorksheet('Товары', ['Артикул', 'Наименование']),
    ])
  );

  assert.deepEqual(result, {
    status: 'COMPATIBLE',
    profileVersion: 1,
    missingWorksheets: [],
    worksheets: [
      {
        name: 'Товары',
        found: true,
        missingColumns: [],
        requiredColumns: ['Артикул', 'Наименование'],
        actualColumns: ['Артикул', 'Наименование'],
      },
    ],
  });
});

test('returns INCOMPATIBLE when a required worksheet is missing', () => {
  const result = analyzeWorkbookCompatibility(
    diagnostics(),
    profile([requiredWorksheet('Товары', ['Артикул'])])
  );

  assert.equal(result.status, 'INCOMPATIBLE');
  assert.deepEqual(result.missingWorksheets, ['Товары']);
  assert.deepEqual(result.worksheets[0], {
    name: 'Товары',
    found: false,
    missingColumns: ['Артикул'],
    requiredColumns: ['Артикул'],
    actualColumns: [],
  });
});

test('returns INCOMPATIBLE when a required column is missing', () => {
  const result = analyzeWorkbookCompatibility(
    diagnostics([{ name: 'Товары', rows: 1, columns: ['Артикул'] }]),
    profile([
      requiredWorksheet('Товары', ['Артикул', 'Наименование']),
    ])
  );

  assert.equal(result.status, 'INCOMPATIBLE');
  assert.deepEqual(result.worksheets[0].missingColumns, ['Наименование']);
});

test('does not treat changed column order as incompatibility', () => {
  const result = analyzeWorkbookCompatibility(
    diagnostics([
      { name: 'Товары', rows: 1, columns: ['Наименование', 'Артикул'] },
    ]),
    profile([
      requiredWorksheet('Товары', ['Артикул', 'Наименование']),
    ])
  );

  assert.equal(result.status, 'COMPATIBLE');
  assert.deepEqual(result.worksheets[0].missingColumns, []);
});

test('compares worksheet and column names with exact letter case', () => {
  const result = analyzeWorkbookCompatibility(
    diagnostics([{ name: 'Товары', rows: 1, columns: ['артикул'] }]),
    profile([requiredWorksheet('Товары', ['Артикул'])])
  );

  assert.equal(result.status, 'INCOMPATIBLE');
  assert.deepEqual(result.worksheets[0].missingColumns, ['Артикул']);
});

test('compares worksheet and column names without trimming spaces', () => {
  const result = analyzeWorkbookCompatibility(
    diagnostics([{ name: 'Товары', rows: 1, columns: ['Артикул '] }]),
    profile([requiredWorksheet('Товары', ['Артикул'])])
  );

  assert.equal(result.status, 'INCOMPATIBLE');
  assert.deepEqual(result.worksheets[0].missingColumns, ['Артикул']);
});

test('allows extra worksheets and columns', () => {
  const result = analyzeWorkbookCompatibility(
    diagnostics([
      {
        name: 'Товары',
        rows: 1,
        columns: ['Артикул', 'Наименование', 'Цена'],
      },
      { name: 'Дополнительно', rows: 0, columns: [] },
    ]),
    profile([requiredWorksheet('Товары', ['Артикул'])])
  );

  assert.equal(result.status, 'COMPATIBLE');
  assert.deepEqual(result.missingWorksheets, []);
});

test('rejects an invalid profileVersion', () => {
  const cases = [
    {},
    { profileVersion: 0, requiredWorksheets: [] },
    { profileVersion: -1, requiredWorksheets: [] },
    { profileVersion: 1.5, requiredWorksheets: [] },
    { profileVersion: '1', requiredWorksheets: [] },
  ];

  cases.forEach(value => assertInvalidProfile(value, /profileVersion/));
});

test('rejects an invalid requiredWorksheets value', () => {
  const cases = [
    null,
    [],
    { profileVersion: 1 },
    { profileVersion: 1, requiredWorksheets: null },
    { profileVersion: 1, requiredWorksheets: {} },
    { profileVersion: 1, requiredWorksheets: [null] },
    { profileVersion: 1, requiredWorksheets: ['Товары'] },
  ];

  cases.forEach(value => {
    assertInvalidProfile(value, /profile|requiredWorksheets/);
  });
});

test('rejects a missing, non-string, or empty worksheet name', () => {
  const cases = [
    { requiredColumns: [] },
    { name: 10, requiredColumns: [] },
    { name: '', requiredColumns: [] },
  ];

  cases.forEach(worksheet => {
    assertInvalidProfile(
      profile([worksheet]),
      /requiredWorksheets\[0\]\.name/
    );
  });
});

test('rejects an invalid requiredColumns value', () => {
  const cases = [
    { name: 'Товары' },
    { name: 'Товары', requiredColumns: null },
    { name: 'Товары', requiredColumns: {} },
    { name: 'Товары', requiredColumns: ['Артикул', 10] },
  ];

  cases.forEach(worksheet => {
    assertInvalidProfile(profile([worksheet]), /requiredColumns/);
  });
});

test('rejects duplicate required worksheet names', () => {
  assertInvalidProfile(
    profile([
      requiredWorksheet('Товары', []),
      requiredWorksheet('Товары', []),
    ]),
    /Товары.*более одного раза/
  );
});

test('rejects duplicate required columns within a worksheet', () => {
  assertInvalidProfile(
    profile([
      requiredWorksheet('Товары', ['Артикул', 'Артикул']),
    ]),
    /Артикул.*более одного раза/
  );
});

test('does not mutate diagnostics or profile', () => {
  const inputDiagnostics = diagnostics([
    { name: 'Товары', rows: 1, columns: ['Артикул', 'Цена'] },
  ]);
  const inputProfile = profile([
    requiredWorksheet('Товары', ['Артикул']),
  ]);
  const diagnosticsBefore = structuredClone(inputDiagnostics);
  const profileBefore = structuredClone(inputProfile);

  const result = analyzeWorkbookCompatibility(inputDiagnostics, inputProfile);

  result.worksheets[0].actualColumns.push('Изменение результата');
  result.worksheets[0].requiredColumns.push('Изменение результата');
  assert.deepEqual(inputDiagnostics, diagnosticsBefore);
  assert.deepEqual(inputProfile, profileBefore);
});
