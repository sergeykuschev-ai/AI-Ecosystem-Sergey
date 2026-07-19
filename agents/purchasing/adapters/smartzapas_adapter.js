const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const readExcelFile = require('read-excel-file/node').default;
const { clean, normalize, toNumber } = require('../parsers/minmax_parser');

const HEADER_ROW_COUNT = 3;
const ADAPTER_SCHEMA = 'smartzapas-adapter-v1';
const NORMALIZED_ROW_SCHEMA = 'smartzapas-row-v1';

const COLUMN_DEFINITIONS = [
  {
    field: 'barcode',
    headers: ['штрихкод', 'штрих-код', 'ean', 'gtin'],
    type: 'text',
  },
  {
    field: 'internalProductId',
    headers: [
      'id товара',
      'код товара',
      'код номенклатуры',
      'код 1с',
      'код 1c',
      'smartzapas id',
    ],
    type: 'text',
  },
  { field: 'article', header: 'артикул', type: 'text' },
  { field: 'name', header: 'наименование', required: true, type: 'text' },
  {
    field: 'supplier',
    header: 'доп. инфо > основной поставщик',
    required: true,
    type: 'text',
  },
  { field: 'abc', header: 'abc-класс > сумма', type: 'text' },
  { field: 'abcDeals', header: 'abc-класс > сделки', type: 'text' },
  { field: 'xyz', header: 'xyz > класс', type: 'text' },
  { field: 'priceNum', header: 'цена', type: 'number' },
  {
    field: 'sales',
    headerPattern: /^история за период \d{2}\.\d{2}\.\d{4} - \d{2}\.\d{2}\.\d{4} > продано > кол-во$/,
    type: 'number',
  },
  {
    field: 'daysAvailable',
    headerPattern: /^история за период \d{2}\.\d{2}\.\d{4} - \d{2}\.\d{2}\.\d{4} > дней наличия$/,
    type: 'number',
  },
  { field: 'speed', header: 'скорость > авто', type: 'number' },
  {
    field: 'stockDays',
    header: 'текущие остатки > дней запаса',
    required: true,
    type: 'number',
  },
  {
    field: 'freeStock',
    header: 'текущие остатки > свободный остаток',
    required: true,
    type: 'number',
  },
  {
    field: 'excessStock',
    header: 'текущие остатки > кол-во излишков',
    type: 'number',
  },
  {
    field: 'inTransit',
    header: 'текущие остатки > в пути',
    type: 'number',
  },
  {
    field: 'reserve',
    header: 'текущие остатки > резерв',
    type: 'number',
  },
  {
    field: 'autoMin',
    header: 'min > шт > авто',
    required: true,
    type: 'number',
  },
  {
    field: 'manualMin',
    header: 'min > шт > ручной',
    required: true,
    type: 'number',
  },
  {
    field: 'needQty',
    headerPattern: /^потреб-ность \d{2}\.\d{2}\.\d{4} - \d{2}\.\d{2}\.\d{4}$/,
    type: 'number',
  },
  {
    field: 'supplierOrderQty',
    header: 'заказать у поставщика > кол-во',
    required: true,
    type: 'number',
  },
  {
    field: 'supplierOrderSum',
    header: 'заказать у поставщика > сумма',
    type: 'number',
  },
  {
    field: 'multiplicity',
    header: 'заказать у поставщика > кратность заказа',
    type: 'number',
  },
];

function normalizeHeaderPart(value) {
  return clean(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/-\s+(?=[a-zа-я])/gi, '-')
    .replace(/\s+/g, ' ');
}

function parseSmartZapasDate(value) {
  const match = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return date;
}

function parseReportedSalesPeriod(header) {
  const match = String(header || '').match(
    /^история за период (\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4}) > продано > кол-во$/
  );
  if (!match) return null;
  const start = parseSmartZapasDate(match[1]);
  const end = parseSmartZapasDate(match[2]);
  if (!start || !end || end < start) return null;

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    inclusiveDays: Math.round((end - start) / 86400000) + 1,
  };
}

function parseSmartZapasShortDate(value) {
  const match = String(value).match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) return null;
  const [, day, month, shortYear] = match;
  return parseSmartZapasDate(`${day}.${month}.20${shortYear}`);
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function parseReportTimestampFromFilePath(filePath) {
  const match = String(filePath || '').match(
    /_(\d{4}-\d{2}-\d{2})[ T](\d{2})-(\d{2})-(\d{2})\.xlsx$/i
  );
  if (!match) return null;
  const [, date, hour, minute, second] = match;
  const timestamp = `${date}T${hour}:${minute}:${second}`;
  const parsed = new Date(`${timestamp}Z`);
  return Number.isNaN(parsed.getTime()) ? null : timestamp;
}

