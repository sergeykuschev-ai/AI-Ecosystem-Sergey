const {
  parseInputRows,
  detectColumns,
} = require('./parsers/minmax_parser');
const { analyzeRows } = require('./services/analyzer');
const { buildMinmaxText } = require('./services/prompt_builder');
const { validateInput, validateResult } = require('./services/validator');

function runOrderAgent(items) {
  validateInput(items);

  const rows = parseInputRows(items);
  const detectedColumns = detectColumns(rows);
  const analysis = analyzeRows(rows);
  const result = [
    {
      json: {
        minmax_text: buildMinmaxText(rows, analysis),
        source_rows_count: rows.length,
        product_rows_count: analysis.productRows.length,
        order_rows_count: analysis.orderRows.length,
        zero_stock_rows_count: analysis.zeroStockRows.length,
        preliminary_order_sum: Math.round(analysis.totalOrderSum),
        detected_columns: detectedColumns,
      },
    },
  ];

  validateResult(result);
  return result;
}

module.exports = { runOrderAgent };

if (require.main === module) {
  const items = typeof $input !== 'undefined' ? $input.all() : [];
  console.log(JSON.stringify(runOrderAgent(items), null, 2));
}
