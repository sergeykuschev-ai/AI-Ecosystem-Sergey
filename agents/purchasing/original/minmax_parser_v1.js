 const rows = $input.all().map((item, index) => ({
  rowNumber: index + 1,
  ...item.json,
}));
const detectedColumns = Array.from(
  new Set(
    rows.flatMap(row => Object.keys(row))
  )
);

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

  // Сначала ищем точное совпадение названия колонки
  const exact = keys.find(key => {
    const normalizedKey = normalize(key);
    return variants.some(variant => normalizedKey === normalize(variant));
  });

  if (exact) return exact;

  // Затем частичное совпадение
  return keys.find(key => {
    const normalizedKey = normalize(key);
    return variants.some(variant =>
      normalizedKey.includes(normalize(variant))
    );
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

function formatNumber(value) {
  const num = toNumber(value);
  if (num === null) return '';
  return Number.isInteger(num)
    ? String(num)
    : num.toFixed(2).replace('.', ',');
}

function formatRub(value) {
  const num = toNumber(value);
  if (num === null) return '';
  return `${Math.round(num).toLocaleString('ru-RU')} ₽`;
}

function isServiceOrCategoryName(name) {
  const text = normalize(name);

  if (!text) return true;

  const exactCategoryNames = new Set([
    'миска зоотовары',
    'зоотовары',
    'товары',
    'кошки',
    'собаки',
    'птицы',
    'грызуны',
    'рыбы',
    'аквариумистика',
    'корма',
    'лакомства',
    'наполнители',
    'игрушки',
    'амуниция',
    'одежда',
    'аксессуары',
    'ветеринария',
    'гигиена',
    'уход',
  ]);

  if (exactCategoryNames.has(text)) return true;

  const forbiddenFragments = [
    'итого',
    'всего',
    'общий итог',
    'подытог',
    'результат',
    'группа товаров',
    'категория товаров',
    'родительская категория',
  ];

  return forbiddenFragments.some(fragment => text.includes(fragment));
}

function isStrategic(name) {
  const text = normalize(name);

  return [
    'award',
    'craftia',
    'mnyams',
    'мнямс',
    'cat fedor',
    'кота федора',
    'galena',
    'япон',
    'tofu',
  ].some(fragment => text.includes(fragment));
}

function normalizeClass(value) {
  return clean(value)
    .toUpperCase()
    .replace(/\s/g, '')
    .replace(/\\/g, '/');
}

function isPriorityABC(abc, xyz) {
  const a = normalizeClass(abc);
  const x = normalizeClass(xyz);

  return a === 'A' && (x === 'X' || x === 'Y');
}

function isRiskyABC(abc, xyz) {
  const a = normalizeClass(abc);
  const x = normalizeClass(xyz);
  const combined = `${a}/${x}`;

  return (
    combined === 'D/D' ||
    combined === 'DD/ZZ' ||
    combined === 'C/Z' ||
    combined === 'D/Z' ||
    combined === 'D/Y'
  );
}

const prepared = rows
  .map(row => {
    const name = get(row, [
      'наименование',
      'номенклатура',
      'товар',
    ]);

    const article = get(row, [
      'артикул',
      'код товара',
      'код номенклатуры',
    ]);

    const supplier = get(row, [
      'основной поставщик',
      'поставщик',
    ]);

    const abc = get(row, ['abc']);
    const xyz = get(row, ['xyz']);

    const min = getNum(row, [
      'min',
      'минимальный остаток',
      'минимум',
    ]);

    const max = getNum(row, [
      'max',
      'максимальный остаток',
      'максимум',
    ]);

    const freeStock = getNum(row, [
      'свободный остаток',
      'свободно',
      'доступный остаток',
    ]);

    const stock = getNum(row, [
      'остаток',
      'текущий остаток',
      'конечный остаток',
    ]);

    const sales = getNum(row, [
      'продажи',
      'продано',
      'расход',
      'количество продаж',
    ]);

    const orderQty = getNum(row, [
      'заказать у поставщика',
      'заказать',
      'к заказу',
    ]);

    const priceNum = getNum(row, [
      'цена',
      'закупочная цена',
      'цена поставщика',
    ]);

    let sumNum = getNum(row, [
      'сумма',
      'сумма заказа',
    ]);

    if (
      (sumNum === null || sumNum === 0) &&
      priceNum !== null &&
      orderQty !== null &&
      orderQty > 0
    ) {
      sumNum = Math.round(priceNum * orderQty * 100) / 100;
    }

    const reserve = getNum(row, ['резерв']);
    const inTransit = getNum(row, ['в пути']);
    const multiplicity = getNum(row, [
      'кратность',
      'упаковка',
      'квант',
    ]);

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
      reserve,
      inTransit,
      multiplicity,
      strategic: isStrategic(name),
      priority: isPriorityABC(abc, xyz),
      risky: isRiskyABC(abc, xyz),
    };
  })
  .filter(row => {
    if (!row.name || row.name.length < 4) return false;
    if (isServiceOrCategoryName(row.name)) return false;
        // Исключаем агрегированные группы вида «Кошки (160)»,
    // «AWARD сухой для кошек (16)», «Лакомства (55)».
    const looksLikeGroup = /\(\d+\)\s*$/.test(row.name);

    if (looksLikeGroup && !row.abc && !row.xyz) {
      return false;
    }

    /*
     * Реальная товарная строка должна иметь хотя бы один
     * товарный признак: артикул или цену.
     * Категории обычно имеют итоговую сумму и количество,
     * но не имеют артикула и цены отдельного SKU.
     */
    const hasProductIdentity =
      Boolean(row.article) ||
      (row.priceNum !== null && row.priceNum > 0);

    return hasProductIdentity;
  });

/*
 * Удаляем дубли.
 * В первую очередь сравниваем по артикулу,
 * при его отсутствии — по наименованию и цене.
 */
const uniqueMap = new Map();

for (const row of prepared) {
  const key = row.article
    ? `article:${normalize(row.article)}`
    : `name:${normalize(row.name)}|price:${row.priceNum ?? ''}`;

  const existing = uniqueMap.get(key);

  if (!existing) {
    uniqueMap.set(key, row);
    continue;
  }

  /*
   * Если одна позиция продублировалась,
   * сохраняем строку с ненулевым количеством заказа.
   */
  if (
    (existing.orderQty === null || existing.orderQty <= 0) &&
    row.orderQty !== null &&
    row.orderQty > 0
  ) {
    uniqueMap.set(key, row);
  }
}

const productRows = Array.from(uniqueMap.values());

const orderRows = productRows
  .filter(row => row.orderQty !== null && row.orderQty > 0)
  .sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    if (a.strategic !== b.strategic) return a.strategic ? -1 : 1;
    return (b.sumNum || 0) - (a.sumNum || 0);
  });

