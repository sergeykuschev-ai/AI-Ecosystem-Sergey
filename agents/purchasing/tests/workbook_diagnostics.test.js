const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  analyzeWorkbook,
} = require('../../../shared/diagnostics/workbook_diagnostics');

test('analyzes a workbook without worksheets', () => {
  assert.deepEqual(analyzeWorkbook([]), {
    worksheetNames: [],
    worksheetCount: 0,
    worksheets: [],
  });
});

test('analyzes a workbook with one worksheet', () => {
  const diagnostics = analyzeWorkbook([{
    sheet: 'Основной лист',
    data: [['Колонка'], ['Значение']],
  }]);

  assert.deepEqual(diagnostics, {
    worksheetNames: ['Основной лист'],
    worksheetCount: 1,
    worksheets: [{
      name: 'Основной лист',
      rows: 2,
      columns: ['Колонка'],
    }],
  });
});

test('analyzes a workbook with multiple worksheets in source order', () => {
  const diagnostics = analyzeWorkbook([
    { sheet: 'Первый', data: [['A']] },
    { sheet: 'Второй', data: [['B']] },
    { sheet: 'Третий', data: [] },
  ]);

  assert.deepEqual(diagnostics.worksheetNames, [
    'Первый',
    'Второй',
    'Третий',
  ]);
  assert.equal(diagnostics.worksheetCount, 3);
  assert.deepEqual(
    diagnostics.worksheets.map(worksheet => worksheet.name),
    diagnostics.worksheetNames
  );
});

test('reads worksheet columns from the unchanged first row', () => {
  const columns = ['Артикул', 'Наименование Товара', 'ABC/XYZ'];
  const workbook = [{
    sheet: 'Заголовки',
    data: [columns, ['A-1', 'Товар', 'A/X']],
  }];

  const diagnostics = analyzeWorkbook(workbook);

  assert.deepEqual(diagnostics.worksheets[0].columns, columns);
  assert.notEqual(diagnostics.worksheets[0].columns, columns);
  assert.deepEqual(workbook[0].data[0], columns);
});

test('counts every worksheet row including the first row', () => {
  const diagnostics = analyzeWorkbook([
    {
      sheet: 'Три строки',
      data: [
        ['Заголовок'],
        ['Строка 1'],
        ['Строка 2'],
      ],
    },
    {
      sheet: 'Пустой лист',
      data: [],
    },
  ]);

  assert.equal(diagnostics.worksheets[0].rows, 3);
  assert.equal(diagnostics.worksheets[1].rows, 0);
});
