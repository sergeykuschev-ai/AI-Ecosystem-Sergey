'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  canonicalSupplierName,
} = require('../../../agents/purchasing/services/demand_engine');

const LEDGER_SCHEMA_VERSION = 'miska-purchase-ledger-v1';
const DEFAULT_TIME_ZONE = 'Asia/Vladivostok';
const ORDER_STATUSES = Object.freeze([
  'DRAFT',
  'ORDERED',
  'IN_TRANSIT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
]);
const ACTIVE_ORDER_STATUSES = new Set([
  'ORDERED',
  'IN_TRANSIT',
  'PARTIALLY_RECEIVED',
]);
const PURCHASED_ORDER_STATUSES = new Set([
  'ORDERED',
  'IN_TRANSIT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
]);
const STATUS_TRANSITIONS = Object.freeze({
  DRAFT: new Set(['ORDERED', 'CANCELLED']),
  ORDERED: new Set(['IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']),
  IN_TRANSIT: new Set(['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']),
  PARTIALLY_RECEIVED: new Set(['RECEIVED', 'CANCELLED']),
  RECEIVED: new Set([]),
  CANCELLED: new Set([]),
});

class PurchaseLedgerError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'PurchaseLedgerError';
    this.code = code;
  }
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function finiteNonNegative(value, field) {
  const number = Number(value);
  const numericInput = typeof value === 'number' ||
    (typeof value === 'string' && value.trim() !== '');
  if (!numericInput || !Number.isFinite(number) || number < 0 ||
      !Number.isFinite(roundMoney(number))) {
    throw new PurchaseLedgerError(
      'PURCHASE_LEDGER_INVALID_INPUT',
      `${field} должен быть неотрицательным числом.`
    );
  }
  return roundMoney(number);
}

function validIso(value, field = 'date') {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new PurchaseLedgerError(
      'PURCHASE_LEDGER_INVALID_INPUT',
      `${field} должен быть ISO-датой.`
    );
  }
  return new Date(Date.parse(value)).toISOString();
}

function emptyLedger() {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    updatedAt: null,
    months: {},
    orders: [],
  };
}

function monthKey(value, timeZone = DEFAULT_TIME_ZONE) {
  const iso = validIso(value, 'Дата периода');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(iso));
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  if (!year || !month) {
    throw new PurchaseLedgerError(
      'PURCHASE_LEDGER_INVALID_INPUT',
      'Не удалось определить месяц закупки.'
    );
  }
  return `${year}-${month}`;
}

function stableRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => ({
    article: String(row?.article ?? '').trim(),
    name: String(row?.name ?? '').trim(),
    quantity: Number(row?.quantity ?? 0),
    price: Number(row?.price ?? 0),
    amount: Number(row?.amount ?? 0),
    barcode: row?.barcode == null ? null : String(row.barcode).trim() || null,
    brand: row?.brand == null ? null : String(row.brand).trim() || null,
  }));
}

function orderTimelineDate(order) {
  return order?.orderedAt || order?.preparedAt || order?.updatedAt || null;
}

function orderFingerprint(supplier, rows) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({
      supplier: canonicalSupplierName(supplier || ''),
      rows: stableRows(rows).map(row => [
        row.article,
        row.name,
        row.quantity,
        row.price,
        row.amount,
      ]),
    }), 'utf8')
    .digest('hex');
}

function validateLedger(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PurchaseLedgerError(
      'PURCHASE_LEDGER_CORRUPTED',
      'Реестр закупок должен быть объектом.'
    );
  }
  if (value.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    throw new PurchaseLedgerError(
      'PURCHASE_LEDGER_CORRUPTED',
      'Реестр закупок имеет неподдерживаемую версию.'
    );
  }
  if (!value.months || typeof value.months !== 'object' || Array.isArray(value.months)) {
    throw new PurchaseLedgerError(
      'PURCHASE_LEDGER_CORRUPTED',
      'Раздел месяцев реестра закупок повреждён.'
    );
  }
  if (!Array.isArray(value.orders)) {
    throw new PurchaseLedgerError(
      'PURCHASE_LEDGER_CORRUPTED',
      'Раздел заказов реестра закупок повреждён.'
    );
  }
  return value;
}