const zeroStockRows = productRows.filter(row => {
  const available =
    row.freeStock !== null ? row.freeStock : row.stock;

  return available !== null && available <= 0;
});

const riskyRows = orderRows.filter(row => row.risky);

const expensiveRows = orderRows
  .slice()
  .sort((a, b) => (b.sumNum || 0) - (a.sumNum || 0))
  .slice(0, 15);

const totalOrderSum = orderRows.reduce(
  (acc, row) => acc + (row.sumNum || 0),
  0
);

const deliveryThreshold = 70000;
const missingToFreeDelivery = Math.max(
  0,
  deliveryThreshold - totalOrderSum
);

function addField(parts, title, value, formatter = String) {
  if (value === null || value === undefined || value === '') return;
  parts.push(`${title}: ${formatter(value)}`);
}

function formatProduct(row) {
  const parts = [
    `Строка: ${row.rowNumber}`,
    `Товар: ${row.name}`,
  ];

  addField(parts, 'Артикул', row.article);
  addField(parts, 'Поставщик', row.supplier);
  addField(parts, 'ABC', row.abc);
  addField(parts, 'XYZ', row.xyz);
  addField(parts, 'Свободный остаток', row.freeStock, formatNumber);
  addField(parts, 'Остаток', row.stock, formatNumber);
  addField(parts, 'Продажи', row.sales, formatNumber);
  addField(parts, 'MIN', row.min, formatNumber);
  addField(parts, 'MAX', row.max, formatNumber);
  addField(parts, 'Резерв', row.reserve, formatNumber);
  addField(parts, 'В пути', row.inTransit, formatNumber);
  addField(parts, 'Кратность', row.multiplicity, formatNumber);
  addField(parts, 'Количество Min-Max', row.orderQty, formatNumber);
  addField(parts, 'Цена', row.priceNum, formatRub);
  addField(parts, 'Сумма Min-Max', row.sumNum, formatRub);

  if (row.strategic) parts.push('Признак: стратегическая позиция');
  if (row.priority) parts.push('Признак: приоритет A/X или A/Y');
  if (row.risky) parts.push('Признак: рискованная ABC/XYZ-группа');

  return parts.join(' | ');
}

