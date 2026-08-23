'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { mapEmployeeNames, normalizeEmployeeName } = require('../xlsx/employee_mapping');
const { excelDate, mapHeaders, parseKpiWorkbook } = require('../xlsx/import_adapter');
const { makeXlsx } = require('./xlsx_fixture');
const { decodeUploadFilename } = require('../http/router');

test('header mapping is exact after safe whitespace and case normalization', () => {
  const mapped = mapHeaders([' ДАТА ', 'Продавец', 'Выручка ₽', 'Количество чеков']);
  assert.deepEqual(mapped.fields, {
    shiftDate: 0, employeeName: 1, historicalRevenue: 2, receipts: 3,
  });
  assert.equal(mapHeaders(['Дата', 'Продавец', 'Похожая выручка', 'Чеки']).fields.historicalRevenue, undefined);
});

test('Excel and Russian dates plus localized numeric values normalize deterministically', () => {
  assert.equal(excelDate(46204), '2026-07-01');
  assert.equal(excelDate('01.08.2026'), '2026-08-01');
  const workbook = makeXlsx([{ name: 'KPI_Контроль', rows: [
    ['Дата', 'Продавец', 'Выручка ₽', 'Количество чеков', 'Товаров в чеке'],
    [46204, 'Капитанова', '1 234,50', 2, 2.5],
  ] }]);
  const parsed = parseKpiWorkbook(workbook);
  assert.equal(parsed.rows[0].historicalRevenue, 1234.5);
  assert.equal(parsed.rows[0].sourceReference.itemsPerReceipt, 2.5);
  assert.equal(parsed.paymentBreakdownAvailable, false);
});

test('payment workbook treats QR as analytics inside acquiring and rejects qr above acquiring', () => {
  const valid = makeXlsx([{ name: 'Input', rows: [
    ['Дата', 'Продавец', 'Наличные, ₽', 'Эквайринг (уже включает QR), ₽', 'QR (входит в эквайринг), ₽', 'Чеки'],
    [46235, 'Капитанова', 100, 200, 50, 3],
  ] }]);
  const parsed = parseKpiWorkbook(valid);
  assert.equal(parsed.rows[0].cash + parsed.rows[0].acquiring, 300);
  assert.equal(parsed.rows[0].qr, 50);
  assert.equal(parsed.rows[0].historicalRevenue, null);

  const invalid = makeXlsx([{ name: 'Input', rows: [
    ['Дата', 'Продавец', 'Наличные, ₽', 'Эквайринг (уже включает QR), ₽', 'QR (входит в эквайринг), ₽', 'Чеки'],
    [46235, 'Капитанова', 100, 200, 201, 3],
  ] }]);
  assert.ok(parseKpiWorkbook(invalid).issues.some(item => item.code === 'QR_EXCEEDS_ACQUIRING'));
});

test('employee mapping normalizes Unicode/whitespace but never guesses abbreviations', () => {
  const employees = [{ id: '1', displayName: 'Иванова Наталья' }];
  assert.equal(normalizeEmployeeName('  ИВАНОВА   НАТАЛЬЯ '), 'иванова наталья');
  const result = mapEmployeeNames([
    { employeeName: ' Иванова  Наталья ' },
    { employeeName: 'Иванова Н.' },
  ], employees);
  assert.equal(result.rows[0].employeeId, '1');
  assert.equal(result.rows[1].employeeId, null);
  assert.deepEqual(result.unresolved, ['Иванова Н.']);
});

test('malformed and unsupported XLSX fail clearly', () => {
  assert.throws(() => parseKpiWorkbook(Buffer.from('not-a-zip')), /Malformed XLSX/);
  assert.throws(
    () => parseKpiWorkbook(makeXlsx([{ name: 'Other', rows: [['A', 'B'], [1, 2]] }])),
    /required Date\/Seller\/Revenue\/Receipts headers/
  );
});

test('multipart filenames preserve Cyrillic UTF-8 names', () => {
  const original = 'KPI_магазин05.26.xlsx';
  const busboyValue = Buffer.from(original, 'utf8').toString('latin1');
  assert.equal(decodeUploadFilename(busboyValue), original);
});
