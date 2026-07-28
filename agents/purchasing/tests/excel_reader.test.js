const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

const {
  getWorksheet,
  listWorksheetNames,
  openWorkbook,
} = require('../../../shared/excel/excel_reader');

const WORKBOOK_PATH = path.resolve(
  __dirname,
  '../../../tests/fixtures/SmartZapas_synthetic.xlsx'
);
const WORKSHEET_NAME = 'SmartZapas Synthetic';

let workbook;

before(async () => {
  workbook = await openWorkbook(WORKBOOK_PATH);
});

test('opens an existing Excel workbook', () => {
  assert.ok(Array.isArray(workbook));
  assert.ok(workbook.length > 0);
});

test('lists worksheet names in workbook order', () => {
  assert.deepEqual(listWorksheetNames(workbook), [WORKSHEET_NAME]);
});

test('returns an existing worksheet by its exact name', () => {
  const worksheet = getWorksheet(workbook, WORKSHEET_NAME);

  assert.equal(worksheet.sheet, WORKSHEET_NAME);
  assert.ok(Array.isArray(worksheet.data));
  assert.equal(worksheet.data.length, 11);
});

test('reports a clear error when a worksheet is absent', () => {
  assert.throws(
    () => getWorksheet(workbook, 'Несуществующий лист'),
    error => error.code === 'WORKSHEET_NOT_FOUND' &&
      error.message.includes('Несуществующий лист') &&
      error.message.includes(WORKSHEET_NAME)
  );
});