function resolveWeeklySalesColumns(
  headerPaths,
  reportDate = null,
  reportTimestamp = null
) {
  const parsedReportDate = reportDate
    ? parseSmartZapasDate(reportDate.split('-').reverse().join('.'))
    : null;
  const columns = [];

  headerPaths.forEach((header, index) => {
    const match = String(header || '').match(
      /^история по периодам > неделя(?:&#10;|\s)*с(?:&#10;|\s)*(\d{2}\.\d{2}\.\d{2})$/
    );
    if (!match) return;
    const periodStartDate = parseSmartZapasShortDate(match[1]);
    if (!periodStartDate) return;
    const periodEndDate = addUtcDays(periodStartDate, 6);
    let completionStatus = 'unknown';

    if (reportTimestamp) {
      const timestampDate = reportTimestamp.slice(0, 10);
      const periodStart = periodStartDate.toISOString().slice(0, 10);
      const periodEnd = periodEndDate.toISOString().slice(0, 10);
      if (timestampDate < periodStart) completionStatus = 'future';
      else if (timestampDate <= periodEnd) completionStatus = 'partial';
      else completionStatus = 'completed';
    } else if (parsedReportDate) {
      if (parsedReportDate < periodStartDate) completionStatus = 'future';
      else if (parsedReportDate < periodEndDate) completionStatus = 'partial';
      else completionStatus = 'completed';
    }

    columns.push({
      index,
      column: toColumnName(index),
      header,
      periodStart: periodStartDate.toISOString().slice(0, 10),
      periodEnd: periodEndDate.toISOString().slice(0, 10),
      completionStatus,
    });
  });

  return columns.sort((left, right) =>
    left.periodStart.localeCompare(right.periodStart) || left.column.localeCompare(right.column)
  );
}

function normalizeWeeklySalesHistory(
  row,
  weeklySalesColumns,
  { blankCompletedAsZero = false } = {}
) {
  const warnings = [];
  const history = weeklySalesColumns.map(column => {
    const rawValue = row[column.index] ?? null;
    const isBlank = rawValue === null || rawValue === undefined || rawValue === '';
    const parsedQuantity = isBlank ? null : toNumber(rawValue);
    const validQuantity =
      parsedQuantity !== null && Number.isFinite(parsedQuantity) && parsedQuantity >= 0;
    const blankAsConfirmedZero =
      isBlank &&
      blankCompletedAsZero &&
      column.completionStatus === 'completed';

    if (!isBlank && !validQuantity) {
      warnings.push({
        periodStart: column.periodStart,
        sourceColumn: column.column,
        warning: 'invalid_negative_or_non_finite_weekly_sales_quantity',
        rawValue,
      });
    }

    return {
      periodStart: column.periodStart,
      periodEnd: column.periodEnd,
      quantity: blankAsConfirmedZero ? 0 : validQuantity ? parsedQuantity : null,
      valueState: blankAsConfirmedZero
        ? 'blank_as_confirmed_zero'
        : isBlank
          ? 'blank_unavailable_incomplete_period'
          : validQuantity && parsedQuantity === 0
            ? 'explicit_zero'
            : validQuantity
              ? 'positive_quantity'
              : 'invalid_value',
      sourceColumn: column.column,
      sourceHeader: column.header,
      rawValue,
      completionStatus: column.completionStatus,
    };
  });

  return { history, warnings };
}

function reconcileWeeklySalesToCumulative(
  productSourceRows,
  weeklySalesColumns,
  salesColumn,
  tolerance = 1e-6
) {
  const rowResults = new Map();
  const mismatchExamples = [];
  let exactMatches = 0;
  let toleranceMatches = 0;
  let mismatches = 0;
  let blankWeeklyCellCount = 0;
  let explicitZeroWeeklyCellCount = 0;
  let positiveWeeklyCellCount = 0;
  let invalidWeeklyCellCount = 0;
  let invalidCumulativeValueCount = 0;

  for (const productSourceRow of productSourceRows) {
    let weeklyTotal = 0;
    let rowHasInvalidWeeklyValue = false;

    for (const column of weeklySalesColumns) {
      const rawValue = productSourceRow.row[column.index] ?? null;
      const isBlank = rawValue === null || rawValue === undefined || rawValue === '';
      if (isBlank) {
        blankWeeklyCellCount += 1;
        continue;
      }
      const quantity = toNumber(rawValue);
      if (quantity === null || !Number.isFinite(quantity) || quantity < 0) {
        invalidWeeklyCellCount += 1;
        rowHasInvalidWeeklyValue = true;
        continue;
      }
      if (quantity === 0) explicitZeroWeeklyCellCount += 1;
      else positiveWeeklyCellCount += 1;
      weeklyTotal += quantity;
    }

    const cumulativeRawValue = salesColumn
      ? productSourceRow.row[salesColumn.index] ?? null
      : null;
    const cumulativeIsBlank =
      cumulativeRawValue === null ||
      cumulativeRawValue === undefined ||
      cumulativeRawValue === '';
    const cumulativeQuantity = cumulativeIsBlank ? 0 : toNumber(cumulativeRawValue);
    const cumulativeInvalid =
      cumulativeQuantity === null ||
      !Number.isFinite(cumulativeQuantity) ||
      cumulativeQuantity < 0;
    if (cumulativeInvalid) invalidCumulativeValueCount += 1;

    const delta = cumulativeInvalid || rowHasInvalidWeeklyValue
      ? null
      : weeklyTotal - cumulativeQuantity;
    const status = delta === 0
      ? 'exact_match'
      : delta !== null && Math.abs(delta) <= tolerance
        ? 'tolerance_match'
        : 'mismatch';
    if (status === 'exact_match') exactMatches += 1;
    else if (status === 'tolerance_match') toleranceMatches += 1;
    else {
      mismatches += 1;
      if (mismatchExamples.length < 10) {
        mismatchExamples.push({
          rowNumber: productSourceRow.rowNumber,
          name: productSourceRow.name,
          weeklyTotal,
          cumulativeQuantity: cumulativeInvalid ? null : cumulativeQuantity,
          delta,
          rowHasInvalidWeeklyValue,
          cumulativeRawValue,
        });
      }
    }

    rowResults.set(productSourceRow.rowNumber, {
      weeklyTotal,
      cumulativeQuantity: cumulativeInvalid ? null : cumulativeQuantity,
      cumulativeRawValue,
      delta,
      status,
    });
  }

  const blankCellSemanticsConfirmed =
    productSourceRows.length > 0 &&
    weeklySalesColumns.length > 0 &&
    Boolean(salesColumn) &&
    invalidWeeklyCellCount === 0 &&
    invalidCumulativeValueCount === 0 &&
    mismatches === 0 &&
    exactMatches + toleranceMatches === productSourceRows.length;

  return {
    rowResults,
    diagnostic: {
      tolerance,
      comparedProductRows: productSourceRows.length,
      exactMatches,
      toleranceMatches,
      mismatches,
      mismatchExamples,
      blankWeeklyCellCount,
      explicitZeroWeeklyCellCount,
      positiveWeeklyCellCount,
      invalidWeeklyCellCount,
      invalidCumulativeValueCount,
      blankCellSemantics: blankCellSemanticsConfirmed
        ? 'confirmed_zero'
        : 'unconfirmed',
      blankCellSemanticsConfirmed,
    },
  };
}

function deriveRollingWeeklySales(history) {
  const completedHistory = history.filter(period => period.completionStatus === 'completed');
  const latestPartialPeriod = [...history]
    .reverse()
    .find(period => period.completionStatus === 'partial');
  const definitions = [
    { field: 'sales7', weeks: 1 },
    { field: 'sales14', weeks: 2 },
    { field: 'sales28', weeks: 4 },
  ];
  const values = {};
  const weeklyPeriodsUsed = {};

  for (const definition of definitions) {
    const periods = completedHistory.slice(-definition.weeks);
    const usable =
      periods.length === definition.weeks &&
      periods.every(period =>
        typeof period.quantity === 'number' &&
        Number.isFinite(period.quantity) &&
        period.quantity >= 0
      );
    values[definition.field] = usable
      ? periods.reduce((sum, period) => sum + period.quantity, 0)
      : null;
    weeklyPeriodsUsed[definition.field] = usable
      ? periods.map(period => period.periodStart)
      : [];
  }

  return {
    ...values,
    weeklyPeriodsUsed,
    excludedPartialWeek:
      latestPartialPeriod
        ? {
          periodStart: latestPartialPeriod.periodStart,
          periodEnd: latestPartialPeriod.periodEnd,
          sourceColumn: latestPartialPeriod.sourceColumn,
          sourceHeader: latestPartialPeriod.sourceHeader,
          reason: 'report_date_before_expected_seven_day_window_end',
        }
        : null,
  };
}

function mergeHeaderLevels(headerRows) {
  const columnCount = Math.max(0, ...headerRows.map(row => row.length));
  const expandedRows = headerRows.map(row =>
    Array.from({ length: columnCount }, (_, index) => normalizeHeaderPart(row[index]))
  );

  for (let columnIndex = 1; columnIndex < columnCount; columnIndex += 1) {
    if (!expandedRows[0][columnIndex]) {
      expandedRows[0][columnIndex] = expandedRows[0][columnIndex - 1];
    }

    if (
      expandedRows[1] &&
      !expandedRows[1][columnIndex] &&
      expandedRows[0][columnIndex] === expandedRows[0][columnIndex - 1]
    ) {
      expandedRows[1][columnIndex] = expandedRows[1][columnIndex - 1];
    }
  }

  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const parts = [];

    for (const row of expandedRows) {
      const part = row[columnIndex];
      if (part && parts[parts.length - 1] !== part) parts.push(part);
    }

    return parts.join(' > ');
  });
}

