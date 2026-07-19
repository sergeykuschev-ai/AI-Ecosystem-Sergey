function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/ё/g, 'е');
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;

  const text = String(value)
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');

  if (text === '' || text === '-' || text === '.') return null;

  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function findKey(row, variants) {
  const keys = Object.keys(row);
  const exact = keys.find(key => {
    const normalizedKey = normalize(key);
    return variants.some(variant => normalizedKey === normalize(variant));
  });

  if (exact) return exact;

  return keys.find(key => {
    const normalizedKey = normalize(key);
    return variants.some(variant => normalizedKey.includes(normalize(variant)));
  });
}

function get(row, variants) {
  const key = findKey(row, variants);
  return key ? clean(row[key]) : '';
}

function getNum(row, variants) {
  const key = findKey(row, variants);
  return key ? toNumber(row[key]) : null;
}

function parseInputRows(items) {
  return items.map((item, index) => ({
    rowNumber: index + 1,
    ...item.json,
  }));
}

function detectColumns(rows) {
  return Array.from(new Set(rows.flatMap(row => Object.keys(row))));
}

function applyOrderSumFallback(row) {
  const parsed = { ...row };

  if (
    (parsed.sumNum === null || parsed.sumNum === 0) &&
    parsed.priceNum !== null &&
    parsed.orderQty !== null &&
    parsed.orderQty > 0
  ) {
    parsed.sumNum = Math.round(parsed.priceNum * parsed.orderQty * 100) / 100;
  }

  return parsed;
}

function parseNormalizedRow(row) {
  if (typeof row.rowIdentity !== 'string' || !row.rowIdentity) {
    throw new TypeError('Normalized SmartZapas row requires rowIdentity.');
  }
  if (!Number.isInteger(row.rowNumber) || typeof row.name !== 'string' || !row.name) {
    throw new TypeError('Normalized SmartZapas row has invalid source metadata.');
  }

  const numericFields = ['freeStock', 'stockDays', 'orderQty', 'priceNum', 'sumNum'];
  for (const field of numericFields) {
    if (row[field] !== null && row[field] !== undefined && typeof row[field] !== 'number') {
      throw new TypeError(`Normalized SmartZapas row has invalid numeric field ${field}.`);
    }
  }

  return applyOrderSumFallback({ ...row });
}

function parseRow(row) {
  if (row && row.schemaVersion === 'smartzapas-row-v1') {
    return parseNormalizedRow(row);
  }

  const name = get(row, ['наименование', 'номенклатура', 'товар']);
  const article = get(row, ['артикул', 'код товара', 'код номенклатуры']);
  const supplier = get(row, ['основной поставщик', 'поставщик']);
  const abc = get(row, ['abc']);
  const xyz = get(row, ['xyz']);
  const min = getNum(row, ['min', 'минимальный остаток', 'минимум']);
  const max = getNum(row, ['max', 'максимальный остаток', 'максимум']);
  const freeStock = getNum(row, ['свободный остаток', 'свободно', 'доступный остаток']);
  const stock = getNum(row, ['остаток', 'текущий остаток', 'конечный остаток']);
  const sales = getNum(row, ['продажи', 'продано', 'расход', 'количество продаж']);
  const orderQty = getNum(row, ['заказать у поставщика', 'заказать', 'к заказу']);
  const priceNum = getNum(row, ['цена', 'закупочная цена', 'цена поставщика']);
  let sumNum = getNum(row, ['сумма', 'сумма заказа']);

  return applyOrderSumFallback({
    rowNumber: row.rowNumber,
    name,
    article,
    supplier,
    abc,
    xyz,
    min,
    max,
    freeStock,
    stock,
    sales,
    orderQty,
    priceNum,
    sumNum,
    reserve: getNum(row, ['резерв']),
    inTransit: getNum(row, ['в пути']),
    multiplicity: getNum(row, ['кратность', 'упаковка', 'квант']),
  });
}

module.exports = {
  clean,
  normalize,
  toNumber,
  findKey,
  get,
  getNum,
  parseInputRows,
  detectColumns,
  applyOrderSumFallback,
  parseNormalizedRow,
  parseRow,
};
