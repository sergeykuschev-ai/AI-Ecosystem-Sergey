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

function normalizeProductRow(row, rowNumber, columnMap, source) {
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
      },
    },
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

    rows.push(normalizeProductRow(row, rowNumber, columnMap, source));
  });

  const duplicateIdentifiers = collectDuplicateIdentifiers(rows);
  const identityFallbacks = rows
    .filter(row => row.identityBasis === 'source_row')
    .map(row => ({
      rowIdentity: row.rowIdentity,
      rowNumber: row.rowNumber,
      reason: 'missing_barcode_and_internal_product_id',
    }));

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
  ];
  for (const field of numericFields) {
    if (row[field] !== null && row[field] !== undefined && typeof row[field] !== 'number') {
      throw new TypeError(
        `Normalized SmartZapas row ${index + 1} has invalid numeric field ${field}.`
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
  ];
  for (const field of diagnosticFields) {
    if (!Array.isArray(result.diagnostics[field])) {
      throw new TypeError(`SmartZapas Adapter v1 diagnostics require ${field}.`);
    }
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