function toColumnName(index) {
  let value = index + 1;
  let name = '';

  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }

  return name;
}

function expectedHeader(definition) {
  if (definition.headers) return definition.headers.join(' | ');
  return definition.header || String(definition.headerPattern);
}

function resolveColumns(headerPaths) {
  const columnMap = {};
  const ambiguousColumns = [];
  const missingRequiredColumns = [];

  for (const definition of COLUMN_DEFINITIONS) {
    const matches = headerPaths
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => {
        if (definition.headerPattern) return definition.headerPattern.test(header);
        if (definition.headers) return definition.headers.includes(header);
        return header === definition.header;
      });

    if (matches.length === 1) {
      const match = matches[0];
      columnMap[definition.field] = {
        index: match.index,
        column: toColumnName(match.index),
        header: match.header,
        type: definition.type,
      };
      continue;
    }

    if (matches.length > 1) {
      ambiguousColumns.push({
        field: definition.field,
        expectedHeader: expectedHeader(definition),
        matches: matches.map(match => ({
          index: match.index,
          column: toColumnName(match.index),
          header: match.header,
        })),
      });
    }

    if (definition.required && matches.length === 0) {
      missingRequiredColumns.push({
        field: definition.field,
        expectedHeader: expectedHeader(definition),
      });
    }
  }

  return { columnMap, ambiguousColumns, missingRequiredColumns };
}

function decodeXmlEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normalizeCell(value, type) {
  return type === 'number' ? toNumber(value) : decodeXmlEntities(clean(value));
}

function fingerprintMatrix(matrix) {
  return crypto.createHash('sha256').update(JSON.stringify(matrix)).digest('hex');
}

function createRowIdentity(reportFingerprint, sheetName, rowNumber) {
  return [
    'smartzapas',
    reportFingerprint,
    encodeURIComponent(sheetName),
    String(rowNumber),
  ].join(':');
}

function extractPackageAttributes(name) {
  const tokens = normalize(name)
    .replace(/,/g, '.')
    .match(/\d+(?:\.\d+)?\s*(?:кг|г|мл|л|шт)\.?/gu) || [];
  const uniqueTokens = Array.from(new Set(tokens.map(token => clean(token))));

  return {
    weight: uniqueTokens.filter(token => /(?:кг|г)\.?$/u.test(token)),
    volume: uniqueTokens.filter(token => /(?:мл|л)\.?$/u.test(token)),
    quantity: uniqueTokens.filter(token => /шт\.?$/u.test(token)),
  };
}

function getNormalizedValue(row, columnMap, field) {
  const column = columnMap[field];
  if (!column) return '';
  return normalizeCell(row[column.index], column.type);
}

function classifyRow(row, rowNumber, columnMap) {
  const name = getNormalizedValue(row, columnMap, 'name');
  const supplier = getNormalizedValue(row, columnMap, 'supplier');
  const evidenceFields = [
    'barcode',
    'internalProductId',
    'article',
    'abc',
    'abcDeals',
    'xyz',
  ];
  const evidence = evidenceFields.filter(field => getNormalizedValue(row, columnMap, field));

  if (!name) {
    return {
      classification: 'service_or_group',
      diagnostic: evidence.length > 0
        ? {
          rowNumber,
          name,
          classification: 'skipped',
          reason: 'missing_name_with_product_signals',
          signals: evidence,
        }
        : null,
      reason: 'missing_name',
    };
  }

  if (supplier) return { classification: 'product', diagnostic: null };

  if (evidence.length > 0) {
    return {
      classification: 'product',
      diagnostic: {
        rowNumber,
        name,
        classification: 'retained_as_product',
        reason: 'missing_supplier_with_product_signals',
        signals: evidence,
      },
    };
  }

  return {
    classification: 'service_or_group',
    diagnostic: null,
    reason: 'missing_supplier_and_product_signals',
  };
}

