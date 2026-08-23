'use strict';

const { parseWorkbook } = require('./ooxml_workbook');

const REQUIRED_COMMON = Object.freeze(['shiftDate', 'employeeName', 'receipts']);
const HEADER_ALIASES = Object.freeze({
  shiftDate: ['дата'],
  employeeName: ['продавец'],
  historicalRevenue: ['выручка', 'выручка ₽', 'выручка, ₽'],
  cash: ['наличные', 'наличные ₽', 'наличные, ₽'],
  acquiring: [
    'эквайринг',
    'эквайринг (уже включает qr)',
    'эквайринг(уже включает qr)',
    'эквайринг (includes qr)',
    'эквайринг(includes qr)',
    'эквайринг (уже включает qr), ₽',
  ],
  qr: ['qr', 'сбп / qr', 'сбп/qr', 'qr (входит в эквайринг), ₽'],
  receipts: ['чеки', 'количество чеков'],
  itemsSold: ['продано товаров, шт.', 'продано товаров шт', 'товаров продано, шт.'],
  itemsPerReceiptReference: ['товаров в чеке'],
  upsellReceipts: ['допродажи (шт)', 'чеки с допродажей'],
  treatsRevenue: ['лакомства', 'лакомства ₽', 'лакомства, ₽', 'лакомства ₽/смена'],
  treatsReceipts: ['чеки с лакомствами'],
  shiftRevenuePlanReference: ['план на день ₽', 'план смены'],
  comment: ['комментарий', 'комментарий руководителя'],
  averageCheckReference: ['средний чек', 'средний чек ₽', 'средний чек, ₽'],
});

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s+/g, ' ');
}

const ALIAS_TO_FIELD = new Map(Object.entries(HEADER_ALIASES).flatMap(
  ([field, aliases]) => aliases.map(alias => [normalizeHeader(alias), field])
));

function mapHeaders(row) {
  const fields = {};
  const unsupported = [];
  row.forEach((value, index) => {
    const normalized = normalizeHeader(value);
    if (!normalized) return;
    const field = ALIAS_TO_FIELD.get(normalized);
    if (field && fields[field] === undefined) fields[field] = index;
    else if (!field) unsupported.push(String(value));
  });
  return { fields, unsupported };
}

function excelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000)
      .toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (iso) return trimmed;
    const russian = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(trimmed);
    if (russian) {
      const year = russian[3].length === 2 ? 2000 + Number(russian[3]) : Number(russian[3]);
      return `${year}-${String(Number(russian[2])).padStart(2, '0')}-${String(Number(russian[1])).padStart(2, '0')}`;
    }
  }
  return null;
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value) {
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function moneyValue(value) {
  const parsed = numberValue(value);
  return parsed === null ? null : Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function findDataSheet(workbook) {
  const candidates = [];
  for (const sheet of workbook.sheets) {
    const limit = Math.min(sheet.rows.length, 20);
    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      const mapped = mapHeaders(sheet.rows[rowIndex]);
      const common = REQUIRED_COMMON.every(field => mapped.fields[field] !== undefined);
      const revenue = mapped.fields.historicalRevenue !== undefined;
      const payments = mapped.fields.cash !== undefined && mapped.fields.acquiring !== undefined;
      if (common && (revenue || payments)) {
        candidates.push({ sheet, rowIndex, ...mapped });
      }
    }
  }
  candidates.sort((left, right) => {
    const preferred = name => /^(input|kpi_контроль)$/iu.test(name) ? 1 : 0;
    return preferred(right.sheet.name) - preferred(left.sheet.name);
  });
  return candidates[0] || null;
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, ...details };
}

