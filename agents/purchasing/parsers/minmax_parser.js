function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/ё/g, 'е');
}

function validateGrouping(integerPart, separator) {
  const groups = integerPart.split(separator);
  for (let i = 0; i < groups.length; i += 1) {
    if (!/^\d+$/.test(groups[i])) return false;
    if (i === 0) {
      if (groups[i].length === 0 || groups[i].length > 3) return false;
    } else if (groups[i].length !== 3) {
      return false;
    }
  }
  return true;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let text = String(value).trim();
  if (text === '') return null;

  let negative = false;
  if (text.charAt(0) === '-') {
    negative = true;
    text = text.slice(1).trim();
  } else if (text.charAt(0) === '+') {
    text = text.slice(1).trim();
  }

  if (text === '') return null;

  // Treat spaces between digits as thousands separators and remove them.
  text = text.replace(/(\d)\s+(?=\d)/g, '$1');

  // After handling spaces, only digits and the two separator candidates remain.
  if (!/^[\d.,]+$/.test(text)) return null;

  const commaCount = (text.match(/,/g) || []).length;
  const dotCount = (text.match(/\./g) || []).length;

  let normalized = text;

  if (commaCount > 0 && dotCount > 0) {
    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');

    if (lastComma > lastDot) {
      // Comma is the decimal separator; dots must form valid thousands groups.
      if (!validateGrouping(text.slice(0, lastComma), '.')) return null;
      normalized = text.replace(/\./g, '').replace(',', '.');
    } else {
      // Dot is the decimal separator; commas must form valid thousands groups.
      if (!validateGrouping(text.slice(0, lastDot), ',')) return null;
      normalized = text.replace(/,/g, '');
    }
  } else if (commaCount > 0) {
    if (commaCount > 1) return null;

    const idx = text.indexOf(',');
    if (text.length - idx - 1 === 3) return null;

    normalized = text.replace(',', '.');
  } else if (dotCount > 0) {
    if (dotCount > 1) return null;

    const idx = text.indexOf('.');
    if (text.length - idx - 1 === 3) return null;
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;

  return negative ? -num : num;
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