function normalizeProductRow(
  row,
  rowNumber,
  columnMap,
  source,
  weeklySalesColumns,
  weeklySalesOptions = {}
) {
  const normalized = {
    sourceSystem: 'smartzapas',
    schemaVersion: NORMALIZED_ROW_SCHEMA,
    rowType: 'product',
    rowNumber,
    sourceRowNumber: rowNumber,
  };

  for (const [field, column] of Object.entries(columnMap)) {
    normalized[field] = normalizeCell(row[column.index], column.type);
  }

  const barcode = normalized.barcode || '';
  const internalProductId = normalized.internalProductId || '';
  const identityBasis = barcode
    ? 'barcode'
    : internalProductId
      ? 'internal_product_id'
      : 'source_row';
  const freeStockColumn = columnMap.freeStock;
  const freeStockSourceToken = freeStockColumn
    ? row[freeStockColumn.index] ?? null
    : null;
  const salesColumn = columnMap.sales;
  const speedColumn = columnMap.speed;
  const reportedSalesQuantitySourceToken = salesColumn
    ? row[salesColumn.index] ?? null
    : null;
  const reportedSalesVelocitySourceToken = speedColumn
    ? row[speedColumn.index] ?? null
    : null;
  const reportedSalesPeriod = salesColumn
    ? parseReportedSalesPeriod(salesColumn.header)
    : null;
  const reportedSalesQuantity = normalized.sales ?? null;
  const reportedSalesWarnings = [];
  let reportedDailySalesRate = null;
  let reportedSalesRateSource = null;
  let reportedSalesRateConfidence = null;

  if (reportedSalesQuantity !== null && reportedSalesQuantity < 0) {
    reportedSalesWarnings.push('invalid_negative_reported_sales_quantity');
  } else if (
    reportedSalesQuantity !== null &&
    reportedSalesPeriod &&
    reportedSalesPeriod.inclusiveDays > 0
  ) {
    reportedDailySalesRate = Math.round(
      (reportedSalesQuantity / reportedSalesPeriod.inclusiveDays) * 1000000
    ) / 1000000;
    reportedSalesRateSource = 'smartzapas_period_sales_explicit_days';
    reportedSalesRateConfidence = 'high';
  } else if (reportedSalesQuantity !== null) {
    reportedSalesWarnings.push('reported_sales_period_unknown');
  }

  if (normalized.speed !== null && normalized.speed !== undefined) {
    if (!Number.isFinite(normalized.speed) || normalized.speed < 0) {
      reportedSalesWarnings.push('invalid_reported_sales_velocity');
    } else {
      reportedSalesWarnings.push('reported_sales_velocity_unit_ambiguous');
      if (reportedDailySalesRate === null) {
        reportedSalesRateSource = 'smartzapas_speed_auto_ambiguous_unit';
        reportedSalesRateConfidence = 'low';
      }
    }
  }

  const weeklySales = normalizeWeeklySalesHistory(
    row,
    weeklySalesColumns,
    weeklySalesOptions
  );
  const rollingWeeklySales = deriveRollingWeeklySales(weeklySales.history);

  return {
    ...normalized,
    rowIdentity: createRowIdentity(source.reportFingerprint, source.sheetName, rowNumber),
    identityBasis,
    matchKey: barcode
      ? { type: 'barcode', value: normalize(barcode) }
      : internalProductId
        ? { type: 'internal_product_id', value: normalize(internalProductId) }
        : null,
    matchingHints: {
      barcode: barcode || null,
      internalProductId: internalProductId || null,
      supplier: normalized.supplier || null,
      article: normalized.article || null,
      normalizedName: normalize(normalized.name),
      packageAttributes: extractPackageAttributes(normalized.name),
    },
    sourceTokens: {
      freeStock: freeStockSourceToken,
      reportedSalesQuantity: reportedSalesQuantitySourceToken,
      reportedSalesVelocity: reportedSalesVelocitySourceToken,
    },
    provenance: {
      reportFingerprint: source.reportFingerprint,
      worksheet: source.sheetName,
      sourceRowNumber: rowNumber,
      fields: {
        freeStock: freeStockColumn
          ? {
            column: freeStockColumn.column,
            header: freeStockColumn.header,
          }
          : null,
        reportedSalesQuantity: salesColumn
          ? {
            column: salesColumn.column,
            header: salesColumn.header,
          }
          : null,
        reportedSalesVelocity: speedColumn
          ? {
            column: speedColumn.column,
            header: speedColumn.header,
          }
          : null,
      },
    },
    reportedSalesQuantity,
    reportedSalesPeriodDays: reportedSalesPeriod
      ? reportedSalesPeriod.inclusiveDays
      : null,
    reportedDailySalesRate,
    reportedSalesRateSource,
    reportedSalesRateConfidence,
    reportedSalesWarnings,
    reportedSalesMetadata: {
      periodStartDate: reportedSalesPeriod ? reportedSalesPeriod.startDate : null,
      periodEndDate: reportedSalesPeriod ? reportedSalesPeriod.endDate : null,
      periodDayConvention: reportedSalesPeriod ? 'inclusive_calendar_days' : null,
      rawSalesQuantity: reportedSalesQuantitySourceToken,
      rawSalesVelocity: reportedSalesVelocitySourceToken,
    },
    weeklySalesHistory: weeklySales.history,
    weeklySalesWarnings: weeklySales.warnings,
    sales7: rollingWeeklySales.sales7,
    sales14: rollingWeeklySales.sales14,
    sales28: rollingWeeklySales.sales28,
    weeklyPeriodsUsed: rollingWeeklySales.weeklyPeriodsUsed,
    excludedPartialWeek: rollingWeeklySales.excludedPartialWeek,
    salesPeriodSource: weeklySalesColumns.length > 0
      ? 'smartzapas_weekly_history'
      : null,
    salesPeriodConfidence: weeklySalesColumns.length > 0 ? 'high' : null,
    weeklyToCumulativeReconciliation:
      weeklySalesOptions.reconciliation || null,
    stock: null,
    min: null,
    max: null,
    orderQty: normalized.supplierOrderQty ?? null,
    sumNum: normalized.supplierOrderSum ?? null,
  };
}