function parseRows(candidate) {
  const { sheet, rowIndex: headerRowIndex, fields } = candidate;
  const hasPayments = fields.cash !== undefined && fields.acquiring !== undefined;
  const issues = [];
  const rows = [];
  let shiftedItemsDetected = false;
  for (let index = headerRowIndex + 1; index < sheet.rows.length; index += 1) {
    const source = sheet.rows[index];
    if (!source || source.every(value => value === null || value === undefined || value === '')) continue;
    const rawDate = source[fields.shiftDate];
    const rawEmployee = source[fields.employeeName];
    const employeeBlank = rawEmployee === null || rawEmployee === undefined ||
      rawEmployee === '' || rawEmployee === 0;
    if (employeeBlank &&
        [fields.historicalRevenue, fields.cash, fields.acquiring, fields.receipts]
          .map(field => field === undefined ? null : numberValue(source[field]))
          .every(value => value === null || value === 0)) continue;
    const rowNumber = index + 1;
    const authoritativeFields = [
      'shiftDate', 'employeeName', 'receipts',
      ...(hasPayments ? ['cash', 'acquiring', 'qr'] : ['historicalRevenue']),
      ...['itemsSold', 'upsellReceipts', 'treatsRevenue', 'treatsReceipts']
        .filter(field => fields[field] !== undefined),
    ];
    for (const field of authoritativeFields) {
      const cell = sheet.cells[index]?.[fields[field]];
      if (cell?.error) {
        issues.push(issue('error', 'ERROR_CELL', `Ошибка Excel в authoritative поле ${field}.`, { row: rowNumber, field }));
      } else if (cell?.formula) {
        issues.push(issue('warning', 'FORMULA_AUTHORITATIVE_CELL', `Authoritative поле ${field} содержит формулу с сохранённым числовым результатом.`, { row: rowNumber, field }));
      }
    }
    const shiftDate = excelDate(rawDate);
    const employeeName = typeof rawEmployee === 'string' ? rawEmployee.trim() : '';
    const receipts = integerValue(source[fields.receipts]);
    if (!shiftDate) issues.push(issue('error', 'INVALID_DATE', 'Некорректная дата смены.', { row: rowNumber }));
    if (!employeeName) issues.push(issue('error', 'MISSING_EMPLOYEE', 'Не указан продавец.', { row: rowNumber }));
    if (receipts === null) issues.push(issue('error', 'INVALID_RECEIPTS', 'Количество чеков должно быть целым числом.', { row: rowNumber }));
    else if (receipts < 0) issues.push(issue('error', 'NEGATIVE_VALUE', 'Количество чеков не может быть отрицательным.', { row: rowNumber, field: 'receipts' }));
    else if (receipts === 0) issues.push(issue('warning', 'ZERO_RECEIPTS', 'Смена содержит 0 чеков.', { row: rowNumber }));

    const historicalRevenue = fields.historicalRevenue === undefined
      ? null : moneyValue(source[fields.historicalRevenue]);
    const cash = fields.cash === undefined ? null : moneyValue(source[fields.cash]);
    const acquiring = fields.acquiring === undefined ? null : moneyValue(source[fields.acquiring]);
    const qr = fields.qr === undefined ? null : moneyValue(source[fields.qr]);
    if (!hasPayments && historicalRevenue === null) {
      issues.push(issue('error', 'INVALID_REVENUE', 'Историческая выручка должна быть числом.', { row: rowNumber }));
    }
    if (hasPayments && [cash, acquiring, qr].some(value => value === null)) {
      issues.push(issue('error', 'MISSING_PAYMENT_BREAKDOWN', 'Для платёжного формата обязательны наличные, эквайринг и QR.', { row: rowNumber }));
    }
    for (const [field, value] of Object.entries({ historicalRevenue, cash, acquiring, qr })) {
      if (value !== null && value < 0) issues.push(issue('error', 'NEGATIVE_VALUE', `${field} не может быть отрицательным.`, { row: rowNumber, field }));
    }
    if (hasPayments && qr > acquiring) {
      issues.push(issue('error', 'QR_EXCEEDS_ACQUIRING', 'QR не может быть больше эквайринга, который включает QR.', { row: rowNumber }));
    }
    const optionalInteger = field => fields[field] === undefined
      ? null : integerValue(source[fields[field]]);
    let itemsSold = optionalInteger('itemsSold');
    const numericComment = fields.comment === undefined ? null : integerValue(source[fields.comment]);
    const itemsReference = fields.itemsPerReceiptReference === undefined
      ? null : numberValue(source[fields.itemsPerReceiptReference]);
    if (itemsSold === null && numericComment !== null && receipts !== null &&
        itemsReference !== null && Math.abs(numericComment - itemsReference * receipts) < 0.01) {
      itemsSold = numericComment;
      shiftedItemsDetected = true;
    }
    const upsellReceipts = optionalInteger('upsellReceipts');
    const treatsReceipts = optionalInteger('treatsReceipts');
    const treatsRevenue = fields.treatsRevenue === undefined
      ? null : moneyValue(source[fields.treatsRevenue]);
    for (const [field, value] of Object.entries({ itemsSold, upsellReceipts, treatsReceipts, treatsRevenue })) {
      if (value !== null && value < 0) issues.push(issue('error', 'NEGATIVE_VALUE', `${field} не может быть отрицательным.`, { row: rowNumber, field }));
    }
    if (upsellReceipts !== null && receipts !== null && upsellReceipts > receipts) {
      issues.push(issue('error', 'UPSELLS_EXCEED_RECEIPTS', 'Чеки с допродажей не могут превышать все чеки.', { row: rowNumber }));
    }
    if (treatsReceipts !== null && receipts !== null && treatsReceipts > receipts) {
      issues.push(issue('error', 'TREATS_EXCEED_RECEIPTS', 'Чеки с лакомствами не могут превышать все чеки.', { row: rowNumber }));
    }
    rows.push({
      shiftDate,
      shiftKey: 'main',
      employeeName,
      cash: hasPayments ? cash : null,
      acquiring: hasPayments ? acquiring : null,
      qr: hasPayments ? qr : null,
      historicalRevenue: hasPayments ? null : historicalRevenue,
      revenueSource: hasPayments ? 'payment_breakdown' : 'historical_total',
      paymentBreakdownAvailable: hasPayments,
      receipts,
      itemsSold,
      upsellReceipts,
      treatsRevenue,
      treatsReceipts,
      comment: fields.comment === undefined || numericComment !== null
        ? null
        : String(source[fields.comment] || '').trim() || null,
      sourceReference: {
        sheet: sheet.name,
        row: rowNumber,
        excelRevenue: historicalRevenue,
        averageCheck: fields.averageCheckReference === undefined ? null : numberValue(source[fields.averageCheckReference]),
        itemsPerReceipt: fields.itemsPerReceiptReference === undefined ? null : numberValue(source[fields.itemsPerReceiptReference]),
        shiftRevenuePlan: fields.shiftRevenuePlanReference === undefined ? null : moneyValue(source[fields.shiftRevenuePlanReference]),
      },
    });
  }
  if (!hasPayments) {
    issues.push(issue('warning', 'PAYMENT_BREAKDOWN_UNAVAILABLE', 'В книге нет достоверной разбивки cash/acquiring/QR; используется historical_revenue.'));
  }
  for (const [field, code, label] of [
    ['itemsSold', 'MISSING_ITEMS_SOLD', 'Продано товаров'],
    ['upsellReceipts', 'MISSING_UPSELL_RECEIPTS', 'Чеки с допродажей'],
    ['treatsRevenue', 'MISSING_TREATS_REVENUE', 'Выручка лакомств'],
    ['treatsReceipts', 'MISSING_TREATS_RECEIPTS', 'Чеки с лакомствами'],
  ]) {
    const missing = rows.filter(row => row[field] === null).length;
    if (missing > 0) {
      issues.push(issue('warning', code, `${label}: нет authoritative значения в ${missing} строках.`, { rows: missing }));
    }
  }
  if (shiftedItemsDetected) {
    issues.push(issue(
      'warning',
      'KNOWN_ITEMS_COLUMN_SHIFT',
      'Обнаружена известная версия, где целое число товаров записано в numeric Comment; значение принято только после точной сверки с receipts × Excel items/receipt.'
    ));
  }
  return { rows, issues, hasPayments };
}

