'use strict';

const readExcelFile = require('read-excel-file/node').default;

async function openWorkbook(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new TypeError('filePath должен быть непустой строкой.');
  }
  return readExcelFile(filePath);
}

function listWorksheetNames(workbook) {
  if (!Array.isArray(workbook)) {
    throw new TypeError('workbook должен быть массивом листов.');
  }
  return workbook.map(worksheet => worksheet.sheet);
}

function getWorksheet(workbook, sheetName) {
  if (typeof sheetName !== 'string' || sheetName.trim() === '') {
    throw new TypeError('sheetName должен быть непустой строкой.');
  }

  const worksheet = workbook.find(sheet => sheet.sheet === sheetName);
  if (worksheet) return worksheet;

  const availableNames = listWorksheetNames(workbook);
  const error = new Error(
    `Лист «${sheetName}» не найден. Доступные листы: ${
      availableNames.length > 0 ? availableNames.join(', ') : 'нет'
    }.`
  );
  error.code = 'WORKSHEET_NOT_FOUND';
  throw error;
}

module.exports = {
  openWorkbook,
  getWorksheet,
  listWorksheetNames,
};