function collectDuplicateIdentifiers(rows) {
  const definitions = [
    { type: 'barcode', getValue: row => row.barcode },
    { type: 'internal_product_id', getValue: row => row.internalProductId },
    { type: 'article', getValue: row => row.article },
  ];
  const diagnostics = [];

  for (const definition of definitions) {
    const groups = new Map();

    for (const row of rows) {
      const rawValue = definition.getValue(row);
      if (!rawValue) continue;
      const value = normalize(rawValue);
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    }

    for (const [value, matches] of groups) {
      if (matches.length < 2) continue;
      diagnostics.push({
        identifierType: definition.type,
        value,
        rowNumbers: matches.map(row => row.rowNumber),
        rowIdentities: matches.map(row => row.rowIdentity),
        productNames: matches.map(row => row.name),
        action: 'retained_all_rows',
      });
    }
  }

  return diagnostics;
}

function adaptSmartZapasMatrix(matrix, metadata = {}) {
  if (!Array.isArray(matrix)) {
    throw new TypeError('SmartZapas export must be a two-dimensional array.');
  }

  const headerRows = matrix.slice(0, HEADER_ROW_COUNT);
  const headerPaths = mergeHeaderLevels(headerRows);
  const {
    columnMap,
    ambiguousColumns,
    missingRequiredColumns,
  } = resolveColumns(headerPaths);
  const rows = [];
  const productSourceRows = [];
  const serviceRows = [];
  const ambiguousRowClassifications = [];
  const dataRows = matrix.slice(HEADER_ROW_COUNT);
  const source = {
    filePath: metadata.filePath || null,
    sheetName: metadata.sheetName || 'Sheet1',
    reportFingerprint: metadata.reportFingerprint || fingerprintMatrix(matrix),
    headerRowCount: HEADER_ROW_COUNT,
    sourceRowsCount: dataRows.length,
  };
  const reportedSalesPeriod = columnMap.sales
    ? parseReportedSalesPeriod(columnMap.sales.header)
    : null;
  source.reportDate = metadata.reportDate ||
    (reportedSalesPeriod ? reportedSalesPeriod.endDate : null);
  source.reportTimestamp = metadata.reportTimestamp || null;
  const weeklySalesColumns = resolveWeeklySalesColumns(
    headerPaths,
    source.reportDate,
    source.reportTimestamp
  );
  source.weeklySalesMetadata = {
    dateSemantics: 'period_start',
    dateSemanticsReason: 'header_uses_week_from_date',
    confidence: 'high',
    periodLengthDays: 7,
    reportDate: source.reportDate,
    reportTimestamp: source.reportTimestamp,
    detectedPeriodCount: weeklySalesColumns.length,
    completedPeriodCount: weeklySalesColumns.filter(
      column => column.completionStatus === 'completed'
    ).length,
    completedPeriodStarts: weeklySalesColumns
      .filter(column => column.completionStatus === 'completed')
      .map(column => column.periodStart),
    excludedPeriods: weeklySalesColumns
      .filter(column => column.completionStatus !== 'completed')
      .map(column => ({
        periodStart: column.periodStart,
        periodEnd: column.periodEnd,
        sourceColumn: column.column,
        completionStatus: column.completionStatus,
      })),
  };

  dataRows.forEach((row, index) => {
    const rowNumber = index + HEADER_ROW_COUNT + 1;
    const classification = classifyRow(row, rowNumber, columnMap);
    const name = getNormalizedValue(row, columnMap, 'name');

    if (classification.diagnostic) {
      ambiguousRowClassifications.push(classification.diagnostic);
    }

    if (classification.classification !== 'product') {
      serviceRows.push({
        rowNumber,
        name,
        rowType: 'service_or_group',
        reason: classification.reason,
      });
      return;
    }

    productSourceRows.push({ row, rowNumber, name });
  });

  const weeklySalesReconciliation = reconcileWeeklySalesToCumulative(
    productSourceRows,
    weeklySalesColumns,
    columnMap.sales
  );
  for (const productSourceRow of productSourceRows) {
    rows.push(normalizeProductRow(
      productSourceRow.row,
      productSourceRow.rowNumber,
      columnMap,
      source,
      weeklySalesColumns,
      {
        blankCompletedAsZero:
          weeklySalesReconciliation.diagnostic.blankCellSemanticsConfirmed,
        reconciliation: weeklySalesReconciliation.rowResults.get(
          productSourceRow.rowNumber
        ),
      }
    ));
  }

  const duplicateIdentifiers = collectDuplicateIdentifiers(rows);
  const identityFallbacks = rows
    .filter(row => row.identityBasis === 'source_row')
    .map(row => ({
      rowIdentity: row.rowIdentity,
      rowNumber: row.rowNumber,
      reason: 'missing_barcode_and_internal_product_id',
    }));
  const salesSemanticsWarnings = [];
  if (columnMap.speed) {
    salesSemanticsWarnings.push({
      field: 'speed',
      column: columnMap.speed.column,
      header: columnMap.speed.header,
      warning: 'reported_sales_velocity_unit_not_declared',
      inferredUnit: 'approximately_units_per_month',
      confidence: 'low',
      action: 'preserved_raw_not_converted_to_daily_rate',
    });
  }
  if (columnMap.daysAvailable) {
    salesSemanticsWarnings.push({
      field: 'daysAvailable',
      column: columnMap.daysAvailable.column,
      header: columnMap.daysAvailable.header,
      warning: 'availability_unit_inconsistent_with_observed_range',
      inferredUnit: null,
      confidence: 'low',
      action: 'not_used_as_sales_rate_denominator',
    });
  }
  if (weeklySalesColumns.length > 0 && !source.reportDate) {
    salesSemanticsWarnings.push({
      field: 'weeklySalesHistory',
      warning: 'weekly_history_report_date_unavailable',
      confidence: 'low',
      action: 'weekly_periods_preserved_but_not_used_for_rolling_sales',
    });
  }

  return {
    schemaVersion: ADAPTER_SCHEMA,
    source,
    headerPaths,
    columnMap,
    rows,
    serviceRows,
    diagnostics: {
      duplicateIdentifiers,
      identityFallbacks,
      ambiguousRowClassifications,
      skippedServiceRows: serviceRows,
      ambiguousColumns,
      missingRequiredColumns,
      salesSemanticsWarnings,
      weeklySalesReconciliation: weeklySalesReconciliation.diagnostic,
    },
  };
}

