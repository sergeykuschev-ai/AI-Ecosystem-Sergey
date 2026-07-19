const { EXPENSIVE_ROWS_LIMIT } = require('../config');
const { parseRow } = require('../parsers/minmax_parser');
const { isProductRow } = require('../rules/category_rules');
const { isPriorityABC, isRiskyABC } = require('../rules/abc_xyz_rules');
const { DELIVERY_THRESHOLD, isStrategic } = require('../rules/supplier_rules');

function analyzeRows(rows) {
  const normalizedRows = rows.filter(
    row => row && row.schemaVersion === 'smartzapas-row-v1'
  );

  if (normalizedRows.length > 0) {
    if (normalizedRows.length !== rows.length) {
      throw new TypeError('Analyzer cannot mix normalized SmartZapas rows with legacy rows.');
    }

    const rowIdentities = new Set();
    for (const row of normalizedRows) {
      if (typeof row.rowIdentity !== 'string' || !row.rowIdentity) {
        throw new TypeError('Every normalized SmartZapas row requires rowIdentity.');
      }
      if (rowIdentities.has(row.rowIdentity)) {
        throw new TypeError(`Duplicate normalized rowIdentity: ${row.rowIdentity}.`);
      }
      rowIdentities.add(row.rowIdentity);
    }
  }

  const prepared = rows.map(row => {
    const parsed = parseRow(row);
    return {
      ...parsed,
      strategic: isStrategic(parsed.name),
      priority: isPriorityABC(parsed.abc, parsed.xyz),
      risky: isRiskyABC(parsed.abc, parsed.xyz),
    };
  });
  const productRows = normalizedRows.length > 0
    ? prepared
    : prepared.filter(isProductRow);
  const orderRows = productRows
    .filter(row => row.orderQty !== null && row.orderQty > 0)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      if (a.strategic !== b.strategic) return a.strategic ? -1 : 1;
      return (b.sumNum || 0) - (a.sumNum || 0);
    });
  const confirmedZeroStockRows = productRows.filter(row => {
    const available = row.freeStock !== null ? row.freeStock : row.stock;
    return available !== null && available <= 0;
  });
  const unknownStockRows = productRows.filter(row => {
    const available = row.freeStock !== null ? row.freeStock : row.stock;
    return available === null || available === undefined;
  });
  const zeroStockDaysWithBlankStockRows = productRows.filter(row =>
    row.freeStock === null &&
    (row.stock === null || row.stock === undefined) &&
    row.stockDays === 0
  );
  const riskyRows = orderRows.filter(row => row.risky);
  const expensiveRows = orderRows
    .slice()
    .sort((a, b) => (b.sumNum || 0) - (a.sumNum || 0))
    .slice(0, EXPENSIVE_ROWS_LIMIT);
  const totalOrderSum = orderRows.reduce(
    (acc, row) => acc + (row.sumNum || 0),
    0
  );
  const missingToFreeDelivery = Math.max(
    0,
    DELIVERY_THRESHOLD - totalOrderSum
  );

  return {
    productRows,
    orderRows,
    zeroStockRows: confirmedZeroStockRows,
    confirmedZeroStockRows,
    unknownStockRows,
    zeroStockDaysWithBlankStockRows,
    confirmedZeroStockCount: confirmedZeroStockRows.length,
    unknownStockCount: unknownStockRows.length,
    zeroStockDaysWithBlankStockCount: zeroStockDaysWithBlankStockRows.length,
    riskyRows,
    expensiveRows,
    totalOrderSum,
    missingToFreeDelivery,
  };
}

module.exports = { analyzeRows };
