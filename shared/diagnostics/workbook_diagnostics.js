'use strict';

const {
  getWorksheet,
  listWorksheetNames,
} = require('../excel/excel_reader');

function analyzeWorkbook(workbook) {
  const worksheetNames = listWorksheetNames(workbook);
  const worksheets = worksheetNames.map(name => {
    const worksheet = getWorksheet(workbook, name);
    const rows = worksheet.data;
    return {
      name,
      rows: rows.length,
      columns: rows.length > 0 ? [...rows[0]] : [],
    };
  });

  return {
    worksheetNames,
    worksheetCount: worksheetNames.length,
    worksheets,
  };
}

module.exports = {
  analyzeWorkbook,
};
