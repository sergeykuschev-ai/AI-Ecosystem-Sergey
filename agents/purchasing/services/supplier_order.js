'use strict';

const {
  WORKBOOK_CELL_STYLES,
  buildWorkbook,
} = require('../../../shared/reporting/xlsx_exporter');

const SUPPLIER_ORDER_SHEET_NAME = 'Заказ поставщику';
const SUPPLIER_ORDER_BLOCKED_CODE = 'OWNER_REVIEW_INCOMPLETE';
const SUPPLIER_ORDER_BLOCKED_MESSAGE =
  'Завершите ручную проверку всех позиций перед формированием заказа ' +
  'поставщику';
const SUPPLIER_ORDER_EMPTY_CODE = 'SUPPLIER_ORDER_EMPTY';
const SUPPLIER_ORDER_DATA_INCOMPLETE_CODE = 'SUPPLIER_ORDER_DATA_INCOMPLETE';
const DEFAULT_SUPPLIER_NAME = 'поставщик';

const MANDATORY_HEADERS = Object.freeze([
  'Артикул',
  'Наименование',
  'Количество',
  'Закупочная цена, ₽',
  'Сумма, ₽',
]);
const MANDATORY_COLUMN_WIDTHS = Object.freeze([18, 55, 14, 18, 18]);

class SupplierOrderError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'SupplierOrderError';
    this.code = code;
    this.details = options.details || {};
  }
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function ownerDecisionOf(item) {
  const decision = item?.owner_decision?.decision;
  return typeof decision === 'string' ? decision : null;
}

/**
 * Позиции, по которым владелец обязан принять решение, но решение
 * ещё не принято (или отложено). Соответствует счётчику
 * needs_decision в ownerDecisionSummary веб-слоя.
 */
function pendingOwnerReviewItems(items) {
  return (items || []).filter(item =>
    item?.matrix?.owner_review_required === true &&
    !['BUY', 'SKIP'].includes(ownerDecisionOf(item))
  );
}

/**
 * Финальное количество позиции для заказа поставщику:
 * - BUY: ручное количество владельца;
 * - без ручного решения: только auto_approved с approved_quantity;
 * - SKIP / DEFER / pending / нулевые количества не включаются.
 * Возвращает null, если позиция не входит в заказ.
 */
function finalOrderQuantity(item) {
  const decision = ownerDecisionOf(item);
  if (decision === 'BUY') {
    const quantity = finiteNumber(item?.owner_decision?.quantity);
    return quantity !== null && quantity > 0 ? quantity : null;
  }
  if (decision === 'SKIP' || decision === 'DEFER') return null;
  if (item?.workflow_status !== 'auto_approved') return null;
  const approved = finiteNumber(item?.quantities?.approved_quantity);
  return approved !== null && approved > 0 ? approved : null;
}

function sanitizeSupplierName(supplier) {
  const cleaned = String(supplier ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/\.+$/g, '')
    .replace(/^_+|_+$/g, '');
  return cleaned === '' ? DEFAULT_SUPPLIER_NAME : cleaned;
}

