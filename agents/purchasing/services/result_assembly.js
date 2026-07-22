const { buildMinmaxText } = require('./prompt_builder');
const {
  buildPurchasingFinancialAssessment,
} = require('./financial_controller');
const {
  resolveFinancialDataSource,
} = require('./financial_data_loader');
const { validateResult } = require('./validator');

function buildResult(rows, analysis, options = {}) {
  const sourceRowsCount = options.sourceRowsCount ?? rows.length;
  const financialDataResult = resolveFinancialDataSource(options);
  const baseFinancialAssessment = buildPurchasingFinancialAssessment(
    analysis.totalOrderSum,
    financialDataResult.financialData
  );
  const financialContextLines = [
    '### Источник финансовых данных',
    '',
    `- Источник: ${financialDataResult.source}`,
    `- Магазин: ${financialDataResult.metadata.store || 'не указан'}`,
    `- Дата обновления: ${financialDataResult.metadata.updated_at || 'не указана'}`,
  ];
  if (financialDataResult.warnings.length > 0) {
    financialContextLines.push(
      `- Предупреждения: ${financialDataResult.warnings.join('; ')}`
    );
  }
  if (financialDataResult.errors.length > 0) {
    financialContextLines.push('- Финансовая конфигурация не загружена.');
    financialContextLines.push(
      `- Ошибки: ${financialDataResult.errors.join('; ')}`
    );
  }
  const financialAssessment = {
    ...baseFinancialAssessment,
    financial_data_source: financialDataResult.source,
    financial_data_updated_at: financialDataResult.metadata.updated_at,
    financial_data_store: financialDataResult.metadata.store,
    financial_data_warnings: financialDataResult.warnings,
    financial_data_errors: financialDataResult.errors,
    report_text: `${baseFinancialAssessment.report_text}\n\n${financialContextLines.join('\n')}`,
  };
  const purchasingReport = buildMinmaxText(rows, analysis, { sourceRowsCount });
  const reportParts = [purchasingReport];
  if (options.additionalReportText) {
    reportParts.push(options.additionalReportText);
  }
  reportParts.push(financialAssessment.report_text);
  const resultJson = {
    minmax_text: reportParts.join('\n\n'),
    source_rows_count: sourceRowsCount,
    product_rows_count: analysis.productRows.length,
    order_rows_count: analysis.orderRows.length,
    zero_stock_rows_count: analysis.confirmedZeroStockCount,
    confirmedZeroStockCount: analysis.confirmedZeroStockCount,
    unknownStockCount: analysis.unknownStockCount,
    zeroStockDaysWithBlankStockCount: analysis.zeroStockDaysWithBlankStockCount,
    preliminary_order_sum: Math.round(analysis.totalOrderSum),
    detected_columns: options.detectedColumns,
    ...options.additionalResultFields,
    financial_assessment: financialAssessment,
  };
  const result = [{ json: resultJson }];

  validateResult(result);
  return result;
}

module.exports = { buildResult };
