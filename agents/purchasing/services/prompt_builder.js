const { toNumber } = require('../parsers/minmax_parser');
const { DELIVERY_THRESHOLD } = require('../rules/supplier_rules');

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
  addField(parts, 'Дней запаса', row.stockDays, formatNumber);
  addField(parts, 'Остаток', row.stock, formatNumber);
  addField(parts, 'Продажи', row.sales, formatNumber);
  if (row.schemaVersion === 'smartzapas-row-v1') {
    addField(parts, 'MIN авто', row.autoMin, formatNumber);
    addField(parts, 'MIN ручной', row.manualMin, formatNumber);
  } else {
    addField(parts, 'MIN', row.min, formatNumber);
  }
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

function buildMinmaxText(rows, analysis, options = {}) {
  const {
    productRows,
    orderRows,
    zeroStockRows,
    riskyRows,
    expensiveRows,
    totalOrderSum,
    missingToFreeDelivery,
  } = analysis;
  const sourceRowsCount = options.sourceRowsCount ?? rows.length;
  const lines = [];

  lines.push('# ДАННЫЕ ИЗ ОТЧЁТА MIN-MAX ВАЛТЫ');
  lines.push('');
  lines.push(`Всего строк в исходном отчёте: ${sourceRowsCount}`);
  lines.push(`Реальных товарных SKU после очистки: ${productRows.length}`);
  lines.push(`Позиций с количеством Min-Max к заказу: ${orderRows.length}`);
  lines.push(
    `Предварительная сумма Min-Max: ${Math.round(totalOrderSum).toLocaleString('ru-RU')} ₽`
  );

  if (totalOrderSum >= DELIVERY_THRESHOLD) {
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

  return lines.join('\n');
}

module.exports = {
  formatNumber,
  formatRub,
  addField,
  formatProduct,
  addSection,
  buildMinmaxText,
};