function orderDatePart(generatedAt) {
  const date = generatedAt instanceof Date
    ? generatedAt
    : new Date(generatedAt);
  if (!Number.isFinite(date.getTime())) {
    throw new SupplierOrderError(
      SUPPLIER_ORDER_DATA_INCOMPLETE_CODE,
      'Некорректная дата формирования заказа поставщику.'
    );
  }
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.` +
    `${date.getFullYear()}`;
}

function buildSupplierOrderFilename(supplier, generatedAt) {
  return `Заказ_поставщику_${sanitizeSupplierName(supplier)}_` +
    `${orderDatePart(generatedAt)}.xlsx`;
}

function orderRowFromItem(item, quantity) {
  const price = finiteNumber(item?.amounts?.unit_price);
  if (price === null || price < 0) {
    throw new SupplierOrderError(
      SUPPLIER_ORDER_DATA_INCOMPLETE_CODE,
      `Для позиции «${item?.name || item?.sku || item?.row_id || '?'}» ` +
      'отсутствует закупочная цена; заказ поставщику не сформирован.',
      { details: { row_id: item?.row_id ?? null } }
    );
  }
  return {
    article: item?.sku ?? '',
    name: item?.name ?? '',
    barcode: item?.barcode || null,
    brand: item?.brand || null,
    quantity,
    price,
    amount: roundMoney(quantity * price),
  };
}

function assertItems(items) {
  if (!Array.isArray(items)) {
    throw new SupplierOrderError(
      SUPPLIER_ORDER_DATA_INCOMPLETE_CODE,
      'Финальное состояние заказа недоступно.'
    );
  }
}

function buildSupplierOrder({ items, supplier, generatedAt }) {
  assertItems(items);
  const pending = pendingOwnerReviewItems(items);
  if (pending.length > 0) {
    throw new SupplierOrderError(
      SUPPLIER_ORDER_BLOCKED_CODE,
      SUPPLIER_ORDER_BLOCKED_MESSAGE,
      { details: { pending_count: pending.length } }
    );
  }

  const rows = [];
  for (const item of items) {
    const quantity = finalOrderQuantity(item);
    if (quantity === null || quantity <= 0) continue;
    rows.push(orderRowFromItem(item, quantity));
  }
  if (rows.length === 0) {
    throw new SupplierOrderError(
      SUPPLIER_ORDER_EMPTY_CODE,
      'Заказ поставщику пуст: нет утверждённых позиций с количеством ' +
      'больше нуля.'
    );
  }

  const totalAmount = roundMoney(
    rows.reduce((sum, row) => sum + row.amount, 0)
  );
  const optional = {
    barcode: rows.some(row => typeof row.barcode === 'string' &&
      row.barcode !== ''),
    brand: rows.some(row => typeof row.brand === 'string' &&
      row.brand !== ''),
  };

  return {
    sheetName: SUPPLIER_ORDER_SHEET_NAME,
    filename: buildSupplierOrderFilename(supplier, generatedAt),
    headers: [
      ...MANDATORY_HEADERS,
      ...(optional.barcode ? ['Штрихкод'] : []),
      ...(optional.brand ? ['Бренд'] : []),
    ],
    optional,
    rows,
    itemCount: rows.length,
    totalAmount,
  };
}

function totalRowCells(order) {
  const cells = [
    { text: '', style: WORKBOOK_CELL_STYLES.totalLabel },
    { text: 'ИТОГО', style: WORKBOOK_CELL_STYLES.totalLabel },
    { text: '', style: WORKBOOK_CELL_STYLES.totalLabel },
    { text: '', style: WORKBOOK_CELL_STYLES.totalLabel },
    {
      number: order.totalAmount,
      style: WORKBOOK_CELL_STYLES.totalMoney,
    },
  ];
  if (order.optional.barcode) {
    cells.push({ text: '', style: WORKBOOK_CELL_STYLES.totalLabel });
  }
  if (order.optional.brand) {
    cells.push({ text: '', style: WORKBOOK_CELL_STYLES.totalLabel });
  }
  return cells;
}

function buildSupplierOrderXlsx(order) {
  const columnWidths = [
    ...MANDATORY_COLUMN_WIDTHS,
    ...(order.optional.barcode ? [24] : []),
    ...(order.optional.brand ? [20] : []),
  ];
  const rows = order.rows.map(row => {
    const cells = [
      { text: row.article },
      { text: row.name },
      { number: row.quantity },
      { number: row.price, style: WORKBOOK_CELL_STYLES.money },
      { number: row.amount, style: WORKBOOK_CELL_STYLES.money },
    ];
    if (order.optional.barcode) cells.push({ text: row.barcode ?? '' });
    if (order.optional.brand) cells.push({ text: row.brand ?? '' });
    return cells;
  });
  return buildWorkbook(order.sheetName, {
    headers: order.headers,
    columnWidths,
    rows,
    totalRow: totalRowCells(order),
  });
}

module.exports = {
  DEFAULT_SUPPLIER_NAME,
  MANDATORY_HEADERS,
  SUPPLIER_ORDER_BLOCKED_CODE,
  SUPPLIER_ORDER_BLOCKED_MESSAGE,
  SUPPLIER_ORDER_DATA_INCOMPLETE_CODE,
  SUPPLIER_ORDER_EMPTY_CODE,
  SUPPLIER_ORDER_SHEET_NAME,
  SupplierOrderError,
  buildSupplierOrder,
  buildSupplierOrderFilename,
  buildSupplierOrderXlsx,
  finalOrderQuantity,
  pendingOwnerReviewItems,
  roundMoney,
  sanitizeSupplierName,
};
