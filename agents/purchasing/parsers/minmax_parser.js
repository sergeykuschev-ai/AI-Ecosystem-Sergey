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

function parseRow(row) {
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

  if (
    (sumNum === null || sumNum === 0) &&
    priceNum !== null &&
    orderQty !== null &&
    orderQty > 0
  ) {
    sumNum = Math.round(priceNum * orderQty * 100) / 100;
  }

  return {
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
  };
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
  parseRow,
};