async function readSmartZapasExport(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new TypeError('SmartZapas export path must be a non-empty string.');
  }

  const fileContents = await fs.readFile(filePath);
  const reportFingerprint = crypto
    .createHash('sha256')
    .update(fileContents)
    .digest('hex');
  const sheets = await readExcelFile(filePath);
  const worksheet = sheets[0];

  if (!worksheet) {
    throw new TypeError('SmartZapas export does not contain a worksheet.');
  }

  return adaptSmartZapasMatrix(worksheet.data, {
    filePath,
    sheetName: worksheet.sheet,
    reportFingerprint,
    reportTimestamp: parseReportTimestampFromFilePath(filePath),
  });
}

function validateNormalizedRow(row, index, source = null) {
  if (!row || typeof row !== 'object') {
    throw new TypeError(`Normalized SmartZapas row ${index + 1} must be an object.`);
  }
  if (row.schemaVersion !== NORMALIZED_ROW_SCHEMA) {
    throw new TypeError(`Normalized SmartZapas row ${index + 1} has an invalid schema.`);
  }
  if (typeof row.rowIdentity !== 'string' || !row.rowIdentity) {
    throw new TypeError(`Normalized SmartZapas row ${index + 1} requires rowIdentity.`);
  }
  if (!Number.isInteger(row.rowNumber) || row.rowNumber < HEADER_ROW_COUNT + 1) {
    throw new TypeError(`Normalized SmartZapas row ${index + 1} has an invalid rowNumber.`);
  }
  if (typeof row.name !== 'string' || !row.name) {
    throw new TypeError(`Normalized SmartZapas row ${index + 1} requires a product name.`);
  }
  if (!row.matchingHints || typeof row.matchingHints !== 'object') {
    throw new TypeError(`Normalized SmartZapas row ${index + 1} requires matchingHints.`);
  }
  if (!row.sourceTokens || !Object.hasOwn(row.sourceTokens, 'freeStock')) {
    throw new TypeError(`Normalized SmartZapas row ${index + 1} requires freeStock provenance.`);
  }
  if (!row.provenance || typeof row.provenance !== 'object') {
    throw new TypeError(`Normalized SmartZapas row ${index + 1} requires provenance.`);
  }

  if (source) {
    const expectedIdentity = createRowIdentity(
      source.reportFingerprint,
      source.sheetName,
      row.rowNumber
    );
    if (row.rowIdentity !== expectedIdentity) {
      throw new TypeError(
        `Normalized SmartZapas row ${index + 1} has an invalid deterministic rowIdentity.`
      );
    }
    if (
      row.provenance.reportFingerprint !== source.reportFingerprint ||
      row.provenance.worksheet !== source.sheetName ||
      row.provenance.sourceRowNumber !== row.rowNumber
    ) {
      throw new TypeError(`Normalized SmartZapas row ${index + 1} has invalid provenance.`);
    }
  }

  const numericFields = [
    'freeStock',
    'stockDays',
    'autoMin',
    'manualMin',
    'orderQty',
    'priceNum',
    'sumNum',
    'reportedSalesQuantity',
    'reportedSalesPeriodDays',
    'reportedDailySalesRate',
    'sales7',
    'sales14',
    'sales28',
  ];
  for (const field of numericFields) {
    if (row[field] !== null && row[field] !== undefined && typeof row[field] !== 'number') {
      throw new TypeError(
        `Normalized SmartZapas row ${index + 1} has invalid numeric field ${field}.`
      );
    }
  }
  if (
    row.reportedDailySalesRate !== null &&
    row.reportedDailySalesRate !== undefined &&
    (!Number.isFinite(row.reportedDailySalesRate) || row.reportedDailySalesRate < 0)
  ) {
    throw new TypeError(
      `Normalized SmartZapas row ${index + 1} has invalid reportedDailySalesRate.`
    );
  }
  for (const field of ['sales7', 'sales14', 'sales28']) {
    if (
      row[field] !== null &&
      row[field] !== undefined &&
      (!Number.isFinite(row[field]) || row[field] < 0)
    ) {
      throw new TypeError(
        `Normalized SmartZapas row ${index + 1} has invalid ${field}.`
      );
    }
  }
  if (!Array.isArray(row.weeklySalesHistory)) {
    throw new TypeError(
      `Normalized SmartZapas row ${index + 1} requires weeklySalesHistory.`
    );
  }
  for (const period of row.weeklySalesHistory) {
    if (
      !period ||
      typeof period.periodStart !== 'string' ||
      typeof period.sourceColumn !== 'string' ||
      typeof period.sourceHeader !== 'string' ||
      !['completed', 'partial', 'future', 'unknown'].includes(period.completionStatus) ||
      ![
        'explicit_zero',
        'blank_as_confirmed_zero',
        'positive_quantity',
        'invalid_value',
        'blank_unavailable_incomplete_period',
      ].includes(period.valueState) ||
      (
        period.quantity !== null &&
        (
          typeof period.quantity !== 'number' ||
          !Number.isFinite(period.quantity) ||
          period.quantity < 0
        )
      )
    ) {
      throw new TypeError(
        `Normalized SmartZapas row ${index + 1} has invalid weeklySalesHistory.`
      );
    }
  }
}