function addSection(lines, title, data, limit = null) {
  lines.push('');
  lines.push(`## ${title}`);
  lines.push(`Количество позиций: ${data.length}`);

  if (data.length === 0) {
    lines.push('Не найдено.');
    return;
  }

  const selected = limit ? data.slice(0, limit) : data;

  selected.forEach((row, index) => {
    lines.push(`${index + 1}. ${formatProduct(row)}`);
  });

  if (limit && data.length > selected.length) {
    lines.push(
      `Остальные ${data.length - selected.length} позиций в этом контрольном разделе не показаны.`
    );
  }
}

const lines = [];

lines.push('# ДАННЫЕ ИЗ ОТЧЁТА MIN-MAX ВАЛТЫ');
lines.push('');
lines.push(`Всего строк в исходном отчёте: ${rows.length}`);
lines.push(`Реальных товарных SKU после очистки: ${productRows.length}`);
lines.push(`Позиций с количеством Min-Max к заказу: ${orderRows.length}`);
lines.push(
  `Предварительная сумма Min-Max: ${Math.round(totalOrderSum).toLocaleString('ru-RU')} ₽`
);

if (totalOrderSum >= deliveryThreshold) {
  lines.push('Порог бесплатной доставки Валты достигнут.');
} else {
  lines.push(
    `До бесплатной доставки не хватает: ${Math.round(missingToFreeDelivery).toLocaleString('ru-RU')} ₽`
  );
}

lines.push('');
lines.push('ВАЖНО:');
lines.push('- Категории, группы, итоги и технические строки исключены.');
lines.push('- Ниже передан полный список реальных SKU с количеством Min-Max к заказу.');
lines.push('- Количество Min-Max не является окончательным решением.');
lines.push('- Агент обязан рассчитать рекомендуемое количество отдельно по каждой позиции.');
lines.push('- Запрещено придумывать отсутствующие остатки, продажи, цены или показатели.');

addSection(
  lines,
  'ПОЛНЫЙ СПИСОК ТОВАРОВ С КОЛИЧЕСТВОМ MIN-MAX К ЗАКАЗУ',
  orderRows
);

addSection(
  lines,
  'Контроль: товары с нулевым свободным или фактическим остатком',
  zeroStockRows
);

addSection(
  lines,
  'Контроль: самые дорогие позиции заказа',
  expensiveRows,
  15
);

addSection(
  lines,
  'Контроль: рискованные D/D, DD/ZZ, C/Z, D/Z и D/Y',
  riskyRows
);

lines.push('');
lines.push('## Обязательная задача агенту');
lines.push('1. Проанализируй каждую переданную товарную позицию.');
lines.push('2. Не используй суммы и количества агрегированных категорий.');
lines.push('3. Не восстанавливай Min-Max механически.');
lines.push('4. Сохраняй A/X, A/Y и стратегические товары при наличии подтверждающих данных.');
lines.push('5. Отдельно проверь все позиции с нулевым остатком.');
lines.push('6. Медленные и рискованные позиции сокращай только с объяснением.');
lines.push('7. Учитывай резерв, товары в пути и кратность упаковки.');
lines.push('8. Итоговая сумма должна укладываться в безопасный финансовый лимит.');
lines.push('9. По каждой позиции укажи исходное количество Min-Max и рекомендуемое количество.');
lines.push('10. Если для решения не хватает данных — не выдумывай их, а отметь позицию для ручной проверки.');

return [
  {
    json: {
      minmax_text: lines.join('\n'),
      source_rows_count: rows.length,
      product_rows_count: productRows.length,
      order_rows_count: orderRows.length,
      zero_stock_rows_count: zeroStockRows.length,
      preliminary_order_sum: Math.round(totalOrderSum),
      detected_columns: detectedColumns,
    },
  },
];