function inspectSettings(workbook) {
  const exact = workbook.sheets.find(sheet => normalizeHeader(sheet.name) === 'settings');
  const legacy = workbook.sheets.find(sheet => /^(kpi_нормы|настройки)$/iu.test(sheet.name));
  const sheet = exact || legacy;
  if (!sheet) return { status: 'MISSING', sheet: null, evidence: {} };
  const evidence = {};
  for (const row of sheet.rows) {
    const key = normalizeHeader(row[0]);
    if (!key) continue;
    const value = row.find((item, index) => index > 0 && item !== null && item !== undefined && item !== '');
    if (value !== undefined) evidence[key] = value;
  }
  const find = (...patterns) => {
    const key = Object.keys(evidence).find(candidate =>
      patterns.every(pattern => candidate.includes(pattern))
    );
    return key ? numberValue(evidence[key]) : null;
  };
  const levelRows = sheet.rows.filter(row =>
    typeof row[7] === 'string' && numberValue(row[8]) !== null && numberValue(row[9]) !== null
  );
  const tierRows = sheet.rows.filter(row =>
    typeof row[3] === 'string' && numberValue(row[4]) !== null
  );
  const values = {
    shiftRevenue: find('план', 'смен'),
    sellerShifts: find('норма', 'смен', 'продав'),
    averageCheck: find('средн', 'чек'),
    itemsPerReceipt: find('товар', 'чек'),
    upsellReceiptShare: find('допродаж'),
    treatsRevenue: find('лакомств', '₽'),
    treatsReceiptShare: find('чек', 'лакомств'),
    acquiringFee: find('эквайринг', 'комисс'),
    qrFee: find('qr', 'комисс'),
  };
  const confirmed = Boolean(exact) && Object.values(values).every(value => value !== null) &&
    levelRows.length >= 4 && tierRows.length >= 5;
  const extracted = confirmed ? {
    targets: {
      shiftRevenue: values.shiftRevenue,
      sellerShifts: values.sellerShifts,
      averageCheck: values.averageCheck,
      itemsPerReceipt: values.itemsPerReceipt,
      upsellReceiptShare: values.upsellReceiptShare,
      treatsRevenue: values.treatsRevenue,
      treatsReceiptShare: values.treatsReceiptShare,
      qrShare: null,
    },
    weights: { shiftPlan: 30, averageCheck: 20, itemsPerReceipt: 15, upsell: 20, treats: 15 },
    levels: [
      ...levelRows.map(row => ({ name: row[7], minimumScore: numberValue(row[8]), bonusBase: moneyValue(row[9]) })),
      { name: 'Без премии', minimumScore: 0, bonusBase: 0 },
    ],
    qrCoefficientTiers: tierRows.map((row, index) => ({
      upperExclusive: index === tierRows.length - 1 ? null : [0.1, 0.15, 0.2, 0.25][index],
      coefficient: numberValue(row[4]),
    })),
    fees: { acquiring: values.acquiringFee, qr: values.qrFee },
    payment: { qrIncludedInAcquiring: true },
    unresolved: ['Excel Settings does not define a standalone target QR share.'],
  } : null;
  return { status: confirmed ? 'CONFIRMED' : 'PARTIAL', sheet: sheet.name, evidence, extracted };
}

