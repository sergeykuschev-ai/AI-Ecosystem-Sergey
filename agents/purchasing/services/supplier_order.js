'use strict';

const {
  WORKBOOK_CELL_STYLES,
  buildWorkbook,
} = require('../../../shared/reporting/xlsx_exporter');
const {
  buildFinalOrderState,
} = require('./final_order');

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

/**
 * Позиции, блокирующие финальный заказ: обязательные ручные решения
 * и pending-позиции без любого решения владельца.
 * Соответствует канонической модели final_order.
 */
function pendingOwnerReviewItems(items) {
  return buildFinalOrderState({ items }).unresolvedItems;
}

/**
 * Финальное количество позиции для заказа поставщику по каноническим
 * правилам final_order. Возвращает null, если позиция не входит
 * в заказ.
 */
function finalOrderQuantity(item) {
  const state = buildFinalOrderState({ items: [item] });
  return state.includedItems[0]?.quantity ?? null;
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

function orderRowFromIncluded(entry) {
  if (entry.price === null || entry.price < 0) {
    throw new SupplierOrderError(
      SUPPLIER_ORDER_DATA_INCOMPLETE_CODE,
      `Для позиции «${entry.name || entry.sku || entry.rowId || '?'}» ` +
      'отсутствует закупочная цена; заказ поставщику не сформирован.',
      { details: { row_id: entry.rowId } }
    );
  }
  if (entry.orderMode === 'PIECE' && !Number.isInteger(entry.quantity)) {
    throw new SupplierOrderError(
      SUPPLIER_ORDER_DATA_INCOMPLETE_CODE,
      `Для позиции «${entry.name || entry.sku || entry.rowId || '?'}» ` +
      'количество PIECE должно быть целым числом; дробные значения не выгружаются поставщику.',
      { details: { row_id: entry.rowId, quantity: entry.quantity } }
    );
  }
  return {
    article: entry.sku ?? '',
    name: entry.name ?? '',
    barcode: entry.barcode,
    brand: entry.brand,
    quantity: entry.quantity,
    price: entry.price,
    amount: entry.amount,
  };
}

/**
 * Строит заказ поставщику из канонического финального состояния.
 * Блокируется при незавершённой ручной проверке и не создаёт
 * фиктивный файл для пустого заказа.
 */
function buildSupplierOrder({ items, supplier, generatedAt, state = null }) {
  const finalState = state || buildFinalOrderState({ items });
  if (!finalState.reviewComplete) {
    throw new SupplierOrderError(
      SUPPLIER_ORDER_BLOCKED_CODE,
      SUPPLIER_ORDER_BLOCKED_MESSAGE,
      { details: { pending_count: finalState.unresolvedCount } }
    );
  }
  if (finalState.includedItems.length === 0) {
    throw new SupplierOrderError(
      SUPPLIER_ORDER_EMPTY_CODE,
      'Заказ поставщику пуст: нет утверждённых позиций с количеством ' +
      'больше нуля.'
    );
  }

  const rows = finalState.includedItems.map(orderRowFromIncluded);
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
    totalAmount: finalState.totalAmount,
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
