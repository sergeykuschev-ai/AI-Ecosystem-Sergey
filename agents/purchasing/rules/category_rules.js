const { normalize } = require('../parsers/minmax_parser');

const EXACT_CATEGORY_NAMES = new Set([
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

const FORBIDDEN_CATEGORY_FRAGMENTS = [
  'итого',
  'всего',
  'общий итог',
  'подытог',
  'результат',
  'группа товаров',
  'категория товаров',
  'родительская категория',
];

function isServiceOrCategoryName(name) {
  const text = normalize(name);
  if (!text) return true;
  if (EXACT_CATEGORY_NAMES.has(text)) return true;
  return FORBIDDEN_CATEGORY_FRAGMENTS.some(fragment => text.includes(fragment));
}

function isProductRow(row) {
  if (!row.name || row.name.length < 4) return false;
  if (isServiceOrCategoryName(row.name)) return false;

  const looksLikeGroup = /\(\d+\)\s*$/.test(row.name);
  if (looksLikeGroup && !row.abc && !row.xyz) return false;

  return Boolean(row.article) || (row.priceNum !== null && row.priceNum > 0);
}

module.exports = {
  EXACT_CATEGORY_NAMES,
  FORBIDDEN_CATEGORY_FRAGMENTS,
  isServiceOrCategoryName,
  isProductRow,
};