function inspectWorkbookReferences(workbook) {
  const sheet = workbook.sheets.find(item => /^(dashboard|дашборд)/iu.test(item.name));
  if (!sheet) return {};
  const references = {};
  for (let rowIndex = 0; rowIndex < Math.min(sheet.rows.length - 1, 12); rowIndex += 1) {
    const labels = sheet.rows[rowIndex];
    const values = sheet.rows[rowIndex + 1];
    for (let column = 0; column < labels.length; column += 1) {
      const label = normalizeHeader(labels[column]);
      const value = numberValue(values[column]);
      if (!label || value === null) continue;
      if ((label === 'выручка' || label === 'выручка магазина') && references.revenue === undefined) references.revenue = value;
      else if ((label === 'чеки' || label === 'количество чеков') && references.receipts === undefined) references.receipts = value;
      else if ((label === 'средний чек' || label === 'средний чек магазина') && references.averageCheck === undefined) references.averageCheck = value;
      else if (label.startsWith('qr') && label.includes('₽') && references.qr === undefined) references.qr = value;
      else if (label.includes('доля qr') && references.qrShare === undefined) references.qrShare = value;
    }
  }
  return { sheet: sheet.name, ...references };
}

function parseKpiWorkbook(buffer) {
  const workbook = parseWorkbook(buffer);
  const candidate = findDataSheet(workbook);
  if (!candidate) {
    throw new TypeError('Unsupported KPI workbook: required Date/Seller/Revenue/Receipts headers were not found');
  }
  const parsed = parseRows(candidate);
  if (parsed.rows.length === 0) throw new TypeError('Unsupported KPI workbook: no shift rows found');
  const periods = new Set(parsed.rows.filter(row => row.shiftDate).map(row => row.shiftDate.slice(0, 7)));
  if (periods.size !== 1) {
    throw new TypeError('A workbook import must contain exactly one month');
  }
  const [period] = periods;
  const [year, month] = period.split('-').map(Number);
  const settings = inspectSettings(workbook);
  const workbookReferences = inspectWorkbookReferences(workbook);
  if (settings.status !== 'CONFIRMED') {
    parsed.issues.push(issue('warning', 'SETTINGS_UNRESOLVED', 'Полный набор настроек KPI для месяца не подтверждён; KPI и премии останутся unresolved.'));
  }
  return {
    version: parsed.hasPayments ? 'miska_payment_breakdown_v1' : 'miska_historical_total_v1',
    dataSheet: candidate.sheet.name,
    headerRow: candidate.rowIndex + 1,
    year,
    month,
    rows: parsed.rows,
    issues: parsed.issues,
    settings,
    workbookReferences,
    paymentBreakdownAvailable: parsed.hasPayments,
    workbookSheets: workbook.sheets.map(sheet => ({ name: sheet.name, rows: sheet.rows.length })),
  };
}

module.exports = {
  HEADER_ALIASES,
  excelDate,
  findDataSheet,
  inspectSettings,
  inspectWorkbookReferences,
  mapHeaders,
  moneyValue,
  normalizeHeader,
  numberValue,
  parseKpiWorkbook,
};
