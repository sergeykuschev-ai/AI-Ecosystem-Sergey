(function initializeCsvExporter(globalObject) {
  'use strict';

  const UTF8_BOM = '\uFEFF';
  const CSV_SEPARATOR = ';';
  const CSV_LINE_ENDING = '\r\n';
  const CSV_CONTENT_TYPE = 'text/csv;charset=utf-8';
  const SUPPLIER_ORDER_FILE_NAME = 'budget-simulation-draft.csv';
  const REMOVED_ITEMS_FILE_NAME = 'budget-simulation-removed-items.csv';
  const EXPORTABLE_STATUSES = new Set(['OPTIMIZED', 'UNCHANGED']);

  function escapeCsvCell(value) {
    const text = value === null || value === undefined
      ? ''
      : String(value);
    if (!/[;"\r\n]/.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function csvRow(values) {
    return values.map(escapeCsvCell).join(CSV_SEPARATOR);
  }

  function formatCsvMoney(value, fieldName) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${fieldName} must be a finite number.`);
    }
    return value.toFixed(2).replace('.', ',');
  }

  function formatQuantity(value, fieldName) {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(
        `${fieldName} must be a non-negative integer.`
      );
    }
    return String(value);
  }

  function validateOptimizationResult(result) {
    if (
      !result ||
      typeof result !== 'object' ||
      !EXPORTABLE_STATUSES.has(result.status) ||
      !Array.isArray(result.items) ||
      !Array.isArray(result.removedItems)
    ) {
      throw new TypeError(
        'An OPTIMIZED or UNCHANGED optimization result is required.'
      );
    }
  }

  function buildCsv(rows) {
    return UTF8_BOM +
      rows.map(csvRow).join(CSV_LINE_ENDING) +
      CSV_LINE_ENDING;
  }

  function buildOptimizedSupplierOrderCsv(result) {
    validateOptimizationResult(result);
    const rows = [[
      'Артикул',
      'Наименование',
      'Количество',
      'Цена, ₽',
      'Сумма, ₽',
      'Исходное решение',
      'Причина изменения',
    ]];

    for (const [index, item] of result.items.entries()) {
      const quantity = formatQuantity(
        item?.optimizedQuantity,
        `items[${index}].optimizedQuantity`
      );
      if (item.optimizedQuantity === 0) continue;
      const originalQuantity = formatQuantity(
        item?.originalQuantity,
        `items[${index}].originalQuantity`
      );
      rows.push([
        item.sku,
        item.name,
        quantity,
        formatCsvMoney(item.price, `items[${index}].price`),
        formatCsvMoney(
          item.optimizedAmount,
          `items[${index}].optimizedAmount`
        ),
        item.decision,
        Number(quantity) < Number(originalQuantity)
          ? 'Количество уменьшено'
          : 'Без изменений',
      ]);
    }

    rows.push([
      'ИТОГО',
      '',
      '',
      '',
      formatCsvMoney(result.optimizedTotal, 'optimizedTotal'),
      '',
      '',
    ]);
    return buildCsv(rows);
  }

  function buildOptimizedRemovedItemsCsv(result) {
    validateOptimizationResult(result);
    const rows = [[
      'Артикул',
      'Наименование',
      'Исходное количество',
      'Убрано из заказа',
      'Сумма сокращения, ₽',
      'Исходное решение',
      'Причина исключения',
    ]];

    for (const [index, item] of result.removedItems.entries()) {
      rows.push([
        item?.sku,
        item?.name,
        formatQuantity(
          item?.originalQuantity,
          `removedItems[${index}].originalQuantity`
        ),
        formatQuantity(
          item?.removedQuantity,
          `removedItems[${index}].removedQuantity`
        ),
        formatCsvMoney(
          item?.removedAmount,
          `removedItems[${index}].removedAmount`
        ),
        item?.decision,
        'Исключено при оптимизации бюджета',
      ]);
    }
    return buildCsv(rows);
  }

  function createOptimizedCsvFiles(result) {
    return {
      supplierOrder: {
        name: SUPPLIER_ORDER_FILE_NAME,
        type: CSV_CONTENT_TYPE,
        content: buildOptimizedSupplierOrderCsv(result),
      },
      removedItems: {
        name: REMOVED_ITEMS_FILE_NAME,
        type: CSV_CONTENT_TYPE,
        content: buildOptimizedRemovedItemsCsv(result),
      },
    };
  }

  const publicApi = {
    CSV_CONTENT_TYPE,
    REMOVED_ITEMS_FILE_NAME,
    SUPPLIER_ORDER_FILE_NAME,
    UTF8_BOM,
    buildOptimizedRemovedItemsCsv,
    buildOptimizedSupplierOrderCsv,
    createOptimizedCsvFiles,
    escapeCsvCell,
    formatCsvMoney,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicApi;
  }
  if (globalObject) globalObject.PurchasingCsvExporter = publicApi;
})(typeof window === 'undefined' ? null : window);
