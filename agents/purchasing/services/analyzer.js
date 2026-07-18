const { EXPENSIVE_ROWS_LIMIT } = require('../config');
const { normalize, parseRow } = require('../parsers/minmax_parser');
const { isProductRow } = require('../rules/category_rules');
const { isPriorityABC, isRiskyABC } = require('../rules/abc_xyz_rules');
const { DELIVERY_THRESHOLD, isStrategic } = require('../rules/supplier_rules');

function analyzeRows(rows) {
  const prepared = rows
    .map(row => {
      const parsed = parseRow(row);
      return {
        ...parsed,
        strategic: isStrategic(parsed.name),
        priority: isPriorityABC(parsed.abc, parsed.xyz),
        risky: isRiskyABC(parsed.abc, parsed.xyz),
      };
    })
    .filter(isProductRow);

  const uniqueMap = new Map();

  for (const row of prepared) {
    const key = row.article
      ? `article:${normalize(row.article)}`
      : `name:${normalize(row.name)}|price:${row.priceNum ?? ''}`;
    const existing = uniqueMap.get(key);

    if (!existing) {
      uniqueMap.set(key, row);
      continue;
    }

    if (
      (existing.orderQty === null || existing.orderQty <= 0) &&
      row.orderQty !== null &&
      row.orderQty > 0
    ) {
      uniqueMap.set(key, row);
    }
  }

  const productRows = Array.from(uniqueMap.values());
  const orderRows = productRows
    .filter(row => row.orderQty !== null && row.orderQty > 0)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      if (a.strategic !== b.strategic) return a.strategic ? -1 : 1;
      return (b.sumNum || 0) - (a.sumNum || 0);
    });
  const zeroStockRows = productRows.filter(row => {
    const available = row.freeStock !== null ? row.freeStock : row.stock;
    return available !== null && available <= 0;
  });
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
    zeroStockRows,
    riskyRows,
    expensiveRows,
    totalOrderSum,
    missingToFreeDelivery,
  };
}

module.exports = { analyzeRows };