function assertUsableAdapterResult(result) {
  if (!result || result.schemaVersion !== ADAPTER_SCHEMA || !Array.isArray(result.rows)) {
    throw new TypeError('Purchasing Agent requires a SmartZapas Adapter v1 result.');
  }
  if (!result.diagnostics || typeof result.diagnostics !== 'object') {
    throw new TypeError('SmartZapas Adapter v1 result requires diagnostics.');
  }
  if (
    !result.source ||
    typeof result.source.sheetName !== 'string' ||
    !result.source.sheetName ||
    typeof result.source.reportFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(result.source.reportFingerprint) ||
    !Number.isInteger(result.source.sourceRowsCount)
  ) {
    throw new TypeError('SmartZapas Adapter v1 result has invalid source provenance.');
  }

  const diagnosticFields = [
    'duplicateIdentifiers',
    'identityFallbacks',
    'ambiguousRowClassifications',
    'skippedServiceRows',
    'ambiguousColumns',
    'missingRequiredColumns',
    'salesSemanticsWarnings',
  ];
  for (const field of diagnosticFields) {
    if (!Array.isArray(result.diagnostics[field])) {
      throw new TypeError(`SmartZapas Adapter v1 diagnostics require ${field}.`);
    }
  }
  if (
    !result.diagnostics.weeklySalesReconciliation ||
    typeof result.diagnostics.weeklySalesReconciliation !== 'object'
  ) {
    throw new TypeError(
      'SmartZapas Adapter v1 diagnostics require weeklySalesReconciliation.'
    );
  }

  const blockingDiagnostics = [
    ...result.diagnostics.missingRequiredColumns,
    ...result.diagnostics.ambiguousColumns,
  ];

  if (blockingDiagnostics.length > 0) {
    const error = new TypeError(
      'SmartZapas export has missing or ambiguous required columns.'
    );
    error.diagnostics = result.diagnostics;
    throw error;
  }

  const rowIdentities = new Set();
  result.rows.forEach((row, index) => {
    validateNormalizedRow(row, index, result.source);
    if (rowIdentities.has(row.rowIdentity)) {
      throw new TypeError(`Duplicate normalized rowIdentity: ${row.rowIdentity}.`);
    }
    rowIdentities.add(row.rowIdentity);
  });
}

module.exports = {
  HEADER_ROW_COUNT,
  ADAPTER_SCHEMA,
  NORMALIZED_ROW_SCHEMA,
  COLUMN_DEFINITIONS,
  normalizeHeaderPart,
  parseSmartZapasDate,
  parseReportedSalesPeriod,
  parseSmartZapasShortDate,
  parseReportTimestampFromFilePath,
  resolveWeeklySalesColumns,
  normalizeWeeklySalesHistory,
  reconcileWeeklySalesToCumulative,
  deriveRollingWeeklySales,
  mergeHeaderLevels,
  resolveColumns,
  fingerprintMatrix,
  createRowIdentity,
  extractPackageAttributes,
  classifyRow,
  collectDuplicateIdentifiers,
  adaptSmartZapasMatrix,
  readSmartZapasExport,
  validateNormalizedRow,
  assertUsableAdapterResult,
};