class PurchaseLedgerService {
  constructor(options = {}) {
    if (typeof options.filePath !== 'string' || options.filePath.trim() === '') {
      throw new TypeError('Purchase ledger filePath обязателен.');
    }
    this.filePath = path.resolve(options.filePath);
    this.fs = options.fsModule || fs;
    this.now = options.now || (() => new Date().toISOString());
    this.timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  }

  load() {
    try {
      return validateLedger(JSON.parse(this.fs.readFileSync(this.filePath, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return emptyLedger();
      if (error instanceof PurchaseLedgerError) throw error;
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_CORRUPTED',
        'Реестр закупок повреждён и не был перезаписан.',
        { cause: error }
      );
    }
  }

  save(ledger) {
    const validated = validateLedger(ledger);
    const directory = path.dirname(this.filePath);
    this.fs.mkdirSync(directory, { recursive: true });
    const suffix = crypto.randomBytes(6).toString('hex');
    const temporary = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}-${suffix}.tmp`
    );
    const content = `${JSON.stringify(validated, null, 2)}\n`;
    try {
      this.fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
      this.fs.renameSync(temporary, this.filePath);
    } catch (error) {
      try { this.fs.rmSync(temporary, { force: true }); } catch {}
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_WRITE_FAILED',
        'Не удалось сохранить реестр закупок.',
        { cause: error }
      );
    }
    return validated;
  }

  configureMonth({ limit, purchased, at = this.now() } = {}) {
    const when = validIso(at, 'Дата обновления бюджета');
    const key = monthKey(when, this.timeZone);
    const ledger = this.load();
    const previous = ledger.months[key] || {};
    const next = {
      limit: limit === undefined || limit === null
        ? (previous.limit ?? null)
        : finiteNonNegative(limit, 'Месячный лимит'),
      baselinePurchased: purchased === undefined || purchased === null
        ? (previous.baselinePurchased ?? 0)
        : finiteNonNegative(purchased, 'Уже закуплено'),
      baselineAt: purchased === undefined || purchased === null
        ? (previous.baselineAt ?? null)
        : when,
      updatedAt: when,
    };
    ledger.months[key] = next;
    ledger.updatedAt = when;
    this.save(ledger);
    return this.getMonthSummary(when);
  }

  getMonthSummary(at = this.now()) {
    const when = validIso(at, 'Дата бюджета');
    const key = monthKey(when, this.timeZone);
    const ledger = this.load();
    const config = ledger.months[key] || null;
    const baselinePurchased = config?.baselinePurchased ?? 0;
    const baselineAt = config?.baselineAt || null;
    let ledgerInvoiceAmount = 0;
    let ledgerReservedAmount = 0;
    let orderCount = 0;
    let activeOrderCount = 0;
    for (const order of ledger.orders) {
      if (!order || !PURCHASED_ORDER_STATUSES.has(order.status)) continue;
      if (!order.orderedAt || monthKey(order.orderedAt, this.timeZone) !== key) continue;
      if (ACTIVE_ORDER_STATUSES.has(order.status)) activeOrderCount += 1;
      if (Number.isFinite(Number(order.invoiceAmount))) {
        const invoiceAt = order.invoiceUpdatedAt || order.orderedAt;
        if (!baselineAt || Date.parse(invoiceAt) > Date.parse(baselineAt)) {
          ledgerInvoiceAmount = roundMoney(
            ledgerInvoiceAmount + Number(order.invoiceAmount)
          );
        }
      } else {
        // A manual baseline is actual purchases from accounting. An order
        // without a supplier invoice is not part of that fact yet, so keep
        // its reserve even when the order predates the refreshed baseline.
        ledgerReservedAmount = roundMoney(
          ledgerReservedAmount + Number(order.totalAmount || 0)
        );
      }
      orderCount += 1;
    }
    const actualPurchased = roundMoney(
      baselinePurchased + ledgerInvoiceAmount
    );
    const committed = roundMoney(
      actualPurchased + ledgerReservedAmount
    );
    const limit = config?.limit ?? null;
    return {
      month: key,
      timeZone: this.timeZone,
      limit,
      baselinePurchased: roundMoney(baselinePurchased),
      baselineAt,
      ledgerInvoiceAmount,
      ledgerReservedAmount,
      // Backward-compatible alias: amount currently consuming the monthly limit.
      ledgerOrdersPurchased: roundMoney(
        ledgerInvoiceAmount + ledgerReservedAmount
      ),
      actualPurchased,
      committed,
      // Keep purchased as the safe amount used by the ordering engine.
      purchased: committed,
      remaining: limit === null ? null : roundMoney(limit - committed),
      orderCount,
      activeOrderCount,
      updatedAt: config?.updatedAt ?? ledger.updatedAt ?? null,
    };
  }

  resolveFinancialOverrides(inputOverrides, at = this.now()) {
    const hasLimit = inputOverrides?.monthly_purchase_limit !== undefined &&
      inputOverrides?.monthly_purchase_limit !== null;
    const hasPurchased = inputOverrides?.purchased_this_month !== undefined &&
      inputOverrides?.purchased_this_month !== null;
    if (hasLimit !== hasPurchased) {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_INVALID_INPUT',
        'Месячный лимит и уже закупленная сумма должны передаваться вместе.'
      );
    }
    if (hasLimit) {
      this.configureMonth({
        limit: inputOverrides.monthly_purchase_limit,
        purchased: inputOverrides.purchased_this_month,
        at,
      });
    }
    const summary = this.getMonthSummary(at);
    if (summary.limit === null) return inputOverrides || null;
    return {
      ...(inputOverrides || {}),
      monthly_purchase_limit: summary.limit,
      purchased_this_month: summary.purchased,
    };
  }

  recordOrder({
    runId,
    supplier,
    order,
    orderedAt = this.now(),
    initialStatus = 'ORDERED',
  } = {}) {
    if (typeof runId !== 'string' || runId.trim() === '') {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_INVALID_INPUT',
        'runId заказа обязателен.'
      );
    }
    const requestedStatus = String(initialStatus || 'ORDERED').trim().toUpperCase();
    if (!['DRAFT', 'ORDERED'].includes(requestedStatus)) {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_INVALID_INPUT',
        'Начальный статус заказа должен быть DRAFT или ORDERED.'
      );
    }
    const when = validIso(
      orderedAt,
      requestedStatus === 'DRAFT' ? 'Дата подготовки заказа' : 'Дата заказа'
    );
    const rows = stableRows(order?.rows);
    if (rows.length === 0) {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_INVALID_INPUT',
        'Нельзя записать пустой заказ.'
      );
    }
    const totalAmount = finiteNonNegative(order?.totalAmount, 'Сумма заказа');
    const fingerprint = orderFingerprint(supplier, rows);
    const ledger = this.load();
    const existingIndex = ledger.orders.findIndex(entry => entry?.runId === runId);
    const existing = existingIndex >= 0 ? ledger.orders[existingIndex] : null;
    const changed = !existing || existing.fingerprint !== fingerprint ||
      existing.totalAmount !== totalAmount;
    if (existing && existing.status !== 'DRAFT' && changed) {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_ORDER_CONFLICT',
        'Уже подтверждённый или завершённый заказ нельзя молча переписать. ' +
          'Создайте новый расчёт для изменённого заказа.'
      );
    }
    const status = existing?.status || requestedStatus;
    const record = {
      // Re-export may update only a draft. Confirmed lifecycle facts stay immutable.
      ...existing,
      orderId: existing?.orderId || `purchase-order-${crypto.createHash('sha256')
        .update(`${runId}|${fingerprint}`, 'utf8')
        .digest('hex')
        .slice(0, 24)}`,
      runId,
      supplier: supplier || null,
      canonicalSupplier: canonicalSupplierName(supplier || ''),
      status,
      preparedAt: existing?.preparedAt || when,
      orderedAt: existing?.orderedAt || (status === 'ORDERED' ? when : null),
      updatedAt: when,
      totalAmount,
      itemCount: rows.length,
      fingerprint,
      items: rows,
    };
    if (existingIndex >= 0) ledger.orders[existingIndex] = record;
    else ledger.orders.push(record);
    ledger.updatedAt = when;
    this.save(ledger);
    return {
      created: existingIndex < 0,
      changed,
      order: structuredClone(record),
      month: this.getMonthSummary(when),
    };
  }

  setInvoiceAmount(orderId, amount, at = this.now()) {
    const invoiceAmount = finiteNonNegative(amount, 'Сумма итогового счёта');
    const when = validIso(at, 'Дата счёта');
    const ledger = this.load();
    const index = ledger.orders.findIndex(order => order?.orderId === orderId);
    if (index < 0) {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_ORDER_NOT_FOUND',
        'Заказ в реестре не найден.'
      );
    }
    if (ledger.orders[index].status === 'DRAFT') {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_STATUS_CONFLICT',
        'Счёт нельзя привязать к неподтверждённому заказу.'
      );
    }
    if (ledger.orders[index].status === 'CANCELLED') {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_STATUS_CONFLICT',
        'Счёт нельзя привязать к отменённому заказу.'
      );
    }
    ledger.orders[index] = {
      ...ledger.orders[index],
      invoiceAmount,
      invoiceUpdatedAt: when,
      updatedAt: when,
    };
    ledger.updatedAt = when;
    this.save(ledger);
    return {
      order: structuredClone(ledger.orders[index]),
      month: this.getMonthSummary(orderTimelineDate(ledger.orders[index])),
    };
  }

  listOrders({ month = null, status = null } = {}) {
    const ledger = this.load();
    return ledger.orders
      .filter(order => {
        if (!month) return true;
        const timelineDate = orderTimelineDate(order);
        return timelineDate && monthKey(timelineDate, this.timeZone) === month;
      })
      .filter(order => !status || order.status === status)
      .map(order => structuredClone(order))
      .sort((a, b) =>
        Date.parse(orderTimelineDate(b) || 0) - Date.parse(orderTimelineDate(a) || 0)
      );
  }

  getOrder(orderId) {
    const order = this.load().orders.find(entry => entry?.orderId === orderId);
    return order ? structuredClone(order) : null;
  }

  assertDraftMatchesCurrent(orderId, { supplier, order } = {}) {
    const current = this.getOrder(orderId);
    if (!current) {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_ORDER_NOT_FOUND',
        'Заказ в реестре не найден.'
      );
    }
    if (current.status !== 'DRAFT') return current;
    const rows = stableRows(order?.rows);
    const totalAmount = finiteNonNegative(order?.totalAmount, 'Сумма заказа');
    const fingerprint = orderFingerprint(supplier || current.supplier, rows);
    if (fingerprint !== current.fingerprint || totalAmount !== current.totalAmount) {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_STALE_DRAFT',
        'Подготовленный Excel устарел: после его скачивания состав или сумма ' +
          'заказа изменились. Скачайте актуальный заказ перед отправкой.'
      );
    }
    return current;
  }

  changeOrderStatus(orderId, targetStatus, at = this.now()) {
    const status = String(targetStatus || '').trim().toUpperCase();
    if (!ORDER_STATUSES.includes(status)) {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_INVALID_INPUT',
        'Неизвестный статус заказа.'
      );
    }
    const when = validIso(at, 'Дата изменения статуса');
    const ledger = this.load();
    const index = ledger.orders.findIndex(order => order?.orderId === orderId);
    if (index < 0) {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_ORDER_NOT_FOUND',
        'Заказ в реестре не найден.'
      );
    }
    const current = ledger.orders[index];
    if (current.status === status) return structuredClone(current);
    if (!STATUS_TRANSITIONS[current.status]?.has(status)) {
      throw new PurchaseLedgerError(
        'PURCHASE_LEDGER_STATUS_CONFLICT',
        `Переход ${current.status} → ${status} запрещён.`
      );
    }
    if (current.status === 'DRAFT' && status === 'ORDERED') {
      const duplicateRisk = this.findDuplicateRisk({
        runId: current.runId,
        supplier: current.supplier,
        order: { rows: current.items },
        asOf: when,
      });
      if (duplicateRisk.exactDuplicate) {
        throw new PurchaseLedgerError(
          'PURCHASE_LEDGER_DUPLICATE_CONFIRMATION',
          'Подтверждение заблокировано: после подготовки файла уже появился ' +
            'идентичный активный заказ. Обновите расчёт перед отправкой.'
        );
      }
    }
    ledger.orders[index] = {
      ...current,
      status,
      updatedAt: when,
      ...(current.status === 'DRAFT' && status === 'ORDERED'
        ? { orderedAt: when }
        : {}),
      ...(status === 'RECEIVED' ? { receivedAt: when } : {}),
      ...(status === 'CANCELLED' ? { cancelledAt: when } : {}),
    };
    ledger.updatedAt = when;
    this.save(ledger);
    return structuredClone(ledger.orders[index]);
  }

  findDuplicateRisk({ runId, supplier, order, asOf = this.now(), windowDays = 7 } = {}) {
    const when = validIso(asOf, 'Дата проверки дубля');
    const fingerprint = orderFingerprint(supplier, order?.rows);
    const canonicalSupplier = canonicalSupplierName(supplier || '');
    const cutoff = Date.parse(when) - (Number(windowDays) * 24 * 60 * 60 * 1000);
    const active = this.load().orders.filter(previous =>
      previous?.runId !== runId &&
      ACTIVE_ORDER_STATUSES.has(previous?.status) &&
      previous?.canonicalSupplier === canonicalSupplier &&
      Date.parse(previous?.orderedAt) >= cutoff
    );
    const exact = active.find(previous => previous.fingerprint === fingerprint) || null;
    const activeByArticle = new Map();
    for (const previous of active) {
      for (const item of previous.items || []) {
        if (!item.article) continue;
        const entry = activeByArticle.get(item.article) || {
          article: item.article,
          quantity: 0,
          orderIds: new Set(),
        };
        entry.quantity += Number(item.quantity || 0);
        entry.orderIds.add(previous.orderId);
        activeByArticle.set(item.article, entry);
      }
    }
    const overlaps = [];
    for (const row of stableRows(order?.rows)) {
      const previous = activeByArticle.get(row.article);
      if (!previous) continue;
      overlaps.push({
        article: row.article,
        name: row.name,
        proposedQuantity: row.quantity,
        activeOrderedQuantity: previous.quantity,
        orderIds: Array.from(previous.orderIds),
      });
    }
    return {
      exactDuplicate: exact ? {
        orderId: exact.orderId,
        runId: exact.runId,
        orderedAt: exact.orderedAt,
        totalAmount: exact.totalAmount,
      } : null,
      overlapCount: overlaps.length,
      overlaps,
      activeOrdersChecked: active.length,
      windowDays,
    };
  }
}

module.exports = {
  ACTIVE_ORDER_STATUSES,
  DEFAULT_TIME_ZONE,
  LEDGER_SCHEMA_VERSION,
  ORDER_STATUSES,
  PURCHASED_ORDER_STATUSES,
  PurchaseLedgerError,
  PurchaseLedgerService,
  emptyLedger,
  monthKey,
  orderFingerprint,
  roundMoney,
};
