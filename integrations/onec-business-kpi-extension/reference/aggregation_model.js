'use strict';

const STORE_CODES = new Map([
  ['Ампер', 'amper'],
  ['Вентиль', 'ventil'],
  ['Метиз маркет', 'metiz-market'],
  ['Миска', 'miska'],
]);

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function emptyRecord(storeCode, businessDate, sourceUpdatedAt) {
  return {
    recordId: `${storeCode}:${businessDate}`,
    storeCode,
    businessDate,
    sourceUpdatedAt,
    cash: 0,
    acquiring: 0,
    qr: 0,
    b2b: 0,
    b2bOrders: 0,
    receipts: 0,
    itemsSold: 0,
    retailSales: 0,
    retailReturns: 0,
    cashReturns: 0,
    cardReturns: 0,
    qrReturns: 0,
    returnReceipts: 0,
    cashiers: [],
    sourceDocuments: [],
    organizationRefs: [],
  };
}

function aggregateDay({
  businessDate,
  sourceInstance,
  sourceUpdatedAt,
  documents,
  requestedStoreCodes = [...STORE_CODES.values()],
}) {
  const records = new Map(requestedStoreCodes.map(code => [
    code,
    emptyRecord(code, businessDate, sourceUpdatedAt),
  ]));
  const cashierMaps = new Map(requestedStoreCodes.map(code => [code, new Map()]));
  const organizationSets = new Map(requestedStoreCodes.map(code => [code, new Set()]));

  for (const document of documents) {
    if (!document.posted || document.businessDate !== businessDate) continue;
    const storeCode = STORE_CODES.get(document.storeName);
    if (!storeCode || !records.has(storeCode)) continue;
    if (!['retail_sale', 'retail_return', 'b2b_shipment'].includes(document.type)) continue;

    const record = records.get(storeCode);
    const cash = roundMoney(document.cash);
    const card = roundMoney(document.card);
    const qr = roundMoney(document.qr);
    const amount = roundMoney(document.amount ?? cash + card + qr);
    const items = Number(document.items) || 0;

    if (document.type === 'retail_sale') {
      record.cash += cash;
      record.acquiring += card + qr;
      record.qr += qr;
      record.retailSales += cash + card + qr;
      record.receipts += 1;
      record.itemsSold += items;
      if (document.cashierRef) {
        const cashiers = cashierMaps.get(storeCode);
        const cashier = cashiers.get(document.cashierRef) || {
          ref: document.cashierRef,
          code: document.cashierCode || null,
          name: document.cashierName || 'Кассир не указан',
          receipts: 0,
          itemsSold: 0,
        };
        cashier.receipts += 1;
        cashier.itemsSold += items;
        cashiers.set(document.cashierRef, cashier);
      }
    } else if (document.type === 'retail_return') {
      record.cash -= cash;
      record.acquiring -= card + qr;
      record.qr -= qr;
      record.retailReturns += cash + card + qr;
      record.cashReturns += cash;
      record.cardReturns += card;
      record.qrReturns += qr;
      record.returnReceipts += 1;
      record.itemsSold -= items;
    } else {
      record.b2b += amount;
      record.b2bOrders += 1;
      record.itemsSold += items;
    }

    if (document.organizationRef) {
      organizationSets.get(storeCode).add(document.organizationRef);
    }
    record.sourceDocuments.push({
      type: document.type,
      ref: document.ref,
      number: document.number || null,
      postedAt: document.postedAt,
      updatedAt: document.updatedAt,
      warehouseRef: document.warehouseRef || null,
      organizationRef: document.organizationRef || null,
      cashierRef: document.cashierRef || null,
    });
    if (new Date(document.updatedAt) > new Date(record.sourceUpdatedAt)) {
      record.sourceUpdatedAt = document.updatedAt;
    }
  }

  return [...records.entries()].map(([storeCode, record]) => ({
    ...record,
    cash: roundMoney(record.cash),
    acquiring: roundMoney(record.acquiring),
    qr: roundMoney(record.qr),
    b2b: roundMoney(record.b2b),
    retailSales: roundMoney(record.retailSales),
    retailReturns: roundMoney(record.retailReturns),
    cashReturns: roundMoney(record.cashReturns),
    cardReturns: roundMoney(record.cardReturns),
    qrReturns: roundMoney(record.qrReturns),
    cashiers: [...cashierMaps.get(storeCode).values()],
    organizationRefs: [...organizationSets.get(storeCode)],
  }));
}

function nextRetryDelaySeconds(attempt) {
  return Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)));
}

module.exports = { STORE_CODES, aggregateDay, nextRetryDelaySeconds };
